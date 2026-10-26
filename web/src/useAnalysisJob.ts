// Analysis job lifecycle: start, poll progress, cancel. Late replies from a superseded run are ignored
// (same run-intent rule as the solve job); unmounting cancels the running process.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export type AnalysisState = {
  status: 'idle' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  progress?: { done: number; total: number };
  result?: any;
  error?: string;
  /** JSON of the frozen model the analysis ran on; compare with the current model to detect staleness. */
  modelSignature?: string;
};

export function useAnalysisJob() {
  const [state, setState] = useState<AnalysisState>({ status: 'idle' });
  const run = useRef(0);
  const jobId = useRef<string | null>(null);

  const cancel = useCallback(async () => {
    ++run.current;
    const id = jobId.current;
    jobId.current = null;
    setState((s) => ({ ...s, status: 'cancelled', error: undefined }));
    if (id) await api('analysis-jobs/' + id, undefined, 'DELETE').catch(() => {});
  }, []);

  useEffect(
    () => () => {
      ++run.current;
      if (jobId.current) api('analysis-jobs/' + jobId.current, undefined, 'DELETE').catch(() => {});
    },
    [],
  );

  const start = useCallback(async (request: any) => {
    const mine = ++run.current;
    const modelSignature = JSON.stringify(request.model);
    setState({ status: 'starting', modelSignature });
    try {
      const job = await api('analysis-jobs', { request, owner: crypto.randomUUID() });
      if (mine !== run.current) {
        api('analysis-jobs/' + job.id, undefined, 'DELETE').catch(() => {});
        return;
      }
      jobId.current = job.id;
      setState({ status: 'running', progress: job.progress, modelSignature });
      const poll = async () => {
        if (mine !== run.current) return;
        try {
          const j = await api('analysis-jobs/' + job.id);
          if (mine !== run.current) return;
          if (j.status === 'running') {
            setState((s) => ({ ...s, progress: j.progress }));
            setTimeout(poll, 200);
            return;
          }
          jobId.current = null;
          setState({
            status: j.status,
            progress: j.progress,
            result: j.result,
            error: j.error,
            modelSignature,
          });
        } catch (e: any) {
          if (mine === run.current)
            setState({ status: 'failed', error: '任务查询失败：' + e.message, modelSignature });
        }
      };
      poll();
    } catch (e: any) {
      if (mine === run.current) setState({ status: 'failed', error: e.message, modelSignature });
    }
  }, []);

  return { state, start, cancel };
}
