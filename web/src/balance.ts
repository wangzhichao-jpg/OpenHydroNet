// Pure helpers for the hydraulic balancing view (SPEC-002). Kernel values are SI; conversion happens here.
import { fmt, toDisplay, pointSignature } from './analysis';
import { unitLabel } from './units';

export { pointSignature };

export type BalanceSettings = {
  mode: 'variable' | 'fixed';
  pump: string;
  lower: number;
  upper: number;
  step: number;
  tolerancePercent: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const nameOf = (model: any, id: string) => model.edges.find((e: any) => e.id === id)?.name || id;
const FLOW = (id: string) => ({ scope: 'edge' as const, id, field: 'flow_m3_s' });
const signedPercent = (fraction: number) =>
  (fraction >= 0 ? '+' : '') + (fraction * 100).toFixed(1) + '%';

/** SPEC-002 defaults: lowest speed of the (first) pump within current ±0.5, step 0.01, ±5 % tolerance. */
export function defaultBalanceSettings(model: any): BalanceSettings {
  const pump = model.edges.find((e: any) => e.kind === 'pump');
  const v = Number.isFinite(pump?.speed) ? pump.speed : 1;
  return {
    mode: pump ? 'variable' : 'fixed',
    pump: pump?.id || '',
    lower: Math.max(0.1, round2(v - 0.5)),
    upper: Math.min(2, round2(v + 0.5)),
    step: 0.01,
    tolerancePercent: 5,
  };
}

/** Same rules as the kernel's ``_check_balance``, checked before a run. */
export function balanceProblems(s: BalanceSettings, model: any): string[] {
  const problems: string[] = [];
  if (s.mode === 'variable') {
    if (!model.edges.some((e: any) => e.id === s.pump && e.kind === 'pump'))
      problems.push('请选择参与调速的泵');
    if (!(s.lower > 0 && s.lower < s.upper && s.upper <= 2))
      problems.push('泵速下限须小于上限，且在 0–2 之间');
  }
  if (!(s.step > 0 && s.step <= 0.1)) problems.push('设定精度须大于 0 且不超过 0.1');
  if (!(s.tolerancePercent > 0 && s.tolerancePercent <= 50))
    problems.push('验证容差须大于 0 且不超过 50%');
  return problems;
}

export function buildBalanceRequest(model: any, s: BalanceSettings) {
  return {
    kind: 'balance' as const,
    model: structuredClone(model),
    mode: s.mode,
    pump: s.pump || undefined,
    lower: s.lower,
    upper: s.upper,
    step: s.step,
    tolerance: s.tolerancePercent / 100,
  };
}

/** Pairing preview from the kernel's ``pair_balancing_valves``. */
export function pairingLines(pairs: any, model: any): { text: string; ok: boolean }[] {
  return [
    ...(pairs?.paired || []).map((p: any) => ({
      text: `${nameOf(model, p.terminal)} ← ${nameOf(model, p.valve)}`,
      ok: true,
    })),
    ...(pairs?.unpaired || []).map((t: string) => ({
      text: `${nameOf(model, t)}：没有串联平衡阀，不参与调节，只报告平衡后的流量`,
      ok: false,
    })),
    ...(pairs?.ambiguous || []).map((a: any) => ({
      text: `${nameOf(model, a.terminal)}：串联多个阀门（${a.valves.map((v: string) => nameOf(model, v)).join('、')}），请只保留一个平衡阀`,
      ok: false,
    })),
  ];
}

export const balanceConclusionText: Record<string, string> = {
  balanced: '平衡完成：各末端验证流量均在容差内',
  outside_tolerance: '已算出平衡设置，但按设定精度取整后部分末端超出容差',
  not_achievable: '在给定条件下无法让全部末端达到设计流量',
  verification_failed: '验证计算未获得合格水力解，结果不可用',
};

function pairNote(p: any, result: any) {
  if (result.mode === 'variable' && p.terminal === result.index_terminal && p.opening === 1)
    return '最不利环路，保持全开';
  if (p.status === 'small_opening') return '开度小于 0.2：阀门口径可能偏大，调节性能差';
  if (p.status === 'needs_more_head') return `开到全开仍差 ${fmt(p.missing_head_m, 3)} m 压头`;
  if (p.status === 'cannot_throttle') return '阀门过大：关到最小仍节流不足';
  if (p.status === 'unsolved') return '未求解';
  return '—';
}

export type BalanceRow = {
  terminal: string;
  valve: string;
  design?: number;
  opening: string;
  verified?: number;
  deviation: string;
  withinTolerance: boolean;
  note: string;
};

export function balanceRows(result: any, frozenModel: any, flowUnit: string): BalanceRow[] {
  const density = result?.fluid?.density_kg_m3;
  return (result?.pairs || []).map((p: any) => {
    const hasFlow = typeof p.verified_flow_m3_s === 'number';
    return {
      terminal: nameOf(frozenModel, p.terminal),
      valve: nameOf(frozenModel, p.valve),
      design: toDisplay(FLOW(p.terminal), p.design_flow_m3_s, flowUnit, density),
      opening: p.opening == null ? '—' : fmt(p.opening),
      verified: hasFlow
        ? toDisplay(FLOW(p.terminal), p.verified_flow_m3_s, flowUnit, density)
        : undefined,
      deviation: hasFlow ? signedPercent(p.deviation) : '—',
      withinTolerance: hasFlow && Math.abs(p.deviation) <= result.tolerance,
      note: pairNote(p, result),
    };
  });
}

export function unpairedRows(result: any, frozenModel: any, flowUnit: string) {
  const density = result?.fluid?.density_kg_m3;
  return (result?.unpaired || []).map((u: any) => {
    const hasFlow = typeof u.verified_flow_m3_s === 'number';
    return {
      terminal: nameOf(frozenModel, u.terminal),
      design: toDisplay(FLOW(u.terminal), u.design_flow_m3_s, flowUnit, density),
      verified: hasFlow
        ? toDisplay(FLOW(u.terminal), u.verified_flow_m3_s, flowUnit, density)
        : undefined,
      deviation: hasFlow ? signedPercent(u.deviation) : '—',
      withinTolerance: hasFlow && Math.abs(u.deviation) <= result.tolerance,
    };
  });
}

/** Pump before/after (speed, head, flow, hydraulic power) with relative change. */
export function comparisonRows(result: any, flowUnit: string) {
  const b = result?.before?.pump,
    a = result?.after?.pump,
    density = result?.fluid?.density_kg_m3;
  if (!b || !a) return [];
  const flow = (v: number) => toDisplay(FLOW('pump'), v, flowUnit, density);
  const row = (label: string, before?: number, after?: number) => ({
    label,
    before,
    after,
    change:
      typeof before === 'number' && typeof after === 'number' && before !== 0
        ? signedPercent(after / before - 1)
        : '—',
  });
  return [
    row('泵相对转速', b.speed, a.speed),
    row('泵扬程 [m]', b.head_m, a.head_m),
    row(`泵流量 [${unitLabel[flowUnit] || flowUnit}]`, flow(b.flow_m3_s), flow(a.flow_m3_s)),
    row('泵水力功率 [W]', b.hydraulic_power_w, a.hydraulic_power_w),
  ];
}

export function indexText(result: any, frozenModel: any) {
  if (result?.mode !== 'variable' || !result.index_terminal) return '';
  const p = (result.pairs || []).find((x: any) => x.terminal === result.index_terminal);
  if (result.conclusion === 'not_achievable')
    return `差距最大：${nameOf(frozenModel, result.index_terminal)}（泵速到上限、阀门全开仍差 ${fmt(p?.missing_head_m, 3)} m）`;
  return `最不利环路：${nameOf(frozenModel, result.index_terminal)}（${p ? nameOf(frozenModel, p.valve) : ''} 保持全开）`;
}
