// ============================================================================
// OfficeGenerator — Procedural zone + element placement
//
// Inspired by SimWorld's `CityGenerator` / `ElementGenerator` pair: a room
// (zone) describes a labelled rectangle of grid tiles, and an "element"
// is a meaningful fixture inside that room (coffee machine, server rack,
// whiteboard). The generator returns *data* — `createWalkGrid` and the
// canvas drawer consume it; nothing here knows about pixels.
//
// Scope of this version (v1):
// - The 8 special rooms (boss_office, break_room, meeting_room, library,
//   lounge, server_room, whiteboard, entrance) keep their stable
//   coordinates inside the existing 24×20 grid.
// - Desk zones are allocated procedurally as `desk_${i}` for
//   `i in [0, min(teamSize, DESK_CAP))`.
// - For teamSize > 6, additional desk columns extend into rows that were
//   only loosely used by the library/whiteboard area, with collision
//   awareness against the special rooms.
// - Elements are emitted as data; consumers can render new sprites on
//   top of them in a follow-up pass. The existing `buildFurnitureLayout`
//   still draws the visual furniture, so backwards-compat holds.
// ============================================================================

import type {
  GeneratedOffice,
  GridPos,
  OfficeElement,
  Zone,
  ZoneId,
} from '@/lib/types';
import { SPECIAL_ZONE_IDS } from '@/lib/types';

// Map dimensions for v1. Kept fixed so existing canvas drawing keeps
// rendering at the same scale; expanding is a follow-up generator pass.
export const OFFICE_COLS = 24;
export const OFFICE_ROWS = 20;

/** Hard cap on visible desks; agents beyond this share desks. */
export const DESK_CAP = 12;

// ----------------------------------------------------------------------------
// Special rooms — stable, reproducible across runs.
// ----------------------------------------------------------------------------

const SPECIAL_ZONE_TEMPLATE: Record<string, Omit<Zone, 'id'>> = {
  boss_office:  { label: 'Boss Office',  emoji: '👔',  center: { col: 14, row: 3  }, minCol: 12, maxCol: 16, minRow: 1,  maxRow: 4  },
  break_room:   { label: 'Break Room',   emoji: '☕',   center: { col: 20, row: 3  }, minCol: 18, maxCol: 22, minRow: 1,  maxRow: 5  },
  meeting_room: { label: 'Meeting Room', emoji: '🤝',  center: { col: 14, row: 7  }, minCol: 12, maxCol: 16, minRow: 6,  maxRow: 9  },
  whiteboard:   { label: 'Whiteboard',   emoji: '📝',  center: { col: 10, row: 12 }, minCol: 9,  maxCol: 11, minRow: 11, maxRow: 13 },
  library:      { label: 'Library',      emoji: '📚',  center: { col: 10, row: 15 }, minCol: 9,  maxCol: 12, minRow: 14, maxRow: 17 },
  lounge:       { label: 'Lounge',       emoji: '🛋️', center: { col: 20, row: 14 }, minCol: 18, maxCol: 22, minRow: 12, maxRow: 16 },
  server_room:  { label: 'Server Room',  emoji: '🖧',  center: { col: 20, row: 9  }, minCol: 18, maxCol: 22, minRow: 7,  maxRow: 10 },
  entrance:     { label: 'Entrance',     emoji: '🚪',  center: { col: 2,  row: 18 }, minCol: 1,  maxCol: 4,  minRow: 17, maxRow: 19 },
};

// ----------------------------------------------------------------------------
// Desk allocator
// ----------------------------------------------------------------------------

/**
 * Allocate up to `count` desk zones inside the open area of the office
 * (cols 2–9 by default), packed in 2-column blocks. Returns Zone records
 * keyed by `desk_${i}`.
 *
 * The first 6 slots reproduce the v0 hardcoded layout exactly so the
 * existing furniture/floor-color logic still aligns. Slots 6+ extend
 * rightward into the column that previously held isolated whiteboard /
 * library — those still draw, this just adds a third desk column for
 * teams of 7-12 and packs additional rows above existing desks.
 */
