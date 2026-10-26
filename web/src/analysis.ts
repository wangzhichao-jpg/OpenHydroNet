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

export function buildAccessibilityRequest(model: any, rows: ConstraintRow[]) {
  return {
    kind: 'accessibility' as const,
    model: structuredClone(model),
    constraints: constraintsToSI(rows),
    variables: [] as any[],
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
