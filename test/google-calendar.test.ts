import { describe, expect, it } from "vitest";
import { googleCalendarConfig, googleCalendarReady } from "@/lib/integrations/google-calendar/config";
import {
  appointmentEvent,
  eventId,
  nextDay,
  roofingJobEvent,
  stopEvent,
  subJobEvent,
  type AppointmentForCalendar,
  type RoofingJobForCalendar,
  type StopForCalendar,
  type SubJobForCalendar,
} from "@/lib/integrations/google-calendar/events";
import { authorizeUrl } from "@/lib/integrations/google-calendar/google";

const job: SubJobForCalendar = {
  id: "0d1f4996-2b7a-4c4e-9f2a-1a2b3c4d5e6f",
  status: "scheduled",
  workDate: "2026-11-24",
  address: "12 Oak St, Trenton, NJ 08611, USA",
  contractor: "All Season",
  crew: ["Luis", "Marco"],
  notes: "Tear-off, 2 layers",
};

const drop: StopForCalendar = {
  id: "a73e182d-5749-4536-8f33-e8fbdd2d5863",
  kind: "drop",
  status: "scheduled",
  date: "2026-11-30",
  rentalId: "01229019-32e4-4e47-8153-5801b255ec87",
  rentalStatus: "scheduled",
  address: "109 Center Ave, Phoenixville, PA 19460, USA",
  customer: "AKG Contractor LLC",
  driver: null,
  sizeYards: 20,
  notes: "Driveway delivery",
};

