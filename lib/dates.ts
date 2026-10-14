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
