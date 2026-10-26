// Shared status area of the analysis views: progress, cancelled, failure/timeout and the stale banner.
import React from 'react';
import type { AnalysisState } from './useAnalysisJob';

/** "label done / total" with a progress bar; ``fallbackTotal`` before the first progress report. */
export function ProgressCount({
  label,
  progress,
  fallbackTotal,
}: {
  label: string;
  progress?: { done: number; total: number };
  fallbackTotal: number;
}) {
  return (
    <>
      {label} {progress?.done ?? 0} / {progress?.total ?? fallbackTotal}
      <progress value={progress?.done ?? 0} max={progress?.total || 1} />
    </>
  );
}

export default function AnalysisStatus({
  state,
  running,
  progress,
  progressTestId,
  cancelledText,
  stale,
  staleText,
  staleTestId,
}: {
  state: AnalysisState;
  running: boolean;
  progress: React.ReactNode;
  progressTestId?: string;
  cancelledText: string;
  stale: boolean;
  staleText: string;
  staleTestId: string;
}) {
  return (
    <>
      {running && (
        <div className="analysis-progress" data-testid={progressTestId}>
          {progress}
        </div>
      )}
      {state.status === 'cancelled' && <div className="tip">{cancelledText}</div>}
      {(state.status === 'failed' || state.status === 'timeout') && (
        <div className="field-error">{state.error}</div>
      )}
      {stale && (
        <div className="stale-banner" data-testid={staleTestId}>
          {staleText}
        </div>
      )}
    </>
  );
}
