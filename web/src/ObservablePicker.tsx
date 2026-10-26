// Shared observable chooser for analysis views: removable chips plus an "add" select.
import React, { useMemo } from 'react';
import { Observable, observableKey, observableLabel, observableOptions } from './analysis';

export default function ObservablePicker({
  model,
  flowUnit,
  value,
  onChange,
}: {
  model: any;
  flowUnit: string;
  value: Observable[];
  onChange: (next: Observable[]) => void;
}) {
  const options = useMemo(() => observableOptions(model), [model]);
  return (
    <div className="field">
      <span>观测量</span>
      <div className="chips">
        {value.map((o) => (
          <button
            key={observableKey(o)}
            className="chip"
            title="移除该观测量"
            onClick={() => onChange(value.filter((x) => observableKey(x) !== observableKey(o)))}
          >
            {observableLabel(o, model, flowUnit)} ×
          </button>
        ))}
        <select
          aria-label="添加观测量"
          value=""
          onChange={(e) => {
            const o = options.find((x) => observableKey(x) === e.target.value);
            if (o) onChange([...value, o]);
          }}
        >
          <option value="">＋ 添加…</option>
          {options
            .filter((o) => !value.some((x) => observableKey(x) === observableKey(o)))
            .map((o) => (
              <option key={observableKey(o)} value={observableKey(o)}>
                {observableLabel(o, model, flowUnit)}
              </option>
            ))}
        </select>
      </div>
    </div>
  );
}
