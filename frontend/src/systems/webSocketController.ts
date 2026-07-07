/**
 * WebSocket transport controller.
 *
 * Owns the connect/reconnect lifecycle that was previously inlined in
 * `useWebSocketEvents`. Lift-and-shift: the reconnect mechanics (exponential
 * backoff, connection-id invalidation for stale `onclose` handlers, session-id
 * guards) are preserved byte-for-byte. The hook constructs one instance and
 * keeps `opts` fresh on each render so callbacks always close over current
 * state without re-creating the controller.
 *
 * The current protocol is receive-only (no `send()` / heartbeat), so the
 * controller exposes only `connect` / `disconnect`. Adding send/heartbeat
 * later is a strict addition here.
 */

export interface WebSocketControllerOptions {
  /** Active session id — drives the WS path and stale-session guards. */
  sessionId: string;
  /** When false, the controller will not (re)connect. */
  enabled: boolean;
  /** Base URL for the WebSocket (controller appends `/ws/${sessionId}`). */
  baseUrl: string;
  /** Receives every `MessageEvent` on the current connection. */
  onMessage: (event: MessageEvent) => void;
  /** Invoked from `onopen` to clear stale tracking state (processed agents, bubbles, spawn index). */
  onReconnectReset: () => void;
  /** Reports connection state changes to the store. */
  setConnected: (connected: boolean) => void;
  /** Reports the active session id to the store once the socket is open. */
  setSessionId: (sessionId: string) => void;
  /** True while the store is in replay mode (skips connecting). */
  isReplaying: () => boolean;
  /** True if `id` is still the session this controller should be talking to. */
  isCurrentSession: (id: string) => boolean;
}

/**
 * Encapsulates one logical WebSocket connection (with reconnect support).
 *
 * The hook wires this to React: it creates a single instance, updates
 * `controller.opts` each render, and calls `connect()` / `disconnect()` from
 * a `useEffect`.
 */
export class WebSocketController {
  private ws: WebSocket | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private retryCount = 0;
  /** Monotonic id bumped on each `connect()`; stale handlers compare against it. */
  private connectionId = 0;

  constructor(public opts: WebSocketControllerOptions) {}

  /**
   * Open a fresh connection. Increments the connection id (invalidating any
   * pending `onclose` from a prior connection), closes the old socket, clears
   * any pending reconnect, and wires `onopen` / `onmessage` / `onerror` /
   * `onclose`. The `onclose` handler implements exponential backoff with the
   * same session-id guards as the original inlined implementation.
   */
  connect(): void {
    const { sessionId, enabled, baseUrl, isReplaying } = this.opts;
    if (!sessionId || isReplaying()) return;

    // Increment connection id to invalidate any pending onclose handlers.
    this.connectionId++;
    const thisConnectionId = this.connectionId;

    // Clean up existing connection.
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    // Clear any pending reconnect timeout.
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    const ws = new WebSocket(`${baseUrl}/ws/${sessionId}`);
    this.ws = ws;

    ws.onopen = () => {
      // Stale handler guard.
      if (this.connectionId !== thisConnectionId) {
        ws.close();
        return;
      }
      this.retryCount = 0;
      this.opts.setConnected(true);
      this.opts.setSessionId(sessionId);
      this.opts.onReconnectReset();
    };

    ws.onmessage = (event) => {
      if (this.connectionId !== thisConnectionId) return;
      this.opts.onMessage(event);
    };

    ws.onerror = () => {
      if (this.connectionId !== thisConnectionId) return;
      console.warn("[WS] Connection error — will retry");
    };

    ws.onclose = (event) => {
      // Stale handler guard — prevents double-reconnect from old connections.
      if (this.connectionId !== thisConnectionId) return;

      void event; // Acknowledge parameter (parity with original).
      this.opts.setConnected(false);

      if (enabled && this.opts.isCurrentSession(sessionId)) {
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        this.retryCount++;
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          if (this.opts.isCurrentSession(sessionId)) {
            this.connect();
          }
        }, delay);
      }
    };
  }

  /**
   * Tear down the current connection: closes the socket and cancels any
   * pending reconnect. Idempotent.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}
