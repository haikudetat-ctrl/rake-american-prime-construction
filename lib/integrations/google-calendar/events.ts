// What a Rake job looks like on Google Calendar. Pure, so it's tested without Google.

export type CalendarEvent = {
  /** Rake's own id for the event: the same job always maps to the same event. */
  id: string;
  summary: string;
  description: string;
  location: string;
  start: { date: string };
  end: { date: string };
  /** All-day jobs don't mark the owner busy for the day. */
  transparency: "transparent";
};

export type CalendarKind = "sub_job" | "stop";

export type SubJobForCalendar = {
  id: string;
  status: string;
  workDate: string;
  address: string;
  contractor: string | null;
  crew: string[];
  notes: string | null;
};

export type StopForCalendar = {
  id: string;
  kind: string;
  status: string;
  date: string;
  rentalId: string;
  rentalStatus: string;
  address: string | null;
  customer: string | null;
  driver: string | null;
  sizeYards: number | null;
  notes: string | null;
};

/**
 * Google event ids are 5 to 1024 characters of a-v and 0-9. A uuid without
 * its dashes is hex, which fits; the prefix keeps jobs and stops apart.
 */
export function eventId(kind: CalendarKind, id: string): string {
  return (kind === "sub_job" ? "rkj" : "rks") + id.replace(/-/g, "").toLowerCase();
}

/** "2026-11-24" → "2026-11-25": an all-day event ends the day after. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const short = (address: string) => address.replace(/,\s*USA$/, "");
const lines = (parts: (string | null)[]) => parts.filter((x): x is string => x !== null).join("\n");

/** A crew job on its work day, or null when it should come off the calendar (voided). */
export function subJobEvent(job: SubJobForCalendar, appUrl: string): CalendarEvent | null {
  if (job.status === "void") return null;
  const who = job.contractor ? ` (${job.contractor})` : "";
  return {
    id: eventId("sub_job", job.id),
    summary: `${job.status === "done" ? "Crew done" : "Crew"}: ${short(job.address)}${who}`,
    description: lines([
      job.contractor ? `Contractor: ${job.contractor}` : null,
      `Crew: ${job.crew.length ? job.crew.join(", ") : "not assigned"}`,
      job.notes ? `Notes: ${job.notes}` : null,
      "",
      `Open in Rake: ${appUrl}/office/subs/${job.id}`,
    ]),
    location: job.address,
    start: { date: job.workDate },
    end: { date: nextDay(job.workDate) },
    transparency: "transparent",
  };
}

const STOP_TITLE: Record<string, { planned: string; done: string }> = {
  drop: { planned: "Dumpster drop", done: "Dumpster dropped" },
  pickup: { planned: "Dumpster pickup", done: "Dumpster picked up" },
};

/** A drop or pickup on its day, or null when it should come off the calendar (cancelled, or a dump run). */
export function stopEvent(stop: StopForCalendar, appUrl: string): CalendarEvent | null {
  const title = STOP_TITLE[stop.kind];
  if (!title || stop.status === "cancelled" || stop.rentalStatus === "cancelled") return null;
  const address = stop.address ?? "Address not set";
  const who = stop.customer ? ` (${stop.customer})` : "";
  return {
    id: eventId("stop", stop.id),
    summary: `${stop.status === "done" ? title.done : title.planned}: ${short(address)}${who}`,
    description: lines([
      stop.customer ? `Customer: ${stop.customer}` : null,
      `Driver: ${stop.driver ?? "not assigned"}`,
      stop.sizeYards ? `Size: ${stop.sizeYards}-yard` : null,
      stop.notes ? `Notes: ${stop.notes}` : null,
      "",
      `Open in Rake: ${appUrl}/office/rentals/${stop.rentalId}`,
    ]),
    location: address,
    start: { date: stop.date },
    end: { date: nextDay(stop.date) },
    transparency: "transparent",
  };
}
