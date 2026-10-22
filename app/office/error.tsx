'use client';
export default function Error({ reset }: { reset: () => void }) {
  return <section className="card space-y-3" role="alert"><h2 className="font-semibold">This workspace couldn’t load</h2><p>Your last action may have completed. Reload and check its status before trying again.</p><button className="btn-secondary" onClick={reset}>Try loading again</button></section>;
}
