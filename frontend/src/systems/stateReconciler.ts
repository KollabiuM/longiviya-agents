/**
 * State reconciliation — pure domain logic extracted from `useWebSocketEvents`.
 *
 * `reconcileState()` applies a backend `GameState` snapshot to the frontend
 * stores: it diffs the agent set (spawning new agents at the right position,
 * triggering departures for removed ones), updates boss/office/queue state,
 * and enqueues speech bubbles. Behavior is byte-identical to the original
 * inlined `handleStateUpdate`; it now lives here so it can be reasoned about
 * (and the spawn-policy branch unit-tested) without React.
 *
 * Store access still flows through `useGameStore.getState()` and the
 * `agentMachineService` singleton — this is a structural extraction, not a
 * dependency-inversion pass.
 */

import { useGameStore } from "@/stores/gameStore";
import { agentMachineService } from "@/machines/agentMachineService";
import {
  getDeskPosition,
  getNextSpawnPosition,
  getQueuePosition,
} from "@/systems/queuePositions";
import type { Agent, GameState, Position } from "@/types";
import { MIN_DESK_COUNT } from "@/constants/positions";

// ============================================================================
// SPAWN-POLICY (pure) — the 4-way branch extracted from handleStateUpdate.
// ============================================================================

/** Which queue (if any) a newly-spawned agent is joining. */
export type SpawnQueueType = "arrival" | "departure";

/** Output of the spawn-policy decision — feeds `agentMachineService.spawnAgent`. */
export interface SpawnDecision {
  spawnPosition: Position;
  skipArrival: boolean;
  queueType?: SpawnQueueType;
  queueIndex?: number;
}

/**
 * Decide where a newly-arrived agent should spawn and whether to skip the
 * elevator arrival animation. Pure function of the backend agent and the
 * surrounding `GameState` snapshot.
 *
 * Four branches (mirrors the original inline comment):
 *  1. `state === "arriving"`            → spawn from elevator (full arrival)
 *  2. in arrival queue (not arriving)   → spawn at queue position, skip arrival
 *  3. in departure queue                → spawn at queue position, skip arrival
 *  4. has desk (working)                → spawn at desk, skip arrival
 *  fallback                             → spawn from elevator
 */
export function resolveSpawn(
  backendAgent: Agent,
  state: GameState,
): SpawnDecision {
  const isInArrivalQueue =
    state.arrivalQueue?.includes(backendAgent.id) ?? false;
  const isInDepartureQueue =
    state.departureQueue?.includes(backendAgent.id) ?? false;
  const arrivalQueueIndex = state.arrivalQueue?.indexOf(backendAgent.id) ?? -1;
  const departureQueueIndex =
    state.departureQueue?.indexOf(backendAgent.id) ?? -1;

  if (backendAgent.state === "arriving") {
    // Agent is still arriving — spawn from elevator.
    return { spawnPosition: getNextSpawnPosition(), skipArrival: false };
  }

  if (isInArrivalQueue) {
    // Agent is in arrival queue (not arriving) — spawn at their queue position.
    // Queue position 0 = ready spot (A0), position 1+ = waiting spots.
    const queuePosition = getQueuePosition("arrival", arrivalQueueIndex + 1);
    return {
      spawnPosition: queuePosition ?? getNextSpawnPosition(),
      skipArrival: true,
      queueType: "arrival",
      queueIndex: arrivalQueueIndex,
    };
  }

  if (isInDepartureQueue) {
    // Agent is in departure queue — spawn at their queue position.
    // Queue position 0 = ready spot (D0), position 1+ = waiting spots.
    const queuePosition = getQueuePosition(
      "departure",
      departureQueueIndex + 1,
    );
    return {
      spawnPosition: queuePosition ?? getDeskPosition(backendAgent.desk ?? 1),
      skipArrival: true,
      queueType: "departure",
      queueIndex: departureQueueIndex,
    };
  }

  if (backendAgent.desk) {
    // Agent is at their desk working.
    return {
      spawnPosition: getDeskPosition(backendAgent.desk),
      skipArrival: true,
    };
  }

  // Fallback — spawn from elevator.
  return { spawnPosition: getNextSpawnPosition(), skipArrival: false };
}

// ============================================================================
// RECONCILIATION CONTEXT
// ============================================================================

/**
 * Mutable references the reconciler reads/writes. These mirror the refs the
 * hook used to keep inline; passing them explicitly keeps the function pure of
 * React while preserving the original mutation semantics.
 *
 * - `processedAgents`: appended-to as new agents are spawned (de-dup).
 * - `lastSeenBubbleText`: per-entity last bubble text (suppresses re-enqueue).
 * - `initialQueueSyncDone`: `{ current }` holder so the reconciler can both
 *   read AND reassign it (mirrors a React ref). Once we've synced a session's
 *   queues on initial connect, frontend owns queue state.
 */
export interface ReconcilerContext {
  currentSessionId: string;
  processedAgents: Set<string>;
  lastSeenBubbleText: Map<string, string>;
  initialQueueSyncDone: { current: string | null };
}

// ============================================================================
// RECONCILE STATE (was handleStateUpdate)
// ============================================================================

/**
 * Apply a backend `GameState` snapshot to the frontend stores + agent machine
 * service. Stale-session guard, agent diff/spawn, bubble enqueue, boss/office
 * sync, queue sync — all preserved from the original inlined handler.
 *
 * Returns early if `state.sessionId` doesn't match `ctx.currentSessionId`
 * (race-condition protection for in-flight messages from an old session).
 */
