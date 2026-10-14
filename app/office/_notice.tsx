import { Flash } from "@/app/_components/flash";

/** Renders the ?notice= / ?error= message set by lib/flash `back()`. */
export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const notice = searchParams.notice;
  const error = searchParams.error;
  if (typeof error === "string") return <Flash tone="error">{error}</Flash>;
  if (typeof notice === "string") return <Flash tone="ok">{notice}</Flash>;
  return null;
}