function allocateDesks(count: number): Record<ZoneId, Zone> {
  const out: Record<ZoneId, Zone> = {};
  const slots: Array<Omit<Zone, 'id'>> = [
    { label: 'Desk 0', emoji: '🖥️', center: { col: 4,  row: 3 }, minCol: 2, maxCol: 5,  minRow: 2,  maxRow: 4  },
    { label: 'Desk 1', emoji: '🖥️', center: { col: 4,  row: 6 }, minCol: 2, maxCol: 5,  minRow: 5,  maxRow: 7  },
    { label: 'Desk 2', emoji: '🖥️', center: { col: 4,  row: 9 }, minCol: 2, maxCol: 5,  minRow: 8,  maxRow: 10 },
    { label: 'Desk 3', emoji: '🖥️', center: { col: 8,  row: 3 }, minCol: 6, maxCol: 9,  minRow: 2,  maxRow: 4  },
    { label: 'Desk 4', emoji: '🖥️', center: { col: 8,  row: 6 }, minCol: 6, maxCol: 9,  minRow: 5,  maxRow: 7  },
    { label: 'Desk 5', emoji: '🖥️', center: { col: 8,  row: 9 }, minCol: 6, maxCol: 9,  minRow: 8,  maxRow: 10 },
    // Slots 6-11 extend the desk farm down into rows 12-19 (avoiding the
    // library/whiteboard footprint at cols 9-12). Two desk columns at
    // cols 4 and 8 mirror the upper farm.
    { label: 'Desk 6', emoji: '🖥️', center: { col: 4,  row: 13 }, minCol: 2, maxCol: 5,  minRow: 12, maxRow: 14 },
    { label: 'Desk 7', emoji: '🖥️', center: { col: 8,  row: 13 }, minCol: 6, maxCol: 8,  minRow: 12, maxRow: 14 },
    { label: 'Desk 8', emoji: '🖥️', center: { col: 4,  row: 16 }, minCol: 2, maxCol: 5,  minRow: 15, maxRow: 17 },
    { label: 'Desk 9', emoji: '🖥️', center: { col: 8,  row: 16 }, minCol: 6, maxCol: 8,  minRow: 15, maxRow: 17 },
    { label: 'Desk 10', emoji: '🖥️', center: { col: 14, row: 12 }, minCol: 13, maxCol: 16, minRow: 11, maxRow: 13 },
    { label: 'Desk 11', emoji: '🖥️', center: { col: 14, row: 16 }, minCol: 13, maxCol: 16, minRow: 15, maxRow: 17 },
  ];

  const allocated = Math.max(0, Math.min(count, DESK_CAP, slots.length));
  for (let i = 0; i < allocated; i++) {
    const id = `desk_${i}`;
    out[id] = { id, ...slots[i] };
  }
  return out;
}

// ----------------------------------------------------------------------------
// Element placement
// ----------------------------------------------------------------------------

function placeElements(zones: Record<ZoneId, Zone>): OfficeElement[] {
  const out: OfficeElement[] = [];
  const at = (zoneId: ZoneId, dx = 0, dy = 0): GridPos | null => {
    const z = zones[zoneId];
    if (!z) return null;
    return { col: z.center.col + dx, row: z.center.row + dy };
  };

  const push = (id: string, kind: OfficeElement['kind'], zoneId: ZoneId, pos: GridPos | null) => {
    if (!pos) return;
    out.push({ id, kind, zone: zoneId, position: pos });
  };

  // Anchor elements — the iconic fixture of each room.
  push('coffee_machine_1', 'coffee_machine', 'break_room',  at('break_room', 0, -1));
  push('whiteboard_1',     'whiteboard',     'meeting_room', at('meeting_room', 2, -1));
  push('whiteboard_zone',  'whiteboard',     'whiteboard',   at('whiteboard'));
  push('bookshelf_1',      'bookshelf',      'library',      at('library', 0, -1));
  push('bookshelf_2',      'bookshelf',      'library',      at('library', 0, 1));
  push('server_rack_1',    'server_rack',    'server_room',  at('server_room', -1, -1));
  push('server_rack_2',    'server_rack',    'server_room',  at('server_room', 1, -1));
  push('server_rack_3',    'server_rack',    'server_room',  at('server_room', -1, 1));
  push('lounge_sofa',      'sofa',           'lounge',       at('lounge', 0, -1));

  // One monitor + chair per allocated desk.
  for (const zoneId of Object.keys(zones)) {
    if (!zoneId.startsWith('desk_')) continue;
    const z = zones[zoneId];
    push(`${zoneId}_monitor`, 'monitor', zoneId, { col: z.center.col - 1, row: z.center.row });
    push(`${zoneId}_chair`,   'desk_chair', zoneId, { col: z.center.col,     row: z.center.row });
  }

  return out;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function generateOffice(teamSize: number): GeneratedOffice {
  const safeTeam = Math.max(0, Math.floor(teamSize));
  const desks = allocateDesks(safeTeam);

  const zones: Record<ZoneId, Zone> = { ...desks };
  for (const sid of SPECIAL_ZONE_IDS) {
    const tmpl = SPECIAL_ZONE_TEMPLATE[sid];
    if (tmpl) zones[sid] = { id: sid, ...tmpl };
  }

  const elements = placeElements(zones);

  return {
    cols: OFFICE_COLS,
    rows: OFFICE_ROWS,
    zones,
    elements,
    deskCount: Object.keys(desks).length,
  };
}

/** Convenience: just the zone map, for callers that don't need elements. */
export function generateZones(teamSize: number): Record<ZoneId, Zone> {
  return generateOffice(teamSize).zones;
}

export function isDeskZone(id: ZoneId): boolean {
  return id.startsWith('desk_');
}

export function isSpecialZone(id: ZoneId): boolean {
  return (SPECIAL_ZONE_IDS as readonly string[]).includes(id);
}
