export function Flash({ tone = "info", children }: { tone?: "info" | "error" | "ok"; children: React.ReactNode }) {
  const color =
    tone === "error"
      ? "border-danger/40 bg-danger/10 text-danger"
      : tone === "ok"
        ? "border-ok/40 bg-ok/10 text-ok"
        : "border-border bg-surface";
  return <p role={tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm ${color}`}>{children}</p>;
}
