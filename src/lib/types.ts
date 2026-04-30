// ============================================================================
// Agent Dashboard — Core Type Definitions
// ============================================================================

// ---------------------------------------------------------------------------
// Agent Behavior System
// ---------------------------------------------------------------------------

/** All possible agent behaviors/states */
export type AgentBehavior =
  // Work
  | 'working'
  | 'thinking'
  | 'researching'
  | 'meeting'
  | 'deploying'
  | 'debugging'
  // Interaction
  | 'receiving_task'
  | 'reporting'
  // Life
  | 'idle'
  | 'coffee'
  | 'snacking'
  | 'toilet'
  | 'sleeping'
  | 'napping'
  // Anomaly
  | 'panicking'
  | 'dead'
  | 'overloaded'
  | 'reviving';

/** Agent states compatible with the office engine (mapped from AgentBehavior) */
export type AgentState =
  | 'idle'
  | 'working'
  | 'thinking'
  | 'researching'
  | 'meeting'
  | 'deploying'
  | 'resting'
  | 'receiving_task'
  | 'reporting'
  | 'waiting'
  | 'arriving';

/**
 * Office zone identifiers.
 *
 * Procedurally generated: special rooms keep stable string ids
 * (`'boss_office'`, `'break_room'`, ...); per-agent desks use the
 * convention `desk_${index}` and are allocated by `OfficeGenerator`
 * based on team size. Use `SPECIAL_ZONE_IDS` and `isDeskZone()` from
 * `@/office/zones` instead of switch-statements over a literal union.
 */
export type ZoneId = string;

/** Discriminator helpers — narrow these by id pattern, not by literal. */
export const SPECIAL_ZONE_IDS = [
  'boss_office',
  'break_room',
  'meeting_room',
  'whiteboard',
  'library',
  'lounge',
  'server_room',
  'entrance',
] as const;
export type SpecialZoneId = (typeof SPECIAL_ZONE_IDS)[number];

/** Pixel coordinate in screen space */
export interface ScreenPos {
  x: number;
  y: number;
}

/** Grid coordinate in isometric tile space */
export interface GridPos {
  col: number;
  row: number;
}

/** Character facing direction */
export type Direction = 'n' | 's' | 'e' | 'w';

/** Character animation state */
export type CharacterAnim =
  | 'stand'
  | 'walk_frame1'
  | 'walk_frame2'
  | 'sit_typing'
  | 'drink_coffee'
  | 'raise_hand'
  | 'headphones'
  | 'sleep'
  | 'run'
  | 'sit_idle'
  | 'thumbs_up'
  | 'hand_task';

/** Furniture/object type */
export type FurnitureType =
  | 'desk'
  | 'chair'
  | 'monitor'
  | 'keyboard'
  | 'big_desk'
  | 'floor_window'
  | 'coffee_machine'
  | 'snack_shelf'
  | 'water_cooler'
  | 'small_table'
  | 'round_table'
  | 'long_table'
  | 'whiteboard_obj'
  | 'bookshelf'
  | 'reading_chair'
  | 'sofa'
  | 'coffee_table'
  | 'server_rack'
  | 'potted_plant'
  | 'carpet'
  | 'wall_clock'
  | 'poster'
  | 'meeting_chair'
  | 'door_mat';

/** A furniture item placed on the map */
export interface FurnitureItem {
  type: FurnitureType;
  col: number;
  row: number;
  variant?: number;
}

