import { createClient } from '@supabase/supabase-js';
import { loadRuntimeEnv } from '../src/lib/runtime-env.js';

const env = await loadRuntimeEnv(new URL('../.env', import.meta.url));

if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in .env');
}

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const [marketCount, snapshotCount, resolutionCount, checkpointResult, runsResult] = await Promise.all([
  countRows('markets'),
  countRows('market_snapshots'),
  countRows('market_resolutions'),
  supabase.from('sync_checkpoints').select('page_count,market_count,updated_at').eq('checkpoint_key', 'kalshi_full_sync').maybeSingle(),
  supabase
    .from('ingestion_runs')
    .select('started_at,kalshi_snapshots_written,status')
    .eq('run_type', 'full_sync')
    .order('started_at', { ascending: false })
    .limit(12),
]);

const recentRuns = runsResult.data ?? [];
const recentSnapshotWrites = recentRuns.reduce((sum, run) => sum + (run.kalshi_snapshots_written ?? 0), 0);

console.log(
  JSON.stringify(
    {
      counts: {
        markets: marketCount,
        market_snapshots: snapshotCount,
        market_resolutions: resolutionCount,
      },
      recent_snapshot_writes: {
        last_12_full_sync_runs: recentSnapshotWrites,
      },
      checkpoint: checkpointResult.data,
    },
    null,
    2,
  ),
);

async function countRows(table: string): Promise<number | null> {
  const { count, error } = await supabase.from(table).select('id', { count: 'estimated', head: true });

  if (error) {
    return null;
  }

  return count;
}
