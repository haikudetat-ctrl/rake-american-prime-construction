import type { ReactNode } from "react";

export type Tone = "success" | "warning" | "danger" | "neutral";

/** Tinted background with matching text; every pair passes AA in both themes. */
export const toneClasses: Record<Tone, string> = {
  success: "bg-ok-soft text-ok",
  warning: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-sunken text-muted",
};

/** Figma "Status / …" chips. Says what the evidence shows, not what we hope happened. */
export function StatusPill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-lg px-2 py-1 text-xs font-semibold tracking-wide uppercase ${toneClasses[tone]}`}>
      {children}
    </span>
  );
}
