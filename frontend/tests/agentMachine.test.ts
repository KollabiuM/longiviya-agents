/**
 * Characterization tests for the agent state machine.
 *
 * The machine is designed for testability: `createAgentMachine(actions)` takes
 * an injected `AgentMachineActions` interface, so we can drive it with a
 * recording fake and assert state transitions / notifications WITHOUT the real
 * render loop, the real `gameStore`, or the `animationSystem`.
 *
 * These tests pin the CURRENT notification sequence and queue-context wiring
 * so the ARC-004/017 refactor (single-writer ownership, deferred events) cannot
 * silently change observable behavior. Add tests only — no source changes.
 */

import { createActor } from "xstate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentMachine } from "@/machines/agentMachine";
import {
  buildSharedActions,
  defaultAgentContext,
  getRandomFarewell,
  sharedDelays,
  sharedGuards,
  type AgentMachineActions,
  type AgentMachineContext,
} from "@/machines/agentMachineCommon";
import type { Position } from "@/types";

// ---------------------------------------------------------------------------
// RECORDER
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] };

/** A recording stand-in for the `AgentMachineActions` interface. */
function makeRecordingActions(): AgentMachineActions & { calls: Call[] } {
  const calls: Call[] = [];
  const stub =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  return {
    onStartWalking: stub("onStartWalking"),
    onQueueJoined: stub("onQueueJoined"),
    onQueueLeft: stub("onQueueLeft"),
    onPhaseChanged: stub("onPhaseChanged"),
    onShowBossBubble: stub("onShowBossBubble"),
    onShowAgentBubble: stub("onShowAgentBubble"),
    onClearBossBubble: stub("onClearBossBubble"),
    onClearAgentBubble: stub("onClearAgentBubble"),
    onSetBossInUse: stub("onSetBossInUse"),
    onOpenElevator: stub("onOpenElevator"),
    onCloseElevator: stub("onCloseElevator"),
    onAgentRemoved: stub("onAgentRemoved"),
    calls,
  };
}

const P: Position = { x: 10, y: 20 };

function ctx(
  overrides: Partial<AgentMachineContext> = {},
): AgentMachineContext {
  return { ...defaultAgentContext, agentId: "A", ...overrides };
}

// ---------------------------------------------------------------------------
// PURE HELPERS / CONSTANTS
// ---------------------------------------------------------------------------

describe("defaultAgentContext", () => {
  it("starts with no queue affiliation and a -1 queueIndex", () => {
    expect(defaultAgentContext.queueType).toBeNull();
    expect(defaultAgentContext.queueIndex).toBe(-1);
    expect(defaultAgentContext.agentId).toBe("");
    expect(defaultAgentContext.agentName).toBeNull();
    expect(defaultAgentContext.desk).toBeNull();
    expect(defaultAgentContext.conversationStep).toBe(0);
  });
});

describe("sharedDelays", () => {
  it("pins the exact delay constants the machine schedules on", () => {
    // The conversing safety-net timeout and door-close buffer are load-bearing
    // for the agent-stuck-at-A0 bug class. Lock them down.
    expect(sharedDelays.BOSS_PAUSE).toBe(100);
    expect(sharedDelays.ELEVATOR_PAUSE).toBe(500);
    expect(sharedDelays.DOOR_CLOSE_DELAY).toBe(520);
    expect(sharedDelays.CONVERSATION_TIMEOUT).toBe(5000);
  });
});

describe("sharedGuards", () => {
  it("isAtFrontOfQueue is true iff queueIndex === 0", () => {
    expect(
      sharedGuards.isAtFrontOfQueue({ context: ctx({ queueIndex: 0 }) }),
    ).toBe(true);
    expect(
      sharedGuards.isAtFrontOfQueue({ context: ctx({ queueIndex: 1 }) }),
    ).toBe(false);
    expect(
      sharedGuards.isAtFrontOfQueue({ context: ctx({ queueIndex: -1 }) }),
    ).toBe(false);
  });

  it("isArrival / isDeparture read queueType", () => {
    expect(
      sharedGuards.isArrival({ context: ctx({ queueType: "arrival" }) }),
    ).toBe(true);
    expect(
      sharedGuards.isArrival({ context: ctx({ queueType: "departure" }) }),
    ).toBe(false);
    expect(
      sharedGuards.isDeparture({ context: ctx({ queueType: "departure" }) }),
    ).toBe(true);
    expect(
      sharedGuards.isDeparture({ context: ctx({ queueType: null }) }),
    ).toBe(false);
  });
});

