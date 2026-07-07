/**
 * Characterization tests for `SessionTracker`.
 *
 * These tests pin down the order-dependent session-linking heuristics the
 * plugin uses to map OpenCode lifecycle events onto the backend's event
 * model. The FIFO callID-matching between task-tool calls and child
 * sessions is approximate by design — OpenCode does not expose which
 * child session corresponds to which callID — and these tests characterize
 * the current behavior so future changes (e.g. SEC-005's API-key routing)
 * cannot silently break it.
 *
 * The transport is a recording stub so tests never hit the network.
 */

import { describe, it, expect } from "bun:test";
import { SessionTracker } from "../src/sessionTracker";
import type { BackendEvent } from "../src/index";

/** Recording stub for the injected transport. */
function makeRecordingSendEvent(): {
  sendEvent: (event: BackendEvent) => Promise<void>;
  events: BackendEvent[];
} {
  const events: BackendEvent[] = [];
  return {
    events,
    sendEvent: (event: BackendEvent) => {
      events.push(event);
      return Promise.resolve();
    },
  };
}

/** Build a tracker backed by a recording stub. */
function makeTracker(): {
  tracker: SessionTracker;
  events: BackendEvent[];
} {
  const { sendEvent, events } = makeRecordingSendEvent();
  return { tracker: new SessionTracker(sendEvent), events };
}

