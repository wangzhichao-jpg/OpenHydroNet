import { clone, type Project } from './model';
export function applyLibrary(p: Project, ids: string[], entry: any) {
  if (!['pump', 'valve'].includes(entry.kind)) throw Error('未知设备库类型');
  if (!ids.length) throw Error('请先在画布或结构中选择同类型设备');
  const n = clone(p),
    selected = ids.map((id) => n.model.edges.find((e) => e.id === id));
  if (selected.some((e) => !e || e.kind !== entry.kind))
    throw Error('仅能对同类型设备应用；不会忽略节点或其他类型');
  const keys =
    entry.kind === 'pump'
      ? ['curve', 'valid_flow', 'efficiency', 'nominal_rpm']
      : ['kv', 'characteristic', 'rangeability'];
  if (
    !entry.parameters ||
    Array.isArray(entry.parameters) ||
    Object.keys(entry.parameters).some((k) => !keys.includes(k))
  )
    throw Error('库包含未知或稳定 ID/运行参数字段，拒绝应用');
  for (const e of selected) {
    for (const key of keys) delete e![key];
    Object.assign(e!, clone(entry.parameters));
    e!.data_source = entry.data_source;
    e!.device_data = {
      library_id: entry.id,
      name: entry.name,
      data_source: entry.data_source,
      source_kind: entry.source_kind || 'user',
      reference_parameters: clone(entry.parameters),
      modified: false,
      fit: entry.fit
        ? {
            rmse_m: entry.fit.rmse_m,
            points_si: entry.fit.points_si,
            temperature_c: entry.fit.temperature_c,
            input_flow_unit: entry.fit.input_flow_unit,
          }
        : null,
    };
  }
  return n;
}
