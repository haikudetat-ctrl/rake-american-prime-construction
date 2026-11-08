import type { ReactNode } from "react";

/**
 * AP / Field (Figma 6:786): the label stays above the control. Uses the same `.label`
 * pattern as the existing forms, so a page can adopt it one field at a time.
 * Pass an `.input` control as children; set `aria-invalid` on it when `error` is shown.
 */
export function Field({ label, hint, error, className = "", children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label className="label">
        <span>{label}</span>
        {children}
      </label>
      {error ? (
        <p role="alert" className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
