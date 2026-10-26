// SPEC-001 扫描子页：1 个调节量的独立稳态扫描（T-001）。
import React, { useMemo, useState } from 'react';
import NumberField from './NumberField';
import {
  adjustableParams,
  defaultObservables,
  observableOptions,
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
} from './analysis';
import { useAnalysisJob } from './useAnalysisJob';
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
  const r = (param && range[param.id + ':' + param.field]) || {
    start: param?.field === 'speed' ? 0.6 : 0.1,
    stop: param?.field === 'speed' ? 1.4 : 1,
    count: 5,
  };
  const setR = (patch: Partial<typeof r>) =>
    param && setRange((all) => ({ ...all, [param.id + ':' + param.field]: { ...r, ...patch } }));
  const [observables, setObservables] = useState<Observable[]>(() => defaultObservables(model));
  const options = useMemo(() => observableOptions(model), [model]);
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
  const currentSignature = JSON.stringify(model);
  const stale =
    !!state.modelSignature &&
    state.status === 'completed' &&
    state.modelSignature !== currentSignature;
  const running = state.status === 'starting' || state.status === 'running';

  let values: number[] = [],
    rangeError = '';
  try {
    values = linspace(r.start, r.stop, r.count);
  } catch (e: any) {
    rangeError = e.message;
  }

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
  const resultParam = state.result?.variables?.[0];
  const resultParamLabel =
    frozenParams.find((x) => x.id === resultParam?.id && x.field === resultParam?.field)?.label ||
    resultParam?.id;

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
        <div className="analysis-range">
          <NumberField
            label="起点"
            value={r.start}
            min={param.min}
            max={param.max}
            onApply={(v: number) => setR({ start: v })}
          />
          <NumberField
            label="终点"
            value={r.stop}
            min={param.min}
            max={param.max}
            onApply={(v: number) => setR({ stop: v })}
          />
          <NumberField
            label="点数"
            value={r.count}
            min={1}
            max={MAX_SCAN_POINTS}
            integer
            onApply={(v: number) => setR({ count: v })}
          />
        </div>
        <div className="field">
          <span>观测量</span>
          <div className="chips">
            {observables.map((o) => (
              <button
                key={observableKey(o)}
                className="chip"
                title="移除该观测量"
                onClick={() =>
                  setObservables((all) => all.filter((x) => observableKey(x) !== observableKey(o)))
                }
              >
                {observableLabel(o, model, flowUnit)} ×
              </button>
            ))}
            <select
              aria-label="添加观测量"
              value=""
              onChange={(e) => {
                const o = options.find((x) => observableKey(x) === e.target.value);
                if (o) setObservables((all) => [...all, o]);
              }}
            >
              <option value="">＋ 添加…</option>
              {options
                .filter((o) => !observables.some((x) => observableKey(x) === observableKey(o)))
                .map((o) => (
                  <option key={observableKey(o)} value={observableKey(o)}>
                    {observableLabel(o, model, flowUnit)}
                  </option>
                ))}
            </select>
          </div>
        </div>
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
                    [{ id: param.id, field: param.field, values }],
                    observables,
                  ),
                )
              }
            >
              运行扫描（{values.length || 0} 点）
            </button>
          )}
          <small>每点独立稳态计算，不是时间动态。</small>
          {rangeError && <small className="field-error">{rangeError}</small>}
        </div>
      </div>
      <div className="analysis-output" role="status" aria-live="polite">
        {running && (
          <div className="analysis-progress" data-testid="scan-progress">
            正在扫描 {state.progress?.done ?? 0} / {state.progress?.total ?? values.length}
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
            {groups.length > 1 && (
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
              {group?.indexes.map((i) => {
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
        {state.status === 'completed' && rows.length > 1 && (
          <LineChart
            xs={rows.map((row) => row.params[0])}
            series={chartSeries}
            xLabel={resultParamLabel}
            yLabel={group?.unit || ''}
            title={`参数扫描曲线：${resultParamLabel}`}
          />
        )}
        {state.status === 'completed' && (
          <table data-testid="scan-table">
            <thead>
              <tr>
                <th>{resultParamLabel}</th>
                {resultObservables.map((o) => (
                  <th key={observableKey(o)}>{observableLabel(o, frozenModel, flowUnit)}</th>
                ))}
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td>{fmt(row.params[0])}</td>
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
