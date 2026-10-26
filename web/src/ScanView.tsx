// SPEC-001 扫描子页：1 个调节量的独立稳态扫描（T-001）。
import React, { useMemo, useState } from 'react';
import NumberField from './NumberField';
import {
  adjustableParams,
  defaultObservables,
  observableLabel,
  observableKey,
  linspace,
  buildScanRequest,
  scanRows,
  Observable,
  MAX_SCAN_POINTS,
  fmt,
  unitGroups,
  scanCsv,
  gridSeries,
} from './analysis';
import { useAnalysisJob } from './useAnalysisJob';
import ObservablePicker from './ObservablePicker';
import LineChart, { ChartSeries, SERIES_COLORS } from './LineChart';
import { download } from './api';

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
  const { state, start, cancel } = useAnalysisJob();
  // Labels and names come from the model the scan actually ran on, not the edited one.
  const frozenModel = useMemo(
    () => (state.modelSignature ? JSON.parse(state.modelSignature) : model),
    [state.modelSignature, model],
  );
  const frozenParams = useMemo(() => adjustableParams(frozenModel), [frozenModel]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [unitIndex, setUnitIndex] = useState(0);
  const [exportNote, setExportNote] = useState('');
  const [gridObservable, setGridObservable] = useState(0);
  const currentSignature = JSON.stringify(model);
  const stale =
    !!state.modelSignature &&
    state.status === 'completed' &&
    state.modelSignature !== currentSignature;
  const running = state.status === 'starting' || state.status === 'running';

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

  const rows = state.status === 'completed' ? scanRows(state.result, flowUnit, frozenModel) : [];
  const resultObservables: Observable[] = state.result?.observables || [];
  const groups = unitGroups(resultObservables, flowUnit);
  const group = groups[unitIndex] || groups[0];
  const chartSeries: ChartSeries[] = (group?.indexes || [])
    .filter((i) => !hidden.includes(observableKey(resultObservables[i])))
    .map((i) => ({
      key: observableKey(resultObservables[i]),
      label: observableLabel(resultObservables[i], frozenModel, flowUnit),
      ys: rows.map((row) => row.values[i]),
      color: SERIES_COLORS[i % SERIES_COLORS.length],
    }));
  async function exportCsv() {
    try {
      const written = await download(
        `${projectName || '未命名工程'}·参数扫描.csv`,
        scanCsv(state.result, frozenModel, flowUnit),
        'csv',
      );
      setExportNote(written === false ? '已取消导出' : '已导出 CSV（当前显示单位）');
    } catch (e: any) {
      setExportNote('导出失败：' + e.message);
    }
  }
  const labelOf = (v: any) =>
    frozenParams.find((x) => x.id === v?.id && x.field === v?.field)?.label || v?.id;
  const resultParamLabel = labelOf(state.result?.variables?.[0]);
  const twoD = state.result?.variables?.length === 2;
  const grid = twoD
    ? gridSeries(
        rows,
        Math.min(gridObservable, resultObservables.length - 1),
        labelOf(state.result.variables[1]),
      )
    : null;

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
        {running && (
          <div className="analysis-progress" data-testid="scan-progress">
            正在扫描 {state.progress?.done ?? 0} / {state.progress?.total ?? total}
            <progress value={state.progress?.done ?? 0} max={state.progress?.total || 1} />
          </div>
        )}
        {state.status === 'cancelled' && <div className="tip">已取消扫描。</div>}
        {(state.status === 'failed' || state.status === 'timeout') && (
          <div className="field-error">{state.error}</div>
        )}
        {stale && (
          <div className="stale-banner" data-testid="scan-stale">
            扫描结果对应运行时的模型；模型已修改，结果仅供参考，请重新运行。
          </div>
        )}
        {state.status === 'completed' && (
          <div className="scan-toolbar">
            {twoD && (
              <select
                aria-label="曲线观测量"
                value={Math.min(gridObservable, resultObservables.length - 1)}
                onChange={(e) => setGridObservable(Number(e.target.value))}
              >
                {resultObservables.map((o, i) => (
                  <option key={observableKey(o)} value={i}>
                    曲线：{observableLabel(o, frozenModel, flowUnit)}
                  </option>
                ))}
              </select>
            )}
            {!twoD && groups.length > 1 && (
              <select
                aria-label="纵轴单位"
                value={groups.indexOf(group)}
                onChange={(e) => setUnitIndex(Number(e.target.value))}
              >
                {groups.map((g, i) => (
                  <option key={g.unit} value={i}>
                    纵轴：{g.unit}
                  </option>
                ))}
              </select>
            )}
            <div className="scan-legend">
              {twoD &&
                grid!.series.map((s, i) => (
                  <span key={s.key} className="legend-item">
                    <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                    {s.label}
                  </span>
                ))}
              {!twoD &&
                group?.indexes.map((i) => {
                  const key = observableKey(resultObservables[i]);
                  const shown = !hidden.includes(key);
                  return (
                    <button
                      key={key}
                      className="legend-item"
                      aria-pressed={shown}
                      onClick={() =>
                        setHidden((all) => (shown ? [...all, key] : all.filter((k) => k !== key)))
                      }
                    >
                      <i
                        style={{
                          background: shown ? SERIES_COLORS[i % SERIES_COLORS.length] : '#ccd6df',
                        }}
                      />
                      {observableLabel(resultObservables[i], frozenModel, flowUnit)}
                    </button>
                  );
                })}
            </div>
            <button onClick={exportCsv}>导出 CSV</button>
            {exportNote && <small>{exportNote}</small>}
          </div>
        )}
        {state.status === 'completed' && !twoD && rows.length > 1 && (
          <LineChart
            xs={rows.map((row) => row.params[0])}
            series={chartSeries}
            xLabel={resultParamLabel}
            yLabel={group?.unit || ''}
            title={`参数扫描曲线：${resultParamLabel}`}
          />
        )}
        {state.status === 'completed' && twoD && grid!.xs.length > 1 && (
          <LineChart
            xs={grid!.xs}
            series={grid!.series.map((x, i) => ({
              ...x,
              color: SERIES_COLORS[i % SERIES_COLORS.length],
            }))}
            xLabel={resultParamLabel}
            yLabel={observableLabel(
              resultObservables[Math.min(gridObservable, resultObservables.length - 1)],
              frozenModel,
              flowUnit,
            )}
            title={`双参数扫描曲线：${resultParamLabel}`}
          />
        )}
        {state.status === 'completed' && (
          <table data-testid="scan-table">
            <thead>
              <tr>
                {state.result.variables.map((v: any) => (
                  <th key={v.id + v.field}>{labelOf(v)}</th>
                ))}
                {resultObservables.map((o) => (
                  <th key={observableKey(o)}>{observableLabel(o, frozenModel, flowUnit)}</th>
                ))}
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.params.map((v, k) => (
                    <td key={'p' + k}>{fmt(v)}</td>
                  ))}
                  {row.values.map((v, j) => (
                    <td key={j}>{fmt(v, 5)}</td>
                  ))}
                  <td>
                    {row.status}
                    {row.issues.length ? ' · ' + row.issues.join(', ') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** Start / stop / point count for one scanned parameter. */
function RangeFields({
  param,
  range,
  prefix = '',
  onChange,
}: {
  param: { min: number; max: number };
  range: { start: number; stop: number; count: number };
  prefix?: string;
  onChange: (patch: Partial<{ start: number; stop: number; count: number }>) => void;
}) {
  return (
    <div className="analysis-range">
      <NumberField
        label={prefix + '起点'}
        value={range.start}
        min={param.min}
        max={param.max}
        onApply={(v: number) => onChange({ start: v })}
      />
      <NumberField
        label={prefix + '终点'}
        value={range.stop}
        min={param.min}
        max={param.max}
        onApply={(v: number) => onChange({ stop: v })}
      />
      <NumberField
        label={prefix + '点数'}
        value={range.count}
        min={1}
        max={MAX_SCAN_POINTS}
        integer
        onApply={(v: number) => onChange({ count: v })}
      />
    </div>
  );
}
