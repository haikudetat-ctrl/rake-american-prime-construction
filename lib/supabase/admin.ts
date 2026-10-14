import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/server";

/**
 * Service-role client. Bypasses RLS, so it is used only where no signed-in
 * user exists or the action is about users themselves:
 *   - the public request link (submit_rental_request)
 *   - the cron routes (outbox, statements, reminders)
 *   - scale-ticket photo storage (private bucket)
 *   - creating team members (auth admin API), owner-gated in the action
 */
let client: SupabaseClient | null = null;

export function adminClient(): SupabaseClient {
  if (client) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
