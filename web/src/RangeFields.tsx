// 扫描参数的起点 / 终点 / 点数（单参数与第二参数共用）。
import React from 'react';
import NumberField from './NumberField';
import { MAX_SCAN_POINTS } from './analysis';

/** Start / stop / point count for one scanned parameter. */
export default function RangeFields({
  param,
  range,
  prefix = '',
  onChange,
}: {
  param: { min: number; max: number };
  range: { start: number; stop: number; count: number };
  prefix?: string;
  onChange: (patch: Partial<{ start: number; stop: number; count: number }>) => void;
}) {
  return (
    <div className="analysis-range">
      <NumberField
        label={prefix + '起点'}
        value={range.start}
        min={param.min}
        max={param.max}
        onApply={(v: number) => onChange({ start: v })}
      />
      <NumberField
        label={prefix + '终点'}
        value={range.stop}
        min={param.min}
        max={param.max}
        onApply={(v: number) => onChange({ stop: v })}
      />
      <NumberField
        label={prefix + '点数'}
        value={range.count}
        min={1}
        max={MAX_SCAN_POINTS}
        integer
        onApply={(v: number) => onChange({ count: v })}
      />
    </div>
  );
}
