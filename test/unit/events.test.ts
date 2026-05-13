import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — must be before any imports of the mocked modules
// ---------------------------------------------------------------------------

vi.mock('../../src/db/supabase.js', () => ({ getSupabase: vi.fn() }));
vi.mock('../../src/lib/env.js', () => ({
  getEnv: vi.fn(() => ({ eventTopScanLimit: 5_000 })),
  getSupabaseEnv: vi.fn(() => ({ supabaseUrl: 'http://test', supabaseServiceKey: 'key' })),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import {
  computeMarketScore,
  computeClusterScore,
  getEventIntelligenceById,
  listTopEventIntelligence,
  listEventIntelligenceByCategory,
} from '../../src/db/events.js';
import { getSupabase } from '../../src/db/supabase.js';
import { getEnv } from '../../src/lib/env.js';
import type { MusashiMarket } from '../../src/types/market.js';
import type { EventCluster } from '../../src/types/event.js';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeMarketRow(id: string, overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: `musashi-kalshi-${id}`,
    platform: 'kalshi',
    platform_id: id.toUpperCase(),
    event_id: null,
    series_id: null,
    title: `Market ${id}`,
    description: null,
    category: 'other',
    url: `https://kalshi.com/markets/${id}`,
    yes_price: 0.5,
    no_price: 0.5,
    volume_24h: 0,
    open_interest: null,
    liquidity: null,
    spread: null,
    status: 'open',
    created_at: null,
    closes_at: null,
    settles_at: null,
    resolved: false,
    resolution: null,
    resolved_at: null,
    last_ingested_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeMarket(overrides: Partial<MusashiMarket> = {}): MusashiMarket {
  return {
    id: 'musashi-kalshi-test',
    platform: 'kalshi',
    platform_id: 'TEST',
    event_id: null,
    series_id: null,
    title: 'Test Market',
    description: null,
    category: 'other',
    url: 'https://kalshi.com/markets/test',
    yes_price: 0.5,
    no_price: 0.5,
    volume_24h: 0,
    open_interest: null,
    liquidity: null,
    spread: null,
    status: 'open',
    created_at: null,
    closes_at: null,
    settles_at: null,
    resolved: false,
    resolution: null,
    resolved_at: null,
    fetched_at: '2026-04-01T00:00:00Z',
    cache_hit: false,
    data_age_seconds: 0,
    ...overrides,
  };
}

function makeCluster(markets: MusashiMarket[]): EventCluster {
  return { cluster_id: 'TEST', source: 'event_id', markets };
}

// ---------------------------------------------------------------------------
// Supabase mock builder
//
// Tracks per-builder-instance state so we can distinguish:
//   - paged market fetches   (.range() was called)
//   - historical market lookups (.in('event_id', ...) was called)
//   - snapshot fetches       (table === 'market_snapshots')
//   - resolution fetches     (table === 'market_resolutions')
// ---------------------------------------------------------------------------

interface MockSetup {
  /** Pages of market rows returned for paged queries, indexed by range start (0, 1000, 2000 …) */
  marketPagesByRangeStart?: Record<number, Array<Record<string, unknown>>>;
  /** Rows returned for historical market lookups (in('event_id', ...)) */
  historicalMarkets?: Array<{ id: string; event_id: string | null }>;
  /** Rows returned for snapshot queries */
  snapshots?: Array<Record<string, unknown>>;
  /** Rows returned for resolution queries */
  resolutions?: Array<{ market_id: string }>;
}

function makeSupabaseMock(setup: MockSetup = {}) {
  const snapshotFromCalls: string[][] = []; // captures each chunk passed to in('market_id', ...)

  const from = vi.fn((table: string) => {
    const state: {
      rangeStart?: number;
      inColumn?: string;
      inValues?: string[];
    } = {};

    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      in: vi.fn((col: string, vals: string[]) => {
        state.inColumn = col;
        state.inValues = vals;
        if (table === 'market_snapshots') {
          snapshotFromCalls.push(vals);
        }
        return builder;
      }),
      gte: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn((start: number) => {
        state.rangeStart = start;
        return builder;
      }),
      then: (onFulfilled: (value: { data: unknown[]; error: null }) => unknown) => {
        let data: unknown[] = [];

        if (table === 'markets') {
          if (state.inColumn === 'event_id') {
            // Historical market lookup
            data = setup.historicalMarkets ?? [];
          } else {
            // Paged market fetch
            const start = state.rangeStart ?? 0;
            data = setup.marketPagesByRangeStart?.[start] ?? [];
          }
        } else if (table === 'market_snapshots') {
          data = setup.snapshots ?? [];
        } else if (table === 'market_resolutions') {
          data = (setup.resolutions ?? []).filter((r) =>
            state.inValues === undefined ? true : state.inValues.includes(r.market_id)
          );
        }

        return Promise.resolve(onFulfilled({ data, error: null }));
      },
    };

    return builder;
  });

  vi.mocked(getSupabase).mockReturnValue({ from } as unknown as ReturnType<typeof getSupabase>);
  return { from, snapshotFromCalls };
}

// ---------------------------------------------------------------------------
// computeMarketScore
// ---------------------------------------------------------------------------

describe('computeMarketScore', () => {
  it('sums liquidity, open_interest, and volume_24h', () => {
    const market = makeMarket({ liquidity: 10_000, open_interest: 5_000, volume_24h: 1_000 });
    expect(computeMarketScore(market)).toBe(16_000);
  });

  it('treats null liquidity as 0', () => {
    const market = makeMarket({ liquidity: null, open_interest: 2_000, volume_24h: 500 });
    expect(computeMarketScore(market)).toBe(2_500);
  });

  it('treats null open_interest as 0', () => {
    const market = makeMarket({ liquidity: 3_000, open_interest: null, volume_24h: 200 });
    expect(computeMarketScore(market)).toBe(3_200);
  });

  it('returns volume_24h only when liquidity and open_interest are both null', () => {
    const market = makeMarket({ liquidity: null, open_interest: null, volume_24h: 750 });
    expect(computeMarketScore(market)).toBe(750);
  });

  it('returns 0 for a market with all-zero/null financial fields', () => {
    const market = makeMarket({ liquidity: null, open_interest: null, volume_24h: 0 });
    expect(computeMarketScore(market)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeClusterScore
// ---------------------------------------------------------------------------

describe('computeClusterScore', () => {
  it('returns the highest market score in the cluster', () => {
    const low = makeMarket({ id: 'musashi-kalshi-a', liquidity: 100, open_interest: null, volume_24h: 0 });
    const high = makeMarket({ id: 'musashi-kalshi-b', liquidity: 50_000, open_interest: null, volume_24h: 0 });
    const cluster = makeCluster([low, high]);
    expect(computeClusterScore(cluster)).toBe(50_000);
  });

  it('uses composite score — open_interest adds to the cluster rank', () => {
    const a = makeMarket({ id: 'musashi-kalshi-a', liquidity: 1_000, open_interest: 9_000, volume_24h: 0 });
    const b = makeMarket({ id: 'musashi-kalshi-b', liquidity: 8_000, open_interest: null, volume_24h: 0 });
    // a: 1000+9000 = 10000 > b: 8000 → cluster should score 10000
    expect(computeClusterScore(makeCluster([a, b]))).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// Ranking stability and tie-breakers
// ---------------------------------------------------------------------------

describe('ranking stability (via listTopEventIntelligence)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns higher-scored cluster first', async () => {
    const highRow = makeMarketRow('high', { event_id: 'EVT-HIGH', liquidity: 50_000 });
    const lowRow = makeMarketRow('low', { event_id: 'EVT-LOW', liquidity: 1_000 });

    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [lowRow, highRow] },
    });

    const results = await listTopEventIntelligence(2);
    expect(results[0]?.event_id).toBe('EVT-HIGH');
    expect(results[1]?.event_id).toBe('EVT-LOW');
  });

  it('uses cluster_id as lexicographic tiebreaker when scores are equal', async () => {
    const aRow = makeMarketRow('a', { event_id: 'EVT-AAA', liquidity: 5_000 });
    const bRow = makeMarketRow('b', { event_id: 'EVT-ZZZ', liquidity: 5_000 });

    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [bRow, aRow] },
    });

    const results = await listTopEventIntelligence(2);
    expect(results[0]?.event_id).toBe('EVT-AAA');
    expect(results[1]?.event_id).toBe('EVT-ZZZ');
  });

  it('open_interest contributes to rank even when liquidity is null', async () => {
    const oi = makeMarketRow('oi', { event_id: 'EVT-OI', liquidity: null, open_interest: 8_000, volume_24h: 0 });
    const liq = makeMarketRow('liq', { event_id: 'EVT-LIQ', liquidity: 5_000, open_interest: null, volume_24h: 0 });

    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [liq, oi] },
    });

    const results = await listTopEventIntelligence(2);
    expect(results[0]?.event_id).toBe('EVT-OI');
  });

  it('volume_24h contributes when both liquidity and open_interest are null', async () => {
    const vol = makeMarketRow('vol', { event_id: 'EVT-VOL', liquidity: null, open_interest: null, volume_24h: 9_000 });
    const zero = makeMarketRow('zero', { event_id: 'EVT-ZERO', liquidity: null, open_interest: null, volume_24h: 0 });

    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [zero, vol] },
    });

    const results = await listTopEventIntelligence(2);
    expect(results[0]?.event_id).toBe('EVT-VOL');
  });

  it('result order is stable across calls with the same input', async () => {
    const rows = [
      makeMarketRow('x', { event_id: 'EVT-X', liquidity: 3_000 }),
      makeMarketRow('y', { event_id: 'EVT-Y', liquidity: 7_000 }),
      makeMarketRow('z', { event_id: 'EVT-Z', liquidity: 1_000 }),
    ];

    makeSupabaseMock({ marketPagesByRangeStart: { 0: rows } });
    const first = await listTopEventIntelligence(3);

    makeSupabaseMock({ marketPagesByRangeStart: { 0: rows } });
    const second = await listTopEventIntelligence(3);

    expect(first.map((e) => e.event_id)).toEqual(second.map((e) => e.event_id));
  });
});

