// ============================================================================
// Zone Definitions — Named areas in the office
//
// Thin facade over `generator.ts`. Kept for back-compat with the rest of
// the codebase that imports `buildZoneMap` / `getZone` /
// `getRandomPointInZone`. New code should import directly from
// `./generator`.
// ============================================================================

import type { Zone, ZoneId } from '@/lib/types';
import { generateOffice, generateZones, isDeskZone, isSpecialZone } from './generator';

/**
 * @deprecated Read zones from `generateOffice(teamSize).zones` instead.
 * This is a partial template kept around so any consumer that imported
 * the old constant still gets the special-room shapes; per-agent desks
 * are no longer in here.
 */
export const ZONES_TEMPLATE: Record<string, Omit<Zone, 'id'>> = (() => {
  const { zones } = generateOffice(0);
  // Strip the `id` field to match the original template shape.
  const out: Record<string, Omit<Zone, 'id'>> = {};
  for (const [id, z] of Object.entries(zones)) {
    const { id: _drop, ...rest } = z;
    void _drop;
    out[id] = rest;
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Build zone map for N agents
// ---------------------------------------------------------------------------

export function buildZoneMap(agentCount: number): Record<ZoneId, Zone> {
  return generateZones(agentCount);
}

// ---------------------------------------------------------------------------
// Get zone by id
// ---------------------------------------------------------------------------

export function getZone(id: ZoneId, agentCount: number): Zone | undefined {
  return buildZoneMap(agentCount)[id];
}

// ---------------------------------------------------------------------------
// Get a random walkable point within a zone
// ---------------------------------------------------------------------------

export function getRandomPointInZone(zone: Zone): { col: number; row: number } {
  const col = zone.minCol + Math.floor(Math.random() * (zone.maxCol - zone.minCol + 1));
  const row = zone.minRow + Math.floor(Math.random() * (zone.maxRow - zone.minRow + 1));
  return { col, row };
}

// Re-export generator helpers so existing callers that import from
// `@/office/zones` find them too.
export { generateOffice, generateZones, isDeskZone, isSpecialZone };
