// Pure helpers for the analysis workspace (SPEC-001). Kernel values are SI; conversion happens here only.
import { flowFactor, unitLabel } from './units';
import { statusText } from './status';

export const MAX_SCAN_POINTS = 1000;
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
