import { describe, expect, it } from 'vitest';

import { buildHistoricalResolutionCounts } from '../../src/lib/event-resolution-counts.js';
import type { EventCluster } from '../../src/types/event.js';
import type { MusashiMarket } from '../../src/types/market.js';

let _seq = 0;

function buildMarket(overrides: Partial<MusashiMarket> = {}): MusashiMarket {
  _seq++;
  return {
    id: `musashi-kalshi-m${_seq}`,
    platform: 'kalshi',
    platform_id: `M${_seq}`,
    event_id: 'TEST-EVENT',
    series_id: null,
    title: `Market ${_seq}`,
    description: null,
    category: 'economics',
    url: `https://kalshi.com/markets/m${_seq}`,
    yes_price: 0.5,
    no_price: 0.5,
    volume_24h: 0,
    open_interest: null,
    liquidity: null,
    spread: null,
    status: 'open',
    created_at: '2026-04-10T00:00:00Z',
    closes_at: '2026-05-01T00:00:00Z',
    settles_at: null,
    resolved: false,
    resolution: null,
    resolved_at: null,
    fetched_at: '2026-04-14T00:00:00Z',
    cache_hit: false,
    data_age_seconds: 0,
    ...overrides,
  };
}

describe('buildHistoricalResolutionCounts', () => {
  it('counts resolved historical markets that share an event_id, including rows outside the active cluster', () => {
    const activeMarket = buildMarket({ id: 'musashi-kalshi-active', event_id: 'FED-SEP' });
    const cluster: EventCluster = { cluster_id: 'FED-SEP', source: 'event_id', markets: [activeMarket] };

    const counts = buildHistoricalResolutionCounts(
      [cluster],
      [
        { id: activeMarket.id, event_id: 'FED-SEP' },
        { id: 'musashi-kalshi-resolved-1', event_id: 'FED-SEP' },
        { id: 'musashi-kalshi-resolved-2', event_id: 'FED-SEP' },
        { id: 'musashi-kalshi-other-event', event_id: 'FED-NOV' },
      ],
      new Set(['musashi-kalshi-resolved-1', 'musashi-kalshi-resolved-2', 'musashi-kalshi-other-event'])
    );

    expect(counts.get('FED-SEP')).toBe(2);
  });

  it('falls back to the singleton market ids for singleton clusters', () => {
    const market = buildMarket({ id: 'musashi-kalshi-singleton', event_id: null });
    const cluster: EventCluster = {
      cluster_id: `singleton:${market.id}`,
      source: 'singleton',
      markets: [market],
    };

    const counts = buildHistoricalResolutionCounts([cluster], [], new Set([market.id]));

    expect(counts.get(`singleton:${market.id}`)).toBe(1);
  });
});
