import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireStaff } from '@/lib/auth';
import { companyToday, formatDate } from '@/lib/dates';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Notice } from './_notice';

export default async function HomePage({ searchParams }: PageProps<'/office'>) {
  await requireStaff();
  const query = await searchParams;
  // Preserve bookmarked dispatch dates, including their action feedback.
  if (typeof query.date === 'string') {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (typeof value === 'string') params.set(key, value);
    redirect(`/office/dumpsters?${params}`);
  }
  const today = companyToday();
  const db = await createSupabaseServerClient();
  const [roofing, subs, stops, leads, requests, closeout, billing, overdue] = await Promise.all([
    db.from('roofing_jobs').select('id, address, status').eq('install_date', today).order('created_at').limit(20),
    db.from('sub_jobs').select('id, address, status').eq('work_date', today).neq('status', 'void').order('created_at').limit(20),
    db.from('stops').select('id', { count: 'exact', head: true }).eq('scheduled_date', today).eq('status', 'scheduled'),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('stage', 'new'),
    db.from('rental_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    db.from('sub_jobs').select('id, address, work_date').eq('status', 'scheduled').lte('work_date', today).order('work_date').limit(20),
    db.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'final'),
    db.from('sub_invoices').select('id', { count: 'exact', head: true }).eq('status', 'open').lt('due_on', today),
  ]);
  const queues = [
    { label: 'New roofing leads', href: '/office/leads', result: leads, action: 'Contact leads' },
    { label: 'Dumpster requests', href: '/office/requests', result: requests, action: 'Review requests' },
    { label: 'Dumpster invoices ready', href: '/office/billing', result: billing, action: 'Review billing' },
    { label: 'Overdue subcontract invoices', href: '/office/subs/invoices?status=overdue', result: overdue, action: 'Review invoices' },
  ];
  return <>
    <Notice searchParams={query} />
    <header><p className="eyebrow">American Prime · {formatDate(today)}</p><h1 className="page-title">Home</h1><p className="text-muted">What needs your attention across roofing, subcontracting and dumpsters.</p></header>
    <section aria-labelledby="attention"><h2 id="attention" className="mb-3 text-lg font-semibold">Needs attention</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{queues.map(({ label, href, result, action }) => <Link key={href} href={href} className="card-stripe block hover:border-brand">
        <h3 className="text-sm font-medium">{label}</h3><p className="stat-value">{result.error || result.count === null ? 'Unavailable' : result.count}</p>
        <p className="text-sm underline">{action} →</p>{result.error && <p className="mt-2 text-xs text-muted">Could not load this queue. Check connection and schema setup.</p>}
      </Link>)}</div>
    </section>
    <section aria-labelledby="today"><h2 id="today" className="mb-3 text-lg font-semibold">Today’s work</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {[{ label: 'Roofing', base: '/office/jobs', result: roofing }, { label: 'Subcontracting', base: '/office/subs', result: subs }].map(({ label, base, result }) => <div className="card space-y-2" key={base}>
          <h3 className="font-semibold">{label}</h3>
          {result.error ? <p role="status">Work unavailable. Check connection and schema setup.</p> : result.data?.length ? <ul>{result.data.map(j => <li key={j.id}><Link className="block min-h-11 py-2 underline" href={`${base}/${j.id}`}>{j.address} · {j.status === 'done' ? 'Work complete' : j.status === 'in_progress' ? 'In progress' : 'Scheduled'}</Link></li>)}</ul> : <p className="text-sm text-muted">Nothing scheduled today.</p>}
          <Link className="btn-secondary" href={base}>View all {label.toLowerCase()} jobs</Link>
        </div>)}
        <div className="card space-y-3"><h3 className="font-semibold">Dumpsters</h3><p>{stops.error || stops.count === null ? 'Dispatch count unavailable.' : `${stops.count} stops still scheduled today.`}</p><Link className="btn" href="/office/dumpsters">Open dispatch</Link></div>
      </div><p className="mt-2 text-xs text-muted">Up to 20 jobs per workspace. Open each workspace for the full schedule.</p>
    </section>
    <section className="card space-y-3"><h2 className="text-lg font-semibold">Finish subcontracting jobs</h2><p className="text-sm text-muted">Scheduled today or earlier, oldest first. Review work before issuing an invoice.</p>
      {closeout.error ? <p role="status">Subcontracting work is unavailable. The subcontracting schema must be installed before this workspace can load.</p> : closeout.data?.length ? <ul>{closeout.data.map(j => <li key={j.id}><Link className="flex min-h-11 flex-wrap justify-between gap-2 border-b border-border py-3 underline" href={`/office/subs/${j.id}`}><span>{j.address} · {formatDate(j.work_date)}</span><span>Review and finish →</span></Link></li>)}</ul> : <p className="text-muted">No scheduled jobs awaiting closeout through today.</p>}
      <Link className="btn-secondary" href="/office/subs">Assign jobs / view all</Link>
    </section>
  </>;
}