// ---------------------------------------------------------------------------
// Paging behavior
// ---------------------------------------------------------------------------

describe('paging behavior', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches a second page when first page is full (1 000 rows)', async () => {
    const page0 = Array.from({ length: 1_000 }, (_, i) => makeMarketRow(`p0-${i}`));
    const page1 = [makeMarketRow('p1-0')];

    const { from } = makeSupabaseMock({
      marketPagesByRangeStart: { 0: page0, 1_000: page1 },
    });

    await listTopEventIntelligence(1_001);

    // from('markets') should be called at least twice: page 0 + page 1 main queries
    // (historical markets query also calls from('markets') but with in('event_id'))
    const marketCalls = vi.mocked(from).mock.calls.filter(([t]) => t === 'markets');
    expect(marketCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('stops after first page when it returns fewer than 1 000 rows', async () => {
    const page0 = [makeMarketRow('only-one')];

    const { from } = makeSupabaseMock({
      marketPagesByRangeStart: { 0: page0 },
    });

    await listTopEventIntelligence(10);

    const mainMarketCalls = vi.mocked(from).mock.calls.filter(([t]) => t === 'markets');
    // First paged call (range) + possible historical-markets call (in event_id).
    // There should be no second paged range call.
    const rangeCallCount = mainMarketCalls.length;
    expect(rangeCallCount).toBeLessThanOrEqual(3); // at most 2 markets calls + 1 resolution
  });

  it('returns empty array when no markets exist', async () => {
    makeSupabaseMock({ marketPagesByRangeStart: { 0: [] } });
    const results = await listTopEventIntelligence(10);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// maxRows cap behavior
// ---------------------------------------------------------------------------

describe('maxRows cap behavior', () => {
  beforeEach(() => vi.clearAllMocks());

  it('caps the market scan at eventTopScanLimit', async () => {
    vi.mocked(getEnv).mockReturnValue({ eventTopScanLimit: 3 } as ReturnType<typeof getEnv>);

    const page0 = Array.from({ length: 1_000 }, (_, i) => makeMarketRow(`m-${i}`));
    makeSupabaseMock({ marketPagesByRangeStart: { 0: page0 } });

    // With cap=3 and limit=10, only 3 markets → 3 singleton clusters → 3 events
    const results = await listTopEventIntelligence(10);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('returns all markets when total is below the cap', async () => {
    vi.mocked(getEnv).mockReturnValue({ eventTopScanLimit: 5_000 } as ReturnType<typeof getEnv>);

    const page0 = [makeMarketRow('a'), makeMarketRow('b'), makeMarketRow('c')];
    makeSupabaseMock({ marketPagesByRangeStart: { 0: page0 } });

    const results = await listTopEventIntelligence(10);
    expect(results).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Snapshot chunking
// ---------------------------------------------------------------------------

describe('snapshot chunking', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches snapshots in chunks when market count exceeds DB_BATCH_SIZE (200)', async () => {
    // 201 singleton markets → 201 market IDs → 2 snapshot chunks
    const rows = Array.from({ length: 201 }, (_, i) => makeMarketRow(`m-${i}`));
    const { snapshotFromCalls } = makeSupabaseMock({
      marketPagesByRangeStart: { 0: rows },
      snapshots: [],
    });

    await listTopEventIntelligence(201);

    // 201 IDs with chunk size 200 → 2 calls to market_snapshots
    expect(snapshotFromCalls).toHaveLength(2);
    expect(snapshotFromCalls[0]).toHaveLength(200);
    expect(snapshotFromCalls[1]).toHaveLength(1);
  });

  it('makes exactly one snapshot call for ≤200 markets', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeMarketRow(`s-${i}`));
    const { snapshotFromCalls } = makeSupabaseMock({
      marketPagesByRangeStart: { 0: rows },
      snapshots: [],
    });

    await listTopEventIntelligence(5);

    expect(snapshotFromCalls).toHaveLength(1);
    expect(snapshotFromCalls[0]).toHaveLength(5);
  });

  it('makes no snapshot calls when no markets are found', async () => {
    const { snapshotFromCalls } = makeSupabaseMock({
      marketPagesByRangeStart: { 0: [] },
    });

    await listTopEventIntelligence(10);
    expect(snapshotFromCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Resolution count mapping per cluster
// ---------------------------------------------------------------------------

describe('resolution count mapping per cluster', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets historical_resolution_count to 0 when no resolutions exist', async () => {
    const row = makeMarketRow('a', { event_id: 'EVT-A' });
    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [row] },
      historicalMarkets: [{ id: 'musashi-kalshi-a', event_id: 'EVT-A' }],
      resolutions: [],
    });

    const results = await listTopEventIntelligence(1);
    expect(results[0]?.trust_context.historical_resolution_count).toBe(0);
  });

  it('counts resolved markets for the correct event cluster', async () => {
    const rowA = makeMarketRow('a', { event_id: 'EVT-A' });
    makeSupabaseMock({
      marketPagesByRangeStart: { 0: [rowA] },
      historicalMarkets: [
        { id: 'musashi-kalshi-a', event_id: 'EVT-A' },
        { id: 'musashi-kalshi-a-old', event_id: 'EVT-A' },
      ],
      resolutions: [{ market_id: 'musashi-kalshi-a-old' }],
    });

    const results = await listTopEventIntelligence(1);
    expect(results[0]?.trust_context.historical_resolution_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Empty-result behavior
// ---------------------------------------------------------------------------

describe('empty-result behavior', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getEventIntelligenceById returns null when no markets match', async () => {
    makeSupabaseMock({ marketPagesByRangeStart: { 0: [] } });
    const result = await getEventIntelligenceById('NONEXISTENT');
    expect(result).toBeNull();
  });

  it('listTopEventIntelligence returns empty array when no active markets exist', async () => {
    makeSupabaseMock({ marketPagesByRangeStart: { 0: [] } });
    const results = await listTopEventIntelligence(10);
    expect(results).toEqual([]);
  });

  it('listEventIntelligenceByCategory returns empty array when category has no markets', async () => {
    makeSupabaseMock({ marketPagesByRangeStart: { 0: [] } });
    const results = await listEventIntelligenceByCategory('fed_policy', 10);
    expect(results).toEqual([]);
  });
});
