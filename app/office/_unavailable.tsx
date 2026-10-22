export function Unavailable({ area = 'Subcontracting' }: { area?: string }) {
  return <section className="card space-y-2" role="alert"><h1 className="text-lg font-semibold">{area} unavailable</h1><p>We couldn’t load this workspace. Reload to try again. If this persists, ask an owner to check the connection and required schema setup.</p><p className="text-sm text-muted">Unavailable records are not shown as zero balances or an empty schedule.</p></section>;
}
