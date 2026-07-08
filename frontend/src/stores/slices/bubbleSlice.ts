/**
 * Bubble slice (ARC-005).
 *
 * Unified bubble queue actions for the boss (state.boss.bubble) and agents
 * (state.agents[*].bubble). This slice owns NO state of its own — bubble
 * state lives on the boss and agent slices. All reads/writes go through the
 * shared `set`/`get`, which are typed for the full GameStore.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type { BubbleContent } from "@/types";
import { createEmptyBubbleState } from "./shared";

export type BubbleSlice = {
  enqueueBubble: (
    entityId: string,
    content: BubbleContent,
    options?: { immediate?: boolean },
  ) => void;
  advanceBubble: (entityId: string) => void;
  clearBubbles: (entityId: string) => void;
  getCurrentBubble: (entityId: string) => BubbleContent | null;
  isBubbleQueueEmpty: (entityId: string) => boolean;
  hasBubbleText: (entityId: string, text: string) => boolean;
};

export const createBubbleSlice: StateCreator<GameStore, [], [], BubbleSlice> = (
  set,
  get,
) => ({
  enqueueBubble: (entityId, content, options) =>
    set((state) => {
      const now = Date.now();

      if (entityId === "boss") {
        const bossBubble = state.boss.bubble;
        // Queue bubbles instead of displaying immediately in these cases:
        // 1. During compaction (boss is jumping on trash) - unless immediate flag
        // 2. There's already a bubble displaying
        // The immediate flag is used for conversation bubbles that need to
        // proceed normally to avoid blocking the agent state machine.
        const isCompacting = state.compactionPhase !== "idle";
        const shouldQueueForCompaction = isCompacting && !options?.immediate;
        const shouldQueue = shouldQueueForCompaction || bossBubble.content;

        if (!shouldQueue) {
          // No current bubble and not compacting, display immediately
          // IMPORTANT: Preserve any existing queued bubbles (e.g., from compaction)
          return {
            boss: {
              ...state.boss,
              bubble: {
                content,
                displayStartTime: now,
                queue: bossBubble.queue,
              },
            },
          };
        }
        // Queue it (compacting or already has a bubble displaying)
        return {
          boss: {
            ...state.boss,
            bubble: {
              ...bossBubble,
              queue: [...bossBubble.queue, content],
            },
          },
        };
      }

      // Agent bubble
      const agent = state.agents.get(entityId);
      if (!agent) return state;

      const agentBubble = agent.bubble;
      const newAgents = new Map(state.agents);

      if (!agentBubble.content) {
        // IMPORTANT: Preserve any existing queued bubbles
        newAgents.set(entityId, {
          ...agent,
          bubble: {
            content,
            displayStartTime: now,
            queue: agentBubble.queue,
          },
        });
      } else {
        newAgents.set(entityId, {
          ...agent,
          bubble: {
            ...agentBubble,
            queue: [...agentBubble.queue, content],
          },
        });
      }

      return { agents: newAgents };
    }),

  advanceBubble: (entityId) =>
    set((state) => {
      const now = Date.now();

      if (entityId === "boss") {
        const bossBubble = state.boss.bubble;
        if (bossBubble.queue.length > 0) {
          const [next, ...rest] = bossBubble.queue;
          return {
            boss: {
              ...state.boss,
              bubble: {
                content: next,
                displayStartTime: now,
                queue: rest,
              },
            },
          };
        }
        // Clear bubble
        return {
          boss: {
            ...state.boss,
            bubble: createEmptyBubbleState(),
          },
        };
      }

      // Agent bubble
      const agent = state.agents.get(entityId);
      if (!agent) return state;

      const agentBubble = agent.bubble;
      const newAgents = new Map(state.agents);

      if (agentBubble.queue.length > 0) {
        const [next, ...rest] = agentBubble.queue;
        newAgents.set(entityId, {
          ...agent,
          bubble: {
            content: next,
            displayStartTime: now,
            queue: rest,
          },
        });
      } else {
        newAgents.set(entityId, {
          ...agent,
          bubble: createEmptyBubbleState(),
        });
      }

      return { agents: newAgents };
    }),

  clearBubbles: (entityId) =>
    set((state) => {
      if (entityId === "boss") {
        return {
          boss: {
            ...state.boss,
            bubble: createEmptyBubbleState(),
          },
        };
      }

      const agent = state.agents.get(entityId);
      if (!agent) return state;

      const newAgents = new Map(state.agents);
      newAgents.set(entityId, {
        ...agent,
        bubble: createEmptyBubbleState(),
      });

      return { agents: newAgents };
    }),

  getCurrentBubble: (entityId) => {
    const state = get();
    if (entityId === "boss") {
      return state.boss.bubble.content;
    }
    return state.agents.get(entityId)?.bubble.content ?? null;
  },

  isBubbleQueueEmpty: (entityId) => {
    const state = get();
    if (entityId === "boss") {
      const b = state.boss.bubble;
      return !b.content && b.queue.length === 0;
    }
    const agent = state.agents.get(entityId);
    if (!agent) return true;
    return !agent.bubble.content && agent.bubble.queue.length === 0;
  },

  hasBubbleText: (entityId, text) => {
    const state = get();
    const bubble =
      entityId === "boss"
        ? state.boss.bubble
        : state.agents.get(entityId)?.bubble;
    if (!bubble) return false;
    // Check current content
    if (bubble.content?.text === text) return true;
    // Check queue
    return bubble.queue.some((b) => b.text === text);
  },
});
