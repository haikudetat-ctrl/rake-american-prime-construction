export const COMPANY_TIMEZONE = "America/New_York";

/** Today's calendar date (YYYY-MM-DD) in the company's timezone. */
export function companyToday(now: Date = new Date(), timeZone = COMPANY_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The Monday on or before a YYYY-MM-DD date. */
export function weekStart(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(isoDate: string, locale = "en-US"): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Minutes the zone is ahead of UTC at a given instant (New York: −240 or −300). */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

/**
 * A wall-clock time in the company's zone ("2026-10-21T14:30", as a
 * datetime-local input sends it) to a UTC ISO timestamp.
 */
export function zonedToUtc(local: string, timeZone = COMPANY_TIMEZONE): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error(`not a local date-time: ${local}`);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let utc = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60_000;
  // Second pass settles times near a daylight-saving change.
  utc = wall - zoneOffsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc).toISOString();
}

/** A UTC timestamp as a datetime-local value in the company's zone. */
export function utcToZonedInput(iso: string, timeZone = COMPANY_TIMEZONE): string {
  const instant = new Date(iso);
  return new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000).toISOString().slice(0, 16);
}

/** "Wed, Oct 21, 2:30 PM" in the company's zone. */
export function formatDateTime(iso: string, timeZone = COMPANY_TIMEZONE): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}
