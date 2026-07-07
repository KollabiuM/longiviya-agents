/**
 * Session-tracking state for the claude-office OpenCode plugin.
 *
 * Encapsulates the seven module-level Map/Set structures the plugin previously
 * kept at module scope, plus the order-dependent session-linking heuristics
 * that map OpenCode lifecycle events onto the backend's event model.
 *
 * The transport (`sendEvent`) is constructor-injected so unit tests can
 * characterize the heuristics without the real fetch path, and so that
 * SEC-005 (plugin `X-API-Key` support) can later centralize header
 * injection here without touching every call site.
 *
 * FIFO callID-matching between task-tool calls and child sessions is
 * approximate by design — OpenCode does not expose which child session
 * corresponds to which callID — and must not be "improved" without
 * characterizing the current behavior first (see
 * `tests/sessionTracker.test.ts`).
 */

import type { BackendEvent } from "./index";

export class SessionTracker {
  /** Sessions we've already emitted session_start for (start dedup). */
  private readonly activeSessions = new Set<string>();

  /** child session ID -> parent session ID (@mention subagents only). */
  private readonly childToParent = new Map<string, string>();

  /** child session ID -> agent name (@mention subagents only). */
  private readonly childToAgent = new Map<string, string>();

  /** parent session ID -> FIFO queue of pending task-tool callIDs. */
  private readonly pendingTaskCalls = new Map<string, string[]>();

  /** child session ID -> task-tool callID (task-tool-spawned children only). */
  private readonly childSessionToCallId = new Map<string, string>();

  /** child session ID -> parent session ID (task-tool-spawned children only). */
  private readonly childSessionToParent = new Map<string, string>();

  /** Child sessions we've already emitted subagent_stop for (stop dedup). */
  private readonly childStopped = new Set<string>();

  constructor(
    private readonly sendEvent: (event: BackendEvent) => Promise<void>,
  ) {}

  /**
   * Emit a BackendEvent via the injected transport. Today the orchestration
   * (deciding WHICH event to send) lives in index.ts; routing the actual
   * send through this method is what lets SEC-005 centralize X-API-Key
   * header injection later without touching every call site.
   */
  async emit(event: BackendEvent): Promise<void> {
    await this.sendEvent(event);
  }

  // ---- activeSessions ----

  isSessionActive(id: string): boolean {
    return this.activeSessions.has(id);
  }

  markSessionActive(id: string): void {
    this.activeSessions.add(id);
  }

  clearActiveSession(id: string): void {
    this.activeSessions.delete(id);
  }

  // ---- pendingTaskCalls (FIFO callID matching) ----

  /**
   * Append a callID to the parent's pending-callID FIFO. When a child
   * session later appears with this parent, the oldest callID is shifted
   * off and linked to the child (suppressing duplicate subagent_start).
   */
  registerTaskCall(parentSessionId: string, callID: string): void {
    const pending = this.pendingTaskCalls.get(parentSessionId) ?? [];
    pending.push(callID);
    this.pendingTaskCalls.set(parentSessionId, pending);
  }

  /**
   * Remove a specific pending callID (used by tool.execute.after when a
   * task tool finishes — handles the error case where the child session
   * never appeared so the FIFO doesn't leak).
   */
  removePendingTaskCall(parentSessionId: string, callID: string): void {
    const pending = this.pendingTaskCalls.get(parentSessionId);
    if (!pending) return;
    const idx = pending.indexOf(callID);
    if (idx !== -1) {
      pending.splice(idx, 1);
      if (pending.length === 0) {
        this.pendingTaskCalls.delete(parentSessionId);
      }
    }
  }

  /**
   * Try to link a newly-created child session to a pending task-tool
   * callID. FIFO-shifts the OLDEST pending callID for this parent and
   * records the child<->callID<->parent linkage. Returns `undefined` if
   * the parent has no pending task calls — signalling a true @mention
   * subagent that should emit its own subagent_start.
   */
  linkChildSession(
    childSessionId: string,
    parentId: string,
  ): { parentId: string; callID: string } | undefined {
    const pending = this.pendingTaskCalls.get(parentId);
    if (!pending || pending.length === 0) return undefined;
    const callID = pending.shift() as string;
    if (pending.length === 0) {
      this.pendingTaskCalls.delete(parentId);
    }
    this.childSessionToCallId.set(childSessionId, callID);
    this.childSessionToParent.set(childSessionId, parentId);
    return { parentId, callID };
  }

  // ---- @mention child maps ----

  registerMentionChild(
    childSessionId: string,
    parentId: string,
    agentName: string,
  ): void {
    this.childToParent.set(childSessionId, parentId);
    this.childToAgent.set(childSessionId, agentName);
  }

  hasMentionChild(childSessionId: string): boolean {
    return this.childToParent.has(childSessionId);
  }

  getMentionChildParent(childSessionId: string): string | undefined {
    return this.childToParent.get(childSessionId);
  }

  /**
   * Returns the stored agent name for an @mention child, or `undefined`
   * if none. Callers apply `?? "subagent"` at use sites to preserve the
   * original fallback behavior.
   */
  getMentionChildAgent(childSessionId: string): string | undefined {
    return this.childToAgent.get(childSessionId);
  }

  setMentionChildAgent(childSessionId: string, agentName: string): void {
    this.childToAgent.set(childSessionId, agentName);
  }

  /**
   * Drop the @mention child entries from childToParent and childToAgent.
   * Does NOT touch childStopped — the caller manages that separately to
   * preserve dedup order across idle->deleted.
   */
  clearMentionChildMaps(childSessionId: string): void {
    this.childToParent.delete(childSessionId);
    this.childToAgent.delete(childSessionId);
  }

  // ---- task-tool child maps ----

  isTaskToolChild(childSessionId: string): boolean {
    return this.childSessionToCallId.has(childSessionId);
  }

  getTaskToolChildParent(childSessionId: string): string | undefined {
    return this.childSessionToParent.get(childSessionId);
  }

  getTaskToolChildCallId(childSessionId: string): string | undefined {
    return this.childSessionToCallId.get(childSessionId);
  }

  /**
   * Drop the task-tool child entries. Does NOT touch childStopped.
   */
  clearTaskToolChildMaps(childSessionId: string): void {
    this.childSessionToCallId.delete(childSessionId);
    this.childSessionToParent.delete(childSessionId);
  }

  // ---- childStopped (duplicate stop suppression) ----

  /**
   * Mark a child session as stopped. Returns `true` if this is the first
   * stop event for this child (the caller should emit subagent_stop), or
   * `false` if the child was already stopped (suppress the duplicate).
   */
  markChildStopped(childSessionId: string): boolean {
    if (this.childStopped.has(childSessionId)) return false;
    this.childStopped.add(childSessionId);
    return true;
  }

  /**
   * Drop the stopped marker for a child. Called after terminal event
   * processing (session.deleted) so the Set doesn't grow unbounded over
   * the process lifetime — the marker only needs to survive idle->deleted.
   */
  clearChildStopped(childSessionId: string): void {
    this.childStopped.delete(childSessionId);
  }
}
