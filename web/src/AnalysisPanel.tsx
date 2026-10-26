// SPEC-001 分析页外壳。子页始终挂载、只切换显示，避免切换时丢失结果或取消正在运行的任务。
import React, { useState } from 'react';
import ScanView from './ScanView';
import AccessibilityView from './AccessibilityView';

const MODES = [
  ['scan', '参数扫描'],
  ['accessibility', '可及性'],
] as const;

export default function AnalysisPanel({ model, flowUnit }: { model: any; flowUnit: string }) {
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
        <AccessibilityView model={model} flowUnit={flowUnit} />
      </div>
    </div>
  );
}
