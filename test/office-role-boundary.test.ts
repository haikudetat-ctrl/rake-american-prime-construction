import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'office' }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic' } } }) },
  from: (table: string) => {
    const chain: Record<string, unknown> = { maybeSingle: async () => ({ data: table === 'memberships' ? { company_id: 'test', role: state.role } : { full_name: 'Synthetic', locale: 'en' } }) };
    for (const method of ['select', 'eq', 'order', 'limit']) chain[method] = () => chain;
    return chain;
  },
}) }));
import { requireStaff, homeFor } from '@/lib/auth';
describe('unchanged focused role interfaces', () => {
  it.each(['driver', 'crew'] as const)('keeps %s out of office workspaces', async role => {
    state.role = role;
    await expect(requireStaff()).rejects.toThrow(`redirect:/${role}`);
    expect(homeFor(role)).toBe(`/${role}`);
  });
  it.each(['office', 'owner'] as const)('allows %s to use Home', async role => {
    state.role = role;
    expect((await requireStaff()).role).toBe(role);
    expect(homeFor(role)).toBe('/office');
  });
});
