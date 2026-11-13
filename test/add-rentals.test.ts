import { describe, expect, it } from 'vitest';
import { bookOn, checkRental, daysBetween, lineCents, parseQty, parseTons, splitAddresses, toPayload, type DraftRental, type RentalContext } from '@/lib/rentals/add-rentals';

// The prices in supabase/tests/dumpster_add_rentals.test.sql: $350 delivery, 7 days
// included, $25 a day after, from a month back; $400 delivery from 5 days back. The
// totals checked here are the ones the database bills there.
const today = '2026-11-13';
const ctx: RentalContext = {
  today,
  customers: [
    { id: '00000000-0000-0000-0000-0000000000c1', name: 'Shore Roofing', sites: [{ id: '00000000-0000-0000-0000-0000000000a1', address: '12 Ocean Ave' }] },
    { id: '00000000-0000-0000-0000-0000000000c2', name: 'Bay Builders', sites: [] },
  ],
  books: [
    { id: 'b1', version: 1, createdOn: '2026-09-14', deliveryCents: 35000, afterDays: 7, perDayCents: 0 },
    { id: 'b2', version: 2, createdOn: '2026-10-14', deliveryCents: 35000, afterDays: 7, perDayCents: 2500 },
    { id: 'b3', version: 3, createdOn: '2026-11-08', deliveryCents: 40000, afterDays: 7, perDayCents: 2500 },
  ],
  items: [
    { id: '00000000-0000-0000-0000-00000000000a', description: 'Mattress', unit: 'each', unitCents: 5000 },
    { id: '00000000-0000-0000-0000-00000000000b', description: 'Tire', unit: 'each', unitCents: 2500 },
  ],
  cans: [
    { id: '00000000-0000-0000-0000-0000000000e1', label: 'C1', sizeYards: 20, inYard: true },
    { id: '00000000-0000-0000-0000-0000000000e2', label: 'C2', sizeYards: 20, inYard: false },
  ],
};
const [mattress, tire] = ctx.items;
const [c1, c2] = ctx.cans;
const draft = (over: Partial<DraftRental> = {}): DraftRental => ({
  key: 'k', customerId: ctx.customers[0].id, siteId: ctx.customers[0].sites[0].id, address: '', state: 'scheduled',
  dropDate: '2026-11-15', canId: '', pickedUpOn: '', tons: '', dumpFee: '', ticket: '', landfillId: '', notes: '', items: {}, ...over,
});
const done = (over: Partial<DraftRental> = {}) => draft({
  state: 'done', dropDate: '2026-11-01', pickedUpOn: '2026-11-11', canId: c2.id, tons: '2.5', dumpFee: '180', ticket: 'T-881',
  items: { [mattress.id]: '2' }, ...over,
});

describe('reading what was typed', () => {
  it('reads quantities, tons and day counts', () => {
    expect(parseQty('2')).toBe(2);
    expect(parseQty('0')).toBeNull();
    expect(parseTons('2.374')).toBe(2.37);
    expect(parseTons('120')).toBeNull();
    expect(daysBetween('2026-11-01', '2026-11-11')).toBe(10);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2); // across the clock change
    expect(splitAddresses('1) 14 Elm St\n\n- 220 Kings Hwy ')).toEqual(['14 Elm St', '220 Kings Hwy']);
  });

  it('rounds a charge the way Postgres does', () => {
    expect(2.55 * 650).toBeLessThan(1657.5);
    expect(lineCents(2.55, 650)).toBe(1658);
  });
});

describe('which prices apply', () => {
  it('uses the price book in force on the drop day, not today\'s', () => {
    expect(bookOn(ctx.books, '2026-11-01')?.version).toBe(2);
    expect(bookOn(ctx.books, '2026-11-08')?.version).toBe(3);
    expect(bookOn(ctx.books, '2026-01-01')?.version).toBe(1);
  });
});

