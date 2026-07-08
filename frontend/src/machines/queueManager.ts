/**
 * Queue Manager
 *
 * Stateless policy façade over the store's queue-reservation / ready-occupancy
 * state (ARC-004). Previously this class held the reservation/occupancy maps as
 * private fields, making it a second writer alongside the Zustand store and the
 * source of queue-slot-collision / stuck-state bugs. All such state now lives
 * exclusively in the store; this class only reads it and issues store actions.
 *
 * The public API is unchanged so call sites in AgentMachineService need no edits.
 * Reservation/occupancy policy (slot-index math, "find by agentId" reads) stays
 * here; the store is the single writer.
 *
 * Extracted from AgentMachineService so that queue logic can be reasoned about
 * and tested independently of the machine lifecycle.
 */

import { getQueuePosition } from "@/systems/queuePositions";
import { useGameStore } from "@/stores/gameStore";
import type { Position } from "@/types";

// ============================================================================
// QUEUE MANAGER
// ============================================================================

export class QueueManager {
  // ==========================================================================
  // RESERVATION API
  // ==========================================================================

  /**
   * Reserve a queue slot for an agent that is walking toward it.
   * Returns the 1-based position index that was reserved.
   */
  reserveQueueSlot(
    agentId: string,
    queueType: "arrival" | "departure",
  ): number {
    const store = useGameStore.getState();
    const queue =
      queueType === "arrival" ? store.arrivalQueue : store.departureQueue;
    const reservations = store.queueReservations[queueType];

    // Count reservations held by OTHER agents
    let reservationCount = 0;
    for (const reservedBy of reservations.values()) {
      if (reservedBy !== agentId) {
        reservationCount++;
      }
    }

    // New agent always joins at the back
    const slotIndex = queue.length + reservationCount + 1;
    store.setQueueReservation(queueType, slotIndex, agentId);
    return slotIndex;
  }

  /**
   * Clear the reservation held by a specific agent (called when they arrive
   * at their queue position and formally join the queue).
   */
  clearReservation(agentId: string, queueType: "arrival" | "departure"): void {
    useGameStore.getState().clearQueueReservation(queueType, agentId);
  }

  /**
   * Clear ALL reservations held by a specific agent across both queues.
   */
  clearAllReservations(agentId: string): void {
    useGameStore.getState().clearAgentReservations(agentId);
  }

  /**
   * Return the current slot index reserved for an agent, or -1 if none.
   */
  getReservationIndex(
    agentId: string,
    queueType: "arrival" | "departure",
  ): number {
    const reservations = useGameStore.getState().queueReservations[queueType];
    for (const [posIndex, reservedBy] of reservations.entries()) {
      if (reservedBy === agentId) return posIndex;
    }
    return -1;
  }

  // ==========================================================================
  // READY-POSITION OCCUPANCY API
  // ==========================================================================

  /**
   * Mark an agent as occupying the ready position for their queue type.
   */
  claimReadyPosition(
    agentId: string,
    queueType: "arrival" | "departure",
  ): void {
    useGameStore.getState().setReadyOccupant(queueType, agentId);
  }

  /**
   * Release the ready position for a queue type.
   * Returns true if this agent was the occupant (and is now cleared).
   */
  releaseReadyPosition(
    agentId: string,
    queueType: "arrival" | "departure",
  ): boolean {
    const store = useGameStore.getState();
    if (store.readyOccupants[queueType] === agentId) {
      store.setReadyOccupant(queueType, null);
      return true;
    }
    return false;
  }

  /**
   * Release the ready position for whichever queue this agent occupies.
   * Returns the queueType that was released, or null.
   */
  releaseReadyPositionForAgent(
    agentId: string,
  ): "arrival" | "departure" | null {
    const store = useGameStore.getState();
    const occupants = store.readyOccupants;
    for (const queueType of ["arrival", "departure"] as const) {
      if (occupants[queueType] === agentId) {
        store.setReadyOccupant(queueType, null);
        return queueType;
      }
    }
    return null;
  }

  /**
   * Return the current occupant of the ready position, or null.
   */
  getReadyOccupant(queueType: "arrival" | "departure"): string | null {
    return useGameStore.getState().readyOccupants[queueType];
  }

  // ==========================================================================
  // QUEUE INDEX SYNC
  // ==========================================================================

  /**
   * Recalculate queue positions for all agents in a queue after one leaves,
   * sending them to their new physical slot. ``setAgentPath`` is supplied by
   * the caller (AgentMachineService) so this module does not import the
   * animation system (ARC-017/ARC-004 cycle break).
   */
  updateQueueIndices(
    queueType: "arrival" | "departure",
    sendEventToAgent: (
      agentId: string,
      event: { type: "QUEUE_POSITION_CHANGED"; newIndex: number },
    ) => void,
    setAgentPath: (agentId: string, target: Position) => void,
  ): void {
    const store = useGameStore.getState();
    const queue =
      queueType === "arrival" ? store.arrivalQueue : store.departureQueue;

    queue.forEach((agentId, index) => {
      sendEventToAgent(agentId, {
        type: "QUEUE_POSITION_CHANGED",
        newIndex: index,
      });

      // Position index 0 in queue maps to slot 1 (A1/D1), etc.
      const positionIndex = index + 1;
      const newPosition = getQueuePosition(queueType, positionIndex);

      if (newPosition) {
        store.updateAgentTarget(agentId, newPosition);
        store.updateAgentQueueInfo(agentId, queueType, index);
        setAgentPath(agentId, newPosition);
      }
    });
  }

  // ==========================================================================
  // RESET
  // ==========================================================================

  /**
   * Clear all reservation/occupancy state — called when the service resets.
   * Delegates to the store (single writer).
   */
  reset(): void {
    useGameStore.getState().resetQueueReservations();
  }
}
