"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  Position,
  BubbleContent,
  BossState,
  AgentState as BackendAgentState,
  ElevatorState,
  PhoneState,
  TodoItem,
  GitStatus,
  WebSocketMessage,
  Agent as BackendAgent,
  GameState as BackendGameState,
  WhiteboardData,
  WhiteboardMode,
  ConversationEntry,
} from "@/types";
import { MIN_DESK_COUNT } from "@/constants/positions";

// ============================================================================
// SHARED STORE TYPES (ARC-005)
// ============================================================================
// Slice-shared types live in ./slices/types and are re-exported here so every
// existing `import { ... } from "@/stores/gameStore"` consumer is unchanged.
export type {
  AgentPhase,
  PathState,
  BubbleState,
  AgentAnimationState,
  CompactionAnimationPhase,
  BossAnimationState,
  EventLogEntry,
  ReplayFrame,
} from "./slices/types";
import type {
  AgentPhase,
  PathState,
  AgentAnimationState,
  CompactionAnimationPhase,
  BossAnimationState,
  EventLogEntry,
  ReplayFrame,
} from "./slices/types";

// Slices (ARC-005): each concern owns its state + actions in its own file and
// is composed below. Cross-slice access (bubbles read boss/agent state; queues
// re-index agents) goes through the shared `set`/`get`, typed for GameStore.
import { createAgentSlice, initialAgentState } from "./slices/agentSlice";
import { createQueueSlice, initialQueueState } from "./slices/queueSlice";
import {
  createReservationSlice,
  initialReservationState,
} from "./slices/reservationSlice";
import { createBossSlice, initialBossSliceState } from "./slices/bossSlice";
import { createBubbleSlice } from "./slices/bubbleSlice";
import { createOfficeSlice, initialOfficeState } from "./slices/officeSlice";
import {
  createWhiteboardSlice,
  initialWhiteboardState,
} from "./slices/whiteboardSlice";
import { createReplaySlice, initialReplayState } from "./slices/replaySlice";
import { createDebugSlice, initialDebugState } from "./slices/debugSlice";
import { createEmptyBubbleState, initialBossState } from "./slices/shared";

// ============================================================================
// STORE INTERFACE (the single public contract; impls come from the slices)
// ============================================================================

export interface GameStore {
  // ========== Agent State ==========
  agents: Map<string, AgentAnimationState>;

  // Agent actions
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

  // ========== Queue State ==========
  arrivalQueue: string[]; // Agent IDs in order
  departureQueue: string[]; // Agent IDs in order

  // Queue actions
  enqueueArrival: (agentId: string) => void;
  enqueueDeparture: (agentId: string) => void;
  dequeueArrival: () => string | undefined;
  dequeueDeparture: () => string | undefined;
  advanceQueue: (queueType: "arrival" | "departure") => void;
  syncQueues: (arrivalQueue: string[], departureQueue: string[]) => void;

  // ========== Queue Reservations (ARC-004: single writer) ==========
  // Slots agents are walking toward but haven't formally joined yet, so two
  // agents never claim the same physical slot. Key: slot index -> agentId.
  queueReservations: {
    arrival: Map<number, string>;
    departure: Map<number, string>;
  };
  // Which agent occupies (or is walking to) the ready position A0/D0.
  readyOccupants: { arrival: string | null; departure: string | null };

  // Reservation mutators. QueueManager is the sole caller (stateless façade);
  // these are the only writes to the above state.
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

  // ========== Boss State ==========
  boss: BossAnimationState;

  // Boss actions
  updateBossBackendState: (state: BossState) => void;
  updateBossTask: (task: string | null) => void;
  setBossInUse: (by: "arrival" | "departure" | null) => void;
  setBossTyping: (typing: boolean) => void;

  // ========== Bubble Actions (unified for boss and agents) ==========
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

  // ========== Office State ==========
  sessionId: string;
  deskCount: number;
  elevatorState: ElevatorState;
  phoneState: PhoneState;
  contextUtilization: number; // 0.0 to 1.0 representing context window usage
  toolUsesSinceCompaction: number; // Counter for safety sign - resets on compaction
  isCompacting: boolean; // True when context compaction animation is active
  compactionPhase: CompactionAnimationPhase; // Phase of the compaction animation
  printReport: boolean; // True when user requested a report and session ended
  todos: TodoItem[];
  gitStatus: GitStatus | null;
  eventLog: EventLogEntry[];

  // Office actions
  setSessionId: (id: string) => void;
  setElevatorState: (state: ElevatorState) => void;
  setPhoneState: (state: PhoneState) => void;
  setDeskCount: (count: number) => void;
  setContextUtilization: (utilization: number) => void;
  setToolUsesSinceCompaction: (count: number) => void;
  triggerCompaction: () => void; // Trigger context compaction animation
  setCompactionPhase: (phase: CompactionAnimationPhase) => void; // Set compaction animation phase
  setIsCompacting: (isCompacting: boolean) => void; // Set isCompacting flag
  setTodos: (todos: TodoItem[]) => void;
  setPrintReport: (printReport: boolean) => void;
  setGitStatus: (status: GitStatus | null) => void;
  addEventLog: (event: NonNullable<WebSocketMessage["event"]>) => void;
  conversation: ConversationEntry[];
  setConversation: (conversation: ConversationEntry[]) => void;

