/**
 * Game Runtime — composition root (ARC-017)
 *
 * Wires the animation system's listener port to the agent machine service.
 * This is the single place that connects the `systems/` layer to the
 * `machines/` layer at runtime, so `animationSystem` never imports
 * `agentMachineService` (breaking the former machines↔systems import cycle).
 *
 * Import for side effects exactly once, where the animation system is started.
 */

import { animationSystem } from "./animationSystem";
import { agentMachineService } from "@/machines/agentMachineService";

/**
 * Connect the agent-machine service as the animation tick's listener.
 * Call once where the animation system is started (e.g. OfficeGame mount).
 */
export function wireGameRuntime(): void {
  animationSystem.setListener(agentMachineService);
}

/**
 * Disconnect the listener. Call before stopping the animation system on
 * teardown / HMR so a stale listener can't dispatch into a reset service.
 */
export function unwireGameRuntime(): void {
  animationSystem.setListener(null);
}
