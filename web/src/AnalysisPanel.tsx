// SPEC-001 分析页外壳。子页始终挂载、只切换显示，避免切换时丢失结果或取消正在运行的任务。
import React, { useState } from 'react';
import ScanView from './ScanView';
import AccessibilityView from './AccessibilityView';

const MODES = [
  ['scan', '参数扫描'],
  ['accessibility', '可及性'],
] as const;

/** Ways an analysis result may change the project; both go through the document's undo history. */
export type AnalysisActions = {
  /** Add the found point (frozen model + adjustments, with its own result) as a scenario. */
  onSaveScenario: (model: any, result: any, summary: string) => void;
  /** Write the found adjustments into the current model. Returns false if the document refused. */
  onApply: (changes: { id: string; field: string; value: number }[], summary: string) => boolean;
};

export default function AnalysisPanel({
  model,
  flowUnit,
  actions,
}: {
  model: any;
  flowUnit: string;
  actions: AnalysisActions;
}) {
  const [mode, setMode] = useState<string>('scan');
  return (
    <div className="analysis-panel" data-testid="analysis-panel">
      <nav className="analysis-modes">
        {MODES.map(([id, label]) => (
          <button key={id} className={mode === id ? 'active' : ''} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
        <small>分析在运行时冻结的模型副本上进行；每个点都是独立稳态计算。</small>
      </nav>
      <div className="analysis-mode" hidden={mode !== 'scan'}>
        <ScanView model={model} flowUnit={flowUnit} />
      </div>
      <div className="analysis-mode" hidden={mode !== 'accessibility'}>
        <AccessibilityView model={model} flowUnit={flowUnit} actions={actions} />
      </div>
    </div>
  );
}
