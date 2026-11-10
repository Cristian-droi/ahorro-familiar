import type { MonthlyUtility } from '@/lib/data/loans';

// Browser access to profits (RN-6). The server computes them in
// utilidades/domain; see src/app/api/utilidades/route.ts.

async function getJson(url: string): Promise<{ utilities: unknown[] }> {
  const res = await fetch(url, { cache: 'no-store' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? 'No se pudieron cargar las utilidades');
  return json;
}

// The caller's own profits, or one shareholder's for the gerente or tesorero.
export async function fetchUtilitiesByYear(year: number, userId?: string): Promise<MonthlyUtility[]> {
  const params = new URLSearchParams({ year: String(year) });
  if (userId) params.set('userId', userId);
  const { utilities } = await getJson(`/api/utilidades?${params}`);
  return utilities as MonthlyUtility[];
}

// Every shareholder's profits, for the admin views.
export async function fetchAllUtilitiesByYear(
  year: number,
): Promise<(MonthlyUtility & { user_id: string })[]> {
  const { utilities } = await getJson(`/api/utilidades?year=${year}&all=1`);
  return utilities as (MonthlyUtility & { user_id: string })[];
}
