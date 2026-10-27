// 水力平衡结果：结论、最不利环路、平衡阀设置与验证、未配对末端、平衡前后对比、保存 / 应用（T-012/T-013）。
import React from 'react';
import { fmt, applyAdjustments, adjustmentSummary } from './analysis';
import { unitLabel } from './units';
import {
  balanceRows,
  unpairedRows,
  comparisonRows,
  balanceConclusionText,
  indexText,
} from './balance';
import PointActions from './PointActions';
import type { AnalysisActions } from './AnalysisPanel';

export default function BalanceResult({
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
  const ok = result.conclusion === 'balanced';
  const unit = unitLabel[flowUnit] || flowUnit;
  const unpaired = unpairedRows(result, frozenModel, flowUnit);
  const compare = comparisonRows(result, flowUnit);
  const summary = adjustmentSummary(result, frozenModel);
  const usable = ['balanced', 'outside_tolerance'].includes(result.conclusion) && !!result.changes;
  const powerUp =
    compare.length === 4 &&
    typeof compare[3].after === 'number' &&
    compare[3].after! > compare[3].before!;
  return (
    <>
      <div className={'conclusion ' + (ok ? 'ok' : 'warn')} data-testid="balance-conclusion">
        {balanceConclusionText[result.conclusion] || result.conclusion}
      </div>
      {indexText(result, frozenModel) && (
        <p className="tip" data-testid="balance-index">
          {indexText(result, frozenModel)}
        </p>
      )}
      <table data-testid="balance-table">
        <thead>
          <tr>
            <th>末端</th>
            <th>平衡阀</th>
            <th>设计流量 [{unit}]</th>
            <th>建议开度</th>
            <th>验证流量 [{unit}]</th>
            <th>偏差</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          {balanceRows(result, frozenModel, flowUnit).map((r) => (
            <tr key={r.terminal} className={r.withinTolerance ? '' : 'violated'}>
              <td>{r.terminal}</td>
              <td>{r.valve}</td>
              <td>{fmt(r.design)}</td>
              <td>{r.opening}</td>
              <td>{fmt(r.verified, 5)}</td>
              <td>{r.deviation}</td>
              <td>{r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {unpaired.length > 0 && (
        <>
          <h4>未参与调节的末端（没有唯一的串联平衡阀）</h4>
          <table data-testid="balance-unpaired">
            <thead>
              <tr>
                <th>末端</th>
                <th>设计流量 [{unit}]</th>
                <th>平衡后流量 [{unit}]</th>
                <th>偏差</th>
              </tr>
            </thead>
            <tbody>
              {unpaired.map((u: any) => (
                <tr key={u.terminal} className={u.withinTolerance ? '' : 'violated'}>
                  <td>{u.terminal}</td>
                  <td>{fmt(u.design)}</td>
                  <td>{fmt(u.verified, 5)}</td>
                  <td>{u.deviation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {compare.length > 0 && (
        <>
          <h4>平衡前后对比（验证计算）</h4>
          <table data-testid="balance-compare">
            <thead>
              <tr>
                <th>项目</th>
                <th>平衡前</th>
                <th>平衡后</th>
                <th>变化</th>
              </tr>
            </thead>
            <tbody>
              {compare.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td>{fmt(c.before, 4)}</td>
                  <td>{fmt(c.after, 4)}</td>
                  <td>{c.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {powerUp && (
            <p className="tip" data-testid="balance-power-note">
              只关小阀门时泵流量减少、扬程升高，水力功率可能增加；节能需要配合降低泵速（选择“泵速参与”）。
            </p>
          )}
        </>
      )}
      {usable && (
        <PointActions
          testId="balance-actions"
          stale={stale}
          applied={applied}
          summary={summary}
          staleNote="模型已修改，平衡结果过期，不能保存或应用；请重新计算。"
          onSave={() =>
            actions.onSaveScenario(
              applyAdjustments(frozenModel, result.changes),
              result.result,
              summary,
            )
          }
          onApply={() => actions.onApply(result.changes, summary)}
        />
      )}
      <p className="tip">
        开度由流量设定法反算并按设定精度取整，验证流量来自写回原模型后的真实计算。不涉及阀门选型、动态平衡阀或控制器动作。
      </p>
    </>
  );
}
