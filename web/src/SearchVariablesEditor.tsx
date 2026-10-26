// 可及性搜索的调节量：勾选、下界、上界、设定精度（SPEC-001 D8）。
import React from 'react';
import NumberField from './NumberField';
import { SearchVariable, fmt } from './analysis';

export default function SearchVariablesEditor({
  vars,
  onChange,
}: {
  vars: SearchVariable[];
  onChange: (v: SearchVariable, patch: Partial<SearchVariable>) => void;
}) {
  return (
    <div className="field" data-testid="search-variables">
      <span>调节量（可选；勾选后在上下界内做局部搜索）</span>
      {vars.map((v) => (
        <div className="search-variable" key={v.id + v.field}>
          <label className="check">
            <input
              type="checkbox"
              aria-label={'参与调节 ' + v.label}
              checked={v.enabled}
              onChange={(e) => onChange(v, { enabled: e.target.checked })}
            />
            {v.label}（当前 {fmt(v.value)}）
          </label>
          {v.enabled && (
            <div className="search-bounds">
              <small aria-hidden="true">下界</small>
              <small aria-hidden="true">上界</small>
              <small aria-hidden="true">设定精度</small>
              <NumberField
                label={v.label + ' 下界'}
                value={v.lower}
                min={v.min}
                max={v.max}
                onApply={(x: number) => onChange(v, { lower: x })}
              />
              <NumberField
                label={v.label + ' 上界'}
                value={v.upper}
                min={v.min}
                max={v.max}
                onApply={(x: number) => onChange(v, { upper: x })}
              />
              <NumberField
                label={v.label + ' 设定精度'}
                value={v.step}
                min={0}
                strict
                max={v.max}
                onApply={(x: number) => onChange(v, { step: x })}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
