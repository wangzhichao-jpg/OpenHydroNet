// 可及性约束编辑。约束行按 SI 保存，显示单位只影响输入与显示（切换单位不会改变要求）。
import React from 'react';
import NumberField from './NumberField';
import { waterDensity } from './units';
import {
  ConstraintRow,
  ConstraintKind,
  constraintKinds,
  constraintLabel,
  constraintToDisplay,
  constraintFromDisplay,
  defaultConstraintRows,
  newConstraintRow,
} from './analysis';

export default function ConstraintEditor({
  model,
  flowUnit,
  rows,
  onChange,
}: {
  model: any;
  flowUnit: string;
  rows: ConstraintRow[];
  onChange: (update: (rows: ConstraintRow[]) => ConstraintRow[]) => void;
}) {
  // Editing uses the density of the model being edited (ADR-004).
  let density = NaN;
  try {
    density = waterDensity(model.fluid?.temperature ?? 20);
  } catch {}
  const edgeName = (id: string) => model.edges.find((e: any) => e.id === id)?.name || id;
  const update = (key: string, patch: Partial<ConstraintRow>) =>
    onChange((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const firstTerminal = model.edges.find((e: any) => e.kind === 'terminal') || model.edges[0];

  return (
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
                    update(r.key, { si: constraintFromDisplay(r.kind, v, flowUnit, density) });
                  } catch {}
                }}
              />
              <button
                className="chip"
                title="删除该约束"
                aria-label={'删除约束 ' + label}
                onClick={() => onChange((all) => all.filter((x) => x.key !== r.key))}
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
            onChange((all) => [...all, newConstraintRow(firstTerminal.id, 'min_flow', 0)])
          }
        >
          ＋ 添加约束
        </button>
        <button onClick={() => onChange(() => defaultConstraintRows(model))}>
          恢复为末端设计流量
        </button>
      </div>
    </div>
  );
}
