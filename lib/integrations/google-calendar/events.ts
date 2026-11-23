// What a Rake job looks like on Google Calendar. Pure, so it's tested without Google.

export type CalendarEvent = {
  /** Rake's own id for the event: the same job always maps to the same event. */
  id: string;
  summary: string;
  description: string;
  location: string;
  /** All-day ({ date }) for work days; timed ({ dateTime }) for an estimate visit. */
  start: EventTime;
  end: EventTime;
  /** All-day jobs don't mark the owner busy for the day; an estimate visit does. */
  transparency: "transparent" | "opaque";
};

export type EventTime = { date: string } | { dateTime: string; timeZone: string };

export type CalendarKind = "sub_job" | "stop" | "roofing_job" | "appointment";

/** A homeowner roof install, from a signed proposal (Nov 23). */
export type RoofingJobForCalendar = {
  id: string;
  status: string;
  installDate: string | null;
  address: string | null;
  customer: string;
  system: string;
  crew: string[];
  notes: string | null;
};

/** An estimate visit set on a roofing lead (Nov 23). */
export type AppointmentForCalendar = {
  leadId: string;
  stage: string;
  appointmentAt: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  need: string;
  notes: string | null;
  timeZone: string;
};

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
const ID_PREFIX: Record<CalendarKind, string> = { sub_job: "rkj", stop: "rks", roofing_job: "rkr", appointment: "rka" };

export function eventId(kind: CalendarKind, id: string): string {
  return ID_PREFIX[kind] + id.replace(/-/g, "").toLowerCase();
}

/** How long an estimate visit holds the calendar. */
export const VISIT_MINUTES = 60;

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

/** A homeowner roof install on its install day, or null until it has one. */
export function roofingJobEvent(job: RoofingJobForCalendar, appUrl: string): CalendarEvent | null {
  if (!job.installDate) return null;
  const address = job.address ?? "Address not set";
  return {
    id: eventId("roofing_job", job.id),
    summary: `${job.status === "done" ? "Roof done" : "Roof install"}: ${short(address)} (${job.customer})`,
    description: lines([
      `Customer: ${job.customer}`,
      `System: ${job.system}`,
      `Crew: ${job.crew.length ? job.crew.join(", ") : "not assigned"}`,
      job.notes ? `Notes: ${job.notes}` : null,
      "",
      `Open in Rake: ${appUrl}/office/jobs/${job.id}`,
    ]),
    location: address,
    start: { date: job.installDate },
    end: { date: nextDay(job.installDate) },
    transparency: "transparent",
  };
}

const NEED_WORDS: Record<string, string> = {
  replacement: "roof replacement",
  repair: "leak or repair",
  inspection: "inspection",
  gutters: "gutters",
  storm: "storm damage",
};

/** "2026-11-24T15:30:00.000Z" plus minutes, as an ISO time. */
function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

/**
 * An estimate visit at its set time, an hour long and marked busy, or null
 * when there is none or the lead was lost. It stays after the visit, as a
 * record of when it happened.
 */
export function appointmentEvent(visit: AppointmentForCalendar, appUrl: string): CalendarEvent | null {
  if (!visit.appointmentAt || visit.stage === "lost") return null;
  const start = new Date(visit.appointmentAt).toISOString();
  const address = visit.address ?? "Address not set";
  const need = NEED_WORDS[visit.need];
  return {
    id: eventId("appointment", visit.leadId),
    summary: `Estimate: ${short(address)} (${visit.name})`,
    description: lines([
      `Homeowner: ${visit.name}`,
      visit.phone ? `Phone: ${visit.phone}` : null,
      need ? `Needs: ${need}` : null,
      visit.notes ? `Notes: ${visit.notes}` : null,
      "",
      `Open in Rake: ${appUrl}/office/leads/${visit.leadId}`,
    ]),
    location: address,
    start: { dateTime: start, timeZone: visit.timeZone },
    end: { dateTime: addMinutes(start, VISIT_MINUTES), timeZone: visit.timeZone },
    transparency: "opaque",
  };
}
