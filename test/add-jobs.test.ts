import { describe, expect, it } from 'vitest';
import { checkDraft, crewRateFrom, parsePitch, parseQty, parseSquares, splitAddresses, toPayload, type ContractorOption, type DraftJob } from '@/lib/subcontract/add-jobs';
import { closeoutReview } from '@/lib/subcontract/review';
import { lineCents } from '@/lib/subcontract/view';

// The same contractor, crew rates and price list as supabase/tests/sub_add_jobs.test.sql,
// so the totals the form shows are checked against the ones the database computes there.
const gc: ContractorOption = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Example Roofing GC',
  weekly: true,
  rate: { base: 9500, tiers: [{ from: 9, cents: 1500 }, { from: 11, cents: 2000 }], minimumCents: 140000 },
  items: [
    { id: '22222222-2222-2222-2222-222222222222', description: '5" K-style gutter', unit: 'ft', billCents: 650, payCents: 550 },
    { id: '33333333-3333-3333-3333-333333333333', description: 'Plywood sheet', unit: 'sheet', billCents: 2000, payCents: 0 },
  ],
};
const [gutter, plywood] = gc.items;
const crew = { base: 5000, tiers: [{ from: 9, cents: 500 }, { from: 11, cents: 1000 }] };
const today = '2026-11-13';
const job = (over: Partial<DraftJob> = {}): DraftJob => ({
  key: 'k', contractorId: gc.id, workDate: '2026-11-10', address: '12 Oak St', notes: '', workerIds: ['a', 'b'],
  squares: '', pitch: '', items: {}, ...over,
});

describe('reading what was typed', () => {
  it('reads squares, pitch and quantities the way the closeout does', () => {
    expect(parseSquares('24.5')).toBe(24.5);
    expect(parseSquares('1,024')).toBeNull();
    expect(parseSquares('0')).toBe(0);
    expect(parseSquares('')).toBeNull();
    expect(parsePitch('12/12')).toBe(12);
    expect(parsePitch('6')).toBe(6);
    expect(parsePitch('steep')).toBeNull();
    expect(parseQty('120')).toBe(120);
    expect(parseQty('2.555')).toBe(2.56);
    expect(parseQty('0')).toBeNull();
    expect(parseQty('')).toBeNull();
  });

  it('turns a pasted list into one address a line, dropping bullets and blanks', () => {
    expect(splitAddresses('- 14 Elm St, Cherry Hill\n\n2) 220  Kings Hwy\r\n• 9 Main St ')).toEqual(['14 Elm St, Cherry Hill', '220 Kings Hwy', '9 Main St']);
  });

  it('uses the database defaults when no crew rates were saved', () => {
    expect(crewRateFrom(null).base).toBe(5000);
    expect(crewRateFrom(null).tiers[0]).toEqual({ from: 9, cents: 500 });
    expect(crewRateFrom({ crew_cents_per_sq: 5500, crew_pitch_tiers: [{ from: 9, cents: 700 }] })).toEqual({ base: 5500, tiers: [{ from: 9, cents: 700 }] });
  });
});

describe('what adding a job will do', () => {
  it('leaves a job without squares scheduled', () => {
    expect(checkDraft(job(), gc, crew, today)).toEqual({ state: 'open' });
  });

  it('closes a roof with its line items for the same totals the database bills', () => {
    const check = checkDraft(job({ squares: '20', pitch: '10', items: { [plywood.id]: '2' } }), gc, crew, today);
    expect(check).toMatchObject({ state: 'close', squares: 20, pitch: 10, billCents: 224000, payCents: 110000, share: 55000 });
  });

  it('closes a gutter-only job at 0 squares, with no pitch and no minimum', () => {
    const check = checkDraft(job({ squares: '0', items: { [gutter.id]: '120' } }), gc, crew, today);
    expect(check).toMatchObject({ state: 'close', pitch: 0, billCents: 78000, payCents: 66000, minimumCents: 0 });
  });

  it('shows the minimum top-up on a small roof', () => {
    expect(checkDraft(job({ squares: '8', pitch: '6' }), gc, crew, today)).toMatchObject({ billCents: 140000, minimumCents: 64000 });
  });

  it.each([
    [{ squares: '0' }, 'A 0-square job needs a line item to bill.'],
    [{ squares: 'twenty', pitch: '6' }, 'Squares are a number like 24 or 24.5 (0 for gutters only).'],
    [{ squares: '20' }, 'Enter the pitch, like 6 or 12/12.'],
    [{ squares: '20', pitch: '6', workerIds: [] }, 'Pick who worked it to close it.'],
    [{ squares: '20', pitch: '6', workDate: '2026-11-14' }, "It's dated after today. Leave the squares blank until it's done."],
    [{ items: { [gutter.id]: '' } }, 'Enter how many for 5" K-style gutter.'],
  ])('says what is missing: %j', (over, message) => {
    expect(checkDraft(job(over), gc, crew, today)).toEqual({ state: 'invalid', message });
  });
});

describe('the list the database gets', () => {
  it('carries the shown totals on jobs that close and nothing extra on jobs that don\'t', () => {
    const result = toPayload([
      job({ squares: '20', pitch: '10', items: { [plywood.id]: '2' }, notes: ' two layers ' }),
      job({ address: ' 40 Next Week Rd ', workDate: '2026-11-20', items: { [gutter.id]: '60' } }),
    ], [gc], crew, today);
    expect(result).toEqual({
      jobs: [
        {
          contractor_id: gc.id, work_date: '2026-11-10', address: '12 Oak St', notes: 'two layers', worker_ids: ['a', 'b'],
          items: [{ item_id: plywood.id, qty: 2 }], squares: 20, pitch: 10, expected_bill_cents: 224000, expected_pay_cents: 110000,
        },
        { contractor_id: gc.id, work_date: '2026-11-20', address: '40 Next Week Rd', notes: null, worker_ids: ['a', 'b'], items: [{ item_id: gutter.id, qty: 60 }] },
      ],
    });
  });

  it('names the first job that isn\'t ready, counting from 1', () => {
    expect(toPayload([job(), job({ address: ' ' })], [gc], crew, today)).toEqual({ error: 'Enter the address.', job: 2 });
    expect(toPayload([job({ contractorId: '' })], [gc], crew, today)).toEqual({ error: 'Pick the contractor.', job: 1 });
  });
});

describe('cents, rounded the way Postgres rounds them', () => {
  it('rounds a half cent up even when the float product falls just short of it', () => {
    // 2.55 × 650 is 1657.4999… in floating point; Postgres gets 1657.5 and rounds to 1658.
    expect(2.55 * 650).toBeLessThan(1657.5);
    expect(lineCents(2.55, 650)).toBe(1658);
    expect(lineCents(24.5, 11000)).toBe(269500);
  });

  it('keeps the closeout preview on the same rounding', () => {
    expect(closeoutReview(0, 0, gc.rate, crew, [{ description: 'x', qty: 2.55, bill_unit_cents: 650, pay_unit_cents: 650 }], 1).billCents).toBe(1658);
  });
});
