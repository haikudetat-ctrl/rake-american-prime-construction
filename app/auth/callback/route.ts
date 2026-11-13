import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Lands an emailed sign-in link: trades the one-time code for a session.
 * Office sign-in now uses typed codes (app/login); this stays so a link from
 * an older email still works, or fails with a clear message.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
