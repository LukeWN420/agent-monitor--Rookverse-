/**
 * Tests for the autowork ticker's exponential backoff.
 *
 * On 2026-05-02 the dashboard wedged because the autowork loop fired
 * `sessions.list` every 15s with a 10s timeout against a slow gateway,
 * with no backoff. Pending requests piled up faster than they drained
 * and the Next.js dev server's event loop saturated. These tests guard
 * the fix: backoff doubles on each failure, caps at 5 min, and resets
 * on the next successful tick.
 *
 * `ensureAutoworkTicker` accepts an injected `tickFn` so tests can drive
 * the schedule without touching the real `runAutoworkTick` (which
 * vitest cannot mock — same-module intra-references bypass `vi.mock`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  autoworkBackoffMs,
  ensureAutoworkTicker,
  __resetAutoworkTickerForTests,
  type AutoworkTickResult,
} from '@/lib/autowork';

const okResult = (): AutoworkTickResult => ({
  ok: true, tick: 0, sent: [], skipped: [], failed: [],
});

const failResult = (): AutoworkTickResult => ({
  ok: false, tick: 0, sent: [], skipped: [],
  failed: [{ sessionKey: 'agent:main:main', error: 'send failed' }],
});

describe('autoworkBackoffMs', () => {
  it('returns the steady-state interval when there are no failures', () => {
    expect(autoworkBackoffMs(0)).toBe(15_000);
  });

  it('doubles on each successive failure', () => {
    expect(autoworkBackoffMs(1)).toBe(30_000);
    expect(autoworkBackoffMs(2)).toBe(60_000);
    expect(autoworkBackoffMs(3)).toBe(120_000);
    expect(autoworkBackoffMs(4)).toBe(240_000);
  });

  it('caps at 5 minutes regardless of failure count', () => {
    expect(autoworkBackoffMs(5)).toBe(300_000);
    expect(autoworkBackoffMs(20)).toBe(300_000);
    expect(autoworkBackoffMs(1000)).toBe(300_000);
  });
});

describe('ensureAutoworkTicker — backoff lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetAutoworkTickerForTests();
  });

  afterEach(() => {
    __resetAutoworkTickerForTests();
    vi.useRealTimers();
  });

  it('runs the first tick at the steady-state interval', async () => {
    const tickFn = vi.fn().mockResolvedValue(okResult());
    ensureAutoworkTicker(tickFn);

    expect(tickFn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);
  });

  it('does not double-arm if called twice', async () => {
    const tickFn = vi.fn().mockResolvedValue(okResult());
    ensureAutoworkTicker(tickFn);
    ensureAutoworkTicker(tickFn);
    ensureAutoworkTicker(tickFn);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);
  });

  it('keeps firing at 15s while ticks succeed', async () => {
    const tickFn = vi.fn().mockResolvedValue(okResult());
    ensureAutoworkTicker(tickFn);

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(3);
  });

  it('backs off when ticks throw — the load-bearing fix', async () => {
    const tickFn = vi.fn().mockRejectedValue(
      new Error("sessions.list timed out after 10000ms"),
    );
    ensureAutoworkTicker(tickFn);

    // Tick 1 at 15s — throws, backoff to 30s.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);

    // 15s after the failed tick — should NOT fire again (backoff is 30s).
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);

    // 15s more (30s total since last tick) — second failure fires.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(2);

    // After 2 fails, backoff is 60s. Advancing 30s shouldn't fire.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tickFn).toHaveBeenCalledTimes(2);

    // Another 30s (60s total since tick 2) — third failure fires.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tickFn).toHaveBeenCalledTimes(3);
  });

  it('treats `ok: false` results as failures for backoff purposes', async () => {
    const tickFn = vi.fn().mockResolvedValue(failResult());
    ensureAutoworkTicker(tickFn);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);

    // Backoff should be 30s after the ok:false result; 15s shouldn't fire.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(2);
  });

  it('resets the backoff on a successful tick', async () => {
    const tickFn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(okResult());
    ensureAutoworkTicker(tickFn);

    // 3 failed ticks. After each, backoff is 30s, 60s, 120s.
    await vi.advanceTimersByTimeAsync(15_000);  // tick 1 (failure)
    await vi.advanceTimersByTimeAsync(30_000);  // tick 2 (failure)
    await vi.advanceTimersByTimeAsync(60_000);  // tick 3 (failure)
    expect(tickFn).toHaveBeenCalledTimes(3);

    // After 3 failures the next tick is 120s away.
    await vi.advanceTimersByTimeAsync(120_000); // tick 4 (success — resets counter)
    expect(tickFn).toHaveBeenCalledTimes(4);

    // After recovery the cadence is back to steady 15s. Anything longer
    // would mean the backoff didn't actually reset.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(tickFn).toHaveBeenCalledTimes(5);
  });

  it('caps the backoff so we do not stop checking forever', async () => {
    const tickFn = vi.fn().mockRejectedValue(new Error('always fails'));
    ensureAutoworkTicker(tickFn);

    // Drive through the natural backoff schedule:
    // 15, 30, 60, 120, 240, capped 300, 300...
    const expectedDelays = [15_000, 30_000, 60_000, 120_000, 240_000, 300_000];
    for (const d of expectedDelays) {
      await vi.advanceTimersByTimeAsync(d);
    }
    expect(tickFn).toHaveBeenCalledTimes(6);

    // Two more capped intervals — should still fire at 300s each.
    await vi.advanceTimersByTimeAsync(300_000);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(tickFn).toHaveBeenCalledTimes(8);
  });
});