describe("getRandomFarewell", () => {
  it("returns a non-empty string (deterministic shape, random pick)", () => {
    for (let i = 0; i < 20; i++) {
      const s = getRandomFarewell();
      expect(typeof s).toBe("string");
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSharedActions
// ---------------------------------------------------------------------------

describe("buildSharedActions", () => {
  it("notifyPhaseChange forwards agentId + the supplied phase param", () => {
    const rec = makeRecordingActions();
    buildSharedActions(rec).notifyPhaseChange(
      { context: ctx({ agentId: "A" }) },
      { phase: "walking_to_desk" },
    );
    expect(rec.calls).toEqual([
      { method: "onPhaseChanged", args: ["A", "walking_to_desk"] },
    ]);
  });

  it("startWalkingTo* variants tag the movementType so the service can route", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);
    const c = ctx({ agentId: "A", targetPosition: P });
    actions.startWalkingToQueue({ context: c });
    actions.startWalkingToReady({ context: c });
    actions.startWalkingToBoss({ context: c });
    actions.startWalkingToDesk({ context: c });
    actions.startWalkingToElevator({ context: c });

    const types = rec.calls.map((c) => c.args[2]);
    expect(types).toEqual([
      "to_arrival_queue", // queueType defaults to "arrival" when null
      "to_ready",
      "to_boss",
      "to_desk",
      "to_elevator",
    ]);
    // Every call also passes the agentId and target position.
    for (const call of rec.calls) {
      expect(call.args[0]).toBe("A");
      expect(call.args[1]).toBe(P);
    }
  });

  it("startWalkingToQueue derives 'to_departure_queue' when queueType is departure", () => {
    const rec = makeRecordingActions();
    buildSharedActions(rec).startWalkingToQueue({
      context: ctx({ queueType: "departure" }),
    });
    expect(rec.calls[0].args[2]).toBe("to_departure_queue");
  });

  it("joinQueue / leaveQueue forward queueType+index / agentId", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);
    actions.joinQueue({
      context: ctx({ queueType: "arrival", queueIndex: 2 }),
    });
    actions.leaveQueue({ context: ctx({ agentId: "A" }) });
    expect(rec.calls).toEqual([
      { method: "onQueueJoined", args: ["A", "arrival", 2] },
      { method: "onQueueLeft", args: ["A"] },
    ]);
  });

  it("joinQueue is a no-op when queueType is null (defensive guard)", () => {
    const rec = makeRecordingActions();
    buildSharedActions(rec).joinQueue({ context: ctx({ queueType: null }) });
    expect(rec.calls).toEqual([]);
  });

  it("arrival bubble actions use the agent name (defaulting to 'Agent') and pass an icon", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);

    actions.showArrivalBossBubble({ context: ctx({ agentName: "Alice" }) });
    actions.showArrivalAgentBubble({ context: ctx({ agentId: "A" }) });

    expect(rec.calls[0]).toMatchObject({
      method: "onShowBossBubble",
      args: ["Here's your task, Alice!", "clipboard"],
    });
    expect(rec.calls[1]).toMatchObject({
      method: "onShowAgentBubble",
      args: ["A", expect.any(String), "thumbs-up"],
    });
  });

  it("departure bubble actions use their own copy and icons", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);

    actions.showDepartureBossBubble({ context: ctx({ agentName: "Bob" }) });
    actions.showDepartureAgentBubble({ context: ctx({ agentId: "A" }) });
    actions.showFarewellBubble({ context: ctx({ agentId: "A" }) });

    expect(rec.calls[0]).toMatchObject({
      method: "onShowBossBubble",
      args: ["Good work, Bob. I'll take that.", "check"],
    });
    expect(rec.calls[1]).toMatchObject({
      method: "onShowAgentBubble",
      args: ["A", expect.any(String), "file-text"],
    });
    expect(rec.calls[2]).toMatchObject({
      method: "onShowAgentBubble",
      args: ["A", expect.any(String)], // farewell has no icon arg
    });
  });

  it("claimBoss passes context.queueType; releaseBoss passes null", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);
    actions.claimBoss({ context: ctx({ queueType: "departure" }) });
    // releaseBoss takes no context argument (it does not read context).
    actions.releaseBoss();
    expect(rec.calls).toEqual([
      { method: "onSetBossInUse", args: ["departure"] },
      { method: "onSetBossInUse", args: [null] },
    ]);
  });

  it("elevator open/close and bubble-clear actions forward verbatim", () => {
    const rec = makeRecordingActions();
    const actions = buildSharedActions(rec);
    // openElevator / closeElevator / clearBossBubble take no context argument.
    actions.openElevator();
    actions.closeElevator();
    actions.clearBossBubble();
    actions.clearAgentBubble({ context: ctx({ agentId: "A" }) });
    expect(rec.calls.map((c) => c.method)).toEqual([
      "onOpenElevator",
      "onCloseElevator",
      "onClearBossBubble",
      "onClearAgentBubble",
    ]);
  });

  it("removeAgent forwards the agentId from context", () => {
    const rec = makeRecordingActions();
    buildSharedActions(rec).removeAgent({ context: ctx({ agentId: "X" }) });
    expect(rec.calls).toEqual([{ method: "onAgentRemoved", args: ["X"] }]);
  });
});

