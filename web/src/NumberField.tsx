import React, { useEffect, useState } from 'react';
import { validateNumber } from './units';
export default function NumberField({
  label,
  unit,
  value,
  min = -Infinity,
  max = Infinity,
  strict = false,
  integer = false,
  optional = false,
  onApply,
  hint,
}: any) {
  const [text, setText] = useState(String(value ?? ''));
  useEffect(() => setText(String(value ?? '')), [value]);
  const blank = text.trim() === '';
  const valid = (optional && blank) || validateNumber(text, min, max, strict, integer);
  return (
    <label className="field">
      <span>
        {label}
        <em>{unit}</em>
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={!valid}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (valid && optional && blank) {
            if (value != null && value !== '') onApply(null);
          } else if (valid && Number(text) !== value) onApply(Number(text));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setText(String(value ?? ''));
          }
        }}
      />
      {!valid ? (
        <small className="field-error">
          请输入{integer ? '整数' : '有限数'}
          {Number.isFinite(min) ? `，${strict ? '大于' : '不小于'} ${min}` : ''}
          {Number.isFinite(max) ? `，不大于 ${max}` : ''}；未提交无效值。Esc 放弃该输入。
        </small>
      ) : (
        hint && <small>{hint}</small>
      )}
    </label>
  );
}
