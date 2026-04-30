# Opus Final Draft: State Machine Transitions + Pixel Art Resources

## Primary Task: State Machine Transitions
See `OPUS_TASK_TRANSITIONS.md` for full spec. Summary:

1. **Transition state machine** — agents walk between zones instead of teleporting
2. **Walk animation refinement** — direction-aware sprites, approach deceleration
3. **Behavior-specific arrival animations** — sit down, raise hand, reach for coffee
4. **Idle fidgeting improvements** — zone-aware fidgeting, occasional "look around"
5. **Speed variation by behavior** — deploying fast, idle slow, panicking fastest

Estimated: ~100 min. This is the last structural piece before going live.

## Reference: Pixel Art Tools for Future Sprite Work
Forked to LukeWN420 and added as git remotes on this repo.

### Sprite Creation (for custom character art)
- **Aseprite** → `remotes/aseprite/main` | https://github.com/LukeWN420/aseprite (36k ⭐ upstream, C++)
  - The industry standard for pixel art + sprite animation
  - Use for: creating proper Rook character sprite sheets (walk cycles, sit animations, direction frames)
  - Current characters are drawn with basic shapes — proper 16x16 or 32x32 sprites would be a huge upgrade
  - Each named agent could get a custom sprite designed in Aseprite
  - Free fork: **LibreSprite** (https://github.com/LibreSprite/LibreSprite)

- **Piskel** → `remotes/piskel/master` | https://github.com/LukeWN420/piskel (12k ⭐ upstream, JS)
  - Web-based pixel art + animation editor
  - Could embed IN the dashboard as an in-app sprite customizer
  - Users design their agent's look from within the app

### Programmatic Pixel Art (code-driven generation)
- **pixel8** → `remotes/pixel8/master` | https://github.com/LukeWN420/pixel8 (2k ⭐ upstream, React)
  - Low-res React component primitives for pixel art
  - **Most directly useful** — could replace our hand-rolled canvas for mini-map, sprites, furniture
  - Handles scaling, animation frames, color palettes natively

- **Data-Pixels** → `remotes/data-pixels/master` | https://github.com/LukeWN420/Data-Pixels (3.3k ⭐ upstream, JS)
  - Create pixel art programmatically from data
  - Could generate desk items, furniture, zone decorations from code
  - Useful for auto-generating agent-specific desk configurations

- **pixel-art-react** → `remotes/pixel-art-react/master` | https://github.com/LukeWN420/pixel-art-react (5.8k ⭐ upstream, React)
  - React-based pixel art drawing/animation app
  - Could be adapted as an in-dashboard sprite editor

### Recommended Next Steps After This Task
1. **State machine transitions** ← this task
2. **Go live** — connect real gateway data, test with active agent sessions
3. **Sprite upgrade** — design proper Rook character sheet in Aseprite (or embed Piskel/pixel-art-react as in-app editor)
4. **pixel8 integration** — replace hand-rolled canvas primitives with React components for cleaner rendering
5. **Dynamic furniture sprites** — use Data-Pixels patterns for code-generated desk items

## Files Changed (from previous commits, now live)
- `src/hooks/useOffice.ts` — walking speed slowed to every 8th tick, fidgeting to every ~15s, bubbles to every ~30s
- `src/components/office/MiniOffice.tsx` — modal overlay instead of page navigation
- `src/app/office/page.tsx` — redirects to dashboard
- `electron/main.cjs` — desktop wrapper with system tray
- `src/office/generator.ts` — procedural zone generation (Priority 1, done)
- `src/lib/AgentsProvider.tsx` — shared agent + office state context