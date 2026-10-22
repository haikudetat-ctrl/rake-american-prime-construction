export function subQuery(query: { week?: unknown; filter?: unknown }): string {
  const params = new URLSearchParams();
  if (typeof query.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.week)) params.set('week', query.week);
  if (query.filter === 'scheduled' || query.filter === 'done') params.set('filter', query.filter);
  return params.size ? `?${params}` : '';
}
