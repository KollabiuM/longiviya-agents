/**
 * Characterization tests for `gameStore` — queue choreography, bubble
 * subsystem, the three reset variants, and `updateAgentMeta`.
 *
 * These tests pin EXISTING behavior so the planned frontend refactors
 * (ARC-004/005/006/017, QA-003/006) cannot silently change it. They assert
 * only on FINAL store state (after each action fully resolves), which survives
 * the QA-006 "collapse dequeue's two `set()` calls into one" fix.
 *
 * Add tests only — no source changes.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "@/stores/gameStore";
import type { Agent, BubbleContent, Position } from "@/types";

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------

const ORIGIN: Position = { x: 0, y: 0 };

/** Minimal backend Agent fixture; tests override fields as needed. */
function makeAgent(id: string, overrides: Partial<Agent> = {}): Agent {
  return {
    id,
    color: "#ff0000",
    number: 1,
    state: "working",
    ...overrides,
  };
}

function addAgent(id: string, overrides: Partial<Agent> = {}): void {
  useGameStore.getState().addAgent(makeAgent(id, overrides), ORIGIN);
}

const BUBBLE: BubbleContent = { type: "speech", text: "hi" };
const BUBBLE_B: BubbleContent = { type: "speech", text: "yo" };

/** Reset the store before every test so order never matters. */
beforeEach(() => {
  useGameStore.getState().reset();
});

// ---------------------------------------------------------------------------
// ADD / REMOVE
// ---------------------------------------------------------------------------

describe("addAgent", () => {
  it("inserts an agent with frontend-owned phase/queue defaults", () => {
    addAgent("A", { name: "Alice", desk: 2 });

    const agent = useGameStore.getState().agents.get("A");
    expect(agent).toBeDefined();
    expect(agent?.phase).toBe("arriving");
    expect(agent?.queueType).toBeNull();
    expect(agent?.queueIndex).toBe(-1);
    expect(agent?.name).toBe("Alice");
    expect(agent?.desk).toBe(2);
    // currentTask follows the backend `?? null` coercion.
    expect(agent?.currentTask).toBeNull();
  });

  it("grows deskCount to the next multiple of 4 that fits all agents", () => {
    addAgent("A");
    // deskCount starts at 8; one agent stays within the first row of 4, but
    // the formula is ceil((size + 1) / 4) * 4, so 1 agent → 8.
    expect(useGameStore.getState().deskCount).toBe(8);

    addAgent("B");
    addAgent("C");
    addAgent("D");
    addAgent("E");
    addAgent("F");
    addAgent("G");
    addAgent("H");
    // 8 agents → ceil((8+1)/4)*4 = ceil(2.25)*4 = 12.
    expect(useGameStore.getState().deskCount).toBe(12);
  });
});

describe("removeAgent", () => {
  it("drops the agent and scrubs them from both queues", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueDeparture("B");

    useGameStore.getState().removeAgent("A");

    expect(useGameStore.getState().agents.has("A")).toBe(false);
    expect(useGameStore.getState().arrivalQueue).not.toContain("A");
    // B unaffected.
    expect(useGameStore.getState().agents.get("B")?.queueType).toBe(
      "departure",
    );
  });
});

// ---------------------------------------------------------------------------
// QUEUE ACTIONS
// ---------------------------------------------------------------------------

describe("arrival queue", () => {
  it("enqueue appends and stamps queueType / queueIndex on the agent", () => {
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");

    expect(useGameStore.getState().arrivalQueue).toEqual(["A"]);
    const agent = useGameStore.getState().agents.get("A");
    expect(agent?.queueType).toBe("arrival");
    expect(agent?.queueIndex).toBe(0);
  });

  it("enqueue is a no-op when the id is already queued (guard against dupes)", () => {
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("A");

    expect(useGameStore.getState().arrivalQueue).toEqual(["A"]);
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
  });

  it("dequeue returns the front id, removes it, and re-indexes the rest 0..n-1", () => {
    addAgent("A");
    addAgent("B");
    addAgent("C");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("B");
    useGameStore.getState().enqueueArrival("C");

    const front = useGameStore.getState().dequeueArrival();

    expect(front).toBe("A");
    expect(useGameStore.getState().arrivalQueue).toEqual(["B", "C"]);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("C")?.queueIndex).toBe(1);
    // The dequeued agent's queueIndex is NOT touched by dequeue itself
    // (callers clear it via updateAgentQueueInfo). Characterized here so a
    // refactor that "helpfully" clears it shows up as a diff.
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
  });

  it("dequeue on an empty queue returns undefined and changes nothing", () => {
    const before = useGameStore.getState().arrivalQueue;
    const front = useGameStore.getState().dequeueArrival();

    expect(front).toBeUndefined();
    expect(useGameStore.getState().arrivalQueue).toBe(before);
  });

  it("interleaving: enqueue A then B, dequeue returns A and B becomes index 0", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().enqueueArrival("B");

    expect(useGameStore.getState().dequeueArrival()).toBe("A");
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
  });
});

