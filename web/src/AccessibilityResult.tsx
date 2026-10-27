// 可及性结果：结论、搜索过程、调节方案（存为工况 / 应用）与逐条约束。
import React, { useMemo } from 'react';
import {
  checkRows,
  conclusionText,
  adjustmentRows,
  adjustmentSummary,
  applyAdjustments,
  refinementNotes,
  fmt,
} from './analysis';
import type { AnalysisActions } from './AnalysisPanel';
import PointActions from './PointActions';

export default function AccessibilityResult({
  result,
  frozenModel,
  flowUnit,
  stale,
  applied,
  actions,
}: {
  result: any;
  frozenModel: any;
  flowUnit: string;
  stale: boolean;
  applied: boolean;
  actions: AnalysisActions;
}) {
  const notes = useMemo(() => refinementNotes(result, frozenModel), [result, frozenModel]);
  const satisfied = ['feasible_at_this_point', 'feasible_point_found'].includes(result.conclusion);
  const summary = adjustmentSummary(result, frozenModel);
  return (
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
          {notes.length > 0 && (
            <ol className="refinement-notes" data-testid="refinement-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ol>
          )}
          {result.changes && (
            <>
              <h4>
                {satisfied
                  ? '调节方案（建议值已尽量少调整，并按设定精度处理）'
                  : '最接近满足的点（仍不满足约束）'}
              </h4>
              <table data-testid="adjustment-table">
                <thead>
                  <tr>
                    <th>调节量</th>
                    <th>当前值</th>
                    <th>{satisfied ? '建议值' : '搜索结果'}</th>
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
              {satisfied && (
                <PointActions
                  testId="found-actions"
                  stale={stale}
                  applied={applied}
                  summary={summary}
                  staleNote="模型已修改，搜索结果过期，不能保存或应用；请重新搜索。"
                  onSave={() =>
                    actions.onSaveScenario(
                      applyAdjustments(frozenModel, result.changes),
                      result.result,
                      summary,
                      '可及性方案',
                    )
                  }
                  onApply={() => actions.onApply(result.changes, summary)}
                />
              )}
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
  );
}
