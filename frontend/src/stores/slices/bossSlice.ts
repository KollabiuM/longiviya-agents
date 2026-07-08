/**
 * Boss slice (ARC-005).
 *
 * The boss character's animation state (backend state, position, bubble,
 * in-use flag, current task, typing flag) and its scalar mutators. Bubble
 * queue contents are mutated by bubbleSlice via cross-slice `set`.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type { BossState } from "@/types";
import type { BossAnimationState } from "./types";
import { initialBossState } from "./shared";

export type BossSlice = {
  boss: BossAnimationState;
  updateBossBackendState: (state: BossState) => void;
  updateBossTask: (task: string | null) => void;
  setBossInUse: (by: "arrival" | "departure" | null) => void;
  setBossTyping: (typing: boolean) => void;
};

export const initialBossSliceState = {
  boss: initialBossState,
};

export const createBossSlice: StateCreator<GameStore, [], [], BossSlice> = (
  set,
) => ({
  ...initialBossSliceState,

  updateBossBackendState: (backendState) =>
    set((state) => ({
      boss: { ...state.boss, backendState },
    })),

  updateBossTask: (task) =>
    set((state) => ({
      boss: { ...state.boss, currentTask: task },
    })),

  setBossInUse: (by) =>
    set((state) => ({
      boss: { ...state.boss, inUseBy: by },
    })),

  setBossTyping: (typing) =>
    set((state) => ({
      boss: { ...state.boss, isTyping: typing },
    })),
});
