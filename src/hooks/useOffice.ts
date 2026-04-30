// ============================================================================
// useOffice — Office state management hook
// ============================================================================
/* eslint-disable react-hooks/set-state-in-effect */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  OfficeState,
  AgentRuntime,
  AgentBehavior,
  AgentConfig,
  GridPos,
  CharacterAnim,
  ZoneId,
  Particle,
} from '@/lib/types';
import type { AgentDashboardState } from '@/lib/types';
import { findPath, type WalkGrid } from '@/engine/pathfinding';
import { createWalkGrid } from '@/office/layout';
import {
  ARRIVAL_FRAMES,
  arrivalAnimFor,
  BEHAVIOR_MAP,
  resolveZone,
  tickIntervalForBehavior,
} from '@/office/behaviors';
import { getZone, getRandomPointInZone } from '@/office/zones';
import { generateOffice, DESK_CAP } from '@/office/generator';
import type { Direction } from '@/lib/types';
import { createParticle, tickParticles } from '@/sprites/effects';
import { gridToScreen } from '@/engine/isometric';

export interface UseOfficeReturn {
  officeState: OfficeState;
  tick: () => void;
}

/** Desk zone ids, generated to match the procedural office. */
const DESK_ZONES: ZoneId[] = Array.from({ length: DESK_CAP }, (_, i) => `desk_${i}`);

/** How long an idle agent holds `sit_idle` during a "look around" break. */
const LOOK_AROUND_FRAMES = 60;
/** Base interval (ticks) between look-around breaks for idle agents. */
const LOOK_AROUND_BASE_INTERVAL = 1350;

function computeDirection(from: GridPos, to: GridPos): Direction {
  if (to.col > from.col) return 'e';
  if (to.col < from.col) return 'w';
  if (to.row > from.row) return 's';
  return 'n';
}

/** True if `pos` lies inside the rectangle defined by [minCol..maxCol, minRow..maxRow]. */
function isInsideZone(
  pos: GridPos,
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): boolean {
  return (
    pos.col >= bounds.minCol &&
    pos.col <= bounds.maxCol &&
    pos.row >= bounds.minRow &&
    pos.row <= bounds.maxRow
  );
}

function createInitialAgentRuntime(id: string, index: number, teamSize: number): AgentRuntime {
  const deskZone = DESK_ZONES[index % DESK_CAP];
  const zone = getZone(deskZone, teamSize);
  const pos = zone ? zone.center : { col: 4, row: 3 + (index % 6) * 3 };
  return {
    id,
    currentState: 'idle',
    pos: { ...pos },
    screenPos: gridToScreen(pos),
    direction: 's',
    anim: 'stand',
    path: [],
    transitioning: false,
    deskZone,
  };
}

