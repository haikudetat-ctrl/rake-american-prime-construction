import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { brandRedirect, brandRewrites, siteForHost } from "@/lib/site/config";

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
  // A brand on its own domain (DROPWISE_SITE_URL, ROOFING_SITE_URL) gets its
  // page at the root. Public pages need no session, so return straight away.
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host)
    .split(",")[0]
    .trim()
    .toLowerCase();
  // A brand page on a host that isn't its home (apconstructionnj.com/dumpsters,
  // or /roofing on the roofing domain itself) moves there for good, so each
  // page has one address in search.
  const moved = brandRedirect(host, request.nextUrl.pathname);
  if (moved) {
    const url = new URL(moved);
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url, 308);
  }

  // Any host that is not a production domain (the vercel.app address,
  // previews) stays out of search entirely.
  const hidden = siteForHost(host) === "other";
  const keepOut = <T extends NextResponse>(res: T): T => {
    if (hidden) res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };

  const rewrite = brandRewrites().get(host)?.[request.nextUrl.pathname];
  if (rewrite) {
    const url = request.nextUrl.clone();
    url.pathname = rewrite;
    return keepOut(NextResponse.rewrite(url));
  }

  let response = NextResponse.next({ request });

  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !key) return keepOut(response);

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
  return keepOut(response);
}

export const config = {
  matcher: [
    // Everything except static assets, the image optimiser, and the public
    // address search (called per keystroke, never needs a session).
    "/((?!_next/static|_next/image|api/places/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
