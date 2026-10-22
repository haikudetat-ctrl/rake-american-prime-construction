'use client';
import { useFormStatus } from 'react-dom';
export function Submit({ children, className = 'btn-secondary' }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={`${className} min-h-11`} disabled={pending}>{pending ? 'Saving…' : children}</button>;
}
