# Opus Task: State Machine Transitions (Priority 2 from SimWorld Crossover)

## Repo
`C:\Users\Lahve\.openclaw\workspace\tmp\agent-monitor` (fork: LukeWN420/agent-monitor--Rookverse-)

## Context
Priority 1 (procedural zone generation) is DONE and merged. The office now dynamically scales 1-12 agents with proper zone allocation. This task builds on that foundation.

## Goal: Agents Walk Between States Instead of Teleporting

Right now, when an agent's behavior changes (e.g. idle → working), they instantly appear at their new position. This looks jarring. We want them to *walk* to the new zone, play a transition animation at the desk, and then settle into the new behavior.

## What to Build

### 1. Transition State Machine (45 min)
The `AgentRuntime` type already has `transitioning: boolean`. Extend it to track *which* transition:

```typescript
// In types.ts or useOffice.ts
type TransitionState = 
  | { kind: 'idle' }                          // standing at destination
  | { kind: 'walking'; targetZone: ZoneId }    // walking to a zone
  | { kind: 'arriving'; fromBehavior: AgentBehavior; toBehavior: AgentBehavior }  // just arrived, playing settle animation
```

In `useOffice.ts`, when behavior changes:
- If the agent is idle and needs to go to a new zone → set `transitioning = { kind: 'walking', targetZone }`
- When agent reaches destination → set `transitioning = { kind: 'arriving', ... }`
- After ~30 ticks at arrived → set `transitioning = { kind: 'idle' }` and play the behavior animation

### 2. Walk Animation Refinement (20 min)
Walking speed was recently slowed (every 8th tick instead of 4th). Keep that pace but add:
- Direction-aware walk sprites (already using `walk_frame1` / `walk_frame2` — make sure they alternate per step, not per 16-tick cycle)
- A brief "stand" frame (1-2 ticks) when changing direction, so agents don't snap 90 degrees
- Agents slow down when approaching their destination (last 2 tiles at half speed)

### 3. Behavior-Specific Arrival Animations (15 min)
When an agent arrives at their zone and transitions to the new behavior:
- **working** → agent sits down (2-tick "sit" transition frame, then `sit_typing`)
- **meeting** → agent raises hand (1-tick `raise_hand` frame, then holds)
- **idle/coffee** → agent reaches for coffee (1-tick frame, then `drink_coffee`)
- **sleeping** → agent lies down (1-tick frame, then `sleep`)
- **debugging** → agent leans forward (1-tick frame, then `sit_typing` with error particles)
- **deploying** → agent runs to server room (keep `run` animation throughout)

Keep these simple — 1-2 frame transitions, not multi-frame sprite sequences. The pixel art style means single-frame state changes read fine.

### 4. Idle Fidgeting Improvements (10 min)
Fidgeting was recently added (agents shift 1 tile randomly every ~15 seconds). Tweak it:
- Make fidgeting direction-aware: agents fidget within their zone, not into walls
- Add occasional "look around" animation: every ~45 seconds, an idle agent plays `sit_idle` for 60 ticks instead of `drink_coffee`
- Coffee steam particles should only spawn when the agent is actually in the break_room zone, not at their desk

### 5. Speed Variation by Behavior (10 min)
Different behaviors = different movement speeds:
- `deploying` → fast walk (every 4th tick, like the old speed)
- `panicking` / `dead` → fastest (every 3rd tick)  
- `idle` / `coffee` → slow stroll (every 10th tick)
- Everything else → normal walk (every 8th tick)

This is already partially set up with the `speed` prop in `useOffice` — just pass the behavior-specific speed.

## What NOT to Touch
- Don't change the zone generator (Priority 1 landed, it's stable)
- Don't change the canvas rendering engine
- Don't change the gateway connection or chat system
- Don't change the modal office overlay
- Don't change the agent card status lines or activity feed (Opus's last batch, those are stable)
- Don't add new behavior types — work with the existing 18

## Testing
- `npm test` must pass (103+ tests)
- `npm run build` must succeed
- Manual: watch agents transition between behaviors. They should walk calmly to their new zone, play a brief arrival animation, then settle. No teleporting. No jarring direction snaps.

## Estimated Time: ~100 min (1.5-2 hours careful work)