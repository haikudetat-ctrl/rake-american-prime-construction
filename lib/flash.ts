import { redirect } from "next/navigation";

/** Redirects back to a page with a one-line message the page renders. */
export function back(path: string, message: string, tone: "ok" | "error" = "ok"): never {
  const url = new URL(path, "http://x");
  url.searchParams.set(tone === "ok" ? "notice" : "error", message);
  redirect(`${url.pathname}${url.search}`);
}

/** Supabase/Postgres errors carry the RAISE text; show it, not a stack. */
export function errorText(error: { message?: string } | null | undefined): string {
  const text = error?.message ?? "Something went wrong";
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function str(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function optional(form: FormData, key: string): string | null {
  const value = str(form, key);
  return value === "" ? null : value;
}
