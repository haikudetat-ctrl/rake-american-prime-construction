import "server-only";
import { open, seal } from "@/lib/integrations/quickbooks/crypto";
import { one } from "@/lib/office/team";
import { adminClient } from "@/lib/supabase/admin";
import { googleCalendarConfig, type GoogleCalendarConfig } from "./config";
import { formatPhone } from "@/lib/phone";
import { appointmentEvent, roofingJobEvent, stopEvent, subJobEvent, eventId, type CalendarEvent, type CalendarKind } from "./events";
import { accessToken, deleteEvent, GoogleError, putEvent } from "./google";

export type Connection = {
  companyId: string;
  googleEmail: string | null;
  calendarId: string;
  refreshToken: string;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastError: string | null;
};

type Row = {
  company_id: string;
  google_email: string | null;
  calendar_id: string;
  refresh_token_enc: string;
  connected_at: string;
  last_synced_at: string | null;
  last_error: string | null;
};

export async function loadConnection(companyId: string, config: GoogleCalendarConfig): Promise<Connection | null> {
  const { data } = await adminClient().from("google_calendar_connections").select("*").eq("company_id", companyId).maybeSingle();
  const row = data as Row | null;
  if (!row) return null;
  return {
    companyId: row.company_id,
    googleEmail: row.google_email,
    calendarId: row.calendar_id,
    refreshToken: open(row.refresh_token_enc, config.tokenKey),
    connectedAt: row.connected_at,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
  };
}

export async function saveConnection(
  config: GoogleCalendarConfig,
  c: { companyId: string; googleEmail: string | null; calendarId: string; refreshToken: string; connectedBy: string },
): Promise<void> {
  const { error } = await adminClient().from("google_calendar_connections").upsert({
    company_id: c.companyId,
    google_email: c.googleEmail,
    calendar_id: c.calendarId,
    refresh_token_enc: seal(c.refreshToken, config.tokenKey),
    connected_by: c.connectedBy,
    connected_at: new Date().toISOString(),
    last_error: null,
  });
  if (error) throw new Error(`saving the Google Calendar connection: ${error.message}`);
}

// Access tokens last an hour; one per company is reused across a drain run.
const tokens = new Map<string, { token: string; until: number }>();

async function tokenFor(config: GoogleCalendarConfig, connection: Connection): Promise<string> {
  const cached = tokens.get(connection.companyId);
  if (cached && cached.until > Date.now()) return cached.token;
  const token = await accessToken(config, connection.refreshToken);
  tokens.set(connection.companyId, { token, until: Date.now() + 50 * 60_000 });
  return token;
}

async function subJob(companyId: string, id: string, appUrl: string): Promise<CalendarEvent | null> {
  const { data } = await adminClient()
    .from("sub_jobs")
    .select("id, status, work_date, address, notes, sub_contractors(name), sub_job_crew(sub_workers(name))")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  const job = data as unknown as {
    id: string; status: string; work_date: string; address: string; notes: string | null;
    sub_contractors: { name: string } | { name: string }[] | null;
    sub_job_crew: { sub_workers: { name: string } | { name: string }[] | null }[] | null;
  };
  return subJobEvent(
    {
      id: job.id,
      status: job.status,
      workDate: job.work_date,
      address: job.address,
      notes: job.notes,
      contractor: one(job.sub_contractors)?.name ?? null,
      crew: (job.sub_job_crew ?? []).map((c) => one(c.sub_workers)?.name).filter((n): n is string => Boolean(n)),
    },
    appUrl,
  );
}

async function stop(companyId: string, id: string, appUrl: string): Promise<CalendarEvent | null> {
  const db = adminClient();
  const { data } = await db
    .from("stops")
    .select("id, kind, status, scheduled_date, driver_id, rental_id, rentals(status, size_yards, notes, customers(name), sites(address))")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  type Rental = {
    status: string; size_yards: number | null; notes: string | null;
    customers: { name: string } | { name: string }[] | null;
    sites: { address: string } | { address: string }[] | null;
  };
  const s = data as unknown as {
    id: string; kind: string; status: string; scheduled_date: string; driver_id: string | null; rental_id: string;
    rentals: Rental | Rental[] | null;
  };
  const rental = one(s.rentals);
  let driver: string | null = null;
  if (s.driver_id) {
    const { data: profile } = await db.from("profiles").select("full_name").eq("user_id", s.driver_id).maybeSingle();
    driver = (profile as { full_name: string | null } | null)?.full_name ?? null;
  }
  return stopEvent(
    {
      id: s.id,
      kind: s.kind,
      status: s.status,
      date: s.scheduled_date,
      rentalId: s.rental_id,
      rentalStatus: rental?.status ?? "cancelled",
      address: one(rental?.sites)?.address ?? null,
      customer: one(rental?.customers)?.name ?? null,
      driver,
      sizeYards: rental?.size_yards ?? null,
      notes: rental?.notes ?? null,
    },
    appUrl,
  );
}

