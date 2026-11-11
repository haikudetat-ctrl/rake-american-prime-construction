import { describe, expect, it } from 'vitest';
import { closeoutReview } from '@/lib/subcontract/review';
import { describeTiers, formatPitchTiers, parsePitchTiers, readTiers, tierCents, type PitchTier } from '@/lib/subcontract/tiers';
import { jobLines, jobScope } from '@/lib/subcontract/view';

// The old $5 step from 9/12, as the migration converts it: a tier at every pitch.
const steps = (from: number, step: number): PitchTier[] =>
  Array.from({ length: 25 - from }, (_, i) => ({ from: from + i, cents: step * (i + 1) }));
const bill = { base: 9500, tiers: steps(9, 500) };
const pay = { base: 5000, tiers: steps(9, 500) };
// All Season's Nov 11 sheet.
const allSeason = { base: 12000, tiers: [{ from: 9, cents: 1500 }, { from: 11, cents: 2000 }], minimumCents: 140000 };

describe('read-only closeout preview of the SQL rules', () => {
  it('includes the first pitch step and independently rounded extras', () => {
    expect(closeoutReview(24.5, 9, bill, pay, [{ description: 'Plywood', qty: 1.5, bill_unit_cents: 1001, pay_unit_cents: 501 }], 3))
      .toEqual({ billCents: 246502, payCents: 135502, minimumCents: 0, share: 45167, remainder: 1 });
  });
  it('preserves a below-threshold base rate and the exact crew pot across shares', () => {
    const r = closeoutReview(1, 6, bill, pay, [], 3);
    expect(r.billCents).toBe(9500);
    expect(r.payCents).toBe(5000);
    expect(r.share * 3 + r.remainder).toBe(r.payCents);
  });
  it('handles converted pitch steps through 24/12', () => {
    const r = closeoutReview(1, 24, bill, pay, [], 1);
    expect(r.billCents).toBe(17500);
    expect(r.payCents).toBe(13000);
  });
  it('bills a tier, not a step per pitch', () => {
    expect(closeoutReview(20, 10, allSeason, pay, [], 2).billCents).toBe(20 * (12000 + 1500));
    expect(closeoutReview(20, 12, allSeason, pay, [], 2).billCents).toBe(20 * (12000 + 2000));
  });
  it('tops a small roof up to the minimum without touching crew pay', () => {
    const r = closeoutReview(8, 6, allSeason, pay, [], 1);
    expect(r).toMatchObject({ billCents: 140000, minimumCents: 140000 - 96000, payCents: 40000 });
  });
  it('skips the minimum and the pitch on a gutter-only job', () => {
    const r = closeoutReview(0, 12, allSeason, pay, [{ description: '5" gutter', qty: 120, bill_unit_cents: 650, pay_unit_cents: 550, unit: 'ft' }], 1);
    expect(r).toMatchObject({ billCents: 78000, minimumCents: 0, payCents: 66000 });
  });
});

describe('pitch tiers', () => {
  it('reads the highest tier at or below the pitch', () => {
    expect([8, 9, 10, 11, 12, 18].map((p) => tierCents(allSeason.tiers, p))).toEqual([0, 1500, 1500, 2000, 2000, 2000]);
  });
  it('parses the setup line in a few spellings', () => {
    expect(parsePitchTiers('9: 15, 11: 20')).toEqual({ tiers: allSeason.tiers });
    expect(parsePitchTiers('11/12 $20\n9/12 $15.00')).toEqual({ tiers: allSeason.tiers });
    expect(parsePitchTiers('')).toEqual({ tiers: [] });
  });
  it('refuses what it cannot read rather than guessing', () => {
    expect(parsePitchTiers('9: 15, 9: 20')).toEqual({ error: '9/12 is listed twice.' });
    expect(parsePitchTiers('steep: 15')).toHaveProperty('error');
    expect(parsePitchTiers('30: 15')).toEqual({ error: 'Pitches go from 1/12 to 24/12.' });
  });
  it('round-trips through the form', () => {
    expect(parsePitchTiers(formatPitchTiers(allSeason.tiers))).toEqual({ tiers: allSeason.tiers });
  });
  it('treats malformed stored tiers as none', () => {
    expect(readTiers([{ from: 9, cents: 1500 }, { from: 'x' }])).toEqual([]);
    expect(readTiers(null)).toEqual([]);
  });
  it('describes tiers in plain words, and old steps the old way', () => {
    expect(describeTiers(allSeason.tiers)).toBe('+$15.00 a square at 9-10/12, +$20.00 a square at 11/12 and up');
    expect(describeTiers(steps(9, 500))).toBe('+$5.00 a square for each pitch step from 9/12');
  });
});

describe('invoice lines for the new cases', () => {
  it('prints the minimum top-up as its own line', () => {
    const lines = jobLines({ squares: 8, pitch: 6, baseCents: 12000, pitchCents: 0, minimumCents: 44000 }, []);
    expect(lines.at(-1)).toEqual({ description: 'Minimum job charge: brings this job to $1,400.00', amountCents: 44000 });
    expect(lines.reduce((s, l) => s + l.amountCents, 0)).toBe(140000);
  });
  it('has no squares line on a gutter-only job, and counts feet', () => {
    const lines = jobLines({ squares: 0, pitch: 0, baseCents: 12000, pitchCents: 0 }, [
      { description: '5" K-style gutter', qty: 120, unitCents: 650, unit: 'ft' },
      { description: '5" miter', qty: 4, unitCents: 1650, unit: 'each' },
    ]);
    expect(lines.map((l) => l.description)).toEqual(['5" K-style gutter: 120 ft at $6.50', '5" miter: 4 at $16.50']);
    expect(jobScope(0, 0)).toBe('Gutters and extras');
    expect(jobScope(24, 12)).toBe('24 squares · 12/12 pitch');
  });
});
