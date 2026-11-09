import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import { toneClasses, type Tone } from "./status-pill";

const ICONS: Record<Tone, IconName> = {
  warning: "triangle-alert",
  danger: "circle-alert",
  success: "check",
  neutral: "info",
};

/**
 * Figma "Note" and the recovery states (84 Outcome uncertain, 85 New information,
 * 86 No receipt yet). Danger callouts are announced; the rest are static notes unless
 * the caller passes a role.
 */
export function Callout({ tone = "warning", title, role, children }: { tone?: Tone; title?: ReactNode; role?: "alert" | "status"; children?: ReactNode }) {
  return (
    <div role={role ?? (tone === "danger" ? "alert" : undefined)} className={`flex gap-3 rounded-row p-3 text-sm sm:p-4 ${toneClasses[tone]}`}>
      <Icon name={ICONS[tone]} size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
