/**
 * Agent slice (ARC-005).
 *
 * The frontend-owned agent animation map and its mutators. `addAgent`
 * constructs an AgentAnimationState from a backend agent; `removeAgent` also
 * prunes the arrival/departure queues (cross-slice writes via the shared
 * `set`). Other actions update scalar fields on a single agent.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type {
  Position,
  AgentState as BackendAgentState,
  Agent as BackendAgent,
} from "@/types";
import type { AgentPhase, PathState, AgentAnimationState } from "./types";
import { DESKS_PER_ROW } from "@/constants/positions";
import { createEmptyBubbleState } from "./shared";

export type AgentSlice = {
  agents: Map<string, AgentAnimationState>;
  addAgent: (backendAgent: BackendAgent, initialPosition: Position) => void;
  removeAgent: (agentId: string) => void;
  updateAgentPhase: (agentId: string, phase: AgentPhase) => void;
  updateAgentPosition: (agentId: string, position: Position) => void;
  updateAgentTarget: (agentId: string, target: Position) => void;
  updateAgentPath: (agentId: string, path: PathState | null) => void;
  updateAgentBackendState: (agentId: string, state: BackendAgentState) => void;
  updateAgentMeta: (
    agentId: string,
    meta: {
      backendState: BackendAgentState;
      name: string | null;
      currentTask: string | null;
    },
  ) => void;
  updateAgentQueueInfo: (
    agentId: string,
    queueType: "arrival" | "departure" | null,
    queueIndex: number,
  ) => void;
  setAgentTyping: (agentId: string, typing: boolean) => void;
};

export const initialAgentState = {
  agents: new Map<string, AgentAnimationState>(),
};

export const createAgentSlice: StateCreator<GameStore, [], [], AgentSlice> = (
  set,
) => ({
  ...initialAgentState,

  addAgent: (backendAgent, initialPosition) =>
    set((state) => {
      const newAgents = new Map(state.agents);
      const animState: AgentAnimationState = {
        id: backendAgent.id,
        name: backendAgent.name ?? null,
        color: backendAgent.color,
        number: backendAgent.number,
        desk: backendAgent.desk ?? null,
        backendState: backendAgent.state,
        currentTask: backendAgent.currentTask ?? null,
        characterType: backendAgent.characterType ?? null,
        parentSessionId: backendAgent.parentSessionId ?? null,
        parentId: backendAgent.parentId ?? null,
        phase: "arriving",
        currentPosition: initialPosition,
        targetPosition: initialPosition,
        path: null,
        bubble: createEmptyBubbleState(),
        queueType: null,
        queueIndex: -1,
        isTyping: false,
      };
      newAgents.set(backendAgent.id, animState);

      // Update desk count if needed
      const newDeskCount = Math.max(
        state.deskCount,
        Math.ceil((newAgents.size + 1) / DESKS_PER_ROW) * DESKS_PER_ROW,
      );

      return { agents: newAgents, deskCount: newDeskCount };
    }),

  removeAgent: (agentId) =>
    set((state) => {
      const newAgents = new Map(state.agents);
      newAgents.delete(agentId);

      // Also remove from queues
      const newArrivalQueue = state.arrivalQueue.filter((id) => id !== agentId);
      const newDepartureQueue = state.departureQueue.filter(
        (id) => id !== agentId,
      );

      return {
        agents: newAgents,
        arrivalQueue: newArrivalQueue,
        departureQueue: newDepartureQueue,
      };
    }),

  updateAgentPhase: (agentId, phase) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, phase });
      return { agents: newAgents };
    }),

  updateAgentPosition: (agentId, position) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, currentPosition: position });
      return { agents: newAgents };
    }),

  updateAgentTarget: (agentId, target) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, targetPosition: target });
      return { agents: newAgents };
    }),

  updateAgentPath: (agentId, path) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, path });
      return { agents: newAgents };
    }),

  updateAgentBackendState: (agentId, backendState) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, backendState });
      return { agents: newAgents };
    }),

  updateAgentMeta: (agentId, meta) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, {
        ...agent,
        backendState: meta.backendState,
        name: meta.name ?? agent.name,
        // `??` (not `||`) so an explicit empty-string currentTask clears the
        // previous task — only null/undefined fall back. See QA-012.
        currentTask: meta.currentTask ?? agent.currentTask,
      });
      return { agents: newAgents };
    }),

  updateAgentQueueInfo: (agentId, queueType, queueIndex) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, queueType, queueIndex });
      return { agents: newAgents };
    }),

  setAgentTyping: (agentId, isTyping) =>
    set((state) => {
      const agent = state.agents.get(agentId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(agentId, { ...agent, isTyping });
      return { agents: newAgents };
    }),
});
