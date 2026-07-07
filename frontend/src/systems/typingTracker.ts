/**
 * Typing animation duration tracker.
 *
 * Owns the minimum-duration timer state machine that was previously inlined in
 * `useWebSocketEvents`. Pre/post tool-use events drive `onPreToolUse` /
 * `onPostToolUse`; the tracker enforces a minimum visible typing duration so
 * fast tool calls don't produce a sub-frame flicker. Pure-TS: no React, no
 * store imports — the routing callback (`setTyping`) is injected by the caller.
 */

/** Minimum time a typing indicator stays visible once turned on (ms). */
export const MIN_TYPING_DURATION_MS = 500;

/** Routes a typing on/off transition to the correct store slot. */
export type SetTypingFn = (key: string, typing: boolean) => void;

/**
 * Tracks per-key typing start times and pending clear timeouts.
 *
 * One instance per WebSocket hook. The caller owns the `setTyping` callback
 * (which routes "boss"/"main" → boss store, anything else → agent store).
 */
export class TypingTracker {
  private readonly startTimes = new Map<string, number>();
  private readonly timeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly setTyping: SetTypingFn,
    private readonly minDurationMs: number = MIN_TYPING_DURATION_MS,
  ) {}

  /**
   * Called on `pre_tool_use`. Clears any pending typing-off timeout for this
   * key, records the start time, and turns typing on immediately.
   */
  onPreToolUse(key: string): void {
    const existing = this.timeouts.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timeouts.delete(key);
    }
    this.startTimes.set(key, Date.now());
    this.setTyping(key, true);
  }

  /**
   * Called on `post_tool_use`. If the minimum visible duration hasn't elapsed,
   * schedule the typing-off callback for the remainder; otherwise turn typing
   * off immediately. Mirrors the original inlined state machine exactly.
   */
  onPostToolUse(key: string): void {
    const startTime = this.startTimes.get(key);
    const elapsed = startTime ? Date.now() - startTime : this.minDurationMs;
    const remaining = this.minDurationMs - elapsed;

    if (remaining > 0) {
      const timeout = setTimeout(() => {
        this.setTyping(key, false);
        this.timeouts.delete(key);
        this.startTimes.delete(key);
      }, remaining);
      this.timeouts.set(key, timeout);
    } else {
      this.setTyping(key, false);
      this.startTimes.delete(key);
    }
  }

  /**
   * Cancel all pending timeouts and clear start-time tracking.
   * Called on WebSocket teardown and on session_start (re-arm for a fresh run).
   */
  clear(): void {
    for (const timeout of this.timeouts.values()) {
      clearTimeout(timeout);
    }
    this.timeouts.clear();
    this.startTimes.clear();
  }
}