// ---------------------------------------------------------------------------
// createAgentMachine — SPAWN variants (initial state + entry notifications)
// ---------------------------------------------------------------------------

describe("createAgentMachine — SPAWN variants", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("SPAWN enters arrival.arriving and emits the arriving entry notifications", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
    });

    const methods = rec.calls.map((c) => c.method);
    expect(methods).toEqual([
      "onPhaseChanged", // phase="arriving"
      "onOpenElevator",
      "onStartWalking", // movementType="to_arrival_queue"
    ]);
    // Phase value + walking tag are load-bearing for the render loop.
    expect(rec.calls[0].args).toEqual(["A", "arriving"]);
    expect(rec.calls[2].args[2]).toBe("to_arrival_queue");
  });

  it("SPAWN_AT_DESK enters idle and only emits an idle phase notification", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN_AT_DESK",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
    });

    expect(rec.calls).toEqual([
      { method: "onPhaseChanged", args: ["A", "idle"] },
    ]);
  });

  it("SPAWN_IN_ARRIVAL_QUEUE enters arrival.in_queue (arrival flow, mid-session)", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN_IN_ARRIVAL_QUEUE",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
      queueIndex: 1,
    });

    // Entry order is load-bearing: notifyPhaseChange → closeElevator →
    // joinQueue. (The arrival in_queue state closes the elevator door behind
    // the agent; the departure in_queue state does NOT — characterized below.)
    const methods = rec.calls.map((c) => c.method);
    expect(methods).toEqual([
      "onPhaseChanged",
      "onCloseElevator",
      "onQueueJoined",
    ]);
    expect(rec.calls[0].args).toEqual(["A", "in_arrival_queue"]);
    expect(rec.calls[2].args).toEqual(["A", "arrival", 1]);
  });

  it("SPAWN_IN_DEPARTURE_QUEUE enters departure.in_queue (departure flow, mid-session)", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN_IN_DEPARTURE_QUEUE",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
      queueIndex: 0,
    });

    // NOTE: departure.in_queue does NOT close the elevator (asymmetric with
    // arrival.in_queue above) — pin both shapes so a refactor can't silently
    // merge them.
    const methods = rec.calls.map((c) => c.method);
    expect(methods).toEqual(["onPhaseChanged", "onQueueJoined"]);
    expect(rec.calls[0].args).toEqual(["A", "in_departure_queue"]);
    expect(rec.calls[1].args).toEqual(["A", "departure", 0]);
  });
});

// ---------------------------------------------------------------------------
// createAgentMachine — REMOVE from idle kicks off the departure flow
// ---------------------------------------------------------------------------