  // Whiteboard actions
  whiteboardData: WhiteboardData;
  whiteboardMode: WhiteboardMode;
  setWhiteboardData: (data: WhiteboardData) => void;
  setWhiteboardMode: (mode: WhiteboardMode) => void;
  cycleWhiteboardMode: () => void;

  // ========== UI State ==========
  isConnected: boolean;
  isReplaying: boolean;
  replaySpeed: number;
  replayEvents: ReplayFrame[];
  currentReplayIndex: number;

  // Debug state
  debugMode: boolean;
  showPaths: boolean;
  showQueueSlots: boolean;
  showPhaseLabels: boolean;
  showObstacles: boolean;

  // UI actions
  setConnected: (connected: boolean) => void;
  setReplaying: (replaying: boolean) => void;
  setReplaySpeed: (speed: number) => void;
  setReplayEvents: (events: ReplayFrame[]) => void;
  setReplayIndex: (index: number) => void;
  setDebugMode: (enabled: boolean) => void;
  toggleDebugOverlay: (
    overlay: "paths" | "queueSlots" | "phaseLabels" | "obstacles",
  ) => void;
  loadPersistedDebugSettings: () => void;

  // ========== Top-level Actions ==========
  reset: () => void;
  resetForReplay: () => void;
  resetForSessionSwitch: () => void;
  processBackendState: (state: BackendGameState) => void;
}

// ============================================================================
// INITIAL STATE (composed from each slice's initial fragment)
// ============================================================================

const initialState = {
  ...initialAgentState,
  ...initialQueueState,
  ...initialReservationState,
  ...initialBossSliceState,
  ...initialOfficeState,
  ...initialWhiteboardState,
  ...initialReplayState,
  ...initialDebugState,
};

