import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { companyToday, formatDate } from '@/lib/dates';
import { formatCents } from '@/lib/money';
import { one } from '@/lib/office/team';
import { subQuery } from '@/lib/subcontract/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Unavailable } from '../../_unavailable';
export default async function InvoicesPage({ searchParams }: PageProps<'/office/subs/invoices'>) {
  await requireStaff();
  const query = await searchParams;
  const today = companyToday();
  const db = await createSupabaseServerClient();
  const status = query.status === 'paid' || query.status === 'overdue' || query.status === 'all' ? query.status : 'open';
  let request = db.from('sub_invoices').select('id, job_id, number, due_on, status, total_cents, sent_at, sub_contractors(name), sub_jobs(address), sub_payments(amount_cents, voided_at)').order('due_on').limit(200);
  if (status !== 'all') request = request.eq('status', status === 'overdue' ? 'open' : status);
  if (status === 'overdue') request = request.lt('due_on', today);
  const { data, error } = await request;
  if (error) return <Unavailable area="Subcontracting invoices" />;
  const context = subQuery(query);
  return <>
    <header><p className="eyebrow">Subcontracting</p><h1 className="page-title">Invoices</h1><p className="text-muted">Contractor balances. Open a job to review its invoice or record a payment.</p></header>
    <nav aria-label="Invoice status" className="flex flex-wrap gap-2">{['open', 'overdue', 'paid', 'all'].map(s => <Link className={s === status ? 'btn' : 'btn-secondary'} aria-current={s === status ? 'page' : undefined} key={s} href={`/office/subs/invoices${context || '?'}${context ? '&' : ''}status=${s}`}>{s === 'open' ? 'Outstanding' : s === 'paid' ? 'Contractor paid' : s === 'all' ? 'All invoices' : 'Overdue'}</Link>)}</nav>
    {!data?.length && <p className="card text-muted">No invoices match this filter.</p>}
    <ul className="space-y-3">{data?.map(i => {
      const paid = (i.sub_payments ?? []).filter(p => !p.voided_at).reduce((sum, p) => sum + p.amount_cents, 0);
      return <li key={i.id}><Link href={`/office/subs/${i.job_id}${context}`} className="card block space-y-2 hover:border-brand"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">#{i.number} · {one(i.sub_contractors)?.name}</h2><span className="pill">{i.status === 'void' ? 'Invoice void' : i.status === 'paid' ? 'Contractor paid' : i.due_on < today ? 'Payment overdue' : 'Payment outstanding'}</span></div><p>{one(i.sub_jobs)?.address}</p><p className="text-sm">{i.status === 'void' ? 'Voided total' : 'Balance'} {formatCents(i.status === 'void' ? i.total_cents : i.total_cents - paid)} · due {formatDate(i.due_on)} · {i.sent_at ? 'Email sent' : 'Email not sent'}</p></Link></li>;
    })}</ul><p className="text-xs text-muted">Showing up to 200 invoices, earliest due first.</p>
  </>;
}
