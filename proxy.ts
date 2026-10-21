import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Refreshes the Supabase session cookie on every matched request.
 *
 * Next 16 renamed this file and its export from `middleware` to `proxy`; the
 * behaviour is unchanged.
 *
 * Server Components cannot write cookies, so without this an expired access
 * token would bounce a driver to sign-in mid-run with a valid refresh token
 * sitting unused on their phone.
 *
 * This is session plumbing, not authorisation. Access is decided by the
 * role checks in `lib/auth` and, underneath them, by row-level security.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) return response;

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, the image optimiser, and the public
    // address search (called per keystroke, never needs a session).
    "/((?!_next/static|_next/image|api/places/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