describe("departure queue", () => {
  it("mirror behavior of the arrival queue with queueType='departure'", () => {
    addAgent("A");
    addAgent("B");
    useGameStore.getState().enqueueDeparture("A");
    useGameStore.getState().enqueueDeparture("B");
    useGameStore.getState().enqueueDeparture("A"); // dupe no-op

    expect(useGameStore.getState().departureQueue).toEqual(["A", "B"]);
    expect(useGameStore.getState().agents.get("A")?.queueType).toBe(
      "departure",
    );
    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(1);

    const front = useGameStore.getState().dequeueDeparture();
    expect(front).toBe("A");
    expect(useGameStore.getState().departureQueue).toEqual(["B"]);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(0);
  });

  it("dequeue on empty departure queue returns undefined", () => {
    expect(useGameStore.getState().dequeueDeparture()).toBeUndefined();
  });
});

describe("advanceQueue", () => {
  it("re-indexes every queued agent to match the current queue order", () => {
    addAgent("A");
    addAgent("B");
    addAgent("C");
    // Put them in the queue but deliberately desync their stored queueIndex.
    useGameStore.getState().arrivalQueue = ["A", "B", "C"];
    useGameStore.getState().updateAgentQueueInfo("A", "arrival", 99);
    useGameStore.getState().updateAgentQueueInfo("B", "arrival", 99);
    useGameStore.getState().updateAgentQueueInfo("C", "arrival", 99);

    useGameStore.getState().advanceQueue("arrival");

    expect(useGameStore.getState().agents.get("A")?.queueIndex).toBe(0);
    expect(useGameStore.getState().agents.get("B")?.queueIndex).toBe(1);
    expect(useGameStore.getState().agents.get("C")?.queueIndex).toBe(2);
  });

  it("is a no-op on an empty queue", () => {
    useGameStore.getState().advanceQueue("departure");
    expect(useGameStore.getState().departureQueue).toEqual([]);
  });
});

describe("syncQueues", () => {
  it("replaces both queues and re-stamps every listed agent's queue info", () => {
    addAgent("A");
    addAgent("B");
    addAgent("D");

    useGameStore.getState().syncQueues(["A", "B"], ["D"]);

    expect(useGameStore.getState().arrivalQueue).toEqual(["A", "B"]);
    expect(useGameStore.getState().departureQueue).toEqual(["D"]);
    expect(useGameStore.getState().agents.get("A")).toMatchObject({
      queueType: "arrival",
      queueIndex: 0,
    });
    expect(useGameStore.getState().agents.get("B")).toMatchObject({
      queueType: "arrival",
      queueIndex: 1,
    });
    expect(useGameStore.getState().agents.get("D")).toMatchObject({
      queueType: "departure",
      queueIndex: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// BUBBLE SUBSYSTEM
// ---------------------------------------------------------------------------

/**
 * Every bubble action has two branches: `entityId === "boss"` and an agent
 * branch. Each test below exercises both.
 */
describe("enqueueBubble — boss branch", () => {
  it("displays immediately when no bubble is current and not compacting", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE);
    expect(boss.bubble.displayStartTime).not.toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("queues when a bubble is already displaying", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    const firstStart = useGameStore.getState().boss.bubble.displayStartTime;
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE); // unchanged
    expect(boss.bubble.displayStartTime).toBe(firstStart); // unchanged
    expect(boss.bubble.queue).toEqual([BUBBLE_B]);
  });

  it("queues (does not display) during compactionPhase !== 'idle'", () => {
    useGameStore.getState().setCompactionPhase("jumping");
    useGameStore.getState().enqueueBubble("boss", BUBBLE);

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toBeNull();
    expect(boss.bubble.queue).toEqual([BUBBLE]);
  });

  it("displays during compaction when given { immediate: true }", () => {
    useGameStore.getState().setCompactionPhase("jumping");
    useGameStore.getState().enqueueBubble("boss", BUBBLE, { immediate: true });

    expect(useGameStore.getState().boss.bubble.content).toEqual(BUBBLE);
  });

  it("preserves already-queued bubbles when displaying a new one", () => {
    // Queue two bubbles during compaction so the queue fills.
    useGameStore.getState().setCompactionPhase("jumping");
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);

    // Compaction ends; the next bubble (with immediate) displays while the
    // previously-queued pair must survive in the queue.
    useGameStore.getState().setCompactionPhase("idle");
    const immediateC: BubbleContent = { type: "speech", text: "now" };
    useGameStore.getState().enqueueBubble("boss", immediateC, {
      immediate: true,
    });

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(immediateC);
    expect(boss.bubble.queue).toEqual([BUBBLE, BUBBLE_B]);
  });
});

describe("enqueueBubble — agent branch", () => {
  it("displays immediately when the agent has no current bubble", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);

    expect(useGameStore.getState().agents.get("A")?.bubble.content).toEqual(
      BUBBLE,
    );
  });

  it("queues when the agent already has a displaying bubble", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);
    useGameStore.getState().enqueueBubble("A", BUBBLE_B);

    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toEqual(BUBBLE);
    expect(bubble?.queue).toEqual([BUBBLE_B]);
  });

  it("is a no-op for an unknown agent id", () => {
    // No throw, no state change.
    useGameStore.getState().enqueueBubble("ghost", BUBBLE);
    expect(useGameStore.getState().agents.has("ghost")).toBe(false);
  });
});