export function useOffice(
  agents: AgentConfig[],
  agentStates: Record<string, AgentDashboardState>,
  speed: number = 1,
): UseOfficeReturn {
  const [officeState, setOfficeState] = useState<OfficeState>(() => ({
    agents: agents.map((a, i) => createInitialAgentRuntime(a.id, i, agents.length)),
    owner: { anim: 'sit_typing' },
    bubbles: [],
    particles: [],
    tick: 0,
    autoMode: true,
    autoTimer: 0,
    dayNightPhase: 0,
  }));

  const walkGridRef = useRef<WalkGrid>(createWalkGrid(agents.length));
  const particleTimerRef = useRef<Record<string, number>>({});

  // Rebuild walk grid when agent count changes
  useEffect(() => {
    walkGridRef.current = createWalkGrid(agents.length);
  }, [agents.length]);

  // Sync agent runtimes when agents config changes
  useEffect(() => {
    setOfficeState(prev => {
      const existingIds = new Set(prev.agents.map(a => a.id));
      const newRuntimes = agents.map((a, i) => {
        const existing = prev.agents.find(r => r.id === a.id);
        if (existing) return existing;
        return createInitialAgentRuntime(a.id, i, agents.length);
      });
      return { ...prev, agents: newRuntimes };
    });
  }, [agents]);

  const tickFn = useCallback(() => {
    setOfficeState(prev => {
      const newTick = prev.tick + 1;
      const newAgents: AgentRuntime[] = [];
      const newBubbles = prev.bubbles.map(b => ({ ...b, ttl: b.ttl - 1 })).filter(b => b.ttl > 0);
      const newParticles = tickParticles(prev.particles);

      // Pre-compute agent index map once per tick — the previous loop did
      // O(n²) lookups inside the per-agent loop just to stagger particles.
      const agentIndexById: Record<string, number> = {};
      for (let i = 0; i < agents.length; i++) agentIndexById[agents[i].id] = i;

      for (const runtime of prev.agents) {
        const dashState = agentStates[runtime.id];
        const behavior: AgentBehavior = dashState?.behavior ?? 'idle';
        const mapping = BEHAVIOR_MAP[behavior];
        const targetZone = resolveZone(behavior, runtime.deskZone);
        const updated = { ...runtime };
        const agentIndex = agentIndexById[runtime.id] ?? 0;

        const zone = getZone(targetZone, agents.length);
        const inTargetZone = zone ? isInsideZone(updated.pos, zone) : true;

        // ---- Phase A: Kick off a walk if we need to be elsewhere -----------
        // Don't interrupt an in-progress arrival animation; let it finish
        // before re-pathing. (Avoids a visual pop where an agent settles
        // for one frame, then immediately stands and walks again.)
        const arriving = (updated.arrivalFramesLeft ?? 0) > 0;
        if (zone && !inTargetZone && updated.path.length === 0 && !arriving) {
          const target = getRandomPointInZone(zone);
          const path = findPath(walkGridRef.current, updated.pos, target);
          if (path.length > 0) {
            updated.path = path;
            updated.transitioning = true;
            updated.arrivalFramesLeft = 0;
            updated.arrivalAnim = undefined;
          }
        }

        // ---- Phase B: Walk along path --------------------------------------
        if (updated.path.length > 0) {
          const next = updated.path[0];
          // Speed depends on behavior: deploying/panicking move faster,
          // idle/coffee stroll, default = the recently-tuned 8-tick pace.
          let interval = tickIntervalForBehavior(behavior);
          // Slow to half speed for the last 2 tiles so arrivals feel deliberate.
          if (updated.path.length <= 2) interval = interval * 2;
          // Honor the `speed` prop as an additional floor (defaults to 1 = no change).
          interval = Math.max(1, Math.round(interval / Math.max(1, speed)));

          if (newTick % interval === 0) {
            const expectedDir = computeDirection(updated.pos, next);
            const dirChanged = expectedDir !== updated.direction;

            if (dirChanged) {
              // Hold a stand frame for one walk-tick so 90° turns aren't jarring.
              updated.prevDirection = updated.direction;
              updated.direction = expectedDir;
              updated.anim = 'stand';
            } else {
              updated.pos = { ...next };
              updated.screenPos = gridToScreen(updated.pos);
              updated.path = updated.path.slice(1);
              updated.stepsTaken = (updated.stepsTaken ?? 0) + 1;
              // Frames alternate per ACTUAL step so cadence tracks motion,
              // not a fixed 16-tick cycle that desyncs at varying speeds.
              updated.anim = updated.stepsTaken % 2 === 0 ? 'walk_frame1' : 'walk_frame2';
              updated.prevDirection = expectedDir;
            }

            // If that step emptied the path, enter the arrival phase.
            if (updated.path.length === 0) {
              updated.arrivalFramesLeft = ARRIVAL_FRAMES;
              updated.arrivalAnim = arrivalAnimFor(behavior);
            }
          }
        }

        // ---- Phase C: Arrival pose (briefly held before settling) ---------
        else if ((updated.arrivalFramesLeft ?? 0) > 0) {
          updated.transitioning = true;
          updated.anim = updated.arrivalAnim ?? mapping.anim;
          updated.arrivalFramesLeft = (updated.arrivalFramesLeft ?? 1) - 1;
          if (updated.arrivalFramesLeft <= 0) {
            updated.arrivalFramesLeft = 0;
            updated.arrivalAnim = undefined;
            updated.transitioning = false;
          }
        }

        // ---- Phase D: Settled at destination ------------------------------
        else {
          updated.transitioning = false;
          updated.anim = mapping.anim;

          // Look-around: every ~45s an idle-ish agent plays sit_idle for 60 ticks.
          // Only kicks in for behaviors whose steady-state is `drink_coffee`,
          // `sit_idle`, or `stand` — i.e. the agent is loitering, not actively typing.
          const isLoitering =
            mapping.anim === 'drink_coffee'
            || mapping.anim === 'sit_idle'
            || mapping.anim === 'stand';
          if (isLoitering) {
            if (updated.nextLookAroundTick === undefined) {
              // Stagger initial look-around timer per agent so they don't all
              // glance up at the same moment.
              updated.nextLookAroundTick =
                newTick + LOOK_AROUND_BASE_INTERVAL + ((agentIndex * 73) % 500);
            }
            if (newTick >= updated.nextLookAroundTick) {
              updated.lookingAroundUntil = newTick + LOOK_AROUND_FRAMES;
              updated.nextLookAroundTick = newTick + LOOK_AROUND_BASE_INTERVAL;
            }
            if (
              updated.lookingAroundUntil !== undefined
              && newTick < updated.lookingAroundUntil
            ) {
              updated.anim = 'sit_idle';
            }
          }

          // Idle fidgeting — every ~15 seconds, shift one tile inside the zone.
          // The previous version could fidget through walls into another room;
          // gate on (a) walkable tile AND (b) still inside the agent's zone.
          if (newTick % 450 === (agentIndex * 53) % 450) {
            const fidgetDx = Math.random() < 0.5 ? -1 : 1;
            const fidgetDy = Math.random() < 0.5 ? -1 : 1;
            const newPos = { col: updated.pos.col + fidgetDx, row: updated.pos.row + fidgetDy };
            const grid = walkGridRef.current;
            const walkable = grid[newPos.row]?.[newPos.col] === 'floor';
            const stillInZone = zone ? isInsideZone(newPos, zone) : false;
            if (walkable && stillInZone) {
              updated.pos = newPos;
              updated.screenPos = gridToScreen(newPos);
            }
          }

          // Particles — coffee steam only spawns when actually in the break room,
          // not at a desk that happened to inherit `coffee_steam` from a behavior.
          if (mapping.particle) {
            const isCoffeeInWrongRoom =
              mapping.particle === 'coffee_steam'
              && targetZone !== 'break_room';
            if (!isCoffeeInWrongRoom) {
              const timerId = `${runtime.id}-particle`;
              const lastSpawn = particleTimerRef.current[timerId] ?? 0;
              if (newTick - lastSpawn > 60) {
                particleTimerRef.current[timerId] = newTick;
                const sp = gridToScreen(updated.pos);
                newParticles.push(
                  createParticle(mapping.particle, sp.x, sp.y - 30),
                );
              }
            }
          }

          // Bubble — every ~30s, staggered per agent.
          if (mapping.bubble && newTick % 900 === (agentIndex * 73) % 900) {
            const sp = gridToScreen(updated.pos);
            newBubbles.push({
              text: mapping.bubble,
              ttl: 120,
              x: sp.x,
              y: sp.y - 40,
            });
          }
        }

        updated.currentState = behavior === 'working' || behavior === 'debugging' ? 'working' :
          behavior === 'thinking' ? 'thinking' :
          behavior === 'researching' ? 'researching' :
          behavior === 'meeting' ? 'meeting' :
          behavior === 'deploying' ? 'deploying' :
          'idle';

        newAgents.push(updated);
      }

      // Day-night cycle (very slow)
      const dayNightPhase = (Math.sin(newTick * 0.0005) + 1) / 2;

      // Owner animation changes
      const ownerAnim: CharacterAnim =
        newTick % 600 < 400 ? 'sit_typing' :
        newTick % 600 < 500 ? 'sit_idle' : 'drink_coffee';

      return {
        agents: newAgents,
        owner: { anim: ownerAnim },
        bubbles: newBubbles,
        particles: newParticles,
        tick: newTick,
        autoMode: prev.autoMode,
        autoTimer: prev.autoTimer,
        dayNightPhase,
      };
    });
  }, [agentStates, agents, speed]);

  return { officeState, tick: tickFn };
}
