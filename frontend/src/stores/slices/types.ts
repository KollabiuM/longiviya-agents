/**
 * Shared store-level types (ARC-005).
 *
 * Extracted from gameStore.ts so each slice can import the types it needs
 * without a runtime dependency back to the store composition root. All types
 * are re-exported from gameStore.ts so existing `import { ... } from
 * "@/stores/gameStore"` consumers are unchanged.
 */
import type {
  Position,
  BubbleContent,
  BossState,
  AgentState as BackendAgentState,
  WebSocketMessage,
  EventDetail,
  GameState as BackendGameState,
} from "@/types";

/**
 * Frontend-controlled agent phases for queue choreography.
 * These are distinct from backend AgentState which tracks work status.
 */
export type AgentPhase =
  | "idle" // At desk, working
  | "arriving" // Just spawned, walking to queue
  | "in_arrival_queue" // Waiting in arrival queue
  | "walking_to_ready" // Moving to position 0 (ready to talk spot)
  | "conversing" // At position 0, talking to boss
  | "walking_to_boss" // Moving to boss desk slot
  | "at_boss" // Brief pause at boss desk
  | "walking_to_desk" // Moving from boss to assigned desk
  | "departing" // Removed from backend, walking to queue
  | "in_departure_queue" // Waiting in departure queue
  | "walking_to_elevator" // Moving from boss to elevator
  | "in_elevator"; // In elevator, about to be removed

/**
 * Path state for an agent following waypoints.
 */
export interface PathState {
  waypoints: Position[];
  currentIndex: number;
  progress: number; // 0-1 along current segment
}

/**
 * Bubble state with queue for ensuring minimum display time.
 */
export interface BubbleState {
  content: BubbleContent | null;
  displayStartTime: number | null;
  queue: BubbleContent[];
}

/**
 * Complete animation state for an agent (frontend-owned).
 */
export interface AgentAnimationState {
  // Identity (from backend)
  id: string;
  name: string | null;
  color: string;
  number: number;
  desk: number | null;
  backendState: BackendAgentState;
  currentTask: string | null;
  characterType: string | null;
  parentSessionId: string | null;
  parentId: string | null;

  // Phase tracking (frontend owned)
  phase: AgentPhase;

  // Position state (frontend owned)
  currentPosition: Position;
  targetPosition: Position;
  path: PathState | null;

  // Bubble state (frontend owned)
  bubble: BubbleState;

  // Queue metadata
  queueType: "arrival" | "departure" | null;
  queueIndex: number; // Position in queue (-1 = not in queue)

  // Animation state
  isTyping: boolean; // True when agent is actively using tools
}

/**
 * Compaction animation phases for the boss walking to and jumping on trash can.
 */
export type CompactionAnimationPhase =
  | "idle" // No animation
  | "walking_to_trash" // Boss walking to trash can
  | "jumping" // Boss jumping on trash can
  | "walking_back"; // Boss returning to desk

/**
 * Boss animation state.
 */
export interface BossAnimationState {
  backendState: BossState;
  position: Position;
  bubble: BubbleState;
  inUseBy: "arrival" | "departure" | null;
  currentTask: string | null;
  isTyping: boolean; // True when boss is actively using tools (typing animation)
}

/**
 * Event log entry for display.
 */
export type EventLogEntry = Omit<
  NonNullable<WebSocketMessage["event"]>,
  "timestamp"
> & { timestamp: Date; detail?: EventDetail };

/**
 * Replay frame for event replay.
 */
export interface ReplayFrame {
  event: NonNullable<WebSocketMessage["event"]>;
  state: BackendGameState;
}
