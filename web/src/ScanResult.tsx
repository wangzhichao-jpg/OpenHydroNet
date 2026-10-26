// 扫描结果：工具栏（纵轴 / 曲线观测量 / 图例 / CSV）、曲线与表格。名称与标签来自冻结模型。
// 组件始终挂载（无结果时返回空），重新运行后保留用户的图例与坐标选择。
import React, { useMemo, useState } from 'react';
import {
  adjustableParams,
  observableLabel,
  observableKey,
  scanRows,
  Observable,
  fmt,
  unitGroups,
  scanCsv,
  gridSeries,
} from './analysis';
import LineChart, { ChartSeries, SERIES_COLORS } from './LineChart';
import { download } from './api';

export default function ScanResult({
  result,
  frozenModel,
  flowUnit,
  projectName,
}: {
  result: any;
  frozenModel: any;
  flowUnit: string;
  projectName: string;
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [unitIndex, setUnitIndex] = useState(0);
  const [exportNote, setExportNote] = useState('');
  const [gridObservable, setGridObservable] = useState(0);
  const frozenParams = useMemo(() => adjustableParams(frozenModel), [frozenModel]);
  if (!result) return null;

  const rows = scanRows(result, flowUnit, frozenModel);
  const resultObservables: Observable[] = result.observables || [];
  const groups = unitGroups(resultObservables, flowUnit);
  const group = groups[unitIndex] || groups[0];
  const chartSeries: ChartSeries[] = (group?.indexes || [])
    .filter((i) => !hidden.includes(observableKey(resultObservables[i])))
    .map((i) => ({
      key: observableKey(resultObservables[i]),
      label: observableLabel(resultObservables[i], frozenModel, flowUnit),
      ys: rows.map((row) => row.values[i]),
      color: SERIES_COLORS[i % SERIES_COLORS.length],
    }));
  async function exportCsv() {
    try {
      const written = await download(
        `${projectName || '未命名工程'}·参数扫描.csv`,
        scanCsv(result, frozenModel, flowUnit),
        'csv',
      );
      setExportNote(written === false ? '已取消导出' : '已导出 CSV（当前显示单位）');
    } catch (e: any) {
      setExportNote('导出失败：' + e.message);
    }
  }
  const labelOf = (v: any) =>
    frozenParams.find((x) => x.id === v?.id && x.field === v?.field)?.label || v?.id;
  const resultParamLabel = labelOf(result.variables?.[0]);
  const twoD = result.variables?.length === 2;
  const grid = twoD
    ? gridSeries(
        rows,
        Math.min(gridObservable, resultObservables.length - 1),
        labelOf(result.variables[1]),
      )
    : null;

  return (
    <>
      {
        <div className="scan-toolbar">
          {twoD && (
            <select
              aria-label="曲线观测量"
              value={Math.min(gridObservable, resultObservables.length - 1)}
              onChange={(e) => setGridObservable(Number(e.target.value))}
            >
              {resultObservables.map((o, i) => (
                <option key={observableKey(o)} value={i}>
                  曲线：{observableLabel(o, frozenModel, flowUnit)}
                </option>
              ))}
            </select>
          )}
          {!twoD && groups.length > 1 && (
            <select
              aria-label="纵轴单位"
              value={groups.indexOf(group)}
              onChange={(e) => setUnitIndex(Number(e.target.value))}
            >
              {groups.map((g, i) => (
                <option key={g.unit} value={i}>
                  纵轴：{g.unit}
                </option>
              ))}
            </select>
          )}
          <div className="scan-legend">
            {twoD &&
              grid!.series.map((s, i) => (
                <span key={s.key} className="legend-item">
                  <i style={{ background: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                  {s.label}
                </span>
              ))}
            {!twoD &&
              group?.indexes.map((i) => {
                const key = observableKey(resultObservables[i]);
                const shown = !hidden.includes(key);
                return (
                  <button
                    key={key}
                    className="legend-item"
                    aria-pressed={shown}
                    onClick={() =>
                      setHidden((all) => (shown ? [...all, key] : all.filter((k) => k !== key)))
                    }
                  >
                    <i
                      style={{
                        background: shown ? SERIES_COLORS[i % SERIES_COLORS.length] : '#ccd6df',
                      }}
                    />
                    {observableLabel(resultObservables[i], frozenModel, flowUnit)}
                  </button>
                );
              })}
          </div>
          <button onClick={exportCsv}>导出 CSV</button>
          {exportNote && <small>{exportNote}</small>}
        </div>
      }
      {!twoD && rows.length > 1 && (
        <LineChart
          xs={rows.map((row) => row.params[0])}
          series={chartSeries}
          xLabel={resultParamLabel}
          yLabel={group?.unit || ''}
          title={`参数扫描曲线：${resultParamLabel}`}
        />
      )}
      {twoD && grid!.xs.length > 1 && (
        <LineChart
          xs={grid!.xs}
          series={grid!.series.map((x, i) => ({
            ...x,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
          }))}
          xLabel={resultParamLabel}
          yLabel={observableLabel(
            resultObservables[Math.min(gridObservable, resultObservables.length - 1)],
            frozenModel,
            flowUnit,
          )}
          title={`双参数扫描曲线：${resultParamLabel}`}
        />
      )}
      {
        <table data-testid="scan-table">
          <thead>
            <tr>
              {result.variables.map((v: any) => (
                <th key={v.id + v.field}>{labelOf(v)}</th>
              ))}
              {resultObservables.map((o) => (
                <th key={observableKey(o)}>{observableLabel(o, frozenModel, flowUnit)}</th>
              ))}
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.params.map((v, k) => (
                  <td key={'p' + k}>{fmt(v)}</td>
                ))}
                {row.values.map((v, j) => (
                  <td key={j}>{fmt(v, 5)}</td>
                ))}
                <td>
                  {row.status}
                  {row.issues.length ? ' · ' + row.issues.join(', ') : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    </>
  );
}
