# feat: event intelligence layer v1

## Summary

- Builds the first Musashi `EventIntelligence` object — a clean, agent-readable summary of a real-world event derived from existing `markets`, `market_snapshots`, and `market_resolutions` data
- No ingestion logic, schema, or Kalshi client touched — read-side transformation only
- 128 unit tests passing, `npm run typecheck` clean

## What was built

### Types (`src/types/event.ts`)
- `EventCluster` — internal grouping of markets around one event; `source` is `'event_id' | 'series_id' | 'singleton'`
- `EventIntelligence` — the primary agent-facing output object
- `RelatedMarket`, `TrustContext`, `RelationLabel`, `ConfidenceLabel`

### Clustering (`src/lib/event-clustering.ts`)
Three-tier deterministic strategy:
1. Group by `event_id` (non-blank)
2. Fallback: group by `series_id` (non-blank) for markets with no `event_id`
3. Fallback: singleton cluster per market

Primary market selection is fully deterministic — tie-broken by liquidity → open_interest → volume_24h → closes_at → lexicographic id.

### Event object builder (`src/lib/event-intelligence.ts`)
- `buildEventIntelligence(cluster, snapshots, resolutionCount)` — pure function, no DB calls
- `computeProbabilityChange` — 24h and 7d price deltas with a proximity guard (`LOOKBACK_TOLERANCE_RATIO = 0.5`) that prevents spurious changes when snapshot history is sparse
- `computeConfidenceLabel` — rule-based `low / medium / high` using liquidity, open_interest, and volume_24h
- `labelRelation` — `confirming / contradicting / related` based on yes_price alignment

### Smoke-test script (`scripts/show-event-intelligence.ts`)
```bash
npm run event:show                        # top 5 events
npm run event:show -- --event-id FED-SEP  # specific event
npm run event:show -- --category fed_policy
npm run event:show -- --limit 20
```

## Changes from review

- `series_id` fallback added to clustering (reduces singleton sprawl)
- `settles_at` added to `EventIntelligence` (distinct from `closes_at`)
- `open_interest` now factors into confidence label as a liquidity proxy
- Proximity guard added to `computeProbabilityChange` — returns `null` rather than a misleading delta when the reference snapshot is too far from the target window

## Files changed

`src/types/event.ts`, `src/lib/event-clustering.ts`, `src/lib/event-intelligence.ts`, `test/unit/event-clustering.test.ts`, `test/unit/event-intelligence.test.ts`, `scripts/show-event-intelligence.ts`, `docs/architecture/event-layer.md`, `package.json`

## Known limitations (v2 work)

- Confidence thresholds (10k / 5k / 1k / 100) are estimated — need a percentile analysis over real Kalshi data to calibrate
- Relation labeling is conservative — complementary contracts (e.g. "cut 25bp" vs "cut 50bp") both land at `related` when their prices are ambiguous
- No DB-backed entry point yet — `buildEventIntelligence` is pure; a `getEventIntelligence(eventId)` wrapper backed by Supabase is the obvious next step
- 7d probability change will be `null` for most markets until 7+ days of snapshots exist
