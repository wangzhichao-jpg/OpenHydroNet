// Small dependency-free SVG line chart for analysis results. Missing points break lines (never interpolated).
import React from 'react';
import { niceTicks, seriesSegments, fmt } from './analysis';

export const SERIES_COLORS = [
  '#1677a8',
  '#d9822b',
  '#2a9d5b',
  '#a23b72',
  '#6a5acd',
  '#8c6d1f',
  '#c0392b',
  '#2c3e50',
];

export type ChartSeries = { key: string; label: string; ys: (number | undefined)[]; color: string };

const W = 640,
  H = 250,
  M = { left: 58, right: 16, top: 12, bottom: 40 };

export default function LineChart({
  xs,
  series,
  xLabel,
  yLabel,
  title,
}: {
  xs: number[];
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  title: string;
}) {
  const ys = series
    .flatMap((s) => s.ys)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!xs.length || !ys.length) return <div className="tip">没有可绘制的收敛点。</div>;
  const xt = niceTicks(Math.min(...xs), Math.max(...xs)),
    yt = niceTicks(Math.min(...ys), Math.max(...ys));
  const [x0, x1, y0, y1] = [xt[0], xt[xt.length - 1], yt[0], yt[yt.length - 1]];
  const sx = (x: number) => M.left + ((x - x0) / (x1 - x0)) * (W - M.left - M.right);
  const sy = (y: number) => H - M.bottom - ((y - y0) / (y1 - y0)) * (H - M.top - M.bottom);
  return (
    <svg className="line-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
      {yt.map((t) => (
        <g key={'y' + t}>
          <line x1={M.left} x2={W - M.right} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={M.left - 6} y={sy(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {xt.map((t) => (
        <g key={'x' + t}>
          <line x1={sx(t)} x2={sx(t)} y1={M.top} y2={H - M.bottom} className="grid" />
          <text x={sx(t)} y={H - M.bottom + 15} textAnchor="middle">
            {fmt(t)}
          </text>
        </g>
      ))}
      <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="axis-label">
        {xLabel}
      </text>
      <text
        x={12}
        y={M.top + (H - M.top - M.bottom) / 2}
        className="axis-label"
        transform={`rotate(-90 12 ${M.top + (H - M.top - M.bottom) / 2})`}
        textAnchor="middle"
      >
        {yLabel}
      </text>
      {series.map((s) => (
        <g key={s.key} data-series={s.label}>
          {seriesSegments(xs, s.ys).map((seg, i) => (
            <polyline
              key={i}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              points={seg.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
            />
          ))}
          {xs.map((x, i) =>
            typeof s.ys[i] === 'number' && Number.isFinite(s.ys[i]) ? (
              <circle key={i} cx={sx(x)} cy={sy(s.ys[i]!)} r={3} fill={s.color}>
                <title>{`${s.label}：${fmt(x)} → ${fmt(s.ys[i], 5)}`}</title>
              </circle>
            ) : null,
          )}
        </g>
      ))}
    </svg>
  );
}