describe("createAgentMachine — REMOVE from idle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("transitions idle → departure.departing and emits departing + walk-to-queue", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN_AT_DESK",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
    });
    rec.calls.length = 0; // ignore the idle entry notification

    actor.send({ type: "REMOVE" });

    const methods = rec.calls.map((c) => c.method);
    expect(methods).toEqual([
      "onPhaseChanged", // "departing"
      "onClearAgentBubble",
      "onStartWalking", // movementType="to_departure_queue" (queueType now "departure")
    ]);
    expect(rec.calls[0].args).toEqual(["A", "departing"]);
    expect(rec.calls[2].args[2]).toBe("to_departure_queue");
  });
});

// ---------------------------------------------------------------------------
// createAgentMachine — full arrival happy path (fake timers)
// ---------------------------------------------------------------------------

describe("createAgentMachine — arrival happy path", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  /**
   * Phases the boss character progresses through as one agent arrives.
   * Each is asserted as an `onPhaseChanged` call in order.
   */
  const EXPECTED_PHASES = [
    "arriving",
    "in_arrival_queue",
    "walking_to_ready",
    "conversing",
    "walking_to_boss",
    "at_boss",
    "walking_to_desk",
  ];

  it("walks an agent from the elevator all the way to their desk", () => {
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
    });
    // arriving → in_arrival_queue
    actor.send({ type: "ARRIVED_AT_QUEUE" });
    // Get to the front of the queue so the BOSS_AVAILABLE guard admits us.
    actor.send({ type: "QUEUE_POSITION_CHANGED", newIndex: 0 });
    actor.send({ type: "BOSS_AVAILABLE" });
    // walking_to_ready → conversing (boss_speaks)
    actor.send({ type: "ARRIVED_AT_READY" });
    // boss bubble "displayed" → agent_responds (after 800ms → done → walking_to_boss)
    actor.send({ type: "BUBBLE_DISPLAYED" });
    vi.advanceTimersByTime(1000); // covers the 800ms agent_responds delay
    // walking_to_boss → at_boss (after BOSS_PAUSE=100ms → walking_to_desk)
    actor.send({ type: "ARRIVED_AT_BOSS" });
    vi.advanceTimersByTime(200); // covers BOSS_PAUSE

    const phases = rec.calls
      .filter((c) => c.method === "onPhaseChanged")
      .map((c) => c.args[1]);
    expect(phases).toEqual(EXPECTED_PHASES);

    // The walk that leaves the ready slot hands the boss back to the queue:
    // releaseBoss fires onSetBossInUse(null) when entering walking_to_desk.
    const bossReleases = rec.calls.filter((c) => c.method === "onSetBossInUse");
    // claimBoss("arrival") at BOSS_AVAILABLE, releaseBoss(null) at walking_to_desk.
    expect(bossReleases.map((c) => c.args[0])).toEqual(["arrival", null]);
  });

  it("auto-advances past a suppressed boss bubble via CONVERSATION_TIMEOUT", () => {
    // If the boss bubble is never acknowledged (BUBBLE_DISPLAYED not sent),
    // the conversing.boss_speaks safety net must advance the agent so they
    // don't freeze at A0. Pin that timeout.
    const rec = makeRecordingActions();
    const actor = createActor(createAgentMachine(rec));
    actor.start();

    actor.send({
      type: "SPAWN",
      agentId: "A",
      name: "Alice",
      desk: 3,
      position: P,
    });
    actor.send({ type: "ARRIVED_AT_QUEUE" });
    actor.send({ type: "QUEUE_POSITION_CHANGED", newIndex: 0 });
    actor.send({ type: "BOSS_AVAILABLE" });
    actor.send({ type: "ARRIVED_AT_READY" });
    // Do NOT send BUBBLE_DISPLAYED — rely on the safety net.
    vi.advanceTimersByTime(sharedDelays.CONVERSATION_TIMEOUT + 10);

    const phases = rec.calls
      .filter((c) => c.method === "onPhaseChanged")
      .map((c) => c.args[1]);
    // boss_speaks timed out → agent_responds (incremented step, showed bubble)
    // but never advanced further because we didn't drive the 800ms or
    // ARRIVED_AT_BOSS. The key assertion: we got past "conversing" entry and
    // the agent_responds branch ran (onShowAgentBubble fired).
    expect(phases).toContain("conversing");
    expect(rec.calls.some((c) => c.method === "onShowAgentBubble")).toBe(true);
  });
});