async function roofingJob(companyId: string, id: string, appUrl: string): Promise<CalendarEvent | null> {
  const db = adminClient();
  const { data } = await db
    .from("roofing_jobs")
    .select("id, status, install_date, address, customer_name, system_name, crew_ids, notes")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!data) return null;
  const job = data as {
    id: string; status: string; install_date: string | null; address: string | null; customer_name: string;
    system_name: string; crew_ids: string[] | null; notes: string | null;
  };
  let crew: string[] = [];
  if (job.crew_ids?.length) {
    const { data: profiles } = await db.from("profiles").select("user_id, full_name").in("user_id", job.crew_ids);
    const names = new Map((profiles ?? []).map((p: { user_id: string; full_name: string | null }) => [p.user_id, p.full_name]));
    crew = job.crew_ids.map((uid) => names.get(uid)).filter((n): n is string => Boolean(n));
  }
  return roofingJobEvent(
    {
      id: job.id,
      status: job.status,
      installDate: job.install_date,
      address: job.address,
      customer: job.customer_name,
      system: job.system_name,
      crew,
      notes: job.notes,
    },
    appUrl,
  );
}

async function appointment(companyId: string, leadId: string, appUrl: string): Promise<CalendarEvent | null> {
  const db = adminClient();
  const [{ data }, { data: company }] = await Promise.all([
    db.from("leads").select("id, stage, appointment_at, name, phone, address, need, notes").eq("id", leadId).eq("company_id", companyId).maybeSingle(),
    db.from("companies").select("timezone").eq("id", companyId).maybeSingle(),
  ]);
  if (!data) return null;
  const lead = data as {
    id: string; stage: string; appointment_at: string | null; name: string; phone: string | null;
    address: string | null; need: string; notes: string | null;
  };
  return appointmentEvent(
    {
      leadId: lead.id,
      stage: lead.stage,
      appointmentAt: lead.appointment_at,
      name: lead.name,
      phone: lead.phone ? formatPhone(lead.phone) : null,
      address: lead.address,
      need: lead.need,
      notes: lead.notes,
      timeZone: (company as { timezone: string } | null)?.timezone ?? "America/New_York",
    },
    appUrl,
  );
}

const LOADERS: Record<CalendarKind, (companyId: string, id: string, appUrl: string) => Promise<CalendarEvent | null>> = {
  sub_job: subJob,
  stop,
  roofing_job: roofingJob,
  appointment,
};

export type SyncOutcome = { done: true } | { skipped: string };

/**
 * Puts one job, stop, roof install or estimate visit on the connected calendar as it stands now, or takes it
 * off. Run by the outbox for each queued "calendar" message; a throw retries
 * it with backoff, and the last error is shown in Settings.
 */
export async function syncCalendarItem(companyId: string, payload: Record<string, unknown>, appUrl: string): Promise<SyncOutcome> {
  const config = googleCalendarConfig();
  if (!config) return { skipped: "Google Calendar is not configured" };
  const connection = await loadConnection(companyId, config);
  if (!connection) return { skipped: "Google Calendar is not connected" };

  const kind = payload.kind as CalendarKind;
  const id = String(payload.id);
  const load = Object.hasOwn(LOADERS, kind) ? LOADERS[kind] : null;
  if (!load) return { skipped: `unknown calendar item ${String(payload.kind)}` };

  const db = adminClient();
  try {
    const event = await load(companyId, id, appUrl);
    const token = await tokenFor(config, connection);
    if (event) await putEvent(token, connection.calendarId, event);
    else await deleteEvent(token, connection.calendarId, eventId(kind, id));
    await db.from("google_calendar_connections")
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq("company_id", companyId);
    return { done: true };
  } catch (err) {
    const message =
      err instanceof GoogleError && err.reconnect
        ? "Google no longer accepts Rake's sign-in (access was removed). Reconnect in Settings."
        : (err as Error).message;
    tokens.delete(companyId);
    await db.from("google_calendar_connections").update({ last_error: message.slice(0, 500) }).eq("company_id", companyId);
    throw new Error(message);
  }
}
