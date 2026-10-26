// SPEC-001 可及性子页：约束编辑与固定工作点检查（T-005）。约束行按 SI 保存，显示单位只影响输入与显示。
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
} from './analysis';
import { useAnalysisJob } from './useAnalysisJob';

export default function AccessibilityView({ model, flowUnit }: { model: any; flowUnit: string }) {
  const [rows, setRows] = useState<ConstraintRow[]>(() => defaultConstraintRows(model));
  const { state, start, cancel } = useAnalysisJob();
  let density = NaN;
  try {
    density = waterDensity(model.fluid?.temperature ?? 20);
  } catch {}
  const edgeName = (id: string) => model.edges.find((e: any) => e.id === id)?.name || id;
  const problems = useMemo(() => constraintProblems(rows, model), [rows, model]);
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
        <div className="analysis-actions">
          {running ? (
            <button onClick={cancel}>取消分析</button>
          ) : (
            <button
              className="primary"
              disabled={!!problems.length}
              onClick={() => start(buildAccessibilityRequest(model, rows))}
            >
              检查当前工作点
            </button>
          )}
          <small>不改变任何泵阀设置，只判断当前输入下的计算结果是否满足全部约束。</small>
          {problems.map((p) => (
            <small key={p} className="field-error">
              {p}
            </small>
          ))}
        </div>
      </div>
      <div className="analysis-output" role="status" aria-live="polite">
        {running && <div className="analysis-progress">正在计算当前工作点…</div>}
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
