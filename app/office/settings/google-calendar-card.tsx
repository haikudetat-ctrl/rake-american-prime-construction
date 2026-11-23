import { disconnectGoogleCalendar } from "@/app/office/actions";
import { formatDateTime } from "@/lib/dates";
import { googleCalendarConfig } from "@/lib/integrations/google-calendar/config";
import { adminClient } from "@/lib/supabase/admin";

/** Owner-only. Connect Google Calendar, and how the sync is doing. */
export async function GoogleCalendarCard({ companyId }: { companyId: string }) {
  const configured = Boolean(googleCalendarConfig());
  const { data } = configured
    ? await adminClient()
        .from("google_calendar_connections")
        .select("google_email, connected_at, last_synced_at, last_error")
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };
  const connection = data as { google_email: string | null; connected_at: string; last_synced_at: string | null; last_error: string | null } | null;

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Google Calendar</h2>
      {!configured ? (
        <p className="text-sm text-muted">Not set up on this deployment. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_TOKEN_KEY.</p>
      ) : !connection ? (
        <>
          <p className="text-sm text-muted">
            Puts crew jobs and dumpster drops and pickups on a &ldquo;Rake jobs&rdquo; calendar in your Google account, and keeps it
            up to date as they&apos;re scheduled, moved or cancelled. Rake only gets access to that calendar.
          </p>
          <a className="btn" href="/api/google-calendar/connect">Connect Google Calendar</a>
        </>
      ) : (
        <>
          <p className="text-sm">
            Connected{connection.google_email ? <> as <strong>{connection.google_email}</strong></> : null} on{" "}
            {formatDateTime(connection.connected_at)}.{" "}
            {connection.last_synced_at ? <>Last update {formatDateTime(connection.last_synced_at)}.</> : <>Filling in now.</>}
          </p>
          <p className="text-sm text-muted">
            To show it to the office, share &ldquo;Rake jobs&rdquo; with them from Google Calendar (Settings and sharing).
            Changes made in Google are overwritten by the next change in Rake.
          </p>
          {connection.last_error && <p className="text-sm text-danger">Last problem: {connection.last_error}</p>}
          <div className="flex flex-wrap gap-2">
            <a className="btn-secondary" href="/api/google-calendar/connect">Reconnect</a>
            <form action={disconnectGoogleCalendar}>
              <button className="btn-secondary text-danger">Disconnect</button>
            </form>
          </div>
        </>
      )}
    </section>
  );
}
