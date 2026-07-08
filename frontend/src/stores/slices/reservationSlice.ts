/**
 * Queue reservation slice (ARC-004 single-writer slice, re-filed under ARC-005).
 *
 * Slots agents are walking toward but haven't formally joined yet, plus the
 * ready-position occupants. QueueManager is the sole caller of these
 * mutators — they are the only writes to this state.
 */
import type { StateCreator } from "zustand";
import type { GameStore } from "../gameStore";

export type ReservationSlice = {
  queueReservations: {
    arrival: Map<number, string>;
    departure: Map<number, string>;
  };
  readyOccupants: { arrival: string | null; departure: string | null };
  setQueueReservation: (
    queueType: "arrival" | "departure",
    slotIndex: number,
    agentId: string,
  ) => void;
  clearQueueReservation: (
    queueType: "arrival" | "departure",
    agentId: string,
  ) => void;
  clearAgentReservations: (agentId: string) => void;
  resetQueueReservations: () => void;
  setReadyOccupant: (
    queueType: "arrival" | "departure",
    agentId: string | null,
  ) => void;
};

export const initialReservationState = {
  queueReservations: {
    arrival: new Map<number, string>(),
    departure: new Map<number, string>(),
  },
  readyOccupants: { arrival: null, departure: null },
};

export const createReservationSlice: StateCreator<
  GameStore,
  [],
  [],
  ReservationSlice
> = (set) => ({
  ...initialReservationState,

  setQueueReservation: (queueType, slotIndex, agentId) =>
    set((state) => {
      const next = new Map(state.queueReservations[queueType]);
      next.set(slotIndex, agentId);
      return {
        queueReservations: { ...state.queueReservations, [queueType]: next },
      };
    }),

  clearQueueReservation: (queueType, agentId) =>
    set((state) => {
      const next = new Map(state.queueReservations[queueType]);
      let removed = false;
      for (const [pos, reservedBy] of next) {
        if (reservedBy === agentId) {
          next.delete(pos);
          removed = true;
          break;
        }
      }
      return removed
        ? {
            queueReservations: {
              ...state.queueReservations,
              [queueType]: next,
            },
          }
        : state;
    }),

  clearAgentReservations: (agentId) =>
    set((state) => {
      let changed = false;
      const nextReservations = {
        arrival: new Map(state.queueReservations.arrival),
        departure: new Map(state.queueReservations.departure),
      };
      for (const qt of ["arrival", "departure"] as const) {
        for (const [pos, reservedBy] of nextReservations[qt]) {
          if (reservedBy === agentId) {
            nextReservations[qt].delete(pos);
            changed = true;
            break;
          }
        }
      }
      return changed ? { queueReservations: nextReservations } : state;
    }),

  resetQueueReservations: () =>
    set({
      queueReservations: {
        arrival: new Map(),
        departure: new Map(),
      },
      readyOccupants: { arrival: null, departure: null },
    }),

  setReadyOccupant: (queueType, agentId) =>
    set((state) => ({
      readyOccupants: { ...state.readyOccupants, [queueType]: agentId },
    })),
});
