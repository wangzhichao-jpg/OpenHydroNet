// Save a computed operating point as a scenario or apply it to the project (shared by accessibility and
// balancing). "Applied" means the current model equals the point; any other edit makes it stale.
import React from 'react';

export default function PointActions({
  testId,
  stale,
  applied,
  summary,
  staleNote,
  onSave,
  onApply,
}: {
  testId: string;
  stale: boolean;
  applied: boolean;
  summary: string;
  staleNote: string;
  onSave: () => void;
  onApply: () => void;
}) {
  return (
    <div className="button-row" data-testid={testId}>
      <button disabled={stale} onClick={onSave}>
        保存为工况快照
      </button>
      <button className="primary" disabled={stale || applied} onClick={onApply}>
        {applied ? '已应用' : '应用到当前工程'}
      </button>
      <small data-testid={testId + '-note'}>
        {stale
          ? staleNote
          : applied
            ? `已应用到当前工程：${summary}。可撤销（Ctrl+Z）；请重新计算主结果。`
            : '保存工况不改变当前工程；应用后可撤销，需重新计算主结果。'}
      </small>
    </div>
  );
}