export function reconcileState(state: GameState, ctx: ReconcilerContext): void {
  // Ignore state updates from old sessions (race condition protection).
  if (state.sessionId !== ctx.currentSessionId) {
    return;
  }

  const store = useGameStore.getState();
  const currentAgentIds = new Set(store.agents.keys());
  const backendAgentIds = new Set(state.agents.map((a) => a.id));

  // ---- Detect new agents (arrivals) ----
  for (const backendAgent of state.agents) {
    if (
      !currentAgentIds.has(backendAgent.id) &&
      !ctx.processedAgents.has(backendAgent.id)
    ) {
      ctx.processedAgents.add(backendAgent.id);

      const decision = resolveSpawn(backendAgent, state);

      // Add to store first.
      store.addAgent(backendAgent, decision.spawnPosition);

      // Spawn state machine with backend state for mid-session handling.
      agentMachineService.spawnAgent(
        backendAgent.id,
        backendAgent.name ?? null,
        backendAgent.desk ?? null,
        decision.spawnPosition,
        {
          backendState: backendAgent.state,
          skipArrival: decision.skipArrival,
          queueType: decision.queueType,
          queueIndex: decision.queueIndex,
        },
      );

      // If agent has a bubble and is at desk/queue, enqueue it immediately.
      if (decision.skipArrival && backendAgent.bubble) {
        store.enqueueBubble(backendAgent.id, backendAgent.bubble);
      }
    } else if (currentAgentIds.has(backendAgent.id)) {
      // Update existing agent's backend state, name, and task.
      // (Name and task may have been enriched by AI after initial spawn.)
      store.updateAgentMeta(backendAgent.id, {
        backendState: backendAgent.state,
        name: backendAgent.name ?? null,
        currentTask: backendAgent.currentTask ?? null,
      });

      // Enqueue bubbles for agents who are at their desk working.
      // Only show bubbles when agent is at desk (phase === "idle").
      // This prevents showing tool calls during arrival/departure animations.
      const agent = store.agents.get(backendAgent.id);
      const isAtDesk = agent?.phase === "idle";

      if (backendAgent.bubble && isAtDesk) {
        const bubbleText = backendAgent.bubble.text;
        const lastSeen = ctx.lastSeenBubbleText.get(backendAgent.id);
        // Only enqueue if backend sent a NEW bubble text (not the same as last time).
        if (bubbleText !== lastSeen) {
          ctx.lastSeenBubbleText.set(backendAgent.id, bubbleText);
          if (!store.hasBubbleText(backendAgent.id, bubbleText)) {
            store.enqueueBubble(backendAgent.id, backendAgent.bubble);
          }
        }
      }
    }
  }

  // ---- Detect removed agents (departures) ----
  for (const agentId of currentAgentIds) {
    if (!backendAgentIds.has(agentId)) {
      const agent = store.agents.get(agentId);
      if (!agent) continue;

      if (agent.phase === "idle") {
        agentMachineService.triggerDeparture(agentId);
      } else {
        // Backend removed the agent before its arrival animation reached
        // the desk. Queue the departure so it fires once the agent is
        // idle, instead of waiting for the next state-update.
        agentMachineService.markPendingDeparture(agentId);
      }
    }
  }

  // ---- Update boss state ----
  store.updateBossBackendState(state.boss.state);
  store.updateBossTask(state.boss.currentTask ?? null);

  // Enqueue boss bubble if present.
  if (state.boss.bubble) {
    const bubbleText = state.boss.bubble.text;
    const lastSeen = ctx.lastSeenBubbleText.get("boss");
    if (bubbleText !== lastSeen) {
      ctx.lastSeenBubbleText.set("boss", bubbleText);
      const alreadyHas = store.hasBubbleText("boss", bubbleText);
      if (!alreadyHas) {
        store.enqueueBubble("boss", state.boss.bubble);
      }
    }
  }

  // ---- Update office state ----
  store.setSessionId(state.sessionId);
  store.setDeskCount(state.office.deskCount ?? MIN_DESK_COUNT);
  // NOTE: elevatorState is NOT synced from backend — it's controlled by the
  // frontend's agent state machine for smooth animations.
  store.setPhoneState(state.office.phoneState ?? "idle");

  // Sync queue state from backend (only on initial connection for mid-session joins).
  // After initial sync, frontend manages queue state based on agent state machine events.
  if (
    (state.arrivalQueue || state.departureQueue) &&
    ctx.initialQueueSyncDone.current !== state.sessionId
  ) {
    store.syncQueues(state.arrivalQueue ?? [], state.departureQueue ?? []);
    ctx.initialQueueSyncDone.current = state.sessionId;
  }
  // Only update context utilization if explicitly provided (not null/undefined).
  // This prevents flip-flopping between actual values and 0.
  if (
    state.office.contextUtilization !== null &&
    state.office.contextUtilization !== undefined
  ) {
    store.setContextUtilization(state.office.contextUtilization);
  }
  // Update safety sign counter.
  if (
    state.office.toolUsesSinceCompaction !== null &&
    state.office.toolUsesSinceCompaction !== undefined
  ) {
    store.setToolUsesSinceCompaction(state.office.toolUsesSinceCompaction);
  }
  store.setTodos(state.todos ?? []);
  // Sync print report flag (triggers printer animation).
  store.setPrintReport(state.office.printReport ?? false);
  // Sync whiteboard data for multi-mode display.
  if (state.whiteboardData) {
    store.setWhiteboardData(state.whiteboardData);
  }
  // Sync conversation history (user prompts + Claude responses).
  if (state.conversation) {
    store.setConversation(state.conversation);
  }
}
