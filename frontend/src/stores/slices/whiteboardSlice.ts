/**
 * Whiteboard slice (ARC-005).
 *
 * The animated whiteboard's data payload and its display mode. Self-contained
 * apart from the @/types shapes it carries.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type { WhiteboardData, WhiteboardMode } from "@/types";

const WHITEBOARD_MODE_COUNT = 12; // 0-11 modes

// Initial whiteboard data
const initialWhiteboardData: WhiteboardData = {
  toolUsage: {},
  taskCompletedCount: 0,
  bugFixedCount: 0,
  coffeeBreakCount: 0,
  codeWrittenCount: 0,
  recentErrorCount: 0,
  recentSuccessCount: 0,
  activityLevel: 0,
  consecutiveSuccesses: 0,
  lastIncidentTime: null,
  agentLifespans: [],
  newsItems: [],
  coffeeCups: 0,
  fileEdits: {},
  backgroundTasks: [],
};

export type WhiteboardSlice = {
  whiteboardData: WhiteboardData;
  whiteboardMode: WhiteboardMode;
  setWhiteboardData: (data: WhiteboardData) => void;
  setWhiteboardMode: (mode: WhiteboardMode) => void;
  cycleWhiteboardMode: () => void;
};

export const initialWhiteboardState = {
  whiteboardData: initialWhiteboardData,
  whiteboardMode: 0 as WhiteboardMode,
};

export const createWhiteboardSlice: StateCreator<
  GameStore,
  [],
  [],
  WhiteboardSlice
> = (set) => ({
  ...initialWhiteboardState,

  setWhiteboardData: (whiteboardData) => set({ whiteboardData }),
  setWhiteboardMode: (whiteboardMode) => set({ whiteboardMode }),

  cycleWhiteboardMode: () =>
    set((state) => ({
      whiteboardMode: ((state.whiteboardMode + 1) %
        WHITEBOARD_MODE_COUNT) as WhiteboardMode,
    })),
});
