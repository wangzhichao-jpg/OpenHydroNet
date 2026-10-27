// SPEC-002 水力平衡子页：流量设定法求平衡阀开度与最低泵速（T-012），结果可存为工况或应用（T-013）。
import React, { useEffect, useMemo, useRef, useState } from 'react';
import NumberField from './NumberField';
import { api } from './api';
import { fmt } from './analysis';
import {
  BalanceSettings,
  defaultBalanceSettings,
  balanceProblems,
  buildBalanceRequest,
  pairingLines,
  pointSignature,
} from './balance';
import { useFrozenAnalysis } from './useAnalysisJob';
import AnalysisStatus, { ProgressCount } from './AnalysisStatus';
import BalanceResult from './BalanceResult';
import type { AnalysisActions } from './AnalysisPanel';

export default function BalanceView({
  model,
  flowUnit,
  actions,
}: {
  model: any;
  flowUnit: string;
  actions: AnalysisActions;
}) {
  const [settings, setSettings] = useState<BalanceSettings>(() => defaultBalanceSettings(model));
  const set = (patch: Partial<BalanceSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const pumps = model.edges.filter((e: any) => e.kind === 'pump');
  const problems = balanceProblems(settings, model);
  const { state, start, cancel, running, result, frozenModel, currentSignature, modelChanged } =
    useFrozenAnalysis(model);
  // Pairing preview comes from the kernel (single implementation); only the latest request counts.
  const [pairs, setPairs] = useState<any>(null);
  const [pairError, setPairError] = useState('');
  const request = useRef(0);
  useEffect(() => {
    const mine = ++request.current;
    const timer = setTimeout(() => {
      api('balance/pairs', model)
        .then((p) => mine === request.current && (setPairs(p), setPairError('')))
        .catch((e) => mine === request.current && setPairError('配对预览失败：' + e.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [currentSignature]);
  const lines = pairingLines(pairs, model);
  const paired = pairs?.paired?.length || 0;
  const usable = result && ['balanced', 'outside_tolerance'].includes(result.conclusion);
  const pointSig = useMemo(
    () => (usable ? pointSignature(result.changes, frozenModel) : null),
    [usable, result, frozenModel],
  );
  const applied = !!pointSig && pointSig === currentSignature && pointSig !== state.modelSignature;
  const stale = modelChanged && !applied;

  return (
    <div className="analysis-view" data-testid="balance-view">
      <div className="analysis-form">
        <label className="field">
          <span>平衡方式</span>
          <select
            aria-label="平衡方式"
            value={settings.mode}
            onChange={(e) => set({ mode: e.target.value as BalanceSettings['mode'] })}
          >
            <option value="variable" disabled={!pumps.length}>
              泵速参与：求最低泵速（变频泵）
            </option>
            <option value="fixed">泵速固定，只调阀门（定速泵）</option>
          </select>
        </label>
        {settings.mode === 'variable' && (
          <>
            <label className="field">
              <span>调速泵</span>
              <select
                aria-label="调速泵"
                value={settings.pump}
                onChange={(e) => set({ pump: e.target.value })}
              >
                {pumps.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.name || p.id}（当前 {fmt(p.speed ?? 1)}）
                  </option>
                ))}
              </select>
            </label>
            <div className="balance-pair">
              <NumberField
                label="泵速下限"
                value={settings.lower}
                min={0}
                strict
                max={2}
                onApply={(v: number) => set({ lower: v })}
              />
              <NumberField
                label="泵速上限"
                value={settings.upper}
                min={0}
                strict
                max={2}
                onApply={(v: number) => set({ upper: v })}
              />
            </div>
          </>
        )}
        <div className="balance-pair">
          <NumberField
            label="设定精度"
            value={settings.step}
            min={0}
            strict
            max={0.1}
            onApply={(v: number) => set({ step: v })}
          />
          <NumberField
            label="验证容差"
            unit="%"
            value={settings.tolerancePercent}
            min={0}
            strict
            max={50}
            onApply={(v: number) => set({ tolerancePercent: v })}
          />
        </div>
        <div className="field" data-testid="balance-pairs">
          <span>末端与平衡阀配对</span>
          {pairError && <small className="field-error">{pairError}</small>}
          {!pairs && !pairError && <small>正在识别…</small>}
          <ul className="balance-pair-list">
            {lines.map((l) => (
              <li key={l.text} className={l.ok ? '' : 'warn'}>
                {l.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="analysis-actions">
          {running ? (
            <button onClick={cancel}>取消分析</button>
          ) : (
            <button
              className="primary"
              disabled={!!problems.length || !paired}
              onClick={() => start(buildBalanceRequest(model, settings))}
            >
              计算水力平衡
            </button>
          )}
          <small>
            各末端按设计流量整定平衡阀；泵速参与时取能满足最不利环路的最低泵速。不修改工程，结果可保存或应用。
          </small>
          {pairs && !paired && (
            <small className="field-error">没有可调节的末端：需要末端串联唯一的平衡阀</small>
          )}
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
          progressTestId="balance-progress"
          progress={
            <ProgressCount
              label="正在计算"
              progress={state.progress}
              fallbackTotal={settings.mode === 'variable' ? 35 : 3}
            />
          }
          cancelledText="已取消平衡计算。"
          stale={stale}
          staleTestId="balance-stale"
          staleText="平衡结果对应运行时的模型；模型已修改，结果仅供参考，请重新计算。"
        />
        {result && (
          <BalanceResult
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