describe("advanceBubble", () => {
  it("boss: pops the next queued bubble into content", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);
    useGameStore.getState().advanceBubble("boss");

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toEqual(BUBBLE_B);
    expect(boss.bubble.queue).toEqual([]);
  });

  it("boss: clears when the queue is empty", () => {
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().advanceBubble("boss"); // queue now empty
    useGameStore.getState().advanceBubble("boss"); // should clear

    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("agent: pops and clears analogously", () => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("A", BUBBLE);
    useGameStore.getState().enqueueBubble("A", BUBBLE_B);
    useGameStore.getState().advanceBubble("A");

    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toEqual(BUBBLE_B);
    expect(bubble?.queue).toEqual([]);
  });
});

describe("clearBubbles / getCurrentBubble / isBubbleQueueEmpty / hasBubbleText", () => {
  beforeEach(() => {
    addAgent("A");
    useGameStore.getState().enqueueBubble("boss", BUBBLE);
    useGameStore.getState().enqueueBubble("boss", BUBBLE_B);
    useGameStore.getState().enqueueBubble("A", BUBBLE);
  });

  it("clearBubbles resets boss bubble to empty state", () => {
    useGameStore.getState().clearBubbles("boss");
    const boss = useGameStore.getState().boss;
    expect(boss.bubble.content).toBeNull();
    expect(boss.bubble.queue).toEqual([]);
  });

  it("clearBubbles resets an agent's bubble to empty state", () => {
    useGameStore.getState().clearBubbles("A");
    const bubble = useGameStore.getState().agents.get("A")?.bubble;
    expect(bubble?.content).toBeNull();
    expect(bubble?.queue).toEqual([]);
  });

  it("getCurrentBubble returns the displaying content for boss and agent", () => {
    expect(useGameStore.getState().getCurrentBubble("boss")).toEqual(BUBBLE);
    expect(useGameStore.getState().getCurrentBubble("A")).toEqual(BUBBLE);
    expect(useGameStore.getState().getCurrentBubble("ghost")).toBeNull();
  });

  it("isBubbleQueueEmpty is false while anything is displaying or queued", () => {
    expect(useGameStore.getState().isBubbleQueueEmpty("boss")).toBe(false);
    expect(useGameStore.getState().isBubbleQueueEmpty("A")).toBe(false);
  });

  it("isBubbleQueueEmpty is true once cleared", () => {
    useGameStore.getState().clearBubbles("boss");
    useGameStore.getState().clearBubbles("A");
    expect(useGameStore.getState().isBubbleQueueEmpty("boss")).toBe(true);
    expect(useGameStore.getState().isBubbleQueueEmpty("A")).toBe(true);
  });

  it("hasBubbleText matches current content OR any queued bubble, for boss and agent", () => {
    expect(useGameStore.getState().hasBubbleText("boss", "hi")).toBe(true); // current
    expect(useGameStore.getState().hasBubbleText("boss", "yo")).toBe(true); // queued
    expect(useGameStore.getState().hasBubbleText("boss", "nope")).toBe(false);
    expect(useGameStore.getState().hasBubbleText("A", "hi")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// RESET VARIANTS
// ---------------------------------------------------------------------------

describe("reset variants", () => {
  function seedNonDefaults(): void {
    // Populate enough state that a "reset" is observable.
    addAgent("A");
    useGameStore.getState().enqueueArrival("A");
    useGameStore.getState().setSessionId("sess-123");
    useGameStore.getState().setDeskCount(16);
    useGameStore.getState().setDebugMode(true);
    useGameStore.getState().setWhiteboardMode(5);
    useGameStore.getState().setReplaying(true);
  }

  describe("reset()", () => {
    beforeEach(seedNonDefaults);

    it("restores initialState with a fresh empty agents Map", () => {
      useGameStore.getState().reset();
      const s = useGameStore.getState();
      expect(s.agents.size).toBe(0);
      expect(s.arrivalQueue).toEqual([]);
      expect(s.sessionId).toBe("None");
      expect(s.deskCount).toBe(8);
    });

    it("clears debugMode and whiteboardMode back to defaults", () => {
      useGameStore.getState().reset();
      const s = useGameStore.getState();
      expect(s.debugMode).toBe(false);
      expect(s.whiteboardMode).toBe(0);
    });

    it("leaves isReplaying false", () => {
      useGameStore.getState().reset();
      expect(useGameStore.getState().isReplaying).toBe(false);
    });
  });

  describe("resetForReplay()", () => {
    beforeEach(seedNonDefaults);

    it("resets game state like reset() but also sets isReplaying=true", () => {
      useGameStore.getState().resetForReplay();
      const s = useGameStore.getState();
      expect(s.agents.size).toBe(0);
      expect(s.arrivalQueue).toEqual([]);
      expect(s.sessionId).toBe("None");
      expect(s.deskCount).toBe(8);
      expect(s.isReplaying).toBe(true);
    });
  });

  describe("resetForSessionSwitch()", () => {
    beforeEach(seedNonDefaults);

    it("clears game state (agents, queues, sessionId, deskCount)", () => {
      useGameStore.getState().resetForSessionSwitch();
      const s = useGameStore.getState();
      expect(s.agents.size).toBe(0);
      expect(s.arrivalQueue).toEqual([]);
      expect(s.departureQueue).toEqual([]);
      expect(s.sessionId).toBe("None");
      expect(s.deskCount).toBe(8);
    });

    it("PRESERVES debugMode and debug overlay toggles (user preference)", () => {
      useGameStore.getState().resetForSessionSwitch();
      const s = useGameStore.getState();
      expect(s.debugMode).toBe(true);
    });

    it("PRESERVES whiteboardMode (user preference)", () => {
      useGameStore.getState().resetForSessionSwitch();
      expect(useGameStore.getState().whiteboardMode).toBe(5);
    });

    it("sets isReplaying=false so the WebSocket may reconnect", () => {
      useGameStore.getState().resetForSessionSwitch();
      expect(useGameStore.getState().isReplaying).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// updateAgentMeta
// ---------------------------------------------------------------------------

describe("updateAgentMeta", () => {
  beforeEach(() => {
    addAgent("A", { name: "Alice", currentTask: "old task" });
  });

  it("name: null keeps the previous name (?? nullish fallback)", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: "old task",
    });
    // `name ?? agent.name` — null is nullish, so the old name is retained.
    expect(useGameStore.getState().agents.get("A")?.name).toBe("Alice");
  });

  it("currentTask: a non-empty new task replaces the old one (|| fallback)", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: "brand new",
    });
    expect(useGameStore.getState().agents.get("A")?.currentTask).toBe(
      "brand new",
    );
  });

  it("currentTask: null keeps the previous task (|| falsy fallback)", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "working",
      name: null,
      currentTask: null,
    });
    expect(useGameStore.getState().agents.get("A")?.currentTask).toBe(
      "old task",
    );
  });

  it("always overwrites backendState with the supplied value", () => {
    useGameStore.getState().updateAgentMeta("A", {
      backendState: "thinking",
      name: null,
      currentTask: null,
    });
    expect(useGameStore.getState().agents.get("A")?.backendState).toBe(
      "thinking",
    );
  });

  // NOTE: `currentTask: ""` is deliberately NOT tested here — that case is the
  // known QA-012 bug (`||` treats "" as falsy and keeps the old task) and
  // changes when QA-012 lands. QA-012 adds its own test.
});
