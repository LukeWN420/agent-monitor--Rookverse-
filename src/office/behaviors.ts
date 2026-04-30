// ============================================================================
// Behavior → Zone + Animation Mapping
// ============================================================================

import type { AgentBehavior, CharacterAnim, ZoneId, Particle } from '@/lib/types';

export interface BehaviorMapping {
  /** Target zone (or '_own_desk' for the agent's assigned desk) */
  zone: ZoneId | '_own_desk';
  /** Animation to play once at the zone */
  anim: CharacterAnim;
  /** Optional speech bubble text */
  bubble?: string;
  /** Particle effect to spawn */
  particle?: Particle['type'];
  /** Priority: higher means agent moves faster */
  priority: number;
}

export const BEHAVIOR_MAP: Record<AgentBehavior, BehaviorMapping> = {
  // Work
  working: {
    zone: '_own_desk',
    anim: 'sit_typing',
    bubble: '💻 Working...',
    particle: 'code',
    priority: 3,
  },
  thinking: {
    zone: '_own_desk',
    anim: 'sit_idle',
    bubble: '🤔 Thinking...',
    particle: 'question',
    priority: 2,
  },
  researching: {
    zone: 'library',
    anim: 'headphones',
    bubble: '📚 Researching',
    particle: 'sparkle',
    priority: 2,
  },
  meeting: {
    zone: 'meeting_room',
    anim: 'raise_hand',
    bubble: '🤝 In meeting',
    priority: 3,
  },
  deploying: {
    zone: 'server_room',
    anim: 'run',
    bubble: '🚀 Deploying!',
    particle: 'lightning',
    priority: 4,
  },
  debugging: {
    zone: '_own_desk',
    anim: 'sit_typing',
    bubble: '🐛 Debugging...',
    particle: 'error',
    priority: 3,
  },

  // Interaction
  receiving_task: {
    zone: 'boss_office',
    anim: 'hand_task',
    bubble: '📋 New task!',
    particle: 'sparkle',
    priority: 4,
  },
  reporting: {
    zone: 'boss_office',
    anim: 'thumbs_up',
    bubble: '✅ Done!',
    particle: 'check',
    priority: 3,
  },

  // Life
  idle: {
    zone: 'break_room',
    anim: 'drink_coffee',
    bubble: '☕ Coffee time',
    particle: 'coffee_steam',
    priority: 0,
  },
  coffee: {
    zone: 'break_room',
    anim: 'drink_coffee',
    bubble: '☕ Coffee time',
    particle: 'coffee_steam',
    priority: 1,
  },
  snacking: {
    zone: 'break_room',
    anim: 'stand',
    bubble: '🍪 Snack break',
    priority: 1,
  },
  toilet: {
    zone: 'break_room',
    anim: 'walk_frame1',
    priority: 1,
  },
  sleeping: {
    zone: 'lounge',
    anim: 'sleep',
    bubble: '😴',
    particle: 'zzz',
    priority: 0,
  },
  napping: {
    zone: '_own_desk',
    anim: 'sleep',
    particle: 'zzz',
    priority: 0,
  },

  // Anomaly
  panicking: {
    zone: '_own_desk',
    anim: 'run',
    bubble: '😱 Error!',
    particle: 'error',
    priority: 5,
  },
  dead: {
    zone: '_own_desk',
    anim: 'sleep',
    bubble: '💀 Crashed',
    particle: 'smoke',
    priority: 0,
  },
  overloaded: {
    zone: '_own_desk',
    anim: 'sit_typing',
    bubble: '🔥 Overloaded!',
    particle: 'smoke',
    priority: 4,
  },
  reviving: {
    zone: '_own_desk',
    anim: 'stand',
    bubble: '🔄 Restarting...',
    particle: 'lightning',
    priority: 3,
  },
};

/** Get the actual zone ID for a behavior, resolving '_own_desk' */
export function resolveZone(behavior: AgentBehavior, deskZone: ZoneId): ZoneId {
  const mapping = BEHAVIOR_MAP[behavior];
  return mapping.zone === '_own_desk' ? deskZone : mapping.zone;
}

/**
 * Tick interval between successive walk steps for a given behavior.
 *
 * Returned values map to "every N ticks the agent advances one tile":
 * - 3  → frantic (panicking, dead — the ghosts of agents past)
 * - 4  → fast walk (deploying — urgent)
 * - 8  → calm default — preserves the recently-tuned office pace
 * - 10 → stroll (idle, coffee — no rush, taking it in)
 *
 * Callers should NOT hard-code these constants; if pacing needs tuning,
 * change them here so the entire office stays consistent.
 */
export function tickIntervalForBehavior(behavior: AgentBehavior): number {
  switch (behavior) {
    case 'panicking':
    case 'dead':
      return 3;
    case 'deploying':
      return 4;
    case 'idle':
    case 'coffee':
      return 10;
    default:
      return 8;
  }
}

/**
 * The animation an agent strikes the moment it arrives at a zone, before
 * the regular behavior animation takes over. Most behaviors already have
 * a visually distinct rest pose (`sit_typing`, `drink_coffee`, ...) so
 * the arrival anim doubles as the steady-state for ~30 ticks while the
 * agent settles. `deploying` keeps `run` because it's a continuous
 * action, not a destination.
 */
export function arrivalAnimFor(behavior: AgentBehavior): CharacterAnim {
  return BEHAVIOR_MAP[behavior].anim;
}

/** How many ticks an agent stays in the arrival pose before resuming idle. */
export const ARRIVAL_FRAMES = 30;
