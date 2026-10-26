// Pure helpers for the analysis workspace (SPEC-001). Kernel values are SI; conversion happens here only.
import { flowFactor, unitLabel } from './units';
import { statusText } from './status';

export const MAX_SCAN_POINTS = 1000;

/** Display formatting for analysis tables; missing values show as an em dash, never 0. */
export const fmt = (v: number | undefined, d = 4) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Number(v.toPrecision(d)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
    : '—';
export type Observable = { scope: 'edge' | 'node'; id: string; field: string };
export type ScanVariable = { id: string; field: string; values: number[] };
export type AdjustableParam = {
  id: string;
  field: 'speed' | 'opening';
  label: string;
  min: number;
  max: number;
  value: number;
};

const FIELD_NAMES: Record<string, string> = {
  flow_m3_s: '流量',
  head_drop_m: '水头差',
  velocity_m_s: '流速',
  head_m: '测压管水头',
  pressure_pa_gauge: '表压',
};
const ADJUSTABLE: Record<
  string,
  { field: 'speed' | 'opening'; name: string; min: number; max: number }
> = {
  pump: { field: 'speed', name: '相对转速', min: 0, max: 2 },
  valve: { field: 'opening', name: '开度', min: 0, max: 1 },
};

/** Evenly spaced values including both ends; rounded to suppress binary noise such as 0.8000000000000002. */
export function linspace(start: number, stop: number, count: number): number[] {
  if (!Number.isFinite(start) || !Number.isFinite(stop)) throw Error('起点和终点必须是有效数值');
  if (!Number.isInteger(count) || count < 1) throw Error('点数必须是正整数');
  if (count > MAX_SCAN_POINTS) throw Error('单批扫描限 1000 点；请拆分批次');
  if (count === 1) return [start];
  return Array.from(
    { length: count },
    (_, i) => +(start + ((stop - start) * i) / (count - 1)).toPrecision(12),
  );
}

const nameOf = (model: any, scope: string, id: string) =>
  (scope === 'node' ? model.nodes : model.edges).find((x: any) => x.id === id)?.name || id;

export function adjustableParams(model: any): AdjustableParam[] {
  return model.edges.flatMap((e: any) => {
    const a = ADJUSTABLE[e.kind];
    if (!a) return [];
    const value = Number.isFinite(e[a.field]) ? e[a.field] : 1;
    return [
      {
        id: e.id,
        field: a.field,
        label: `${e.name || e.id} · ${a.name}`,
        min: a.min,
        max: a.max,
        value,
      },
    ];
  });
}

export function defaultObservables(model: any): Observable[] {
  return model.edges
    .filter((e: any) => e.kind === 'terminal')
    .map((e: any) => ({ scope: 'edge', id: e.id, field: 'flow_m3_s' }));
}

export function observableOptions(model: any): Observable[] {
  return [
    ...model.edges.flatMap((e: any) =>
      ['flow_m3_s', 'head_drop_m'].map((field) => ({ scope: 'edge' as const, id: e.id, field })),
    ),
    ...model.nodes.flatMap((n: any) =>
      ['head_m', 'pressure_pa_gauge'].map((field) => ({ scope: 'node' as const, id: n.id, field })),
    ),
  ];
}

function displayUnit(o: Observable, flowUnit: string) {
  if (o.field === 'flow_m3_s') return unitLabel[flowUnit] || flowUnit;
  if (o.field === 'pressure_pa_gauge') return 'kPa';
  if (o.field === 'velocity_m_s') return 'm/s';
  return 'm';
}

export function observableLabel(o: Observable, model: any, flowUnit: string) {
  return `${nameOf(model, o.scope, o.id)} ${FIELD_NAMES[o.field] || o.field} [${displayUnit(o, flowUnit)}]`;
}

export const observableKey = (o: Observable) => `${o.scope}:${o.id}:${o.field}`;

/** SI → display. Mass units need the density the kernel actually used; without it nothing is shown. */
export function toDisplay(
  o: Observable,
  si: number | null | undefined,
  flowUnit: string,
  density?: number,
) {
  if (typeof si !== 'number' || !Number.isFinite(si)) return undefined;
  if (o.field === 'flow_m3_s') {
    if ((flowUnit === 'kg/h' || flowUnit === 't/h') && !(Number.isFinite(density) && density! > 0))
      return undefined;
    return si * flowFactor(flowUnit, density ?? NaN);
  }
  if (o.field === 'pressure_pa_gauge') return si / 1000;
  return si;
}

export function buildScanRequest(model: any, variables: ScanVariable[], observables: Observable[]) {
  return { kind: 'scan' as const, model: structuredClone(model), variables, observables };
}

// Short labels for kernel issue codes; full messages stay in the main issue list.
const ISSUE_TEXT: Record<string, string> = {
  TERMINAL_DEMAND: '末端低于设计流量',
  CONTROL_HEAD: '流控压差不足',
  HIGH_VELOCITY: '流速超过 3 m/s',
  PUMP_EXTRAPOLATION: '泵曲线外推',
  NEGATIVE_PUMP_HEAD: '泵负扬程外推',
  VAPOUR_SCREEN: '汽化风险',
  RESIDUAL: '残差未达标',
  BOUNDARY_CONFLICT: '边界冲突',
};

export function issueText(issue: { code: string; object_id?: string | null }, model?: any) {
  const label = ISSUE_TEXT[issue.code] || issue.code;
  if (!issue.object_id) return label;
  const name = model ? nameOf(model, 'edge', issue.object_id) : issue.object_id;
  const node = model?.nodes?.find((n: any) => n.id === issue.object_id);
  return `${label}（${node ? node.name || node.id : name}）`;
}

export type ScanRow = {
  params: number[];
  values: (number | undefined)[];
  status: string;
  issues: string[];
};

export function scanRows(result: any, flowUnit: string, model?: any): ScanRow[] {
  const density = result?.fluid?.density_kg_m3;
  return (result?.records || []).map((r: any) => ({
    params: r.changes.map((c: any) => c.value),
    values: result.observables.map((o: Observable, i: number) =>
      toDisplay(o, r.values[i], flowUnit, density),
    ),
    status: statusText[r.status] || r.status,
    issues: (r.issues || []).map((i: any) => issueText(i, model)),
  }));
}

// ---- 可及性（T-005）----
export type ConstraintKind = 'min_flow' | 'max_flow' | 'min_head';
/** One editable constraint. ``si`` is m³/s for flows and m for head, independent of the display unit. */
export type ConstraintRow = { key: string; id: string; kind: ConstraintKind; si: number };

export const constraintKinds: ConstraintKind[] = ['min_flow', 'max_flow', 'min_head'];
const CONSTRAINT_NAMES: Record<ConstraintKind, string> = {
  min_flow: '最小流量',
  max_flow: '最大流量',
  min_head: '最小压降（资用压头）',
};
export const constraintLabel = (kind: ConstraintKind, flowUnit: string) =>
  `${CONSTRAINT_NAMES[kind]} [${kind === 'min_head' ? 'm' : unitLabel[flowUnit] || flowUnit}]`;

/** Kernel conclusions (GLOSSARY: 可及性). A failed local search is never reported as proof of no solution. */
export const conclusionText: Record<string, string> = {
  feasible_at_this_point: '当前工作点满足全部约束',
  not_satisfied_at_this_point: '当前工作点不满足约束',
  feasible_point_found: '在给定调节范围内找到满足全部约束的工作点',
  undetermined: '未确定：局部搜索在给定范围内没有找到满足全部约束的点，这不能证明无解',
};

let rowSeq = 0;
export const newConstraintRow = (id: string, kind: ConstraintKind, si: number): ConstraintRow => ({
  key: 'c' + ++rowSeq,
  id,
  kind,
  si,
});

export function defaultConstraintRows(model: any): ConstraintRow[] {
  return model.edges
    .filter(
      (e: any) => e.kind === 'terminal' && Number.isFinite(e.design_flow) && e.design_flow > 0,
    )
    .map((e: any) => newConstraintRow(e.id, 'min_flow', e.design_flow));
}

/** SI → display; mass units need a valid density, otherwise nothing is shown. */
export function constraintToDisplay(row: ConstraintRow, flowUnit: string, density: number) {
  if (row.kind === 'min_head') return row.si;
  const shown = toDisplay(
    { scope: 'edge', id: row.id, field: 'flow_m3_s' },
    row.si,
    flowUnit,
    density,
  );
  return shown === undefined ? undefined : +shown.toPrecision(12);
}

/** Display → SI using the density of the model being edited (ADR-004); throws without a valid density. */
export function constraintFromDisplay(
  kind: ConstraintKind,
  value: number,
  flowUnit: string,
  density: number,
) {
  return kind === 'min_head' ? value : value / flowFactor(flowUnit, density);
}

export function constraintsToSI(rows: ConstraintRow[]) {
  return rows.map((r) => ({ id: r.id, [r.kind]: r.si })) as {
    id: string;
    min_flow?: number;
    max_flow?: number;
    min_head?: number;
  }[];
}

export function buildAccessibilityRequest(
  model: any,
  rows: ConstraintRow[],
  variables: SearchVariable[] = [],
) {
  return {
    kind: 'accessibility' as const,
    model: structuredClone(model),
    constraints: constraintsToSI(rows),
    variables: variables
      .filter((v) => v.enabled)
      .map(({ id, field, lower, upper, step }) => ({ id, field, lower, upper, step })),
  };
}

export type CheckRow = {
  object: string;
  kind: string;
  required?: number;
  actual?: number;
  satisfied: boolean;
  shortfall: string;
};

/** Kernel checks → display rows, converted with the result's own density. */
export function checkRows(result: any, model: any, flowUnit: string): CheckRow[] {
  const density = result?.fluid?.density_kg_m3;
  return (result?.checks || []).map((c: any) => {
    const o: Observable = {
      scope: 'edge',
      id: c.id,
      field: c.kind === 'min_head' ? 'head_drop_m' : 'flow_m3_s',
    };
    return {
      object: nameOf(model, 'edge', c.id),
      kind: constraintLabel(c.kind, flowUnit),
      required: toDisplay(o, c.required, flowUnit, density),
      actual: toDisplay(o, c.actual, flowUnit, density),
      satisfied: !!c.satisfied,
      shortfall: c.satisfied ? '—' : (c.violation * 100).toFixed(1) + '%',
    };
  });
}

/** Same rules as the kernel's constraint validation, checked before a run (Chinese messages). */
export function constraintProblems(rows: ConstraintRow[], model: any): string[] {
  if (!rows.length) return ['请至少设置一条约束'];
  const problems: string[] = [];
  const seen = new Set<string>();
  const flows: Record<string, { min_flow?: number; max_flow?: number }> = {};
  for (const r of rows) {
    const name = nameOf(model, 'edge', r.id);
    if (!model.edges.some((e: any) => e.id === r.id))
      problems.push(`约束对象 ${r.id} 已不存在，请删除或改选`);
    if (!Number.isFinite(r.si) || r.si < 0) problems.push(`${name} 的约束值不能为负或无效`);
    if (seen.has(r.id + r.kind)) problems.push(`${name} 的${CONSTRAINT_NAMES[r.kind]}约束重复`);
    seen.add(r.id + r.kind);
    if (r.kind !== 'min_head') (flows[r.id] ||= {})[r.kind] = r.si;
  }
  for (const [id, f] of Object.entries(flows))
    if (f.min_flow !== undefined && f.max_flow !== undefined && f.min_flow > f.max_flow)
      problems.push(`${nameOf(model, 'edge', id)} 的流量下限大于上限`);
  return problems;
}

// ---- 有界局部搜索（T-006）----
/** ``step``: settable precision (SPEC-001 D8, default 0.01); the kernel rounds the found point to it. */
export type SearchVariable = AdjustableParam & {
  lower: number;
  upper: number;
  step: number;
  enabled: boolean;
};
export const DEFAULT_STEP = 0.01;

const round2 = (v: number) => Math.round(v * 100) / 100;

/** All adjustable parameters, unselected. Pump: current speed ±0.4; valve: 0.1–1 (both within physical limits). */
export function searchVariables(model: any): SearchVariable[] {
  return adjustableParams(model).map((p) => ({
    ...p,
    lower: p.field === 'speed' ? Math.max(p.min, round2(p.value - 0.4)) : 0.1,
    upper: p.field === 'speed' ? Math.min(p.max, round2(p.value + 0.4)) : 1,
    step: DEFAULT_STEP,
    enabled: false,
  }));
}

export function searchProblems(vars: SearchVariable[]): string[] {
  return vars
    .filter((v) => v.enabled)
    .flatMap((v) => {
      if (!(Number.isFinite(v.lower) && Number.isFinite(v.upper) && v.lower < v.upper))
        return [`${v.label}：下界必须小于上界`];
      if (v.lower < v.min || v.upper > v.max)
        return [`${v.label}：范围须在 ${v.min}–${v.max} 之内`];
      if (!(Number.isFinite(v.step) && v.step > 0 && v.step <= v.upper - v.lower))
        return [`${v.label}：设定精度须大于 0 且不超过上下界宽度`];
      return [];
    });
}

export type AdjustmentRow = { label: string; from: number; to: number; delta: number };

/** Found adjustment versus the model the search ran on. */
export function adjustmentRows(result: any, frozenModel: any): AdjustmentRow[] {
  const params = adjustableParams(frozenModel);
  return (result?.changes || []).map((c: any) => {
    const p = params.find((x) => x.id === c.id && x.field === c.field);
    const from = p ? p.value : NaN;
    return { label: p?.label || c.id, from, to: c.value, delta: +(c.value - from).toPrecision(12) };
  });
}

// ---- 可行点落地（T-007）----
/** Copy of ``model`` with found operating adjustments applied (pump speed / valve opening only). */
export function applyAdjustments(
  model: any,
  changes: { id: string; field: string; value: number }[],
) {
  const next = structuredClone(model);
  for (const c of changes) {
    const e = next.edges.find((x: any) => x.id === c.id);
    if (!e) throw Error(`调节对象不存在：${c.id}`);
    if (!adjustableParams({ edges: [e] }).some((p) => p.field === c.field))
      throw Error('只能应用泵相对转速和阀开度，仅限运行调节量');
    e[c.field] = c.value;
  }
  return next;
}

/** One-line description of the real changes (|Δ| ≥ 1e-5), e.g. "循环泵 · 相对转速 1 → 1.135". */
export function adjustmentSummary(result: any, frozenModel: any) {
  return adjustmentRows(result, frozenModel)
    .filter((a) => Math.abs(a.delta) >= 1e-5)
    .map((a) => `${a.label} ${fmt(a.from)} → ${fmt(a.to)}`)
    .join('；');
}

// ---- 尽量少调整与设定精度（T-009）----
/** "label value" for each change that differs from the frozen model (|Δ| ≥ 1e-5). */
function describeChanges(changes: any[] | null | undefined, frozenModel: any) {
  const rows = adjustmentRows({ changes }, frozenModel).filter((a) => Math.abs(a.delta) >= 1e-5);
  return rows.length ? rows.map((a) => `${a.label} ${fmt(a.to)}`).join('；') : '与当前值相同';
}

/** Plain-language account of how the suggested point was obtained; empty unless a point was found. */
export function refinementNotes(result: any, frozenModel: any): string[] {
  if (result?.conclusion !== 'feasible_point_found' || result.objective !== 'min_change_local')
    return [];
  const notes = [
    '首个可行点：' + describeChanges(result.first_feasible_changes, frozenModel),
    '尽量少调整（局部，不保证最小）：' + describeChanges(result.unrounded_changes, frozenModel),
  ];
  const r = result.rounding || {};
  if (r.status === 'rounded_feasible')
    notes.push(
      `按设定精度取整：${describeChanges(result.changes, frozenModel)}，已重新验算，满足全部约束`,
    );
  else if (r.status === 'rounded_infeasible') {
    const names = [
      ...new Set((r.rounded_violations || []).map((v: any) => nameOf(frozenModel, 'edge', v.id))),
    ];
    notes.push(
      `按设定精度取整为 ${describeChanges(r.rounded_changes, frozenModel)} 时不满足约束（${names.join('、')}），以下保留未取整值`,
    );
  } else if (r.status === 'exact') notes.push('已在设定精度上，无需取整');
  else if (r.status === 'not_verified') notes.push('已达评估上限，未完成取整验算，以下为未取整值');
  return notes;
}

// ---- 扫描曲线与 CSV（T-002）----
/** Round axis ticks (1/2/5 × 10ⁿ) covering [min, max]; a flat range is widened so the axis is never empty. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) {
    const pad = Math.abs(min) * 0.1 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / count,
    mag = 10 ** Math.floor(Math.log10(raw)),
    norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let k = Math.floor(min / step); k <= Math.ceil(max / step); k++)
    ticks.push(+(k * step).toPrecision(12));
  return ticks;
}

/** Split a series at missing values: failed points break the line and are never interpolated. */
export function seriesSegments(xs: number[], ys: (number | undefined)[]): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  xs.forEach((x, i) => {
    const y = ys[i];
    if (typeof y === 'number' && Number.isFinite(y)) current.push([x, y]);
    else if (current.length) {
      segments.push(current);
      current = [];
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

/** Observables sharing a y axis, in order of first appearance. */
export function unitGroups(observables: Observable[], flowUnit: string) {
  const groups: { unit: string; indexes: number[] }[] = [];
  observables.forEach((o, i) => {
    const unit = displayUnit(o, flowUnit);
    const g = groups.find((x) => x.unit === unit);
    if (g) g.indexes.push(i);
    else groups.push({ unit, indexes: [i] });
  });
  return groups;
}

/** CSV cell; text starting like a formula is prefixed with ' (never executed), then quoted if needed. */
function csvCell(value: string | number | undefined) {
  if (value === undefined) return '';
  if (typeof value === 'number') return String(+value.toPrecision(12));
  let text = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

/** Scan result as CSV (UTF-8 BOM, CRLF), in the current display units and the result's own density. */
export function scanCsv(result: any, frozenModel: any, flowUnit: string) {
  const params = adjustableParams(frozenModel);
  const paramLabels = result.variables.map(
    (v: any) => params.find((p) => p.id === v.id && p.field === v.field)?.label || v.id,
  );
  const header = [
    ...paramLabels,
    ...result.observables.map((o: Observable) => observableLabel(o, frozenModel, flowUnit)),
    '状态',
    '问题',
  ];
  const rows = scanRows(result, flowUnit, frozenModel).map((r) => [
    ...r.params,
    ...r.values,
    r.status,
    r.issues.join('；'),
  ]);
  return (
    '\ufeff' + [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
  );
}

// ---- 敏感性（T-004）----
export const DEFAULT_DIFF_STEP = 0.005;

export function buildSensitivityRequest(
  model: any,
  parameters: { id: string; field: string }[],
  observables: Observable[],
  step = DEFAULT_DIFF_STEP,
) {
  return {
    kind: 'sensitivity' as const,
    model: structuredClone(model),
    parameters,
    observables,
    step,
  };
}

const METHOD_TEXT: Record<string, string> = {
  central: '中心差分',
  forward: '单侧差分（已在下限）',
  backward: '单侧差分（已在上限）',
};

export type SensitivityCell = {
  param: string;
  elasticity?: number;
  derivative?: number;
  method: string;
};
export type SensitivityRow = {
  label: string;
  base?: number;
  cells: SensitivityCell[];
  strongest: number;
};

/** One row per observable; derivatives in display units per unit of the parameter, ranked by |elasticity|. */
export function sensitivityRows(result: any, frozenModel: any, flowUnit: string): SensitivityRow[] {
  const density = result?.fluid?.density_kg_m3;
  const params = adjustableParams(frozenModel);
  return (result?.observables || []).map((o: Observable, i: number) => {
    const cells: SensitivityCell[] = result.parameters.map((p: any) => {
      const ok = p.status === 'ok';
      const e = ok ? p.elasticities[i] : null;
      return {
        param: params.find((x) => x.id === p.id && x.field === p.field)?.label || p.id,
        elasticity: typeof e === 'number' && Number.isFinite(e) ? e : undefined,
        derivative: ok ? toDisplay(o, p.derivatives[i], flowUnit, density) : undefined,
        method: ok ? METHOD_TEXT[p.method] || p.method : '未确定（差分点未收敛）',
      };
    });
    let strongest = -1;
    cells.forEach((c, j) => {
      if (c.elasticity === undefined) return;
      if (strongest < 0 || Math.abs(c.elasticity) > Math.abs(cells[strongest].elasticity!))
        strongest = j;
    });
    return {
      label: observableLabel(o, frozenModel, flowUnit),
      base: toDisplay(o, result.base_values[i], flowUnit, density),
      cells,
      strongest,
    };
  });
}

export function strongestText(row: SensitivityRow) {
  if (row.strongest < 0) return '基准值为 0 或差分未完成，无法按弹性排序';
  const c = row.cells[row.strongest],
    e = c.elasticity!;
  return `影响最大：${c.param}（弹性 ${fmt(e, 3)}：参数增加 1%，约${e >= 0 ? '增加' : '减少'} ${fmt(Math.abs(e), 3)}%）`;
}

// ---- 双参数扫描（T-003）----
/** Two-parameter rows → x = first parameter, one series per second-parameter value (SPEC-001 D6). */
export function gridSeries(rows: ScanRow[], observableIndex: number, secondLabel: string) {
  const xs: number[] = [],
    seconds: number[] = [];
  for (const r of rows) {
    if (!xs.includes(r.params[0])) xs.push(r.params[0]);
    if (!seconds.includes(r.params[1])) seconds.push(r.params[1]);
  }
  return {
    xs,
    series: seconds.map((b) => ({
      key: 'second:' + b,
      label: `${secondLabel} = ${fmt(b)}`,
      ys: xs.map(
        (a) => rows.find((r) => r.params[0] === a && r.params[1] === b)?.values[observableIndex],
      ),
    })),
  };
}
