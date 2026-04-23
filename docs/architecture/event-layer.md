# Event Layer — v1 Architecture Notes

## What this is

The event layer sits on top of the existing `markets`, `market_snapshots`, and
`market_resolutions` tables. It does not change ingestion logic or schema. It is
a read-side transformation that produces one clean `EventIntelligence` object per
real-world event — the primary primitive for agent consumers.

## Files

| File | Purpose |
|---|---|
| `src/types/event.ts` | `EventCluster`, `EventIntelligence`, and helper union types |
| `src/lib/event-clustering.ts` | `clusterMarkets()`, `selectPrimaryMarket()` |
| `src/lib/event-intelligence.ts` | `buildEventIntelligence()`, `computeProbabilityChange()`, `computeConfidenceLabel()`, `labelRelation()` |
| `test/unit/event-clustering.test.ts` | Unit tests for clustering and primary-market selection |
| `test/unit/event-intelligence.test.ts` | Unit tests for probability change, confidence, relation, and full object contract |

## Design decisions

### Clustering (FR1)

Markets are grouped by `event_id` when the field is non-null and non-blank.
Markets with a missing or blank `event_id` become singleton clusters — one
market, one event. We do not attempt fuzzy title matching or LLM-based grouping
in v1.

**Why:** Safe defaults over clever guesses. False merges would silently corrupt
the event object; false splits are harmless and easy to debug.

### Primary market selection (FR2)

Deterministic, tie-broken in order:
1. Highest `liquidity` (nulls last)
2. Highest `open_interest` (nulls last)
3. Highest `volume_24h`
4. Earliest `closes_at` (nulls last)
5. Lexicographic `id` (final stable tiebreaker)

**Why:** The most liquid market tends to have the most price discovery. Volume
and close time are secondary signals. The `id` tiebreaker ensures two identical
runs on identical data return the same result.

### Probability change (FR4)

`computeProbabilityChange(marketId, snapshots, hoursBack)` returns
`currentYesPrice - pastYesPrice`, or `null` when:
- fewer than two snapshots exist for the market, or
- no snapshot falls within the proximity window (see below).

"Past" is the snapshot with the smallest time-distance to
`latestSnapshotTime - hoursBack`. This approach is tolerant of irregular
snapshot cadences.

**Proximity guard (`LOOKBACK_TOLERANCE_RATIO = 0.5`):** The reference snapshot
must land within 50% of the window from the target time. For a 24h request the
reference must be between 12h and 36h ago; for a 7d request between 3.5d and
10.5d ago. Without this guard, two snapshots seconds apart could produce a
plausible-looking 7-day change from essentially no history.

**Assumption:** Snapshot times are stored with enough resolution that
`String.prototype.localeCompare` ordering is correct. This holds for ISO 8601
strings.

### Relation labeling (FR5)

| Primary `yes_price` | Related `yes_price` | Label |
|---|---|---|
| ≥ 0.60 (bullish) | ≥ 0.60 (bullish) | `confirming` |
| ≤ 0.40 (bearish) | ≤ 0.40 (bearish) | `confirming` |
| ≥ 0.60 (bullish) | ≤ 0.40 (bearish) | `contradicting` |
| ≤ 0.40 (bearish) | ≥ 0.60 (bullish) | `contradicting` |
| anything else | anything else | `related` |

Markets in the 0.40–0.60 ambiguous zone are labeled `related` to avoid
over-classification. This means most related markets will be `related` in
practice — that is intentional for v1.

### Confidence label (FR6)

Rule-based thresholds. Tune these constants in `event-intelligence.ts` as real
Kalshi liquidity distributions become better understood.

| Condition | Label |
|---|---|
| `liquidity >= 10 000` AND `volume_24h >= 1 000` | `high` |
| `liquidity >= 1 000` OR `volume_24h >= 100` | `medium` |
| everything else (including all-null) | `low` |

`open_interest` is surfaced in `trust_context` for consumers but is not used in
the confidence label formula in v1 — its distribution on Kalshi is not yet well
characterised.

## How to test

### Unit tests

Covers all logic (clustering, primary selection, probability change, confidence
label, relation labeling, full object contract). No DB required.

```bash
npm test
```

### Smoke test against real DB data

```bash
# Top 5 active events by liquidity (default)
npm run event:show

# One specific event_id
npm run event:show -- --event-id FED-SEP-2025

# Active markets in a category
npm run event:show -- --category fed_policy

# Show more events
npm run event:show -- --limit 20
```

Diagnostic counts (markets fetched, snapshots fetched, clusters formed,
historical resolutions found) go to stderr. The `EventIntelligence[]` JSON goes
to stdout, so you can pipe it:

```bash
npm run event:show -- --limit 1 | jq '.[0].trust_context'
```

**What to look for:**

| Field | Healthy signal |
|---|---|
| `related_markets` | Non-empty for Kalshi events with multiple contracts |
| `probability_change_24h` | Non-null only when a snapshot lands within ±12h of the 24h-ago mark |
| `probability_change_7d` | `null` is normal until ≥7 days of history; also null if no snapshot is within ±84h of the 7d-ago mark |
| `trust_context.confidence_label` | Varies between `low` / `medium` / `high` across markets |
| `trust_context.historical_resolution_count` | Count of resolved markets within this specific cluster, not a global total |
| `event_id` | Real Kalshi `event_ticker` values for grouped markets |

**Red flag:** If every cluster has an `event_id` starting with `singleton:`, the
stored `markets` rows have no `event_id` populated — check ingestion.

## Operational notes

### DB querying constraints

- **No index on `liquidity`.** `ORDER BY liquidity` at the DB level causes a full
  table scan and hits the statement timeout. The smoke script pages through the
  active market selection, then sorts by primary-market liquidity in JavaScript.
  If a DB-level sort is needed in future, add an index on `markets(liquidity)`.

- **`fetched_at`, `cache_hit`, `data_age_seconds` are not stored.** These fields
  exist on `MusashiMarket` for API responses but are never written to the `markets`
  table. Scripts that query the DB directly must select only the persisted columns
  and fill these in with neutral defaults (`cache_hit: false`, `data_age_seconds: 0`,
  `fetched_at` mapped from `last_ingested_at`).

### Node.js version

The `@supabase/supabase-js` client requires Node.js ≥ 20. Node 18 works but
prints a deprecation warning and will stop being supported in a future Supabase
client release. Use `nvm install 20 && nvm alias default 20` to upgrade.

## Known weaknesses / v2 ideas

1. **Singleton sprawl.** Kalshi markets without an `event_id` each become their
   own cluster. If Kalshi populates `event_id` inconsistently, the clustering
   becomes fragmented. A title-similarity pass (deterministic, not LLM) could
   close this gap.

2. **Confidence thresholds are guesses.** The 10 000 / 1 000 / 100 values were
   chosen without seeing real Kalshi liquidity distributions. The first step
   toward better calibration is a percentile analysis over stored `market_snapshots`.

3. **Relation labeling is coarse.** Prediction markets for the same event often
   ask complementary questions (e.g. "cut by 25bp" vs "cut by 50bp"). Their
   `yes_price` values can both be low without being contradictory. In v2, title
   parsing or market metadata could allow more nuanced labeling.

4. **No DB-backed entry point.** `buildEventIntelligence` is a pure function —
   callers must supply the cluster and snapshots. A thin `getEventIntelligence(eventId)`
   function backed by Supabase queries is the obvious next step for agent
   consumption.

5. **7d changes need longer snapshot history.** The 7-day change will be `null`
   for most markets until the system has been running long enough to have 7+ days
   of snapshots within the proximity window. This is expected behaviour, not a bug.