describe('what adding a rental will do', () => {
  it('bills a finished rental in full: delivery, extra days, disposal and charges', () => {
    const check = checkRental(done(), ctx);
    expect(check).toMatchObject({ state: 'billed', final: true, totalCents: 70500 });
    expect(check.state === 'billed' && check.lines.map((l) => l.cents)).toEqual([35000, 7500, 18000, 10000]);
  });

  it('opens an invoice for a rental still out, at the newer price, with no extra days or disposal yet', () => {
    expect(checkRental(draft({ state: 'on_site', dropDate: '2026-11-10', canId: c1.id, items: { [tire.id]: '1' } }), ctx))
      .toMatchObject({ state: 'billed', final: false, totalCents: 42500 });
  });

  it('books a drop for today or later', () => {
    expect(checkRental(draft(), ctx)).toEqual({ state: 'scheduled' });
  });

  it.each([
    [{ state: 'scheduled', dropDate: '2026-11-12' }, 'That day has passed. If the can went out, pick “Out on the job” or “Picked up and dumped”.'],
    [{ items: { 'x': '1' } }, null],
    [{ state: 'on_site', dropDate: '2026-11-10' }, "Pick the can that's out there."],
    [{ state: 'on_site', dropDate: '2026-11-10', canId: '00000000-0000-0000-0000-0000000000e2' }, "Can C2 isn't in the yard in Rake. Check where it is."],
    [{ state: 'on_site', dropDate: '2026-11-14', canId: '00000000-0000-0000-0000-0000000000e1' }, 'The drop day is after today. Book it instead.'],
  ] as [Partial<DraftRental>, string | null][])('says what is wrong: %j', (over, message) => {
    const check = checkRental(draft(over), ctx);
    if (message) expect(check).toEqual({ state: 'invalid', message });
    else expect(check.state).not.toBe('invalid');
  });

  it.each([
    [{ pickedUpOn: '' }, 'Enter the day it was picked up.'],
    [{ pickedUpOn: '2026-10-30' }, 'The pickup is before the drop.'],
    [{ pickedUpOn: '2026-11-14' }, 'The pickup is after today.'],
    [{ tons: '' }, 'Enter the tons from the scale ticket.'],
    [{ dumpFee: 'lots' }, 'Enter the dump fee from the scale ticket, like 182.50.'],
    [{ items: { '00000000-0000-0000-0000-00000000000a': '' } }, 'Enter how many for Mattress.'],
  ] as [Partial<DraftRental>, string][])('a finished rental needs its ticket and dates: %j', (over, message) => {
    expect(checkRental(done(over), ctx)).toEqual({ state: 'invalid', message });
  });

  it('won\'t book charges before there is an invoice', () => {
    expect(checkRental(draft({ items: { [tire.id]: '1' } }), ctx)).toEqual({
      state: 'invalid', message: 'Line items go on once the can is dropped. Untick them for a booking.',
    });
  });
});

describe('the list the database gets', () => {
  it('carries the shown total on billed rentals, and a new address as typed', () => {
    expect(toPayload([
      done({ notes: ' gate code 4411 ' }),
      draft({ customerId: ctx.customers[1].id, siteId: 'new', address: ' 77 Harbor Way ' }),
    ], ctx)).toEqual({
      rentals: [
        {
          customer_id: ctx.customers[0].id, site_id: ctx.customers[0].sites[0].id, state: 'done', drop_date: '2026-11-01',
          notes: 'gate code 4411', can_id: c2.id, picked_up_on: '2026-11-11', tons: 2.5, dump_fee_cents: 18000, ticket_number: 'T-881',
          items: [{ item_id: mattress.id, qty: 2 }], expected_total_cents: 70500,
        },
        { customer_id: ctx.customers[1].id, address: '77 Harbor Way', state: 'scheduled', drop_date: '2026-11-15', notes: null, items: [] },
      ],
    });
  });

  it('names the first rental that isn\'t ready, counting from 1', () => {
    expect(toPayload([draft(), draft({ siteId: 'new', address: '' })], ctx)).toEqual({ error: 'Enter the address.', rental: 2 });
    expect(toPayload([draft({ customerId: '' })], ctx)).toEqual({ error: 'Pick the customer.', rental: 1 });
  });
});