/** Zone definition */
export interface Zone {
  id: ZoneId;
  label: string;
  emoji: string;
  center: GridPos;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * A contextual element placed inside a zone by the office generator
 * (coffee machine in break_room, server racks in server_room, ...).
 * SimWorld's `ElementGenerator` analogue: the *meaningful* fixtures of a
 * room, separate from the cosmetic `FurnitureItem` clutter.
 */
export type OfficeElementKind =
  | 'coffee_machine'
  | 'whiteboard'
  | 'server_rack'
  | 'bookshelf'
  | 'sofa'
  | 'monitor'
  | 'desk_chair';

export interface OfficeElement {
  id: string;
  kind: OfficeElementKind;
  zone: ZoneId;
  position: GridPos;
}

/** Output of `generateOffice()` — what the rest of the office reads from. */
export interface GeneratedOffice {
  /** Map dimensions for this generation. Specials live inside this box. */
  cols: number;
  rows: number;
  /** All zones (specials + per-agent desks). */
  zones: Record<ZoneId, Zone>;
  /** Contextual elements per zone (coffee, whiteboards, ...). */
  elements: OfficeElement[];
  /** Number of desk zones allocated; equals min(teamSize, deskCap). */
  deskCount: number;
}

/** A speech bubble */
export interface Bubble {
  text: string;
  ttl: number;
  x: number;
  y: number;
}

/** Effect particle */
export interface Particle {
  type: 'zzz' | 'sparkle' | 'code' | 'question' | 'check' | 'coffee_steam' | 'smoke' | 'error' | 'lightning';
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

/** Tile walkability */
export type TileType = 'floor' | 'wall' | 'furniture' | 'door';

/** State transition info */
export interface StateTransition {
  targetZone: ZoneId | '_own_desk';
  agentAnim: CharacterAnim;
  ownerAnim: CharacterAnim;
  bubble?: string;
  particles?: Particle['type'];
}

// ---------------------------------------------------------------------------
// Agent Runtime (Office Engine)
// ---------------------------------------------------------------------------

export interface AgentRuntime {
  id: string;
  currentState: AgentState;
  pos: GridPos;
  screenPos: ScreenPos;
  direction: Direction;
  anim: CharacterAnim;
  path: GridPos[];
  transitioning: boolean;
  deskZone: ZoneId;
}

export interface OwnerRuntime {
  anim: CharacterAnim;
}

export interface OfficeState {
  agents: AgentRuntime[];
  owner: OwnerRuntime;
  bubbles: Bubble[];
  particles: Particle[];
  tick: number;
  autoMode: boolean;
  autoTimer: number;
  dayNightPhase: number;
}

// ---------------------------------------------------------------------------
// Dashboard Data Types
// ---------------------------------------------------------------------------

/** Avatar preset for agents */
export type AgentAvatar = 'glasses' | 'hoodie' | 'suit' | 'casual' | 'robot' | 'cat' | 'dog' | 'duckbot' | 'alien' | 'wizard' | 'superhero' | 'gamer';

/** Avatar preset for the owner */
export type OwnerAvatar = 'boss' | 'casual' | 'creative';

/** Theme preset */
export type ThemeName = 'default' | 'dark' | 'cozy' | 'cyberpunk';

/** Single AI agent configuration */
export interface AgentConfig {
  id: string;
  name: string;
  emoji: string;
  color: string;
  avatar: AgentAvatar;
  model?: string;
  modelProvider?: string;
  channel?: string;
  sessionKey?: string;
  sessionKind?: 'direct' | 'group' | 'global' | 'unknown';
  label?: string | null;
  displayName?: string | null;
  derivedTitle?: string | null;
  lastMessagePreview?: string | null;
  isSubagent?: boolean;
  parentId?: string | null;
  parentSessionKey?: string | null;
  rootId?: string | null;
  depth?: number;
  subagentIds?: string[];
  sendPolicy?: 'allow' | 'deny' | 'unknown';
  thinkingLevel?: string | null;
  verboseLevel?: string | null;
  reasoningLevel?: string | null;
  elevatedLevel?: string | null;
  avatarUrl?: string | null;
  identityTheme?: string | null;
}

/** Owner configuration */
export interface OwnerConfig {
  name: string;
  emoji: string;
  avatar: OwnerAvatar;
}

/** Gateway connection settings */
export interface GatewayConfig {
  url: string;
  token: string;
}

/** Root configuration for the dashboard */
export interface DashboardConfig {
  agents: AgentConfig[];
  owner: OwnerConfig;
  gateway: GatewayConfig;
  theme: ThemeName;
  connected: boolean;
  demoMode: boolean;
}

// ---------------------------------------------------------------------------
// Agent Dashboard State
// ---------------------------------------------------------------------------

/** Token usage snapshot */
export interface TokenUsage {
  timestamp: number;
  input: number;
  output: number;
  total: number;
}

/** A single task */
export interface AgentTask {
  id: string;
  title: string;
  status: 'active' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  tokenUsage?: number;
}

/** Activity feed event */
export interface ActivityEvent {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  type: 'state_change' | 'task_start' | 'task_complete' | 'task_fail' | 'tool_call' | 'message' | 'error' | 'system';
  message: string;
  timestamp: number;
  /**
   * For `tool_call` events: which side of the tool's lifecycle this event
   * marks. `start` = first time we saw this tool name; `complete` = the
   * agent moved off the tool cleanly; `fail` = the tool errored before
   * completing. Older events may omit this — render those as `start` for
   * back-compat.
   */
  phase?: 'start' | 'complete' | 'fail';
  /** Tool identifier (`web_search`, `read_file`, etc). */
  toolName?: string;
  /** The gateway-reported phase string (`running`, `pre`, `post`...). */
  toolPhase?: string;
  /** Wall-clock time the tool was active, in ms. Set on `complete`/`fail`. */
  durationMs?: number;
  /** Human-readable failure reason. Set on `fail`. */
  errorReason?: string;
}

export type ChatScope = 'direct' | 'broadcast' | 'history';

export type ChatChannel = 'agent' | 'global';

/** Shared chat message shape for direct and global chat views. */
export interface ChatMessage {
  id: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  scope: ChatScope;
  channel: ChatChannel;
  targetIds?: string[];
  isThinking?: boolean;
}

/** Full agent dashboard state */
export interface AgentDashboardState {
  behavior: AgentBehavior;
  officeState: AgentState;
  currentTask: AgentTask | null;
  taskHistory: AgentTask[];
  tokenUsage: TokenUsage[];
  inputTokens?: number;
  outputTokens?: number;
  totalTokens: number;
  contextTokens?: number;
  maxContextTokens?: number;
  totalTasks: number;
  lastActivity: number;
  sessionLog: string[];
  streamType?: string | null;
  /** Last gateway chatStatus for this session: 'delta' | 'final' | 'aborted' | 'error'. */
  chatStatus?: string | null;
  toolName?: string | null;
  toolPhase?: string | null;
  statusSummary?: string;
  lastRunId?: string | null;
  lastMessagePreview?: string | null;
  sendPolicy?: 'allow' | 'deny' | 'unknown';
  reasoningLevel?: string | null;
  thinkingLevel?: string | null;
  verboseLevel?: string | null;
  elevatedLevel?: string | null;
  uptime: number;
}

/** System-wide statistics */
export interface SystemStats {
  totalAgents: number;
  mainAgents?: number;
  subAgents?: number;
  activeAgents: number;
  totalTokens: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalBroadcasts?: number;
  activeThreads?: number;
  uptime: number;
  connected: boolean;
}

/** Persisted auto-work policy for a single session. */
export interface AutoworkPolicy {
  enabled: boolean;
  intervalMs: number;
  directive: string;
  lastSentAt: number;
}

/** Dashboard-visible auto-work settings. */
export interface AutoworkConfig {
  maxSendsPerTick: number;
  defaultDirective: string;
  policies: Record<string, AutoworkPolicy>;
}

// ACP Agent Support
export interface ACPAgent extends AgentConfig {
  runtime: 'acp';
  agentId: string;  // codex, claude-code, etc.
  sessionId?: string;
}

export type AgentType = 'main' | 'subagent' | 'acp';

export interface AgentWithType extends AgentConfig {
  agentType: AgentType;
}
