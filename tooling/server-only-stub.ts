// `server-only` exists so Next fails the build when a server module is pulled
// into a client bundle. Vitest and the CLI scripts in scripts/ have no such
// distinction, and the real package throws on import, so both alias it here.
//
// This does not weaken the guard where it matters: the guard is enforced at
// `next build`, and the reason a Google key can never reach the browser is that
// no NEXT_PUBLIC_ Google variable exists to carry it.
export {};
