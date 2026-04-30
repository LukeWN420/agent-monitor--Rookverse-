# Opus Task: SimWorld → Agent Monitor Crossover

## Repo
`C:\Users\Lahve\.openclaw\workspace\tmp\agent-monitor` (forked as LukeWN420/agent-monitor--Rookverse-)

## SimWorld Reference
`C:\Users\Lahve\.openclaw\workspace\tmp\SimWorld` — UE-based 3D simulation with procedural city generation and agent AI

## Goal
Take the best algorithms from SimWorld and adapt them into Agent Monitor's 2D pixel office, making the workspace richer, more dynamic, and more engaging. We're not porting the 3D engine — we're extracting the *thinking* and applying it at 2D scale.

## What to Adapt

### 1. Procedural Zone Generation from CityGen (60 min)
SimWorld's `citygen/` module procedurally generates cities with roads, buildings, and elements. Adapt this for the pixel office:

- The office currently has hardcoded zones (desk_0-5, break_room, meeting_room, server_room, library, lounge, boss_office, bathroom)
- Create a `OfficeGenerator` class inspired by `CityGenerator` that:
  - Procedurally places zones based on team size (1 agent = small office, 5+ = multi-room, 10+ = multi-floor)
  - Auto-creates desk zones for new agents as they register
  - Adds connecting corridors between zones (like SimWorld's road generation)
  - Places "elements" in zones — coffee machine in break room, whiteboard in meeting room, server rack in server room (like SimWorld's `ElementGenerator`)
- The current `createWalkGrid()` in `office/layout.ts` returns a fixed grid. Make it dynamic — generated from the zone layout.

### 2. Smarter Agent Pathfinding (45 min)
SimWorld has robust A* pathfinding with collision avoidance (`local_planner/`, `map/`). Our office pathfinding works but is basic:

- Adapt SimWorld's route generation approach:
  - Agents should path around each other, not walk through each other
  - Add "waiting" behavior — if path is blocked by another agent, wait a tick then retry
  - Agents approaching the same destination should queue (e.g., at the coffee machine)
  - Walking speed variation — agents move at slightly different speeds based on behavior (deploying = fast, idle = slow)
- Reference: `simworld/local_planner/local_planner.py` and `simworld/local_planner/action_space.py`

### 3. Agent State Machine with Natural Transitions (45 min)
SimWorld's pedestrian/vehicle agents have proper state machines. Our agents jump directly between 18 behaviors with no transition animation:

- Create a transition system so agents *move between states* instead of teleporting:
  - idle → working: agent gets up, walks to desk, sits down, starts typing
  - working → meeting: agent stands, walks to meeting room, sits at table
  - any → sleeping: agent walks to lounge, lies down
  - any → panicking: agent stands abruptly, runs to desk
- Add "transitioning" states visible in the office: "walking to desk", "heading to meeting", "getting coffee"
- The `useOffice` hook already has `transitioning: boolean` on `AgentRuntime` — extend it to track *which* transition and play appropriate walk animations
- Reference: `simworld/agent/pedestrian.py` for how SimWorld handles pedestrian state transitions

### 4. Dynamic Furniture & Decorations (30 min)
SimWorld's `ElementGenerator` places contextual objects in generated spaces. Apply the same idea:

- When an agent sits at their desk, show desk-specific items: monitor, keyboard, coffee cup
- When agent is "working", show code on screen (tiny pixel text). When "thinking", show question marks. When "idle", show a coffee cup.
- Meeting room: when agents gather, show a whiteboard with bullet points
- Break room: coffee machine with steam particles when someone's nearby
- These are all sprite additions to the existing `drawFurniture()` and particle systems

### 5. Mini-map for Multi-zone Navigation (30 min — stretch)
When the office grows beyond ~8 zones, the single canvas gets crowded:

- Add a mini-map overlay (top-right corner) showing zone layout and agent positions as dots
- Clicking a zone on the mini-map scrolls/centers the main view on that zone
- Inspired by SimWorld's map overview but in pixel art style
- Only show when zone count > 6

## Priority Order
1. Procedural zone generation (biggest structural improvement)
2. Agent state machine transitions (most visible dynamism improvement)
3. Smarter pathfinding (most functional improvement)
4. Dynamic furniture (polish)
5. Mini-map (stretch)

## What NOT to Do
- Don't import SimWorld as a dependency — it's a reference, not a library
- Don't touch the UE server or 3D rendering — we're 2D only
- Don't change the gateway connection, chat system, or shared state context
- Don't change the existing behavior enum (18 behaviors) — just add transition states between them
- Don't make the office so complex it's slow — keep 30fps target