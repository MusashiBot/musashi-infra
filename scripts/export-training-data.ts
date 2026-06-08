import fs from 'fs';
import path from 'path';
import { getSupabase } from '../src/db/supabase.js';

// data model
type EventIntelligence = {
  event_id: string;
  event_title: string;
  category: string;
  description: string | null;
  probability: number;
  yes_price?: number | null;
  no_price?: number | null;
  volume_24h: number;
  liquidity?: number | null;
  created_at: string;
  updated_at: string;
  resolved: boolean;
  resolution_outcome?: 'YES' | 'NO' | null;
  resolved_at?: string | null;
  probability_history?: Array<{
    timestamp: string;
    probability: number;
  }>;
  polymarket_id?: string | null;
  kalshi_id?: string | null;
};

// output format
type TrainingExample = {
  event_id: string;
  text: string;
  category: string;
  features: Record<string, number | boolean | string>;
  outcome: {
    resolved: boolean;
    label: 0 | 1 | null;
    resolution_outcome: 'YES' | 'NO' | null;
  };
  metadata: {
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
  };
};

// gets EventIntelligence objects from supabase
async function fetchEventIntelligence(): Promise<EventIntelligence[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('event_intelligence')
    .select('*')
    .limit(500);

  if (error) {
    throw new Error(`Supabase fetch failed: ${error.message}`);
  }

  return data ?? [];
}

// Convert raw event to training row
function transform(e: EventIntelligence): TrainingExample {
  const label =
    e.resolved && e.resolution_outcome
      ? e.resolution_outcome === 'YES'
        ? 1
        : 0
      : null;

  const probabilityHistory = e.probability_history;
  const latestProbability = probabilityHistory?.length
    ? probabilityHistory[probabilityHistory.length - 1]?.probability ?? e.probability
    : e.probability;

  return {
    event_id: e.event_id,
    text: `${e.event_title}. ${e.description ?? ''}`.trim(),

    category: e.category,

    features: {
      probability: latestProbability,
      volume_24h: e.volume_24h,
      liquidity: e.liquidity ?? 0,

      yes_price: e.yes_price ?? 0,
      no_price: e.no_price ?? 0,

      log_volume: Math.log10(e.volume_24h + 1),
      title_length: e.event_title.length,
      has_number: /\d/.test(e.event_title),

      is_cross_listed: !!(e.polymarket_id && e.kalshi_id),
    },

    outcome: {
      resolved: e.resolved,
      label,
      resolution_outcome: e.resolution_outcome ?? null,
    },

    metadata: {
      created_at: e.created_at,
      updated_at: e.updated_at,
      resolved_at: e.resolved_at ?? null,
    },
  };
}

async function main() {
  console.log('Exporting Musashi training dataset');
  const events = await fetchEventIntelligence();
  console.log(`Loaded ${events.length} events`);

  const dataset = events.map(transform);
  const outputPath = path.join(process.cwd(), 'training-dataset.json');

  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2));
  console.log('Wrote dataset:', outputPath);
  console.log('Sample:', dataset[0]);
}

main().catch((err) => {
  console.error('Export failed:', err);
  process.exit(1);
});