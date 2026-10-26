// SPEC-001 可及性子页：约束编辑、固定工作点检查（T-005）与有界局部搜索（T-006/T-009）。
// 本文件只组合状态与运行；编辑与结果展示见 ConstraintEditor / SearchVariablesEditor / AccessibilityResult。
import React, { useMemo, useState } from 'react';
import {
  ConstraintRow,
  constraintProblems,
  defaultConstraintRows,
  buildAccessibilityRequest,
  SearchVariable,
  searchVariables,
  searchProblems,
  foundPointSignature,
} from './analysis';
import { useFrozenAnalysis } from './useAnalysisJob';
import AnalysisStatus from './AnalysisStatus';
import ConstraintEditor from './ConstraintEditor';
import SearchVariablesEditor from './SearchVariablesEditor';
import AccessibilityResult from './AccessibilityResult';
import type { AnalysisActions } from './AnalysisPanel';

export default function AccessibilityView({
  model,
  flowUnit,
  actions,
}: {
  model: any;
  flowUnit: string;
  actions: AnalysisActions;
}) {
  const [rows, setRows] = useState<ConstraintRow[]>(() => defaultConstraintRows(model));
  // Only the user's choices are stored; the list itself follows the live model, so current values stay
  // up to date and deleted pumps/valves disappear instead of producing a rejected request.
  const [choices, setChoices] = useState<Record<string, Partial<SearchVariable>>>({});
  const vars = useMemo(
    () => searchVariables(model).map((v) => ({ ...v, ...choices[v.id + ':' + v.field] })),
    [model, choices],
  );
  const setVar = (v: SearchVariable, patch: Partial<SearchVariable>) =>
    setChoices((all) => ({
      ...all,
      [v.id + ':' + v.field]: { ...all[v.id + ':' + v.field], ...patch },
    }));
  const searching = vars.some((v) => v.enabled);
  const problems = useMemo(
    () => [...constraintProblems(rows, model), ...searchProblems(vars)],
    [rows, model, vars],
  );
  const { state, start, cancel, running, result, frozenModel, currentSignature, modelChanged } =
    useFrozenAnalysis(model);
  // When the current model equals the found point, the adjustment has been applied: the shown checks
  // describe the current model exactly, so the result is not stale.
  const foundSignature = useMemo(
    () => foundPointSignature(result, frozenModel),
    [result, frozenModel],
  );
  const applied =
    !!foundSignature &&
    foundSignature === currentSignature &&
    foundSignature !== state.modelSignature;
  const stale = modelChanged && !applied;

  if (!model.edges.length) return <div className="tip">当前模型没有支路，无法设置约束。</div>;

  return (
    <div className="analysis-view" data-testid="accessibility-view">
      <div className="analysis-form">
        <ConstraintEditor model={model} flowUnit={flowUnit} rows={rows} onChange={setRows} />
        <SearchVariablesEditor vars={vars} onChange={setVar} />
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
        <AnalysisStatus
          state={state}
          running={running}
          progressTestId="accessibility-progress"
          progress={
            state.progress && state.progress.total > 1 ? (
              <>
                已评估 {state.progress.done} 次（上限 {state.progress.total}）
                <progress value={state.progress.done} max={state.progress.total} />
              </>
            ) : (
              '正在计算当前工作点…'
            )
          }
          cancelledText="已取消检查。"
          stale={stale}
          staleTestId="accessibility-stale"
          staleText="检查结果对应运行时的模型；模型已修改，结果仅供参考，请重新检查。"
        />
        {result && (
          <AccessibilityResult
            result={result}
            frozenModel={frozenModel}
            flowUnit={flowUnit}
            stale={stale}
            applied={applied}
            actions={actions}
          />
        )}
      </div>
    </div>
  );
}
