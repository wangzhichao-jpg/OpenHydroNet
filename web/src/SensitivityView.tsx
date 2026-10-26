// SPEC-001 敏感性子页（T-004）：所选调节量 × 观测量的有限差分敏感性矩阵，按 |弹性| 找出影响最大的调节量。
import React, { useMemo, useState } from 'react';
import NumberField from './NumberField';
import ObservablePicker from './ObservablePicker';
import {
  adjustableParams,
  defaultObservables,
  buildSensitivityRequest,
  sensitivityRows,
  strongestText,
  Observable,
  DEFAULT_DIFF_STEP,
  fmt,
} from './analysis';
import { useFrozenAnalysis } from './useAnalysisJob';
import AnalysisStatus, { ProgressCount } from './AnalysisStatus';

export default function SensitivityView({ model, flowUnit }: { model: any; flowUnit: string }) {
  const params = useMemo(() => adjustableParams(model), [model]);
  // Unchecked parameters are remembered; the list follows the live model.
  const [excluded, setExcluded] = useState<string[]>([]);
  const chosen = params.filter((p) => !excluded.includes(p.id + ':' + p.field));
  const [observables, setObservables] = useState<Observable[]>(() => defaultObservables(model));
  const [step, setStep] = useState(DEFAULT_DIFF_STEP);
  const { state, start, cancel, running, result, frozenModel, modelChanged } =
    useFrozenAnalysis(model);
  const rows = useMemo(
    () => (result ? sensitivityRows(result, frozenModel, flowUnit) : []),
    [result, frozenModel, flowUnit],
  );

  if (!params.length) return <div className="tip">当前模型没有泵或阀，无可分析的调节量。</div>;

  return (
    <div className="analysis-view" data-testid="sensitivity-view">
      <div className="analysis-form">
        <div className="field">
          <span>调节量</span>
          {params.map((p) => {
            const key = p.id + ':' + p.field;
            return (
              <label className="check sensitivity-param" key={key}>
                <input
                  type="checkbox"
                  aria-label={'参与分析 ' + p.label}
                  checked={!excluded.includes(key)}
                  onChange={(e) =>
                    setExcluded((all) =>
                      e.target.checked ? all.filter((k) => k !== key) : [...all, key],
                    )
                  }
                />
                {p.label}（当前 {fmt(p.value)}）
              </label>
            );
          })}
        </div>
        <NumberField
          label="差分步长"
          value={step}
          min={0}
          strict
          max={0.1}
          hint="在当前值两侧各取一个点；到达物理上下限时改为单侧差分。"
          onApply={(v: number) => setStep(v)}
        />
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
              disabled={!chosen.length || !observables.length}
              onClick={() =>
                start(
                  buildSensitivityRequest(
                    model,
                    chosen.map(({ id, field }) => ({ id, field })),
                    observables,
                    step,
                  ),
                )
              }
            >
              计算敏感性（{1 + 2 * chosen.length} 次计算）
            </button>
          )}
          <small>局部线性化结果，只描述当前工作点附近的变化趋势，不预测大幅调节后的结果。</small>
          {!chosen.length && <small className="field-error">请至少选择一个调节量</small>}
        </div>
      </div>
      <div className="analysis-output" role="status" aria-live="polite">
        <AnalysisStatus
          state={state}
          running={running}
          progress={
            <ProgressCount
              label="正在计算差分点"
              progress={state.progress}
              fallbackTotal={1 + 2 * chosen.length}
            />
          }
          cancelledText="已取消。"
          stale={modelChanged}
          staleTestId="sensitivity-stale"
          staleText="敏感性结果对应运行时的模型；模型已修改，结果仅供参考，请重新计算。"
        />
        {result && (
          <>
            <ul className="sensitivity-summary" data-testid="sensitivity-summary">
              {rows.map((r) => (
                <li key={r.label}>
                  <b>{r.label}</b>：{strongestText(r)}
                </li>
              ))}
            </ul>
            <table data-testid="sensitivity-table">
              <thead>
                <tr>
                  <th>观测量</th>
                  <th>当前值</th>
                  {rows[0]?.cells.map((c) => (
                    <th key={c.param}>
                      {c.param}
                      <br />
                      <small>弹性（导数）</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <td>{r.label}</td>
                    <td>{fmt(r.base, 5)}</td>
                    {r.cells.map((c, j) => (
                      <td key={j} className={j === r.strongest ? 'strongest' : ''} title={c.method}>
                        {fmt(c.elasticity, 3)}
                        <small>（{fmt(c.derivative, 4)}）</small>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="tip">
              弹性 = 参数变化 1% 时观测量变化的百分数；括号内为导数（观测量显示单位 / 参数单位）。
              {rows[0]?.cells.some((c) => c.method !== '中心差分') &&
                ' 部分参数在物理上下限处使用单侧差分（鼠标悬停单元格查看）。'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
