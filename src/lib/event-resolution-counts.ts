import type { EventCluster } from '../types/event.js';

export interface HistoricalEventMarket {
  id: string;
  event_id: string | null;
}

export function buildHistoricalResolutionCounts(
  clusters: EventCluster[],
  historicalMarkets: HistoricalEventMarket[],
  resolvedMarketIds: Set<string>
): Map<string, number> {
  const resolvedIdsByEvent = new Map<string, Set<string>>();

  for (const market of historicalMarkets) {
    const eventId = market.event_id?.trim();
    if (!eventId || !resolvedMarketIds.has(market.id)) {
      continue;
    }

    const existing = resolvedIdsByEvent.get(eventId);
    if (existing !== undefined) {
      existing.add(market.id);
    } else {
      resolvedIdsByEvent.set(eventId, new Set([market.id]));
    }
  }

  const counts = new Map<string, number>();

  for (const cluster of clusters) {
    if (cluster.source === 'event_id') {
      counts.set(cluster.cluster_id, resolvedIdsByEvent.get(cluster.cluster_id)?.size ?? 0);
      continue;
    }

    counts.set(cluster.cluster_id, cluster.markets.filter((market) => resolvedMarketIds.has(market.id)).length);
  }

  return counts;
}
