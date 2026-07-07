/**
 * Tests for the pure spawn-policy branch extracted from useWebSocketEvents
 * (ARC-018). `resolveSpawn()` was previously trapped in the hook's
 * `handleStateUpdate` closure — untestable in isolation. It is now a pure
 * function of `(backendAgent, state)` and these tests pin all four branches
 * plus the fallback.
 *
 * Note: full `reconcileState()` integration tests (which require mocking
 * `useGameStore` + `agentMachineService`) are deferred to QA-005 / ARC-007 —
 * out of scope for this ARC-018 cut.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { resolveSpawn } from "@/systems/stateReconciler";
import { resetSpawnIndex } from "@/systems/queuePositions";
import {
  ARRIVAL_QUEUE_POSITIONS,
  DEPARTURE_QUEUE_POSITIONS,
  ELEVATOR_SPAWN_POSITIONS,
  getDeskPosition,
} from "@/systems/queuePositions";
import type { Agent, GameState } from "@/types";

/** Build a minimal valid Agent for testing. */
function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    color: "#ff0000",
    number: 1,
    state: "working",
    ...overrides,
  };
}

/** Build a minimal valid GameState for testing. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    sessionId: "session-1",
    boss: { state: "idle" },
    agents: [],
    office: {},
    lastUpdated: "0",
    ...overrides,
  };
}

describe("resolveSpawn", () => {
  beforeEach(() => resetSpawnIndex());

  it("branch 1: arriving agent spawns from the elevator (no skip)", () => {
    const agent = makeAgent({ id: "a1", state: "arriving" });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(false);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    // First elevator slot after a reset.
    expect(decision.spawnPosition).toEqual(ELEVATOR_SPAWN_POSITIONS[0]);
  });

  it("branch 2: agent in arrival queue spawns at queue position and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBe("arrival");
    expect(decision.queueIndex).toBe(0);
    // arrivalQueueIndex 0 → getQueuePosition("arrival", 1) = ARRIVAL_QUEUE_POSITIONS[1].
    expect(decision.spawnPosition).toEqual(ARRIVAL_QUEUE_POSITIONS[1]);
  });

  it("branch 3: agent in departure queue spawns at queue position and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      departureQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBe("departure");
    expect(decision.queueIndex).toBe(0);
    // departureQueueIndex 0 → getQueuePosition("departure", 1) = DEPARTURE_QUEUE_POSITIONS[1].
    expect(decision.spawnPosition).toEqual(DEPARTURE_QUEUE_POSITIONS[1]);
  });

  it("branch 4: working agent with a desk spawns at the desk and skips arrival", () => {
    const agent = makeAgent({ id: "a1", state: "working", desk: 3 });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(true);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    expect(decision.spawnPosition).toEqual(getDeskPosition(3));
  });

  it("fallback: not arriving, not queued, no desk → elevator spawn, no skip", () => {
    const agent = makeAgent({ id: "a1", state: "working" });
    const state = makeState({ agents: [agent] });

    const decision = resolveSpawn(agent, state);

    expect(decision.skipArrival).toBe(false);
    expect(decision.queueType).toBeUndefined();
    expect(decision.queueIndex).toBeUndefined();
    expect(decision.spawnPosition).toEqual(ELEVATOR_SPAWN_POSITIONS[0]);
  });

  it("arrival queue takes precedence over departure queue when both contain the id", () => {
    // (Backend should never put an id in both, but the branch order matters:
    // arrival is checked first.)
    const agent = makeAgent({ id: "a1", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
      departureQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueType).toBe("arrival");
    expect(decision.queueIndex).toBe(0);
  });

  it("non-arriving state in arrival queue still uses the queue-position branch (only 'arriving' forces branch 1)", () => {
    // 'leaving' is a valid non-arriving AgentState; the branch must NOT take
    // the elevator-spawn path because state !== "arriving".
    const agent = makeAgent({ id: "a1", state: "leaving" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1"],
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueType).toBe("arrival");
    expect(decision.skipArrival).toBe(true);
  });

  it("higher arrival-queue index maps to a deeper queue position", () => {
    const agent = makeAgent({ id: "a2", state: "waiting" });
    const state = makeState({
      agents: [agent],
      arrivalQueue: ["a1", "a2"], // a2 is at index 1
    });

    const decision = resolveSpawn(agent, state);

    expect(decision.queueIndex).toBe(1);
    // index 1 → getQueuePosition("arrival", 2) = ARRIVAL_QUEUE_POSITIONS[2].
    expect(decision.spawnPosition).toEqual(ARRIVAL_QUEUE_POSITIONS[2]);
  });
});
