import { describe, expect, it } from 'vitest';

import {
  ARRIVAL_FRAMES,
  arrivalAnimFor,
  BEHAVIOR_MAP,
  resolveZone,
  tickIntervalForBehavior,
} from '../office/behaviors';
import type { AgentBehavior } from '../lib/types';

describe('tickIntervalForBehavior', () => {
  it('returns 8 for the calm default behaviors', () => {
    // The user explicitly tuned the default cadence to 8; this guards
    // against accidental regression to faster speeds.
    for (const b of [
      'working',
      'thinking',
      'researching',
      'meeting',
      'debugging',
      'receiving_task',
      'reporting',
      'snacking',
      'toilet',
      'sleeping',
      'napping',
      'overloaded',
      'reviving',
    ] as AgentBehavior[]) {
      expect(tickIntervalForBehavior(b), `interval for ${b}`).toBe(8);
    }
  });

  it('runs deploy fast (every 4 ticks)', () => {
    expect(tickIntervalForBehavior('deploying')).toBe(4);
  });

  it('runs panic / dead frantic (every 3 ticks)', () => {
    expect(tickIntervalForBehavior('panicking')).toBe(3);
    expect(tickIntervalForBehavior('dead')).toBe(3);
  });

  it('strolls idle / coffee (every 10 ticks)', () => {
    expect(tickIntervalForBehavior('idle')).toBe(10);
    expect(tickIntervalForBehavior('coffee')).toBe(10);
  });

  it('every behavior in the enum gets a positive interval', () => {
    for (const b of Object.keys(BEHAVIOR_MAP) as AgentBehavior[]) {
      const i = tickIntervalForBehavior(b);
      expect(i).toBeGreaterThan(0);
      expect(Number.isFinite(i)).toBe(true);
    }
  });
});

describe('arrivalAnimFor', () => {
  it('matches the steady-state anim for behaviors that arrive into a pose', () => {
    expect(arrivalAnimFor('working')).toBe('sit_typing');
    expect(arrivalAnimFor('meeting')).toBe('raise_hand');
    expect(arrivalAnimFor('idle')).toBe('drink_coffee');
    expect(arrivalAnimFor('coffee')).toBe('drink_coffee');
    expect(arrivalAnimFor('sleeping')).toBe('sleep');
    expect(arrivalAnimFor('debugging')).toBe('sit_typing');
  });

  it('keeps `run` for deploying — it has no rest pose', () => {
    expect(arrivalAnimFor('deploying')).toBe('run');
  });
});

describe('ARRIVAL_FRAMES', () => {
  it('is set to the documented 30-tick settle window', () => {
    expect(ARRIVAL_FRAMES).toBe(30);
  });
});

describe('resolveZone (regression — still works after type widening)', () => {
  it('uses the desk zone for own-desk behaviors', () => {
    expect(resolveZone('working', 'desk_3')).toBe('desk_3');
    expect(resolveZone('thinking', 'desk_5')).toBe('desk_5');
  });

  it('uses the explicit zone otherwise', () => {
    expect(resolveZone('meeting', 'desk_0')).toBe('meeting_room');
    expect(resolveZone('researching', 'desk_0')).toBe('library');
    expect(resolveZone('idle', 'desk_0')).toBe('break_room');
  });
});
