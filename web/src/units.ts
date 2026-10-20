// SI model values never depend on the display unit or an earlier result.
export const flowUnits = ['m3/h', 'kg/h', 't/h', 'L/s'] as const;
export type FlowUnit = (typeof flowUnits)[number];
export const unitLabel: Record<string, string> = {
  'm3/h': 'm³/h',
  'kg/h': 'kg/h',
  't/h': 't/h',
  'L/s': 'L/s',
};
export function waterDensity(temperature: number): number {
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 100)
    throw Error('水温必须为 0–100 ℃');
  const t = temperature;
  return 1000 * (1 - ((t + 288.9414) / (508929.2 * (t + 68.12963))) * (t - 3.9863) ** 2);
}
export function flowFactor(unit: string, density: number): number {
  if (unit === 'm3/h') return 3600;
  if (unit === 'L/s') return 1000;
  if (!Number.isFinite(density) || density <= 0) throw Error('质量流量换算缺少有效密度');
  if (unit === 'kg/h') return 3600 * density;
  if (unit === 't/h') return 3.6 * density;
  throw Error('不支持的流量单位：' + unit);
}
export function resultFlow(result: any, id: string, unit: string): number | undefined {
  const q = result?.edges?.[id]?.flow_m3_s;
  if (!Number.isFinite(q)) return undefined;
  const density = result?.fluid?.density_kg_m3;
  if ((unit === 'kg/h' || unit === 't/h') && (!Number.isFinite(density) || density <= 0))
    return undefined;
  return q * flowFactor(unit, density);
}
export function compareFlows(baseline: any, current: any, id: string, unit: string) {
  const before = resultFlow(baseline, id, unit),
    now = resultFlow(current, id, unit);
  const comparable = Number.isFinite(before) && Number.isFinite(now);
  const delta = comparable ? now! - before! : undefined;
  return {
    baseline: before,
    current: now,
    delta,
    percent:
      comparable && Math.abs(before!) > 1e-12 ? (delta! / Math.abs(before!)) * 100 : undefined,
  };
}
export function validateNumber(
  text: string,
  min = -Infinity,
  max = Infinity,
  strict = false,
  integer = false,
) {
  const value = Number(text);
  return (
    text.trim() !== '' &&
    Number.isFinite(value) &&
    (strict ? value > min : value >= min) &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}