describe("SessionTracker", () => {
  // -------------------------------------------------------------------------
  // activeSessions
  // -------------------------------------------------------------------------

  describe("activeSessions", () => {
    it("marks and detects active sessions", () => {
      const { tracker } = makeTracker();
      expect(tracker.isSessionActive("S1")).toBe(false);
      tracker.markSessionActive("S1");
      expect(tracker.isSessionActive("S1")).toBe(true);
    });

    it("clearActiveSession removes the marker", () => {
      const { tracker } = makeTracker();
      tracker.markSessionActive("S1");
      tracker.clearActiveSession("S1");
      expect(tracker.isSessionActive("S1")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // FIFO callID matching (the approximate heuristic the code documents)
  // -------------------------------------------------------------------------

  describe("FIFO callID matching", () => {
    it("links children to pending callIDs in registration order", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.registerTaskCall("P", "C2");

      const first = tracker.linkChildSession("child-1", "P");
      const second = tracker.linkChildSession("child-2", "P");

      expect(first).toEqual({ parentId: "P", callID: "C1" });
      expect(second).toEqual({ parentId: "P", callID: "C2" });
    });

    it("records the linkage so the child is recognized as a task-tool child", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");

      tracker.linkChildSession("child-1", "P");

      expect(tracker.isTaskToolChild("child-1")).toBe(true);
      expect(tracker.getTaskToolChildParent("child-1")).toBe("P");
      expect(tracker.getTaskToolChildCallId("child-1")).toBe("C1");
    });

    it("cleared the FIFO map entry once the last callID is consumed", () => {
      // Guards against unbounded growth of the per-parent pendingCall queue.
      // Re-register after drain and confirm it behaves as a fresh FIFO.
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      expect(tracker.linkChildSession("child-1", "P")?.callID).toBe("C1");

      // After drain, a new child should NOT match (returns undefined).
      expect(tracker.linkChildSession("child-2", "P")).toBeUndefined();

      // Re-registering works as a fresh FIFO.
      tracker.registerTaskCall("P", "C2");
      expect(tracker.linkChildSession("child-3", "P")?.callID).toBe("C2");
    });
  });

  // -------------------------------------------------------------------------
  // Child arrives with no pending callID -> @mention subagent path
  // -------------------------------------------------------------------------

  describe("child without pending task call", () => {
    it("linkChildSession returns undefined when parent has no FIFO", () => {
      const { tracker } = makeTracker();
      expect(tracker.linkChildSession("child-1", "P")).toBeUndefined();
    });

    it("linkChildSession returns undefined when parent FIFO is empty after drain", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.linkChildSession("child-1", "P");
      expect(tracker.linkChildSession("child-2", "P")).toBeUndefined();
    });

    it("does not record the child as a task-tool child when unmatched", () => {
      const { tracker } = makeTracker();
      tracker.linkChildSession("child-1", "P");
      expect(tracker.isTaskToolChild("child-1")).toBe(false);
      expect(tracker.getTaskToolChildParent("child-1")).toBeUndefined();
      expect(tracker.getTaskToolChildCallId("child-1")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Interleaved parents: no cross-matching
  // -------------------------------------------------------------------------

  describe("interleaved parents", () => {
    it("does not cross-match callIDs between parents", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P1", "C1-A");
      tracker.registerTaskCall("P2", "C2-A");

      // First child of P1 must get C1-A, not C2-A.
      expect(tracker.linkChildSession("child-1", "P1")?.callID).toBe("C1-A");
      // First child of P2 must get C2-A.
      expect(tracker.linkChildSession("child-2", "P2")?.callID).toBe("C2-A");
    });

    it("draining one parent does not affect another parent's FIFO", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P1", "C1-A");
      tracker.registerTaskCall("P1", "C1-B");
      tracker.registerTaskCall("P2", "C2-A");

      tracker.linkChildSession("child-1", "P1");

      // P2 still has its call.
      expect(tracker.linkChildSession("child-2", "P2")?.callID).toBe("C2-A");
      // P1 still has its second call.
      expect(tracker.linkChildSession("child-3", "P1")?.callID).toBe("C1-B");
    });
  });

  // -------------------------------------------------------------------------
  // Cleanup: removing pending calls and clearing child state
  // -------------------------------------------------------------------------

  describe("removePendingTaskCall (tool.execute.after cleanup)", () => {
    it("removes a specific pending callID so it cannot be linked later", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.registerTaskCall("P", "C2");
      tracker.removePendingTaskCall("P", "C1");

      // Next child should link to C2, NOT C1.
      expect(tracker.linkChildSession("child-1", "P")?.callID).toBe("C2");
    });

    it("preserves FIFO order of remaining callIDs", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.registerTaskCall("P", "C2");
      tracker.registerTaskCall("P", "C3");

      tracker.removePendingTaskCall("P", "C2");

      expect(tracker.linkChildSession("child-1", "P")?.callID).toBe("C1");
      expect(tracker.linkChildSession("child-2", "P")?.callID).toBe("C3");
    });

    it("is a no-op for an unknown parent", () => {
      const { tracker } = makeTracker();
      // Should not throw.
      tracker.removePendingTaskCall("UNKNOWN", "C1");
    });

    it("is a no-op for an unknown callID on a known parent", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.removePendingTaskCall("P", "MISSING");
      expect(tracker.linkChildSession("child-1", "P")?.callID).toBe("C1");
    });

    it("drops the FIFO map entry once the last callID is removed", () => {
      // Mirrors the drain-and-re-register behavior the plugin relies on
      // so the pendingCalls map doesn't accumulate empty arrays.
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.removePendingTaskCall("P", "C1");

      // A new child must not match — FIFO is gone, not just empty.
      expect(tracker.linkChildSession("child-1", "P")).toBeUndefined();
    });
  });

  describe("clearTaskToolChildMaps", () => {
    it("removes the task-tool child linkage", () => {
      const { tracker } = makeTracker();
      tracker.registerTaskCall("P", "C1");
      tracker.linkChildSession("child-1", "P");

      tracker.clearTaskToolChildMaps("child-1");

      expect(tracker.isTaskToolChild("child-1")).toBe(false);
      expect(tracker.getTaskToolChildParent("child-1")).toBeUndefined();
      expect(tracker.getTaskToolChildCallId("child-1")).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Duplicate stop suppression (the childStopped Set)
  // -------------------------------------------------------------------------

  describe("markChildStopped (duplicate stop suppression)", () => {
    it("returns true the first time a child is marked stopped", () => {
      const { tracker } = makeTracker();
      expect(tracker.markChildStopped("child-1")).toBe(true);
    });

    it("returns false on subsequent marks for the same child (suppress duplicate subagent_stop)", () => {
      const { tracker } = makeTracker();
      expect(tracker.markChildStopped("child-1")).toBe(true);
      expect(tracker.markChildStopped("child-1")).toBe(false);
      expect(tracker.markChildStopped("child-1")).toBe(false);
    });

    it("tracks different children independently", () => {
      const { tracker } = makeTracker();
      expect(tracker.markChildStopped("child-1")).toBe(true);
      expect(tracker.markChildStopped("child-2")).toBe(true);
      expect(tracker.markChildStopped("child-1")).toBe(false);
      expect(tracker.markChildStopped("child-2")).toBe(false);
    });

    it("clearChildStopped allows the marker to be set again (idle->deleted lifecycle)", () => {
      // session.idle marks stopped (emit), then session.deleted clears the
      // marker so the Set doesn't grow unbounded.
      const { tracker } = makeTracker();
      tracker.markChildStopped("child-1");
      tracker.clearChildStopped("child-1");
      // After clear, marking again reports first-time.
      expect(tracker.markChildStopped("child-1")).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // @mention child lifecycle (registerMentionChild + lookups + clear)
  // -------------------------------------------------------------------------

  describe("@mention child maps", () => {
    it("registerMentionChild records parent and agent name", () => {
      const { tracker } = makeTracker();
      tracker.registerMentionChild("child-1", "P", "researcher");

      expect(tracker.hasMentionChild("child-1")).toBe(true);
      expect(tracker.getMentionChildParent("child-1")).toBe("P");
      expect(tracker.getMentionChildAgent("child-1")).toBe("researcher");
    });

    it("getMentionChildAgent returns undefined when no name stored (caller applies fallback)", () => {
      // Preserves the original `childToAgent.get(id) ?? "subagent"` pattern:
      // callers own the fallback, not the tracker.
      const { tracker } = makeTracker();
      expect(tracker.getMentionChildAgent("missing")).toBeUndefined();
    });

    it("setMentionChildAgent updates the stored name", () => {
      const { tracker } = makeTracker();
      tracker.registerMentionChild("child-1", "P", "researcher");

      // session.updated path: title differs from stored name -> update.
      tracker.setMentionChildAgent("child-1", "Titled Agent");

      expect(tracker.getMentionChildAgent("child-1")).toBe("Titled Agent");
    });

    it("clearMentionChildMaps removes parent and agent entries", () => {
      const { tracker } = makeTracker();
      tracker.registerMentionChild("child-1", "P", "researcher");

      tracker.clearMentionChildMaps("child-1");

      expect(tracker.hasMentionChild("child-1")).toBe(false);
      expect(tracker.getMentionChildParent("child-1")).toBeUndefined();
      expect(tracker.getMentionChildAgent("child-1")).toBeUndefined();
    });

    it("clearMentionChildMaps does NOT touch the childStopped marker", () => {
      // Important: in session.deleted, the original code reads parent+agent,
      // clears the maps, THEN checks/stops, THEN clears the stopped marker.
      // Clearing maps early must not also clear the stop marker — that would
      // re-enable a duplicate subagent_stop emission.
      const { tracker } = makeTracker();
      tracker.registerMentionChild("child-1", "P", "researcher");
      tracker.markChildStopped("child-1");

      tracker.clearMentionChildMaps("child-1");

      // The stopped marker survives — so a second mark is still suppressed.
      expect(tracker.markChildStopped("child-1")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle: session.created -> session.idle -> session.deleted
  // (characterizes the @mention subagent flow end-to-end at the state layer)
  // -------------------------------------------------------------------------

  describe("@mention subagent full lifecycle", () => {
    it("emits subagent_stop at most once across idle + deleted", () => {
      // Simulates the orchestration index.ts does for an @mention child.
      // The state-machine invariant: subagent_stop fires exactly once per
      // child, even though both session.idle and session.deleted try.
      const { tracker } = makeTracker();
      const childID = "child-1";
      const parentID = "P";
      const agentName = "researcher";

      tracker.registerMentionChild(childID, parentID, agentName);

      // session.idle fires first.
      const stopOnIdle = tracker.markChildStopped(childID);
      expect(stopOnIdle).toBe(true);

      // session.deleted fires later — must NOT emit a duplicate stop.
      const stopOnDeleted = tracker.markChildStopped(childID);
      expect(stopOnDeleted).toBe(false);

      // Terminal cleanup clears the marker so the Set doesn't grow.
      tracker.clearMentionChildMaps(childID);
      tracker.clearChildStopped(childID);
    });
  });

  // -------------------------------------------------------------------------
  // Transport injection (precondition for SEC-005's API-key routing)
  // -------------------------------------------------------------------------

  describe("injected transport", () => {
    it("emit() forwards to the injected sendEvent", async () => {
      const { sendEvent, events } = makeRecordingSendEvent();
      const tracker = new SessionTracker(sendEvent);

      const event: BackendEvent = {
        event_type: "session_start",
        session_id: "S1",
        timestamp: "2026-07-07T00:00:00.000Z",
        data: {},
      };
      await tracker.emit(event);

      expect(events).toEqual([event]);
    });
  });
});
