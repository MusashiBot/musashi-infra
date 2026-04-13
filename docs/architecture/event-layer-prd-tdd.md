# Event Layer PRD + TDD

## Purpose
Build the first Musashi `event layer`.

Today the system stores raw prediction markets well. That is not enough for agents.
Agents do not want dozens of raw market rows. They want one clean object that answers:

- What is the market saying about this event?
- What changed recently?
- What related markets confirm or contradict it?
- How trustworthy is this market signal?

This document defines the first version of that layer.

## Prediction Market Basics
- A `market` is a question with a tradable probability, usually yes/no.
- Example: `Will the Fed cut rates by September?`
- A market price near `0.70` means the market is implying roughly `70%`.
- Multiple markets can refer to the same real-world event.

Musashi already stores:
- `markets`: current market registry
- `market_snapshots`: price history over time
- `market_resolutions`: final outcomes for resolved markets

The event layer sits on top of that.

## Problem
Raw markets are too messy for agents because:
- many markets are near-duplicates
- related markets are not grouped
- there is no event-level summary
- there is no clear contradiction/confirmation view
- there is no trust context

## Goal
Create one `Event Intelligence Object` that an agent can read directly.

The object should summarize one real-world event using related Kalshi markets.

## Non-Goals
Do not build these in this task:
- Polymarket support
- X/Twitter sentiment
- news ingestion
- trading/execution
- frontend/UI
- full semantic ontology for every domain
- LLM-generated explanations in production

This task is only about event grouping + event object generation from existing Musashi market data.

## Primary User
AI builders and agent developers.

They need a structured object, not a chart or dashboard.

## Core Output
The intern should produce the first version of this object:

```ts
interface EventIntelligence {
  event_id: string;
  event_title: string;
  category: string | null;
  primary_market_id: string;
  primary_market_title: string;
  current_probability: number | null;
  probability_change_24h: number | null;
  probability_change_7d: number | null;
  closes_at: string | null;
  related_markets: Array<{
    market_id: string;
    title: string;
    relation: 'confirming' | 'contradicting' | 'related';
    current_probability: number | null;
  }>;
  trust_context: {
    liquidity: number | null;
    volume_24h: number | null;
    open_interest: number | null;
    historical_resolution_count: number;
    confidence_label: 'low' | 'medium' | 'high';
  };
}
```

The exact field names may change slightly, but the shape and intent should stay close to this.

## Scope
### In scope
- define how to cluster markets into an event
- define how to choose a primary market for an event
- define a first event object
- implement read-side code that builds the object from existing DB data
- add tests
- add a short runbook/dev note

### Out of scope
- changing ingestion
- changing Kalshi client logic
- building a public API
- adding external data sources

## Functional Requirements
### FR1. Event clustering
Group related markets into the same event cluster.

Minimum acceptable clustering logic:
- markets with the same `event_id` should cluster together first
- if `event_id` is missing or weak, use fallback grouping with safe heuristics only
- do not use fuzzy LLM grouping in this first version

### FR2. Primary market selection
Each event must have one `primary_market`.

Choose the best market using deterministic rules, for example:
- highest liquidity
- then highest open interest
- then highest 24h volume
- then nearest close date

### FR3. Current event state
The object must show:
- current implied probability from the primary market
- event title
- event category
- close time

### FR4. Change summary
The object must show:
- probability change over 24 hours
- probability change over 7 days

If snapshot history is insufficient, return `null` safely.

### FR5. Related markets
Include a list of related markets in the same cluster.

Each related market should be labeled:
- `confirming`
- `contradicting`
- `related`

First version can use simple deterministic logic:
- same directional implication -> `confirming`
- opposing directional implication -> `contradicting`
- otherwise `related`

If strong contradiction logic cannot be done safely yet, default to `related` rather than inventing meaning.

### FR6. Trust context
The object must include a basic trust view.

First version should use available fields only:
- liquidity
- volume_24h
- open_interest
- number of historically resolved similar markets if available

Map this into a simple confidence label:
- `high`
- `medium`
- `low`

Rule-based is fine for v1.

## Data Inputs
Use only existing Musashi tables:
- `markets`
- `market_snapshots`
- `market_resolutions`

The intern may create read helpers and derived types, but should not change schema unless absolutely necessary.

## Suggested Deliverable Shape
The intern should open one PR that includes:
- event-layer types
- event clustering/read logic
- event object builder
- tests
- one short doc explaining assumptions and limits

## Suggested File Ownership
Recommended new files:
- `src/types/event.ts`
- `src/lib/event-clustering.ts`
- `src/lib/event-intelligence.ts`
- `test/unit/event-clustering.test.ts`
- `test/unit/event-intelligence.test.ts`
- optional short doc under `docs/architecture/` or `docs/operations/`

This is guidance, not a hard requirement.

## TDD Requirements
The intern should write tests first or at least commit tests as part of the same PR.

### Required tests
#### 1. Event clustering tests
- groups markets with the same `event_id`
- does not merge unrelated markets
- handles missing/blank `event_id` safely

#### 2. Primary market selection tests
- picks the most liquid market when multiple markets exist
- falls back deterministically when liquidity is tied or missing

#### 3. Change summary tests
- computes 24h change from snapshots correctly
- computes 7d change from snapshots correctly
- returns `null` when not enough history exists

#### 4. Related market labeling tests
- returns `confirming` when relation is clearly aligned
- returns `related` as safe fallback when contradiction is unclear
- does not over-classify weak relations

#### 5. Trust context tests
- returns `high`, `medium`, `low` deterministically from rule-based input
- handles missing liquidity/volume/open interest safely

#### 6. Event object contract test
- building an event object returns the required fields
- nullability is stable and explicit
- no field is silently omitted

## Acceptance Criteria
The PR is acceptable only if:
- event objects can be built from existing stored market data
- logic is deterministic and explainable
- tests cover the requirements above
- `npm run typecheck` passes
- `npm test` passes
- no ingestion logic is changed
- no fake LLM logic is used for clustering or explanation

## Implementation Notes
- Prefer deterministic heuristics over cleverness
- Use current Musashi data as the source of truth
- If a value is uncertain, return `null` or `related`
- Do not invent semantic confidence that the data does not support
- Keep v1 boring, stable, and testable

## Simple Definition of Success
After this PR, an engineer should be able to give Musashi one market or event identifier and receive one clean event object that explains:
- what the main market says now
- how it changed recently
- what nearby markets say
- how much the agent should trust the signal

That is the first real Musashi event primitive for agents.
