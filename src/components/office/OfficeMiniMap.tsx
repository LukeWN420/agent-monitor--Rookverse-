// ============================================================================
// OfficeMiniMap — Top-right navigation overlay for the expanded office.
//
// Renders a compact SVG view of the procedural zone layout plus live agent
// positions. Pixel8-influenced aesthetic (integer-pixel grid, limited
// palette, 1px borders) implemented natively in SVG so we keep zero
// runtime deps and stay compatible with the project's React 19 / Next 16
// stack — `pixel8` itself is abandoned at a React 16 reconciler.
//
// Props are deliberately data-only: the parent owns `GeneratedOffice` and
// `AgentRuntime[]`, the mini-map just renders. Click on a zone fires
// `onZoneClick(zoneId, center)` so callers can wire pan/zoom/highlight
// later without component churn.
// ============================================================================

'use client';

import { useMemo } from 'react';
import type {
  AgentConfig,
  AgentRuntime,
  GeneratedOffice,
  GridPos,
  ZoneId,
} from '@/lib/types';

interface OfficeMiniMapProps {
  office: GeneratedOffice;
  agents: AgentConfig[];
  runtimes: AgentRuntime[];
  /** Fired when a zone rectangle is clicked. */
  onZoneClick?: (zoneId: ZoneId, center: GridPos) => void;
  /**
   * Mini-map only renders when zone count exceeds this threshold (per the
   * SimWorld crossover spec — small offices don't need navigation).
   * Default: 6. Pass `0` to always render.
   */
  minZones?: number;
  /** CSS pixel size of the longer edge. Default 180. */
  size?: number;
  /** Optional className passthrough for layout overrides. */
  className?: string;
}

// Subdued zone tints sampled from the canvas floor-color palette so the
// mini-map and the main office read as the same room at a glance.
const ZONE_FILL: Record<string, string> = {
  boss_office:  'rgba(141, 110, 99, 0.55)',
  meeting_room: 'rgba(164, 184, 204, 0.55)',
  break_room:   'rgba(232, 213, 183, 0.55)',
  lounge:       'rgba(197, 182, 223, 0.55)',
  server_room:  'rgba(55, 71, 79, 0.65)',
  library:      'rgba(151, 167, 138, 0.5)',
  whiteboard:   'rgba(176, 176, 176, 0.5)',
  entrance:     'rgba(180, 180, 180, 0.5)',
};
const DESK_FILL = 'rgba(120, 120, 130, 0.45)';
const ZONE_STROKE = 'rgba(212, 168, 67, 0.4)';

function fillForZone(id: ZoneId): string {
  if (id.startsWith('desk_')) return DESK_FILL;
  return ZONE_FILL[id] ?? DESK_FILL;
}

export default function OfficeMiniMap({
  office,
  agents,
  runtimes,
  onZoneClick,
  minZones = 6,
  size = 180,
  className = '',
}: OfficeMiniMapProps) {
  const zoneList = useMemo(() => Object.values(office.zones), [office.zones]);
  const colorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.color;
    return m;
  }, [agents]);
  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of agents) m[a.id] = a.name;
    return m;
  }, [agents]);

  // Below threshold → don't render anything. Honors the spec's
  // "only show when zone count > 6".
  if (zoneList.length <= minZones) return null;

  // Preserve grid aspect ratio. Constrain the longer edge to `size`.
  const aspect = office.cols / office.rows;
  const w = aspect >= 1 ? size : Math.round(size * aspect);
  const h = aspect >= 1 ? Math.round(size / aspect) : size;

  return (
    <div
      role="region"
      aria-label="Office mini-map"
      className={`absolute top-3 right-3 z-10 select-none ${className}`}
      style={{
        width: w + 12,
        backgroundColor: 'rgba(11, 16, 32, 0.85)',
        border: '1px solid #D4A843',
        borderRadius: 6,
        padding: 6,
        boxShadow: '0 0 12px rgba(212, 168, 67, 0.18)',
      }}
    >
      <div
        className="text-[9px] font-mono mb-1.5 flex justify-between"
        style={{ color: '#D4A843', letterSpacing: 0.5 }}
      >
        <span>♜ MAP</span>
        <span style={{ color: 'rgba(232, 232, 232, 0.6)' }}>
          {runtimes.length} agt · {zoneList.length} zn
        </span>
      </div>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${office.cols} ${office.rows}`}
        style={{
          display: 'block',
          imageRendering: 'pixelated',
          backgroundColor: '#0B1020',
        }}
        data-testid="office-mini-map"
      >
        {zoneList.map((z) => (
          <rect
            key={z.id}
            x={z.minCol}
            y={z.minRow}
            width={z.maxCol - z.minCol + 1}
            height={z.maxRow - z.minRow + 1}
            fill={fillForZone(z.id)}
            stroke={ZONE_STROKE}
            strokeWidth={0.05}
            onClick={() => onZoneClick?.(z.id, z.center)}
            style={{ cursor: onZoneClick ? 'pointer' : 'default' }}
            data-zone-id={z.id}
          >
            <title>{z.label}</title>
          </rect>
        ))}
        {runtimes.map((r) => (
          <circle
            key={r.id}
            cx={r.pos.col + 0.5}
            cy={r.pos.row + 0.5}
            r={0.55}
            fill={colorById[r.id] ?? '#D4A843'}
            stroke="#0B1020"
            strokeWidth={0.15}
            data-agent-id={r.id}
          >
            <title>{nameById[r.id] ?? r.id}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
