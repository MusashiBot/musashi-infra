import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
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

const [marketCount, snapshotCount, resolutionCount, checkpointResult, runsResult, tableSizes] = await Promise.all([
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
  loadTableSizes(),
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
      table_sizes: tableSizes,
      checkpoint: checkpointResult.data,
    },
    null,
    2,
  ),
);

async function countRows(table: string): Promise<number | null> {
  if (table === 'markets') {
    const estimatedResult = await supabase.from(table).select('id', { count: 'estimated', head: true });

    if (estimatedResult.error) {
      return null;
    }

    return estimatedResult.count;
  }

  const exactResult = await supabase.from(table).select('id', { count: 'exact', head: true });

  if (!exactResult.error) {
    return exactResult.count;
  }

  const estimatedResult = await supabase.from(table).select('id', { count: 'estimated', head: true });

  if (estimatedResult.error) {
    return null;
  }

  return estimatedResult.count;
}

async function loadTableSizes(): Promise<Array<{ table_name: string; total_size: string; bytes: number }> | null> {
  if (
    !env.SUPABASE_DB_HOST ||
    !env.SUPABASE_DB_NAME ||
    !env.SUPABASE_DB_USER ||
    !env.SUPABASE_DB_PASSWORD
  ) {
    return null;
  }

  const sql = postgres({
    host: env.SUPABASE_DB_HOST,
    port: Number(env.SUPABASE_DB_PORT ?? '5432'),
    database: env.SUPABASE_DB_NAME,
    username: env.SUPABASE_DB_USER,
    password: env.SUPABASE_DB_PASSWORD,
    ssl: 'require',
    max: 1,
  });

  try {
    const rows = await sql.unsafe(`select relname as table_name,
                                          pg_size_pretty(pg_total_relation_size(oid)) as total_size,
                                          pg_total_relation_size(oid) as bytes
                                     from pg_class
                                    where relkind = 'r'
                                      and relnamespace = 'public'::regnamespace
                                    order by pg_total_relation_size(oid) desc
                                    limit 12`);

    return Array.from(rows as unknown as Array<{ table_name: string; total_size: string; bytes: number }>).map((row) => ({
      table_name: row.table_name,
      total_size: row.total_size,
      bytes: Number(row.bytes),
    }));
  } finally {
    await sql.end();
  }
}
