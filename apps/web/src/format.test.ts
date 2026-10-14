import { describe, expect, it } from 'vitest';
import { countdown } from './format';

describe('countdown', () => {
  it('counts mm:ss under an hour, on the pairing code’s own scale', () => {
    expect(countdown(14 * 60_000 + 32_000)).toBe('14:32');
    expect(countdown(60_000)).toBe('01:00');
    expect(countdown(9_000)).toBe('00:09');
  });

  it('adds hours past 60 minutes and floors leftover milliseconds', () => {
    expect(countdown(3_600_000)).toBe('1:00:00');
    expect(countdown(3_600_000 + 2 * 60_000 + 30_000)).toBe('1:02:30');
    expect(countdown(1_950)).toBe('00:01');
  });

  it('reads expired, zero and nonsense deadlines as 0:00 instead of going negative', () => {
    expect(countdown(0)).toBe('00:00');
    expect(countdown(-5_000)).toBe('00:00');
    expect(countdown(Number.NaN)).toBe('00:00');
    expect(countdown(Number.POSITIVE_INFINITY)).toBe('00:00');
  });
});
