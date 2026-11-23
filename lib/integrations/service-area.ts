/**
 * Where American Prime works, for address lookups: New Jersey and the
 * Pennsylvania side of the Delaware (Philadelphia and its suburbs, Bucks,
 * Montgomery, Chester, the Lehigh Valley, out to Reading and Lancaster).
 *
 * Until Nov 23 lookups were locked to New Jersey. A Pennsylvania address then
 * had nothing to match, Google answered with the state itself, and the office
 * saw its PA job saved as "New Jersey, USA".
 *
 * Adding a state is one entry in SERVICE_STATES, plus widening the box if the
 * new state lies outside it.
 */

/** Two-letter codes a looked-up address may land in. */
export const SERVICE_STATES: readonly string[] = ["NJ", "PA"];

/**
 * A box around the area. Geocoding uses it to prefer nearby matches (so
 * "123 Main St" lands on a Main Street here, not three states away) and the
 * public form's search uses it to limit suggestions. A box can't follow state
 * lines, so it also takes in Staten Island and northern Delaware; the state
 * check above is what decides.
 */
export const SERVICE_AREA = { south: 38.92, west: -76.4, north: 41.36, east: -73.88 } as const;

export function inServiceState(state: string | null): boolean {
  return state !== null && SERVICE_STATES.includes(state.toUpperCase());
}
