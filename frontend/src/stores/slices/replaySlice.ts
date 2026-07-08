/**
 * Connection / replay slice (ARC-005).
 *
 * WebSocket connection flag and the event-replay transport state. All fields
 * are independent scalar/array values with plain setters — no cross-slice
 * dependencies.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";
import type { ReplayFrame } from "./types";

export type ReplaySlice = {
  isConnected: boolean;
  isReplaying: boolean;
  replaySpeed: number;
  replayEvents: ReplayFrame[];
  currentReplayIndex: number;
  setConnected: (isConnected: boolean) => void;
  setReplaying: (replaying: boolean) => void;
  setReplaySpeed: (speed: number) => void;
  setReplayEvents: (events: ReplayFrame[]) => void;
  setReplayIndex: (index: number) => void;
};

export const initialReplayState = {
  isConnected: false,
  isReplaying: false,
  replaySpeed: 1,
  replayEvents: [] as ReplayFrame[],
  currentReplayIndex: -1,
};

export const createReplaySlice: StateCreator<GameStore, [], [], ReplaySlice> = (
  set,
) => ({
  ...initialReplayState,

  setConnected: (isConnected) => set({ isConnected }),
  setReplaying: (isReplaying) => set({ isReplaying }),
  setReplaySpeed: (replaySpeed) => set({ replaySpeed }),
  setReplayEvents: (replayEvents) => set({ replayEvents }),
  setReplayIndex: (currentReplayIndex) => set({ currentReplayIndex }),
});
