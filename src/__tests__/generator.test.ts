import { describe, expect, it } from 'vitest';

import {
  DESK_CAP,
  generateOffice,
  generateZones,
  isDeskZone,
  isSpecialZone,
  OFFICE_COLS,
  OFFICE_ROWS,
} from '../office/generator';
import { SPECIAL_ZONE_IDS } from '../lib/types';

describe('generateOffice', () => {
  it('always emits all special zones, regardless of team size', () => {
    for (const teamSize of [0, 1, 6, 30]) {
      const { zones } = generateOffice(teamSize);
      for (const sid of SPECIAL_ZONE_IDS) {
        expect(zones[sid], `${sid} for team=${teamSize}`).toBeDefined();
        expect(zones[sid].id).toBe(sid);
      }
    }
  });

  it('allocates one desk zone per agent up to DESK_CAP', () => {
    expect(generateOffice(0).deskCount).toBe(0);
    expect(generateOffice(1).deskCount).toBe(1);
    expect(generateOffice(6).deskCount).toBe(6);
    expect(generateOffice(DESK_CAP).deskCount).toBe(DESK_CAP);
    expect(generateOffice(DESK_CAP + 5).deskCount).toBe(DESK_CAP);
  });

  it('clamps negative or NaN inputs to zero desks', () => {
    expect(generateOffice(-3).deskCount).toBe(0);
    expect(generateOffice(Number.NaN).deskCount).toBe(0);
  });

  it('every zone fits inside the generated grid', () => {
    const { zones, cols, rows } = generateOffice(DESK_CAP);
    expect(cols).toBe(OFFICE_COLS);
    expect(rows).toBe(OFFICE_ROWS);
    for (const id of Object.keys(zones)) {
      const z = zones[id];
      expect(z.minCol, `${id} minCol`).toBeGreaterThanOrEqual(0);
      expect(z.maxCol, `${id} maxCol`).toBeLessThan(cols);
      expect(z.minRow, `${id} minRow`).toBeGreaterThanOrEqual(0);
      expect(z.maxRow, `${id} maxRow`).toBeLessThan(rows);
      expect(z.minCol).toBeLessThanOrEqual(z.maxCol);
      expect(z.minRow).toBeLessThanOrEqual(z.maxRow);
      // Center has to be inside the rectangle.
      expect(z.center.col).toBeGreaterThanOrEqual(z.minCol);
      expect(z.center.col).toBeLessThanOrEqual(z.maxCol);
      expect(z.center.row).toBeGreaterThanOrEqual(z.minRow);
      expect(z.center.row).toBeLessThanOrEqual(z.maxRow);
    }
  });

  it('elements reference zones that exist in the same generation', () => {
    const office = generateOffice(6);
    const ids = new Set(Object.keys(office.zones));
    for (const el of office.elements) {
      expect(ids.has(el.zone), `element ${el.id} references unknown zone ${el.zone}`).toBe(true);
    }
  });

  it('desk allocations get a monitor + chair element each', () => {
    const office = generateOffice(3);
    for (let i = 0; i < 3; i++) {
      const monitor = office.elements.find((e) => e.id === `desk_${i}_monitor`);
      const chair = office.elements.find((e) => e.id === `desk_${i}_chair`);
      expect(monitor?.kind).toBe('monitor');
      expect(chair?.kind).toBe('desk_chair');
    }
  });

  it('special rooms get their iconic anchor element', () => {
    const office = generateOffice(0);
    const byKind = (kind: string) => office.elements.filter((e) => e.kind === kind);
    expect(byKind('coffee_machine').length).toBeGreaterThan(0);
    expect(byKind('whiteboard').length).toBeGreaterThan(0);
    expect(byKind('server_rack').length).toBeGreaterThan(0);
    expect(byKind('bookshelf').length).toBeGreaterThan(0);
    expect(byKind('sofa').length).toBeGreaterThan(0);
  });

  it('generation is deterministic — same input, same output', () => {
    const a = generateOffice(5);
    const b = generateOffice(5);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('isDeskZone / isSpecialZone classify correctly', () => {
    expect(isDeskZone('desk_0')).toBe(true);
    expect(isDeskZone('desk_42')).toBe(true);
    expect(isDeskZone('boss_office')).toBe(false);
    expect(isSpecialZone('break_room')).toBe(true);
    expect(isSpecialZone('desk_0')).toBe(false);
  });

  it('generateZones is a thin wrapper over generateOffice().zones', () => {
    const direct = generateZones(4);
    const indirect = generateOffice(4).zones;
    expect(Object.keys(direct).sort()).toEqual(Object.keys(indirect).sort());
  });

  it('legacy v0 layout is preserved for the first 6 desks', () => {
    // The procedural generator's first 6 desks must match the original
    // hand-coded ZONES_TEMPLATE so existing furniture / floor-color logic
    // doesn't drift.
    const { zones } = generateOffice(6);
    const expected: Record<string, { col: number; row: number }> = {
      desk_0: { col: 4, row: 3 },
      desk_1: { col: 4, row: 6 },
      desk_2: { col: 4, row: 9 },
      desk_3: { col: 8, row: 3 },
      desk_4: { col: 8, row: 6 },
      desk_5: { col: 8, row: 9 },
    };
    for (const [id, expectedCenter] of Object.entries(expected)) {
      expect(zones[id].center).toEqual(expectedCenter);
    }
  });
});
