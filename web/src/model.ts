export type Item = { id: string; name?: string; [key: string]: any };
export type Project = {
  format: 'openhydronet';
  schema_version: 1;
  name: string;
  model: { nodes: Item[]; edges: Item[]; fluid: { [key: string]: any } };
  layout: Record<string, { x: number; y: number }>;
  scenarios: any[];
  preferences: any;
  library: any[];
  [key: string]: any;
};
export const uid = (prefix = 'N') => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
export const clone = <T>(v: T): T => structuredClone(v);
export const emptyProject = (): Project => ({
  format: 'openhydronet',
  schema_version: 1,
  name: '未命名工程',
  model: { nodes: [], edges: [], fluid: { temperature: 20, atmospheric_pressure: 101325 } },
  layout: {},
  scenarios: [],
  preferences: { flow_unit: 'm3/h', scenario: 'heating' },
  library: [],
});
export const defaults = (kind: string) =>
  ({
    pipe: { length: 100, diameter: 0.1, roughness: 0.00005, zeta: 0, local_mode: 'zeta' },
    pump: {
      curve: [25, 0, -50000],
      speed: 1,
      parallel: 1,
      check_valve: true,
      data_source: '用户定义，未经厂家认证',
    },
    valve: { opening: 1, kv: 100, characteristic: 'linear' },
    terminal: { design_head: 10, design_flow: 0.01 },
    resistance: { resistance: 100000 },
    flow_control: { set_flow: 0.01, min_head: 3 },
  })[kind] || {};
export const names: Record<string, string> = {
  pipe: '管段',
  pump: '水泵',
  valve: '阀门',
  terminal: '用户末端',
  resistance: '等效阻力',
  flow_control: '理想流控',
  node: '节点',
};
export type History = { past: Project[]; present: Project; future: Project[] };
export function commit(h: History, p: Project): History {
  return JSON.stringify(h.present) === JSON.stringify(p)
    ? h
    : { past: [...h.past.slice(-79), h.present], present: p, future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
export function deleteItems(p: Project, ids: string[]): Project {
  const n = clone(p);
  const set = new Set(ids);
  n.model.nodes = n.model.nodes.filter((x) => !set.has(x.id));
  n.model.edges = n.model.edges.filter(
    (x) => !set.has(x.id) && !set.has(x.source) && !set.has(x.target),
  );
  ids.forEach((id) => delete n.layout[id]);
  return n;
}
export function copyItems(p: Project, ids: string[]) {
  const set = new Set(ids);
  for (const e of p.model.edges)
    if (set.has(e.id)) {
      set.add(e.source);
      set.add(e.target);
    }
  return {
    nodes: clone(p.model.nodes.filter((n) => set.has(n.id))),
    edges: clone(p.model.edges.filter((e) => set.has(e.source) && set.has(e.target))),
    layout: clone(p.layout),
  };
}
export function pasteItems(p: Project, buffer: ReturnType<typeof copyItems>): Project {
  const n = clone(p),
    mapping = new Map<string, string>();
  for (const node of buffer.nodes) {
    const id = uid();
    mapping.set(node.id, id);
    n.model.nodes.push({ ...node, id, name: (node.name || node.id) + ' 副本' });
    const pos = buffer.layout[node.id] || { x: 0, y: 0 };
    n.layout[id] = { x: pos.x + 60, y: pos.y + 60 };
  }
  for (const e of buffer.edges)
    n.model.edges.push({
      ...e,
      id: uid('E'),
      source: mapping.get(e.source)!,
      target: mapping.get(e.target)!,
    });
  return n;
}
export function splitEdge(p: Project, id: string, ratio = 0.5): Project {
  if (!(ratio > 0 && ratio < 1)) throw Error('拆分比例必须在 0 和 1 之间');
  const n = clone(p),
    e = n.model.edges.find((e) => e.id === id);
  if (!e || !['pipe', 'resistance'].includes(e.kind)) throw Error('仅可拆分普通管道或等效阻力');
  const middle = uid(),
    tail = uid('E');
  const a = n.layout[e.source] || { x: 0, y: 0 },
    b = n.layout[e.target] || { x: 0, y: 0 };
  n.model.nodes.push({
    id: middle,
    name: '拆分连接点',
    elevation:
      (n.model.nodes.find((x) => x.id === e.source)?.elevation || 0) * (1 - ratio) +
      (n.model.nodes.find((x) => x.id === e.target)?.elevation || 0) * ratio,
    demand: 0,
    head: null,
  });
  n.layout[middle] = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
  const second: Item = {
    ...e,
    id: tail,
    name: (e.name || e.id) + ' · 后段',
    source: middle,
    original_id: e.original_id || e.id,
  };
  if (e.kind === 'pipe') {
    second.length = (e.length || 100) * (1 - ratio);
    e.length = (e.length || 100) * ratio;
    if (e.local_mode !== 'ratio') {
      second.zeta = (e.zeta || 0) * (1 - ratio);
      e.zeta = (e.zeta || 0) * ratio;
    }
  } else {
    second.resistance = e.resistance * (1 - ratio);
    e.resistance *= ratio;
  }
  e.target = middle;
  e.original_id = e.original_id || e.id;
  n.model.edges.push(second);
  return n;
}
export function alignItems(p: Project, ids: string[], mode: 'x' | 'y' | 'distribute'): Project {
  const n = clone(p),
    points = ids.filter((id) => n.layout[id]);
  if (points.length < 2) return n;
  if (mode === 'distribute') {
    points.sort((a, b) => n.layout[a].x - n.layout[b].x);
    const lo = n.layout[points[0]].x,
      hi = n.layout[points.at(-1)!].x;
    points.forEach((id, i) => (n.layout[id].x = lo + ((hi - lo) * i) / (points.length - 1)));
  } else {
    const avg = points.reduce((s, id) => s + n.layout[id][mode], 0) / points.length;
    points.forEach((id) => (n.layout[id][mode] = Math.round(avg / 20) * 20));
  }
  return n;
}
export function insertDevice(p: Project, id: string, kind: string): Project {
  let n = splitEdge(p, id);
  const first = n.model.edges.find((e) => e.id === id)!;
  const mid = first.target;
  const second = n.model.edges.at(-1)!;
  const next = uid();
  n.model.nodes.push({
    id: next,
    name: '设备出口',
    elevation: n.model.nodes.find((x) => x.id === mid)?.elevation || 0,
    demand: 0,
    head: null,
  });
  const pos = n.layout[mid];
  n.layout[mid] = { x: pos.x - 40, y: pos.y };
  n.layout[next] = { x: pos.x + 40, y: pos.y };
  second.source = next;
  n.model.edges.push({
    id: uid('E'),
    kind,
    name: names[kind],
    source: mid,
    target: next,
    ...defaults(kind),
  });
  return n;
}
export const signature = (p: Project) => JSON.stringify(p.model);
