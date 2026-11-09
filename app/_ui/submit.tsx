'use client';
import { useFormStatus } from 'react-dom';

/** A submit button that disables itself while its form's action runs, so a double tap can't submit twice. */
export function Submit({ children, className = 'btn-secondary', disabled = false, pendingLabel = 'Saving…' }: {
  children: React.ReactNode; className?: string; disabled?: boolean; pendingLabel?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return <button className={`${className} min-h-11`} disabled={disabled || pending}>{pending ? pendingLabel : children}</button>;
}
