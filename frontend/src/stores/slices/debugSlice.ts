/**
 * Debug / persistence slice (ARC-005).
 *
 * Debug-overlay flags and their localStorage persistence. Self-contained: no
 * dependencies on other slices. Extracted from gameStore.ts so the debug
 * subsystem can be reasoned about (and tested) in isolation.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";

const DEBUG_SETTINGS_KEY = "claude-office-debug-settings";

interface DebugSettings {
  debugMode: boolean;
  showPaths: boolean;
  showQueueSlots: boolean;
  showPhaseLabels: boolean;
  showObstacles: boolean;
}

function loadDebugSettings(): Partial<DebugSettings> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(DEBUG_SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored) as DebugSettings;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveDebugSettings(settings: DebugSettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DEBUG_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export type DebugSlice = {
  debugMode: boolean;
  showPaths: boolean;
  showQueueSlots: boolean;
  showPhaseLabels: boolean;
  showObstacles: boolean;
  setDebugMode: (debugMode: boolean) => void;
  toggleDebugOverlay: (
    overlay: "paths" | "queueSlots" | "phaseLabels" | "obstacles",
  ) => void;
  loadPersistedDebugSettings: () => void;
};

/** Initial debug flags (all off; `loadPersistedDebugSettings` overrides). */
export const initialDebugState = {
  debugMode: false,
  showPaths: false,
  showQueueSlots: false,
  showPhaseLabels: false,
  showObstacles: false,
};

export const createDebugSlice: StateCreator<GameStore, [], [], DebugSlice> = (
  set,
  get,
) => ({
  ...initialDebugState,

  setDebugMode: (debugMode) => {
    set({ debugMode });
    const state = get();
    saveDebugSettings({
      debugMode,
      showPaths: state.showPaths,
      showQueueSlots: state.showQueueSlots,
      showPhaseLabels: state.showPhaseLabels,
      showObstacles: state.showObstacles,
    });
  },

  toggleDebugOverlay: (overlay) => {
    set((state) => {
      let newState: Partial<DebugSettings>;
      switch (overlay) {
        case "paths":
          newState = { showPaths: !state.showPaths };
          break;
        case "queueSlots":
          newState = { showQueueSlots: !state.showQueueSlots };
          break;
        case "phaseLabels":
          newState = { showPhaseLabels: !state.showPhaseLabels };
          break;
        case "obstacles":
          newState = { showObstacles: !state.showObstacles };
          break;
        default:
          return state;
      }
      // Save to localStorage after state update
      const currentState = { ...state, ...newState };
      saveDebugSettings({
        debugMode: currentState.debugMode,
        showPaths: currentState.showPaths,
        showQueueSlots: currentState.showQueueSlots,
        showPhaseLabels: currentState.showPhaseLabels,
        showObstacles: currentState.showObstacles,
      });
      return newState;
    });
  },

  loadPersistedDebugSettings: () => {
    const persisted = loadDebugSettings();
    if (Object.keys(persisted).length > 0) {
      set({
        debugMode: persisted.debugMode ?? false,
        showPaths: persisted.showPaths ?? false,
        showQueueSlots: persisted.showQueueSlots ?? false,
        showPhaseLabels: persisted.showPhaseLabels ?? false,
        showObstacles: persisted.showObstacles ?? false,
      });
    }
  },
});
