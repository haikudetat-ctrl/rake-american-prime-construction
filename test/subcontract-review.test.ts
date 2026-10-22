import { describe, expect, it } from 'vitest';
import { closeoutReview } from '@/lib/subcontract/review';
const bill = { base: 9500, from: 9, step: 500 };
const pay = { base: 5000, from: 9, step: 500 };
describe('read-only closeout preview of the existing SQL rules', () => {
  it('includes the first pitch step and independently rounded extras', () => {
    expect(closeoutReview(24.5, 9, bill, pay, [{ description: 'Plywood', qty: 1.5, bill_unit_cents: 1001, pay_unit_cents: 501 }], 3)).toEqual({ billCents: 246502, payCents: 135502, share: 45167, remainder: 1 });
  });
  it('preserves a below-threshold base rate and the exact crew pot across shares', () => {
    const r = closeoutReview(1, 6, bill, pay, [], 3);
    expect(r.billCents).toBe(9500);
    expect(r.payCents).toBe(5000);
    expect(r.share * 3 + r.remainder).toBe(r.payCents);
  });
  it('handles pitch steps through 24/12', () => {
    const r = closeoutReview(1, 24, bill, pay, [], 1);
    expect(r.billCents).toBe(17500);
    expect(r.payCents).toBe(13000);
  });
});
