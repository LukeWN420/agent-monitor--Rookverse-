import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import OfficeMiniMap from '@/components/office/OfficeMiniMap';
import { generateOffice } from '@/office/generator';
import { gridToScreen } from '@/engine/isometric';
import type { AgentConfig, AgentRuntime } from '@/lib/types';

function makeAgent(id: string, name: string, color: string): AgentConfig {
  return { id, name, emoji: '♜', color, avatar: 'glasses' };
}

function makeRuntime(id: string, col: number, row: number): AgentRuntime {
  return {
    id,
    currentState: 'idle',
    pos: { col, row },
    screenPos: gridToScreen({ col, row }),
    direction: 's',
    anim: 'stand',
    path: [],
    transitioning: false,
    deskZone: 'desk_0',
  };
}

describe('OfficeMiniMap', () => {
  it('renders nothing when zone count is at or below the threshold', () => {
    const office = generateOffice(0);
    // The generator always emits 8 specials; force the threshold above that.
    const { container } = render(
      <OfficeMiniMap
        office={office}
        agents={[]}
        runtimes={[]}
        minZones={Object.keys(office.zones).length}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders a zone rect for every zone in the generated office', () => {
    const office = generateOffice(3);
    render(
      <OfficeMiniMap
        office={office}
        agents={[]}
        runtimes={[]}
      />,
    );
    const svg = screen.getByTestId('office-mini-map');
    const zoneIds = Object.keys(office.zones);
    for (const id of zoneIds) {
      expect(svg.querySelector(`[data-zone-id="${id}"]`), `rect for ${id}`).toBeTruthy();
    }
  });

  it('renders one circle per agent runtime, colored to the agent', () => {
    const office = generateOffice(2);
    const agents = [
      makeAgent('a', 'Rook', '#D4A843'),
      makeAgent('b', 'GPT', '#FF7043'),
    ];
    const runtimes = [makeRuntime('a', 4, 3), makeRuntime('b', 8, 6)];
    render(<OfficeMiniMap office={office} agents={agents} runtimes={runtimes} />);
    const svg = screen.getByTestId('office-mini-map');
    expect(svg.querySelector('[data-agent-id="a"]')?.getAttribute('fill')).toBe('#D4A843');
    expect(svg.querySelector('[data-agent-id="b"]')?.getAttribute('fill')).toBe('#FF7043');
  });

  it('positions agent dots at grid-coord + 0.5 so they sit centered on the tile', () => {
    const office = generateOffice(1);
    const runtimes = [makeRuntime('a', 4, 3)];
    render(<OfficeMiniMap office={office} agents={[makeAgent('a', 'Rook', '#fff')]} runtimes={runtimes} />);
    const dot = screen.getByTestId('office-mini-map').querySelector('[data-agent-id="a"]');
    expect(dot?.getAttribute('cx')).toBe('4.5');
    expect(dot?.getAttribute('cy')).toBe('3.5');
  });

  it('fires onZoneClick with zone id and center on click', () => {
    const office = generateOffice(2);
    const onZoneClick = vi.fn();
    render(
      <OfficeMiniMap
        office={office}
        agents={[]}
        runtimes={[]}
        onZoneClick={onZoneClick}
      />,
    );
    const breakRoomRect = screen
      .getByTestId('office-mini-map')
      .querySelector('[data-zone-id="break_room"]')!;
    fireEvent.click(breakRoomRect);
    expect(onZoneClick).toHaveBeenCalledTimes(1);
    expect(onZoneClick).toHaveBeenCalledWith('break_room', office.zones.break_room.center);
  });

  it('uses the correct viewBox so SVG coords are grid-native', () => {
    const office = generateOffice(2);
    render(<OfficeMiniMap office={office} agents={[]} runtimes={[]} />);
    const svg = screen.getByTestId('office-mini-map');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${office.cols} ${office.rows}`);
  });

  it('exposes an aria region label so screen readers can find it', () => {
    const office = generateOffice(2);
    const { container } = render(
      <OfficeMiniMap office={office} agents={[]} runtimes={[]} />,
    );
    const region = container.querySelector('[role="region"]');
    expect(region?.getAttribute('aria-label')).toBe('Office mini-map');
  });

  it('shows a counter for agents and zones', () => {
    const office = generateOffice(3);
    const agents = [
      makeAgent('a', 'Rook', '#D4A843'),
      makeAgent('b', 'GPT', '#FF7043'),
    ];
    const runtimes = [makeRuntime('a', 4, 3), makeRuntime('b', 8, 6)];
    render(<OfficeMiniMap office={office} agents={agents} runtimes={runtimes} />);
    // Format: `<n> agt · <z> zn`
    const counter = screen.getByText(/\d+ agt · \d+ zn/);
    expect(counter.textContent).toContain(`${runtimes.length} agt`);
    expect(counter.textContent).toContain(`${Object.keys(office.zones).length} zn`);
  });

  it('still renders when agent runtimes reference unknown agent ids — uses defaults', () => {
    const office = generateOffice(1);
    const runtimes = [makeRuntime('ghost', 4, 3)];
    render(<OfficeMiniMap office={office} agents={[]} runtimes={runtimes} />);
    const dot = screen.getByTestId('office-mini-map').querySelector('[data-agent-id="ghost"]');
    expect(dot).toBeTruthy();
    // Falls back to gold for missing color metadata.
    expect(dot?.getAttribute('fill')).toBe('#D4A843');
  });
});