// ============================================================================
// STORE IMPLEMENTATION (composition root)
// ============================================================================

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get, api) => ({
    ...initialState,

    // --- Slices (ARC-005): each provides its own state + actions ---
    ...createAgentSlice(set, get, api),
    ...createQueueSlice(set, get, api),
    ...createReservationSlice(set, get, api),
    ...createBossSlice(set, get, api),
    ...createBubbleSlice(set, get, api),
    ...createOfficeSlice(set, get, api),
    ...createWhiteboardSlice(set, get, api),
    ...createReplaySlice(set, get, api),
    ...createDebugSlice(set, get, api),

    // ========================================================================
    // TOP-LEVEL ACTIONS (cross-cutting: reset variants reconcile every slice)
    // ========================================================================

    reset: () =>
      set({
        ...initialState,
        agents: new Map(),
        boss: { ...initialBossState, bubble: createEmptyBubbleState() },
        whiteboardData: { ...initialWhiteboardState.whiteboardData },
        whiteboardMode: 0,
      }),

    resetForReplay: () =>
      set({
        ...initialState,
        agents: new Map(),
        boss: { ...initialBossState, bubble: createEmptyBubbleState() },
        whiteboardData: { ...initialWhiteboardState.whiteboardData },
        whiteboardMode: 0,
        isReplaying: true,
      }),

    resetForSessionSwitch: () =>
      set({
        // Reset all agent/game state but preserve UI settings
        agents: new Map(),
        arrivalQueue: [],
        departureQueue: [],
        queueReservations: {
          arrival: new Map(),
          departure: new Map(),
        },
        readyOccupants: { arrival: null, departure: null },
        boss: { ...initialBossState, bubble: createEmptyBubbleState() },
        sessionId: "None",
        deskCount: MIN_DESK_COUNT,
        elevatorState: "closed",
        phoneState: "idle",
        contextUtilization: 0.0,
        toolUsesSinceCompaction: 0,
        isCompacting: false,
        compactionPhase: "idle",
        todos: [],
        gitStatus: null,
        eventLog: [], // Clear event log for new session
        whiteboardData: { ...initialWhiteboardState.whiteboardData },
        // Keep whiteboardMode - user preference
        // Keep connection-related state
        isConnected: false,
        isReplaying: false, // Important: allow WebSocket to reconnect
        replayEvents: [],
        currentReplayIndex: -1,
        conversation: [], // Clear conversation for new session
        // Debug settings are preserved (not reset)
      }),

    processBackendState: (backendState) =>
      set((state) => {
        // This is called when we receive a full state update from backend.
        // It reconciles the backend agent list with our frontend state.

        const currentAgentIds = new Set(state.agents.keys());
        const backendAgentIds = new Set(backendState.agents.map((a) => a.id));

        const newAgents = new Map(state.agents);
        const newArrivalQueue = [...state.arrivalQueue];
        const newDepartureQueue = [...state.departureQueue];

        // Handle new agents (arrivals)
        for (const backendAgent of backendState.agents) {
          if (!currentAgentIds.has(backendAgent.id)) {
            // New agent - will be added via state machine event, not here
          } else {
            // Existing agent - update backend state
            const existing = newAgents.get(backendAgent.id);
            if (existing) {
              newAgents.set(backendAgent.id, {
                ...existing,
                backendState: backendAgent.state,
                currentTask: backendAgent.currentTask ?? null,
                desk: backendAgent.desk ?? null,
                name: backendAgent.name ?? null,
              });
            }
          }
        }

        // Handle removed agents (departures)
        for (const agentId of currentAgentIds) {
          if (!backendAgentIds.has(agentId)) {
            // Will be handled by state machine event when agent is idle
          }
        }

        // Update boss
        const newBoss: BossAnimationState = {
          ...state.boss,
          backendState: backendState.boss.state,
          currentTask: backendState.boss.currentTask ?? null,
        };

        // Process bubbles from backend state
        // (These are enqueued separately via state machine events)

        // Update whiteboard data if provided
        const whiteboardData = backendState.whiteboardData
          ? {
              toolUsage: backendState.whiteboardData.toolUsage ?? {},
              taskCompletedCount:
                backendState.whiteboardData.taskCompletedCount ?? 0,
              bugFixedCount: backendState.whiteboardData.bugFixedCount ?? 0,
              coffeeBreakCount:
                backendState.whiteboardData.coffeeBreakCount ?? 0,
              codeWrittenCount:
                backendState.whiteboardData.codeWrittenCount ?? 0,
              recentErrorCount:
                backendState.whiteboardData.recentErrorCount ?? 0,
              recentSuccessCount:
                backendState.whiteboardData.recentSuccessCount ?? 0,
              activityLevel: backendState.whiteboardData.activityLevel ?? 0,
              consecutiveSuccesses:
                backendState.whiteboardData.consecutiveSuccesses ?? 0,
              lastIncidentTime:
                backendState.whiteboardData.lastIncidentTime ?? null,
              agentLifespans: backendState.whiteboardData.agentLifespans ?? [],
              newsItems: backendState.whiteboardData.newsItems ?? [],
              coffeeCups: backendState.whiteboardData.coffeeCups ?? 0,
              fileEdits: backendState.whiteboardData.fileEdits ?? {},
              backgroundTasks:
                backendState.whiteboardData.backgroundTasks ?? [],
            }
          : state.whiteboardData;

        return {
          agents: newAgents,
          arrivalQueue: newArrivalQueue,
          departureQueue: newDepartureQueue,
          boss: newBoss,
          sessionId: backendState.sessionId,
          deskCount: backendState.office.deskCount,
          // NOTE: elevatorState is NOT synced from backend - it's controlled by
          // the frontend's agent state machine for smooth animations
          phoneState: backendState.office.phoneState,
          contextUtilization: backendState.office.contextUtilization ?? 0.0,
          toolUsesSinceCompaction:
            backendState.office.toolUsesSinceCompaction ?? 0,
          printReport: backendState.office.printReport ?? false,
          todos: backendState.todos,
          whiteboardData,
          conversation: backendState.conversation ?? [],
        };
      }),
  })),
);

// ============================================================================
// SELECTORS (for efficient subscriptions)
// ============================================================================

export const selectAgents = (state: GameStore) => state.agents;
export const selectBoss = (state: GameStore) => state.boss;
export const selectArrivalQueue = (state: GameStore) => state.arrivalQueue;
export const selectDepartureQueue = (state: GameStore) => state.departureQueue;
export const selectIsConnected = (state: GameStore) => state.isConnected;
export const selectIsReplaying = (state: GameStore) => state.isReplaying;
export const selectDebugMode = (state: GameStore) => state.debugMode;
export const selectSessionId = (state: GameStore) => state.sessionId;
export const selectShowPaths = (state: GameStore) => state.showPaths;
export const selectShowQueueSlots = (state: GameStore) => state.showQueueSlots;
export const selectShowPhaseLabels = (state: GameStore) =>
  state.showPhaseLabels;
export const selectShowObstacles = (state: GameStore) => state.showObstacles;
export const selectElevatorState = (state: GameStore) => state.elevatorState;
export const selectContextUtilization = (state: GameStore) =>
  state.contextUtilization;
export const selectIsCompacting = (state: GameStore) => state.isCompacting;
export const selectCompactionPhase = (state: GameStore) =>
  state.compactionPhase;
export const selectTodos = (state: GameStore) => state.todos;
export const selectGitStatus = (state: GameStore) => state.gitStatus;
export const selectEventLog = (state: GameStore) => state.eventLog;
export const selectToolUsesSinceCompaction = (state: GameStore) =>
  state.toolUsesSinceCompaction;
export const selectPrintReport = (state: GameStore) => state.printReport;
export const selectWhiteboardData = (state: GameStore) => state.whiteboardData;
export const selectWhiteboardMode = (state: GameStore) => state.whiteboardMode;
export const selectConversation = (state: GameStore) => state.conversation;
