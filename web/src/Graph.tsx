import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Handle,
  Position,
  useViewport,
} from '@xyflow/react';
export function Junction({ data, selected }: any) {
  const zoom = useViewport().zoom,
    showLabel = data.labels !== false && (zoom > 0.48 || selected);
  return (
    <div
      className={'junction ' + (data.fixed ? 'fixed ' : '') + (selected ? 'selected' : '')}
      title={data.name}
    >
      <span className="node-dot">{data.fixed ? '⊙' : '●'}</span>
      {showLabel && (
        <span className="node-caption" style={{ fontSize: 11 / Math.max(1, zoom) }}>
          {data.name}
        </span>
      )}
      {showLabel && data.showValue && (
        <small style={{ fontSize: 10 / Math.max(1, zoom) }}>{data.value}</small>
      )}
      {[Position.Left, Position.Top, Position.Right, Position.Bottom].map((p, i) => (
        <Handle type="source" key={p} position={p} id={String(i)} className="port" />
      ))}
    </div>
  );
}
export function HydraulicEdge(props: any) {
  const [path, x, y] = getSmoothStepPath({ ...props, borderRadius: 6 });
  const zoom = useViewport().zoom;
  const d = props.data;
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        markerStart={props.markerStart}
        markerEnd={props.markerEnd}
        style={props.style}
        interactionWidth={24}
      />
      <EdgeLabelRenderer>
        {(zoom > 0.48 || props.selected) && d.labels && (
          <button
            data-testid={'edge-' + props.id}
            className={
              'edge-label nodrag nopan ' +
              (props.selected ? 'active ' : '') +
              (d.kind === 'pipe' ? 'pipe' : 'device')
            }
            style={{
              transform: `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 / Math.max(1, zoom)})`,
              borderColor: props.style?.stroke,
            }}
            onClick={() => d.select(props.id)}
          >
            <b>
              {d.symbol} {d.name}
            </b>
            {d.value && <small>{d.value}</small>}
          </button>
        )}
      </EdgeLabelRenderer>
    </>
  );
}
export const nodeTypes = { junction: Junction };
export const edgeTypes = { hydraulic: HydraulicEdge };

function pathBetween(model: any, start: string, end: string, exclude: Set<string>) {
  const queue: [[string, string[]]] | any = [[start, [start]]],
    visited = new Set([start]);
  while (queue.length) {
    const [at, path] = queue.shift();
    if (at === end) return path;
    for (const e of model.edges) {
      if (exclude.has(e.id) || e.closed || (e.kind === 'valve' && e.opening === 0)) continue;
      const next = e.source === at ? e.target : e.target === at ? e.source : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push([next, [...path, next]]);
      }
    }
  }
  return [];
}
export function PressureChart({ project, result, onSelect, terminal }: any) {
  const pump = project.model.edges.find((e: any) => e.kind === 'pump');
  const load =
    project.model.edges.find((e: any) => e.id === terminal) ||
    project.model.edges.find((e: any) => e.kind === 'terminal');
  if (!pump || !load || !result?.nodes)
    return (
      <div className="empty-state">
        水压图需要一个循环泵、一个用户末端及有效结果。当前图显示测压水头 H 与标高 z，不含速度水头。
      </div>
    );
  const excluded = new Set<string>([pump.id, load.id]);
  const supply = pathBetween(project.model, pump.target, load.source, excluded);
  const ret = pathBetween(project.model, load.target, pump.source, excluded);
  const ids = [pump.source, ...supply, ...ret];
  if (!supply.length || !ret.length)
    return <div className="empty-state">找不到穿过该末端的完整循环路径，请检查连接。</div>;
  const values = ids.map((id) => ({
    id,
    h: result.nodes[id]?.head_m,
    z: project.model.nodes.find((n: any) => n.id === id)?.elevation || 0,
  }));
  if (values.some((v) => !Number.isFinite(v.h) || !Number.isFinite(v.z)))
    return <div className="empty-state">路径缺少有效结果，请重新计算；不把缺失值画成零。</div>;
  const max = Math.max(10, ...values.map((v) => v.h), ...values.map((v) => v.z)),
    min = Math.min(0, ...values.map((v) => v.h), ...values.map((v) => v.z)),
    range = max - min || 1;
  const x = (i: number) => 62 + (i * 790) / Math.max(1, values.length - 1),
    y = (v: number) => 154 - ((v - min) / range) * 120;
  const line = (key: string) => values.map((v, i) => `${x(i)},${y(v[key])}`).join(' ');
  return (
    <div className="chart">
      <div className="chart-head">
        <span>
          <i className="line-blue" />
          测压水头 H=z+p/(ρg)
        </span>
        <span>
          <i className="line-grey" />
          标高 z
        </span>
        <span>参考：表压、当地大气压 {project.model.fluid.atmospheric_pressure || 101325} Pa</span>
      </div>
      <svg viewBox="0 0 920 200" role="img" aria-label="循环路径水压图">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1="60" x2="865" y1={154 - f * 120} y2={154 - f * 120} stroke="#dfe7ef" />
            <text x="12" y={158 - f * 120}>
              {(min + f * range).toFixed(1)} m
            </text>
          </g>
        ))}
        <polyline
          points={line('z')}
          fill="none"
          stroke="#8a98a9"
          strokeDasharray="5 4"
          strokeWidth="2"
        />
        <polyline points={line('h')} fill="none" stroke="#167cbd" strokeWidth="3" />
        {values.map((v, i) => (
          <g key={i} onClick={() => onSelect(v.id)} className="chart-point">
            <circle cx={x(i)} cy={y(v.h)} r="4" fill="#167cbd" />
            <title>
              {v.id}: H {v.h?.toFixed(3)} m；z {v.z} m；压力水头 {(v.h - v.z).toFixed(3)} m
            </title>
            <text x={x(i)} y="176" textAnchor="middle">
              {v.id}
            </text>
          </g>
        ))}
        <text x="450" y="196" textAnchor="middle">
          循环路径节点序号（非实际距离）；泵入口 → 供水 → 指定末端 → 回水 → 泵入口
        </text>
      </svg>
    </div>
  );
}
