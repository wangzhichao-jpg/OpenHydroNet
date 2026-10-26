// SPEC-001 可及性子页：约束编辑、固定工作点检查（T-005）与有界局部搜索（T-006）。约束行按 SI 保存，显示单位只影响输入与显示。
import React, { useMemo, useState } from 'react';
import NumberField from './NumberField';
import { waterDensity } from './units';
import {
  ConstraintRow,
  ConstraintKind,
  constraintKinds,
  constraintLabel,
  constraintToDisplay,
  constraintFromDisplay,
  constraintProblems,
  defaultConstraintRows,
  newConstraintRow,
  buildAccessibilityRequest,
  checkRows,
  conclusionText,
  fmt,
  SearchVariable,
  searchVariables,
  searchProblems,
  adjustmentRows,
} from './analysis';
import { useAnalysisJob } from './useAnalysisJob';

export default function AccessibilityView({ model, flowUnit }: { model: any; flowUnit: string }) {
  const [rows, setRows] = useState<ConstraintRow[]>(() => defaultConstraintRows(model));
  // Only the user's choices are stored; the list itself follows the live model, so current values stay
  // up to date and deleted pumps/valves disappear instead of producing a rejected request.
  const [choices, setChoices] = useState<Record<string, Partial<SearchVariable>>>({});
  const vars = useMemo(
    () => searchVariables(model).map((v) => ({ ...v, ...choices[v.id + ':' + v.field] })),
    [model, choices],
  );
  const searching = vars.some((v) => v.enabled);
  const setVar = (v: SearchVariable, patch: Partial<SearchVariable>) =>
    setChoices((all) => ({
      ...all,
      [v.id + ':' + v.field]: { ...all[v.id + ':' + v.field], ...patch },
    }));
  const { state, start, cancel } = useAnalysisJob();
  let density = NaN;
  try {
    density = waterDensity(model.fluid?.temperature ?? 20);
  } catch {}
  const edgeName = (id: string) => model.edges.find((e: any) => e.id === id)?.name || id;
  const problems = useMemo(
    () => [...constraintProblems(rows, model), ...searchProblems(vars)],
    [rows, model, vars],
  );
  const running = state.status === 'starting' || state.status === 'running';
  const stale =
    state.status === 'completed' &&
    !!state.modelSignature &&
    state.modelSignature !== JSON.stringify(model);
  const frozenModel = useMemo(
    () => (state.modelSignature ? JSON.parse(state.modelSignature) : model),
    [state.modelSignature, model],
  );
  const update = (key: string, patch: Partial<ConstraintRow>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const firstTerminal = model.edges.find((e: any) => e.kind === 'terminal') || model.edges[0];
  const result = state.status === 'completed' ? state.result : null;
  const satisfied =
    result && ['feasible_at_this_point', 'feasible_point_found'].includes(result.conclusion);

  if (!model.edges.length) return <div className="tip">当前模型没有支路，无法设置约束。</div>;

  return (
    <div className="analysis-view" data-testid="accessibility-view">
      <div className="analysis-form">
        <div className="field">
          <span>约束（对支路计算结果的要求）</span>
          <div className="constraint-list">
            {rows.map((r) => {
              const shown = constraintToDisplay(r, flowUnit, density);
              const label = `${edgeName(r.id)} ${constraintLabel(r.kind, flowUnit)}`;
              return (
                <div
                  className="constraint-row"
                  key={r.key}
                  data-testid={'constraint-' + r.id + '-' + r.kind}
                >
                  <select
                    aria-label="约束对象"
                    value={r.id}
                    onChange={(e) => update(r.key, { id: e.target.value })}
                  >
                    {!model.edges.some((e: any) => e.id === r.id) && (
                      <option value={r.id}>{r.id}（已删除）</option>
                    )}
                    {model.edges.map((e: any) => (
                      <option key={e.id} value={e.id}>
                        {e.name || e.id}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="约束类型"
                    value={r.kind}
                    onChange={(e) => {
                      const kind = e.target.value as ConstraintKind;
                      // Switching between flow and head keeps the row but resets a meaningless value.
                      update(r.key, {
                        kind,
                        si: (kind === 'min_head') === (r.kind === 'min_head') ? r.si : 0,
                      });
                    }}
                  >
                    {constraintKinds.map((k) => (
                      <option key={k} value={k}>
                        {constraintLabel(k, flowUnit)}
                      </option>
                    ))}
                  </select>
                  <NumberField
                    label={label}
                    value={shown ?? ''}
                    min={0}
                    onApply={(v: number) => {
                      try {
                        update(r.key, {
                          si: constraintFromDisplay(r.kind, v, flowUnit, density),
                        });
                      } catch {}
                    }}
                  />
                  <button
                    className="chip"
                    title="删除该约束"
                    aria-label={'删除约束 ' + label}
                    onClick={() => setRows((all) => all.filter((x) => x.key !== r.key))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="button-row">
            <button
              onClick={() =>
                setRows((all) => [...all, newConstraintRow(firstTerminal.id, 'min_flow', 0)])
              }
            >
              ＋ 添加约束
            </button>
            <button onClick={() => setRows(defaultConstraintRows(model))}>
              恢复为末端设计流量
            </button>
          </div>
        </div>
        <div className="field" data-testid="search-variables">
          <span>调节量（可选；勾选后在上下界内做局部搜索）</span>
          {vars.map((v) => (
            <div className="search-variable" key={v.id + v.field}>
              <label className="check">
                <input
                  type="checkbox"
                  aria-label={'参与调节 ' + v.label}
                  checked={v.enabled}
                  onChange={(e) => setVar(v, { enabled: e.target.checked })}
                />
                {v.label}（当前 {fmt(v.value)}）
              </label>
              {v.enabled && (
                <div className="search-bounds">
                  <NumberField
                    label={v.label + ' 下界'}
                    value={v.lower}
                    min={v.min}
                    max={v.max}
                    onApply={(x: number) => setVar(v, { lower: x })}
                  />
                  <NumberField
                    label={v.label + ' 上界'}
                    value={v.upper}
                    min={v.min}
                    max={v.max}
                    onApply={(x: number) => setVar(v, { upper: x })}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="analysis-actions">
          {running ? (
            <button onClick={cancel}>取消分析</button>
          ) : (
            <button
              className="primary"
              disabled={!!problems.length}
              onClick={() => start(buildAccessibilityRequest(model, rows, vars))}
            >
              {searching ? '搜索可行调节（局部）' : '检查当前工作点'}
            </button>
          )}
          <small>
            {searching
              ? '在所选调节量的上下界内做有界局部搜索，不修改工程；找不到时结论为“未确定”，不做全局保证。'
              : '不改变任何泵阀设置，只判断当前输入下的计算结果是否满足全部约束。'}
          </small>
          {problems.map((p) => (
            <small key={p} className="field-error">
              {p}
            </small>
          ))}
        </div>
      </div>
      <div className="analysis-output" role="status" aria-live="polite">
        {running && (
          <div className="analysis-progress" data-testid="accessibility-progress">
            {state.progress && state.progress.total > 1 ? (
              <>
                已评估 {state.progress.done} 次（上限 {state.progress.total}）
                <progress value={state.progress.done} max={state.progress.total} />
              </>
            ) : (
              '正在计算当前工作点…'
            )}
          </div>
        )}
        {state.status === 'cancelled' && <div className="tip">已取消检查。</div>}
        {(state.status === 'failed' || state.status === 'timeout') && (
          <div className="field-error">{state.error}</div>
        )}
        {stale && (
          <div className="stale-banner" data-testid="accessibility-stale">
            检查结果对应运行时的模型；模型已修改，结果仅供参考，请重新检查。
          </div>
        )}
        {result && (
          <>
            <div
              className={'conclusion ' + (satisfied ? 'ok' : 'warn')}
              data-testid="accessibility-conclusion"
            >
              {conclusionText[result.conclusion] || result.conclusion}
            </div>
            {result.mode === 'bounded_local_feasibility_search' && (
              <>
                <p className="tip">
                  已评估 {result.evaluations} 次{result.budget_exhausted ? '，已达评估上限' : ''}
                  ；局部搜索，不做全局保证。
                  {result.conclusion === 'undetermined' &&
                    ' 建议：检查最不利末端、在真实允许的范围内放宽调节上下界，或复核泵阀数据。'}
                </p>
                {result.changes && (
                  <>
                    <h4>{satisfied ? '调节方案' : '最接近满足的点（仍不满足约束）'}</h4>
                    <table data-testid="adjustment-table">
                      <thead>
                        <tr>
                          <th>调节量</th>
                          <th>当前值</th>
                          <th>搜索结果</th>
                          <th>变化</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adjustmentRows(result, frozenModel).map((a) => (
                          <tr key={a.label}>
                            <td>{a.label}</td>
                            <td>{fmt(a.from)}</td>
                            <td>{fmt(a.to)}</td>
                            <td>
                              {Math.abs(a.delta) < 1e-5
                                ? '不变'
                                : (a.delta > 0 ? '+' : '') + fmt(a.delta)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <h4>该点各约束</h4>
                  </>
                )}
              </>
            )}
            <table data-testid="accessibility-table">
              <thead>
                <tr>
                  <th>对象</th>
                  <th>约束</th>
                  <th>要求</th>
                  <th>实际</th>
                  <th>是否满足</th>
                  <th>相对差距</th>
                </tr>
              </thead>
              <tbody>
                {checkRows(result, frozenModel, flowUnit).map((c, i) => (
                  <tr key={i} className={c.satisfied ? '' : 'violated'}>
                    <td>{c.object}</td>
                    <td>{c.kind}</td>
                    <td>{fmt(c.required)}</td>
                    <td>{fmt(c.actual, 5)}</td>
                    <td>{c.satisfied ? '满足' : '不满足'}</td>
                    <td>{c.shortfall}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.checks && (
              <div className="field-error">
                该工作点没有获得合格水力解，无法逐条判断约束；请先查看问题列表。
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
