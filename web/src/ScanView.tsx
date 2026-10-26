// SPEC-001 扫描子页：1–2 个调节量的独立稳态扫描（T-001/T-003）；结果展示见 ScanResult。
import React, { useMemo, useState } from 'react';
import {
  adjustableParams,
  defaultObservables,
  linspace,
  buildScanRequest,
  Observable,
  MAX_SCAN_POINTS,
  fmt,
} from './analysis';
import { useFrozenAnalysis } from './useAnalysisJob';
import AnalysisStatus, { ProgressCount } from './AnalysisStatus';
import RangeFields from './RangeFields';
import ScanResult from './ScanResult';
import ObservablePicker from './ObservablePicker';

export default function ScanView({
  model,
  flowUnit,
  projectName,
}: {
  model: any;
  flowUnit: string;
  projectName: string;
}) {
  const params = useMemo(() => adjustableParams(model), [model]);
  const [paramKey, setParamKey] = useState(() =>
    params[0] ? params[0].id + ':' + params[0].field : '',
  );
  const param = params.find((x) => x.id + ':' + x.field === paramKey) || params[0];
  const [range, setRange] = useState<
    Record<string, { start: number; stop: number; count: number }>
  >({});
  type Range = { start: number; stop: number; count: number };
  const rangeOf = (p: any): Range =>
    range[p.id + ':' + p.field] || {
      start: p.field === 'speed' ? 0.6 : 0.1,
      stop: p.field === 'speed' ? 1.4 : 1,
      count: 5,
    };
  const setRangeOf = (p: any, patch: Partial<Range>) =>
    setRange((all) => ({ ...all, [p.id + ':' + p.field]: { ...rangeOf(p), ...patch } }));
  const r = param ? rangeOf(param) : { start: 0, stop: 1, count: 1 };
  // Optional second parameter (T-003): Cartesian product, first parameter outer.
  const [secondKey, setSecondKey] = useState('');
  const second = params.find((x) => x.id + ':' + x.field === secondKey && x !== param);
  const [observables, setObservables] = useState<Observable[]>(() => defaultObservables(model));
  const { state, start, cancel, running, result, frozenModel, modelChanged } =
    useFrozenAnalysis(model);

  let values: number[] = [],
    values2: number[] = [],
    rangeError = '';
  try {
    values = linspace(r.start, r.stop, r.count);
    if (second)
      values2 = linspace(rangeOf(second).start, rangeOf(second).stop, rangeOf(second).count);
  } catch (e: any) {
    rangeError = e.message;
  }
  const total = values.length * (second ? values2.length : 1);
  if (!rangeError && total > MAX_SCAN_POINTS)
    rangeError = `共 ${total} 点，单批扫描限 ${MAX_SCAN_POINTS} 点；请减少点数`;

  if (!params.length) return <div className="tip">当前模型没有泵或阀，无可扫描的调节量。</div>;

  return (
    <div className="analysis-view" data-testid="scan-view">
      <div className="analysis-form">
        <label className="field">
          <span>扫描参数</span>
          <select
            aria-label="扫描参数"
            value={param.id + ':' + param.field}
            onChange={(e) => setParamKey(e.target.value)}
          >
            {params.map((x) => (
              <option key={x.id + x.field} value={x.id + ':' + x.field}>
                {x.label}（当前 {fmt(x.value)}）
              </option>
            ))}
          </select>
        </label>
        <RangeFields param={param} range={r} onChange={(patch) => setRangeOf(param, patch)} />
        <label className="field">
          <span>第二参数（可选）</span>
          <select
            aria-label="第二参数"
            value={second ? second.id + ':' + second.field : ''}
            onChange={(e) => setSecondKey(e.target.value)}
          >
            <option value="">无（单参数扫描）</option>
            {params
              .filter((x) => x !== param)
              .map((x) => (
                <option key={x.id + x.field} value={x.id + ':' + x.field}>
                  {x.label}（当前 {fmt(x.value)}）
                </option>
              ))}
          </select>
        </label>
        {second && (
          <RangeFields
            param={second}
            range={rangeOf(second)}
            prefix="第二参数 "
            onChange={(patch) => setRangeOf(second, patch)}
          />
        )}
        <ObservablePicker
          model={model}
          flowUnit={flowUnit}
          value={observables}
          onChange={setObservables}
        />
        <div className="analysis-actions">
          {running ? (
            <button onClick={cancel}>取消分析</button>
          ) : (
            <button
              className="primary"
              disabled={!!rangeError || !observables.length}
              onClick={() =>
                start(
                  buildScanRequest(
                    model,
                    [
                      { id: param.id, field: param.field, values },
                      ...(second ? [{ id: second.id, field: second.field, values: values2 }] : []),
                    ],
                    observables,
                  ),
                )
              }
            >
              运行扫描（{rangeError ? 0 : total} 点）
            </button>
          )}
          <small>每点独立稳态计算，不是时间动态。</small>
          {rangeError && <small className="field-error">{rangeError}</small>}
        </div>
      </div>
      <div className="analysis-output" role="status" aria-live="polite">
        <AnalysisStatus
          state={state}
          running={running}
          progressTestId="scan-progress"
          progress={
            <ProgressCount label="正在扫描" progress={state.progress} fallbackTotal={total} />
          }
          cancelledText="已取消扫描。"
          stale={modelChanged}
          staleTestId="scan-stale"
          staleText="扫描结果对应运行时的模型；模型已修改，结果仅供参考，请重新运行。"
        />
        <ScanResult
          result={result}
          frozenModel={frozenModel}
          flowUnit={flowUnit}
          projectName={projectName}
        />
      </div>
    </div>
  );
}