describe("Google Calendar events (Nov 23)", () => {
  it("uses ids Google accepts, the same for the same job every time", () => {
    const id = eventId("sub_job", job.id);
    expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(id).toBe(eventId("sub_job", job.id.toUpperCase()));
    expect(eventId("stop", job.id)).not.toBe(id);
  });

  it("ends an all-day event the next day, across months and years", () => {
    expect(nextDay("2026-11-24")).toBe("2026-11-25");
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("puts a crew job on its work day with the contractor, crew and a link back", () => {
    const e = subJobEvent(job, "https://app.example")!;
    expect(e.summary).toBe("Crew: 12 Oak St, Trenton, NJ 08611 (All Season)");
    expect(e.start).toEqual({ date: "2026-11-24" });
    expect(e.end).toEqual({ date: "2026-11-25" });
    expect(e.location).toBe(job.address);
    expect(e.description).toContain("Crew: Luis, Marco");
    expect(e.description).toContain("Notes: Tear-off, 2 layers");
    expect(e.description).toContain(`https://app.example/office/subs/${job.id}`);
    expect(e.transparency).toBe("transparent");
  });

  it("marks a finished job, says when nobody's assigned, and takes a voided one off", () => {
    expect(subJobEvent({ ...job, status: "done" }, "")!.summary).toMatch(/^Crew done: /);
    expect(subJobEvent({ ...job, crew: [] }, "")!.description).toContain("Crew: not assigned");
    expect(subJobEvent({ ...job, status: "void" }, "")).toBeNull();
  });

  it("puts a dumpster drop or pickup on its day, with customer, size and a link to the rental", () => {
    const e = stopEvent(drop, "https://app.example")!;
    expect(e.summary).toBe("Dumpster drop: 109 Center Ave, Phoenixville, PA 19460 (AKG Contractor LLC)");
    expect(e.description).toContain("Driver: not assigned");
    expect(e.description).toContain("Size: 20-yard");
    expect(e.description).toContain(`https://app.example/office/rentals/${drop.rentalId}`);
    expect(stopEvent({ ...drop, kind: "pickup", driver: "Driver A" }, "")!.summary).toMatch(/^Dumpster pickup: /);
    expect(stopEvent({ ...drop, status: "done" }, "")!.summary).toMatch(/^Dumpster dropped: /);
  });

  it("takes a cancelled stop, a cancelled rental and dump runs off the calendar", () => {
    expect(stopEvent({ ...drop, status: "cancelled" }, "")).toBeNull();
    expect(stopEvent({ ...drop, rentalStatus: "cancelled" }, "")).toBeNull();
    expect(stopEvent({ ...drop, kind: "dump" }, "")).toBeNull();
  });

  it("never writes null into an event", () => {
    const bare = stopEvent({ ...drop, address: null, customer: null, sizeYards: null, notes: null }, "")!;
    expect(JSON.stringify(bare)).not.toContain("null");
    expect(bare.summary).toBe("Dumpster drop: Address not set");
  });
});

describe("Google Calendar connection", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const env = { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_TOKEN_KEY: key } as unknown as NodeJS.ProcessEnv;

  it("asks Google for offline access to Rake's own calendars only, and comes back where it started", () => {
    const url = new URL(authorizeUrl(googleCalendarConfig(env)!, "https://www.apconstructionnj.com/api/google-calendar/callback", "st"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/calendar.app.created");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("redirect_uri")).toBe("https://www.apconstructionnj.com/api/google-calendar/callback");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.toString()).not.toContain("secret");
  });

  it("is off until all three settings are there, and a bad key can't take the outbox down", () => {
    expect(googleCalendarConfig({ ...env, GOOGLE_TOKEN_KEY: undefined })).toBeNull();
    expect(() => googleCalendarConfig({ ...env, GOOGLE_TOKEN_KEY: "short" })).toThrow(/32 random bytes/);
    expect(googleCalendarReady({ ...env, GOOGLE_TOKEN_KEY: "short" })).toBe(false);
    expect(googleCalendarReady(env)).toBe(true);
  });
});

const install: RoofingJobForCalendar = {
  id: "5b9e2c1a-7f40-4d2b-9c11-2a3b4c5d6e7f",
  status: "scheduled",
  installDate: "2026-12-02",
  address: "5 Shore Rd, Brigantine, NJ 08203, USA",
  customer: "Pat Rivera",
  system: "GAF Timberline HDZ",
  crew: ["Luis"],
  notes: null,
};

const visit: AppointmentForCalendar = {
  leadId: "9c0d1e2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f",
  stage: "appointment",
  appointmentAt: "2026-11-25T15:30:00Z",
  name: "Pat Rivera",
  phone: "(609) 555-0123",
  address: "5 Shore Rd, Brigantine, NJ 08203, USA",
  need: "repair",
  notes: "Leak over the kitchen",
  timeZone: "America/New_York",
};

describe("Google Calendar: homeowner roofing (Nov 23)", () => {
  it("keeps every kind's ids apart", () => {
    const ids = (["sub_job", "stop", "roofing_job", "appointment"] as const).map((k) => eventId(k, install.id));
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
  });

  it("puts a roof install on its install day with the customer, system and crew", () => {
    const e = roofingJobEvent(install, "https://app.example")!;
    expect(e.summary).toBe("Roof install: 5 Shore Rd, Brigantine, NJ 08203 (Pat Rivera)");
    expect(e.start).toEqual({ date: "2026-12-02" });
    expect(e.end).toEqual({ date: "2026-12-03" });
    expect(e.description).toContain("System: GAF Timberline HDZ");
    expect(e.description).toContain("Crew: Luis");
    expect(e.description).toContain(`https://app.example/office/jobs/${install.id}`);
    expect(e.transparency).toBe("transparent");
  });

  it("marks a finished install and leaves an unscheduled one off", () => {
    expect(roofingJobEvent({ ...install, status: "done" }, "")!.summary).toMatch(/^Roof done: /);
    expect(roofingJobEvent({ ...install, installDate: null }, "")).toBeNull();
  });

  it("puts an estimate visit at its time for an hour, marked busy", () => {
    const e = appointmentEvent(visit, "https://app.example")!;
    expect(e.summary).toBe("Estimate: 5 Shore Rd, Brigantine, NJ 08203 (Pat Rivera)");
    expect(e.start).toEqual({ dateTime: "2026-11-25T15:30:00.000Z", timeZone: "America/New_York" });
    expect(e.end).toEqual({ dateTime: "2026-11-25T16:30:00.000Z", timeZone: "America/New_York" });
    expect(e.description).toContain("Phone: (609) 555-0123");
    expect(e.description).toContain("Needs: leak or repair");
    expect(e.description).toContain(`https://app.example/office/leads/${visit.leadId}`);
    expect(e.transparency).toBe("opaque");
  });

  it("takes a visit off when it's cleared or the lead is lost, and keeps it after the visit", () => {
    expect(appointmentEvent({ ...visit, appointmentAt: null }, "")).toBeNull();
    expect(appointmentEvent({ ...visit, stage: "lost" }, "")).toBeNull();
    expect(appointmentEvent({ ...visit, stage: "proposal_sent" }, "")).not.toBeNull();
  });
});
