/**
 * show-event-status.ts
 *
 * KPI snapshot for the event intelligence layer against live DB data.
 *
 * Usage:
 *   npm run status:event                           # top 20 events
 *   npm run status:event -- --limit 50             # top 50 events
 *   npm run status:event -- --category fed_policy  # events in one category
 */

import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!env['SUPABASE_URL'] || !env['SUPABASE_SERVICE_KEY']) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

// Inject env vars before importing DB modules that call getEnv() / getSupabase()
process.env['SUPABASE_URL'] = env['SUPABASE_URL'];
process.env['SUPABASE_SERVICE_KEY'] = env['SUPABASE_SERVICE_KEY'];

// Dynamic import after env vars are set
const { listTopEventIntelligence, listEventIntelligenceByCategory } = await import('../src/db/events.js');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const rawLimit = Number(getArg('--limit') ?? '20');
const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 20;
const category = getArg('--category') as Parameters<typeof listEventIntelligenceByCategory>[0] | undefined;

// ---------------------------------------------------------------------------
// Fetch events
// ---------------------------------------------------------------------------

console.error(`Fetching top ${limit} event(s)${category !== undefined ? ` in category '${category}'` : ''}…`);

const events =
  category !== undefined
    ? await listEventIntelligenceByCategory(category, limit)
    : await listTopEventIntelligence(limit);

console.error(`Received ${events.length} event(s)`);

// ---------------------------------------------------------------------------
// Compute KPIs
// ---------------------------------------------------------------------------

const total = events.length;

function ratio(count: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1_000) / 1_000;
}

const nonNull24h = events.filter((e) => e.probability_change_24h !== null).length;
const nonNull7d = events.filter((e) => e.probability_change_7d !== null).length;
const singletons = events.filter((e) => e.event_id.startsWith('singleton:')).length;
const totalRelated = events.reduce((sum, e) => sum + e.related_markets.length, 0);
const avgRelated = total > 0 ? Math.round((totalRelated / total) * 10) / 10 : 0;

const output = {
  sampled_at: new Date().toISOString(),
  filters: {
    limit,
    category: category ?? null,
  },
  kpis: {
    total_events_sampled: total,
    ratio_non_null_24h_change: ratio(nonNull24h),
    ratio_non_null_7d_change: ratio(nonNull7d),
    ratio_singleton_clusters: ratio(singletons),
    avg_related_markets_per_event: avgRelated,
  },
  raw_counts: {
    non_null_24h: nonNull24h,
    non_null_7d: nonNull7d,
    singleton_clusters: singletons,
    total_related_markets: totalRelated,
  },
};

console.log(JSON.stringify(output, null, 2));
