import { getEnv } from '../lib/env.js';
import { runResolutionCheck } from './resolution-check.js';

export interface ResolutionBackfillSummary {
  started_at: string;
  completed_at: string;
  runs_attempted: number;
  runs_completed: number;
  total_markets_checked: number;
  total_resolutions_detected: number;
  total_errors: number;
  stopped_reason: 'max_runs_reached' | 'max_duration_reached' | 'run_failed';
  last_run_status: string | null;
}

export async function backfillResolutions(): Promise<ResolutionBackfillSummary> {
  const env = getEnv();
  const startedAt = new Date();
  const deadline = startedAt.getTime() + env.resolutionBackfillMaxDurationMs;

  let runsCompleted = 0;
  let totalMarketsChecked = 0;
  let totalResolutionsDetected = 0;
  let totalErrors = 0;
  let lastRunStatus: string | null = null;
  let stoppedReason: ResolutionBackfillSummary['stopped_reason'] = 'max_runs_reached';

  for (let runIndex = 0; runIndex < env.resolutionBackfillMaxRuns; runIndex += 1) {
    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    const run = await runResolutionCheck();
    runsCompleted += 1;
    lastRunStatus = run.status;
    totalMarketsChecked += run.kalshi_markets_fetched;
    totalResolutionsDetected += run.resolutions_detected;
    totalErrors += run.kalshi_errors;

    if (run.status === 'failed') {
      stoppedReason = 'run_failed';
      break;
    }

    if (Date.now() >= deadline) {
      stoppedReason = 'max_duration_reached';
      break;
    }

    if (runIndex === env.resolutionBackfillMaxRuns - 1) {
      stoppedReason = 'max_runs_reached';
    }
  }

  return {
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    runs_attempted: env.resolutionBackfillMaxRuns,
    runs_completed: runsCompleted,
    total_markets_checked: totalMarketsChecked,
    total_resolutions_detected: totalResolutionsDetected,
    total_errors: totalErrors,
    stopped_reason: stoppedReason,
    last_run_status: lastRunStatus,
  };
}
