/**
 * Queue slice (ARC-005).
 *
 * Arrival/departure queue ID arrays and their mutators. Several actions also
 * re-index the queued agents' `queueIndex`/`queueType` fields (cross-slice
 * writes via the shared `set`); dequeueArrival/dequeueDeparture use `get()`
 * to read then atomically write so subscribers never observe a shifted queue
 * with stale indices (QA-006).
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";

export type QueueSlice = {
  arrivalQueue: string[];
  departureQueue: string[];
  enqueueArrival: (agentId: string) => void;
  enqueueDeparture: (agentId: string) => void;
  dequeueArrival: () => string | undefined;
  dequeueDeparture: () => string | undefined;
  advanceQueue: (queueType: "arrival" | "departure") => void;
  syncQueues: (arrivalQueue: string[], departureQueue: string[]) => void;
};

export const initialQueueState = {
  arrivalQueue: [] as string[],
  departureQueue: [] as string[],
};

export const createQueueSlice: StateCreator<GameStore, [], [], QueueSlice> = (
  set,
  get,
) => ({
  ...initialQueueState,

  enqueueArrival: (agentId) =>
    set((state) => {
      if (state.arrivalQueue.includes(agentId)) return state;

      const newQueue = [...state.arrivalQueue, agentId];
      const queueIndex = newQueue.length - 1;

      // Update agent's queue info
      const agent = state.agents.get(agentId);
      if (agent) {
        const newAgents = new Map(state.agents);
        newAgents.set(agentId, {
          ...agent,
          queueType: "arrival",
          queueIndex,
        });
        return { arrivalQueue: newQueue, agents: newAgents };
      }

      return { arrivalQueue: newQueue };
    }),

  enqueueDeparture: (agentId) =>
    set((state) => {
      if (state.departureQueue.includes(agentId)) return state;

      const newQueue = [...state.departureQueue, agentId];
      const queueIndex = newQueue.length - 1;

      // Update agent's queue info
      const agent = state.agents.get(agentId);
      if (agent) {
        const newAgents = new Map(state.agents);
        newAgents.set(agentId, {
          ...agent,
          queueType: "departure",
          queueIndex,
        });
        return { departureQueue: newQueue, agents: newAgents };
      }

      return { departureQueue: newQueue };
    }),

  dequeueArrival: () => {
    const state = get();
    if (state.arrivalQueue.length === 0) return undefined;

    const [frontId, ...rest] = state.arrivalQueue;

    // Re-index remaining queued agents in the same atomic update so
    // subscribers never observe a shifted queue with stale queueIndex
    // values (QA-006: previously two separate `set()` calls).
    const newAgents = new Map(state.agents);
    rest.forEach((id, idx) => {
      const agent = newAgents.get(id);
      if (agent) {
        newAgents.set(id, { ...agent, queueIndex: idx });
      }
    });
    set({ arrivalQueue: rest, agents: newAgents });

    return frontId;
  },

  dequeueDeparture: () => {
    const state = get();
    if (state.departureQueue.length === 0) return undefined;

    const [frontId, ...rest] = state.departureQueue;

    // Re-index remaining queued agents in the same atomic update so
    // subscribers never observe a shifted queue with stale queueIndex
    // values (QA-006: previously two separate `set()` calls).
    const newAgents = new Map(state.agents);
    rest.forEach((id, idx) => {
      const agent = newAgents.get(id);
      if (agent) {
        newAgents.set(id, { ...agent, queueIndex: idx });
      }
    });
    set({ departureQueue: rest, agents: newAgents });

    return frontId;
  },

  advanceQueue: (queueType) =>
    set((state) => {
      const queue =
        queueType === "arrival" ? state.arrivalQueue : state.departureQueue;
      if (queue.length === 0) return state;

      // Update all agents' queue indices
      const newAgents = new Map(state.agents);
      queue.forEach((id, idx) => {
        const agent = newAgents.get(id);
        if (agent) {
          newAgents.set(id, { ...agent, queueIndex: idx });
        }
      });

      return { agents: newAgents };
    }),

  syncQueues: (arrivalQueue, departureQueue) =>
    set((state) => {
      // Update agents' queue info based on synced queues
      const newAgents = new Map(state.agents);

      arrivalQueue.forEach((id, idx) => {
        const agent = newAgents.get(id);
        if (agent) {
          newAgents.set(id, {
            ...agent,
            queueType: "arrival",
            queueIndex: idx,
          });
        }
      });

      departureQueue.forEach((id, idx) => {
        const agent = newAgents.get(id);
        if (agent) {
          newAgents.set(id, {
            ...agent,
            queueType: "departure",
            queueIndex: idx,
          });
        }
      });

      return {
        arrivalQueue,
        departureQueue,
        agents: newAgents,
      };
    }),
});
