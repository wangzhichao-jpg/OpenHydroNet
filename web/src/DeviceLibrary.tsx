import React, { useRef, useState } from 'react';
import NumberField from './NumberField';
import { api, download } from './api';
import { clone, uid } from './model';
import { flowUnits, unitLabel } from './units';

function Curve({ entry }: any) {
  const p = entry.parameters;
  if (entry.kind !== 'pump')
    return (
      <div className="tip">
        阀门条目保存全开 Kv、特性与可调比。开度和隔离状态属于具体工程工况，应用库条目时不会重置。
      </div>
    );
  const end = p.valid_flow?.[1] ?? 0.02,
    start = p.valid_flow?.[0] ?? 0;
  const values = Array.from({ length: 61 }, (_, i) => {
    const q = start + ((end - start) * i) / 60;
    const h = p.curve.reduce((sum: number, c: number, power: number) => sum + c * q ** power, 0);
    return { q, h };
  });
  const lo = Math.min(0, ...values.map((v) => v.h)),
    hi = Math.max(1, ...values.map((v) => v.h));
  const x = (q: number) => 55 + (q / Math.max(end, 1e-9)) * 475,
    y = (h: number) => 170 - ((h - lo) / (hi - lo)) * 135;
  return (
    <figure className="library-curve">
      <svg viewBox="0 0 580 215" role="img" aria-label="泵库基准流量扬程曲线">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1="55" x2="535" y1={35 + 135 * f} y2={35 + 135 * f} stroke="#dce6ef" />
            <text x="4" y={40 + 135 * f}>
              {(hi - (hi - lo) * f).toFixed(1)}
            </text>
          </g>
        ))}
        <polyline
          fill="none"
          stroke="#087f8c"
          strokeWidth="3"
          points={values.map((v) => `${x(v.q)},${y(v.h)}`).join(' ')}
        />
        {entry.fit?.points_si?.map((v: any, i: number) => (
          <circle key={i} cx={x(v.flow_m3_s)} cy={y(v.head_m)} r="4" fill="#d18e2e">
            <title>
              {v.flow_m3_s * 3600} m³/h, {v.head_m} m
            </title>
          </circle>
        ))}
        <text x="8" y="15">
          H [m] · 基准转速 n=1，单泵
        </text>
        <text x="200" y="208">
          Q [m³/h]：0 — {(end * 3600).toFixed(2)}
        </text>
      </svg>
      <figcaption>
        {p.valid_flow
          ? '线段限于声明的有效流量范围。点为输入数据；线为当前多项式，不等同厂家认证。'
          : '未声明有效范围：曲线展示至 72 m³/h 只是显示约定，不是允许工作区。'}
      </figcaption>
    </figure>
  );
}
export default function DeviceLibrary({ project, selectedDevices, onMutate, onApply }: any) {
  const [active, setActive] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('新增泵/阀，输入来源和性能数据；库数据随工程保存。');
  const catalogFile = useRef<HTMLInputElement>(null);
  async function importCatalog(data: any) {
    try {
      if (!data) return;
      const checked = await api('library/import', data);
      const copies = checked.entries.map((entry: any) => ({
        ...entry,
        original_library_id: entry.original_library_id || entry.id,
        id: uid('LIB'),
      }));
      if (onMutate((p: any) => p.library.push(...copies)) !== false) {
        setActive(copies[0].id);
        setMessage(
          `已作为副本导入 ${copies.length} 项，明确生成新库 ID，未覆盖原条目；工程设备参数未自动改变`,
        );
      }
    } catch (e: any) {
      setMessage('导入库失败：' + e.message);
    }
  }
  const entries = project.library,
    entry = entries.find((x: any) => x.id === active) || entries[0];
  const update = (mutate: (e: any) => void) => {
    const id = entry.id;
    onMutate((p: any) => {
      const e = p.library.find((x: any) => x.id === id);
      if (e) mutate(e);
    });
  };
  function add(kind: string) {
    if (entries.length >= 500) {
      setMessage('设备库最多 500 项，请拆分工程');
      return;
    }
    const id = uid('LIB');
    onMutate((p: any) =>
      p.library.push({
        id,
        kind,
        name: kind === 'pump' ? '新水泵（待录入）' : '新阀门（待录入）',
        source_kind: 'synthetic',
        data_source: '虚构初始值，请替换为有来源的数据；非厂家参数',
        parameters:
          kind === 'pump'
            ? { curve: [32, 0, -180000], valid_flow: [0, 0.012], nominal_rpm: 1450 }
            : { kv: 85, characteristic: 'linear', rangeability: 50 },
        points_text: kind === 'pump' ? '0,32\n14.4,29.12\n28.8,20.48\n43.2,6.08' : '',
        point_unit: 'm3/h',
        fit_degree: 2,
        point_temperature: project.model.fluid.temperature ?? 20,
        fit_pending: false,
      }),
    );
    setActive(id);
  }
  async function fit() {
    const id = entry.id,
      text = entry.points_text || '',
      unit = entry.point_unit || 'm3/h',
      degree = entry.fit_degree || 2,
      temperature = entry.point_temperature ?? project.model.fluid.temperature ?? 20,
      originalParameters = JSON.stringify(entry.parameters);
    try {
      const rows = text
        .split(/\r?\n/)
        .filter((s: string) => s.trim())
        .map((s: string) =>
          s
            .trim()
            .split(/[,，;；\t ]+/)
            .map(Number),
        );
      if (rows.some((r: number[]) => r.length !== 2 || r.some((v) => !Number.isFinite(v))))
        throw Error('每行需两个数字：流量, 扬程；不含表头');
      setBusy(true);
      const result = await api('fit-pump', {
        flows: rows.map((r: number[]) => r[0]),
        heads: rows.map((r: number[]) => r[1]),
        degree,
        flow_unit: unit,
        temperature,
      });
      const activeEditor = document.activeElement as HTMLElement;
      if (
        activeEditor?.matches('input,textarea,select') &&
        activeEditor.closest('.library-editor')
      ) {
        setMessage('拟合期间正在继续编辑，已丢弃返回结果；请结束编辑后重新拟合');
        return;
      }
      let applied = false;
      onMutate((p: any) => {
        const e = p.library.find((x: any) => x.id === id);
        if (
          e &&
          (e.points_text || '') === text &&
          (e.point_unit || 'm3/h') === unit &&
          (e.fit_degree || 2) === degree &&
          (e.point_temperature ?? p.model.fluid.temperature ?? 20) === temperature &&
          JSON.stringify(e.parameters) === originalParameters
        ) {
          e.parameters.curve = result.curve;
          e.parameters.valid_flow = result.valid_flow;
          const { sampled_curve, ...metadata } = result;
          e.fit = metadata;
          e.fit_pending = false;
          e.point_temperature = temperature;
          applied = true;
        }
      });
      setMessage(
        applied
          ? `拟合完成：RMSE ${result.rmse_m.toExponential(3)} m；${result.warnings.join('；') || '请核对数据来源与有效区间'}`
          : '拟合期间条目已改变，已丢弃过期结果，请重新拟合',
      );
    } catch (e: any) {
      setMessage('拟合失败：' + e.message + '；旧曲线未被覆盖');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="library-workspace">
      <div className="library-list">
        <div className="button-row">
          <button onClick={() => add('pump')}>＋ 水泵</button>
          <button onClick={() => add('valve')}>＋ 阀门</button>
        </div>
        <button
          onClick={async () => {
            if (window.desktop) {
              try {
                await importCatalog(await window.desktop.openLibrary());
              } catch (e: any) {
                setMessage('导入失败：' + e.message);
              }
            } else catalogFile.current?.click();
          }}
        >
          导入库 JSON（副本）
        </button>
        <input
          type="file"
          accept=".json"
          hidden
          ref={catalogFile}
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 5_000_000) throw Error('设备库超过 5 MB');
                await importCatalog(JSON.parse(await f.text()));
              }
            } catch (e: any) {
              setMessage('导入失败：' + e.message);
            }
            e.target.value = '';
          }}
        />
        {entries.length === 0 && (
          <div className="tip">暂无条目。新增后填写数据，可自定义保存为工程库。</div>
        )}
        {entries.map((e: any) => (
          <button
            key={e.id}
            className={entry?.id === e.id ? 'selected' : ''}
            onClick={() => setActive(e.id)}
          >
            <b>
              {e.kind === 'pump' ? '◉' : '⋈'} {e.name || '未命名条目'}
            </b>
            <small>
              {e.source_kind === 'synthetic'
                ? '虚构/教学'
                : e.source_kind === 'manufacturer'
                  ? '用户声明厂家来源，未认证'
                  : '用户数据'}{' '}
              · {e.id}
            </small>
          </button>
        ))}
      </div>
      <div className="library-editor">
        {entry ? (
          <>
            <div className="library-heading">
              <h3>设备库 · {entry.kind === 'pump' ? '水泵' : '阀门'}</h3>
              <span>已选工程设备 {selectedDevices.length} 个</span>
              <button
                onClick={async () => {
                  try {
                    if (entry.fit_pending)
                      throw Error(
                        '性能点草稿已变化，请先拟合，或明确选择保留当前系数；未使用旧曲线冒充新数据',
                      );
                    const baseline = JSON.stringify(project),
                      ids = [...selectedDevices];
                    const checked = await api('library/check', entry);
                    onApply(checked, baseline, ids);
                    setMessage(
                      '已应用数据副本，保留工程设备稳定 ID、端点、泵速/台数或阀开度；删除库条目不会破坏工程',
                    );
                  } catch (e: any) {
                    setMessage(e.message);
                  }
                }}
              >
                应用到同类选中设备
              </button>
              <button
                disabled={entries.length >= 500}
                onClick={() => {
                  onMutate((p: any) => {
                    const e = clone(entry);
                    e.id = uid('LIB');
                    e.name += ' 副本';
                    p.library.push(e);
                    setActive(e.id);
                  });
                }}
              >
                复制条目
              </button>
              <button
                className="danger"
                onClick={() => {
                  const id = entry.id;
                  onMutate((p: any) => {
                    p.library = p.library.filter((e: any) => e.id !== id);
                  });
                }}
              >
                删除库条目
              </button>
            </div>
            <div className="library-columns">
              <section>
                <label className="field">
                  <span>库中名称</span>
                  <input
                    aria-label="库中名称"
                    value={entry.name}
                    onChange={(e) => update((x) => (x.name = e.target.value))}
                  />
                </label>
                <label className="field">
                  <span>数据类别</span>
                  <select
                    aria-label="库数据类别"
                    value={entry.source_kind || 'user'}
                    onChange={(e) => update((x) => (x.source_kind = e.target.value))}
                  >
                    <option value="synthetic">虚构教学数据</option>
                    <option value="user">用户测量/自定义</option>
                    <option value="manufacturer">用户声明厂家来源（未认证）</option>
                  </select>
                </label>
                <label className="field">
                  <span>来源、页码/链接或测量说明</span>
                  <textarea
                    aria-label="设备数据来源"
                    value={entry.data_source || ''}
                    onChange={(e) => update((x) => (x.data_source = e.target.value))}
                  />
                </label>
                {entry.kind === 'pump' ? (
                  <>
                    <NumberField
                      label="库中基准转速"
                      unit="rpm"
                      value={entry.parameters.nominal_rpm ?? ''}
                      min={0}
                      strict
                      optional
                      hint="仅记录基准曲线对应转速；具体工程相对转速另设"
                      onApply={(v: number) => update((x) => (x.parameters.nominal_rpm = v))}
                    />
                    <NumberField
                      label="库中整机效率"
                      unit="0–1，可留空"
                      value={entry.parameters.efficiency ?? ''}
                      min={0}
                      max={1}
                      strict
                      optional
                      onApply={(v: number) => update((x) => (x.parameters.efficiency = v))}
                    />
                    <div className="formula">H₀(Q) = a₀ + a₁Q + a₂Q² + a₃Q³；Q 为 m³/s</div>
                    {entry.parameters.curve.map((v: number, i: number) => (
                      <NumberField
                        key={i}
                        label={`库曲线 a${i}`}
                        unit={i ? 'm/(m³/s)^' + i : 'm'}
                        value={v}
                        onApply={(n: number) =>
                          update((x) => {
                            x.parameters.curve[i] = n;
                            x.fit = null;
                            x.fit_pending = false;
                          })
                        }
                      />
                    ))}
                  </>
                ) : (
                  <>
                    <NumberField
                      label="库中全开 Kv"
                      unit="m³/h @ 1 bar"
                      value={entry.parameters.kv}
                      min={0}
                      strict
                      onApply={(v: number) => update((x) => (x.parameters.kv = v))}
                    />
                    <label className="field">
                      <span>库中阀特性</span>
                      <select
                        aria-label="库中阀特性"
                        value={entry.parameters.characteristic || 'linear'}
                        onChange={(e) =>
                          update((x) => (x.parameters.characteristic = e.target.value))
                        }
                      >
                        <option value="linear">线性 Kv</option>
                        <option value="equal_percentage">等百分比 Kv</option>
                      </select>
                    </label>
                    <NumberField
                      label="库中可调比"
                      unit="1"
                      min={1}
                      value={entry.parameters.rangeability ?? 50}
                      onApply={(v: number) => update((x) => (x.parameters.rangeability = v))}
                    />
                  </>
                )}
              </section>
              <section>
                <Curve entry={entry} />
                {entry.kind === 'pump' && (
                  <>
                    <label className="field">
                      <span>流量 / 扬程数据点 · 每行 Q,H [m]</span>
                      <textarea
                        aria-label="泵性能点"
                        rows={7}
                        value={entry.points_text || ''}
                        onChange={(e) =>
                          update((x) => {
                            x.points_text = e.target.value;
                            x.fit_pending = true;
                          })
                        }
                      />
                    </label>
                    <div className="button-row">
                      <select
                        aria-label="拟合流量单位"
                        value={entry.point_unit || 'm3/h'}
                        onChange={(e) =>
                          update((x) => {
                            x.point_unit = e.target.value;
                            x.fit_pending = true;
                          })
                        }
                      >
                        {flowUnits.map((unit) => (
                          <option key={unit} value={unit}>
                            {unitLabel[unit]}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="拟合阶数"
                        value={entry.fit_degree || 2}
                        onChange={(e) =>
                          update((x) => {
                            x.fit_degree = Number(e.target.value);
                            x.fit_pending = true;
                          })
                        }
                      >
                        <option value={2}>二次 · 至少三点</option>
                        <option value={3}>三次 · 至少四点</option>
                      </select>
                      <button disabled={busy} onClick={fit}>
                        {busy ? '拟合中…' : '拟合并更新曲线'}
                      </button>
                    </div>
                    <NumberField
                      label="性能点水温"
                      unit="℃"
                      min={0}
                      max={100}
                      value={entry.point_temperature ?? project.model.fluid.temperature ?? 20}
                      onApply={(v: number) =>
                        update((x) => {
                          x.point_temperature = v;
                          x.fit_pending = true;
                        })
                      }
                    />
                    <small>
                      质量流量点按上述点数据温度转换；该温度不自动跟随工程工况变化。有效范围、残差和原始点随库保存。更改运行转速不修改基准曲线。
                    </small>
                    {entry.fit_pending && (
                      <div className="field-error">
                        性能点草稿未拟合；当前图和系数仍是上一次结果。
                        <button
                          onClick={() =>
                            update((x) => {
                              x.fit_pending = false;
                              x.fit = null;
                            })
                          }
                        >
                          明确保留当前系数，不采用点草稿
                        </button>
                      </div>
                    )}
                    {entry.fit && (
                      <small>
                        上次拟合点条件：{entry.fit.temperature_c} ℃，ρ=
                        {entry.fit.density_kg_m3.toFixed(3)} kg/m³；RMSE=
                        {entry.fit.rmse_m.toExponential(3)} m
                      </small>
                    )}
                  </>
                )}
                <button
                  onClick={async () => {
                    try {
                      setMessage('正在校验并导出设备库…');
                      await api('library/import', {
                        format: 'openhydronet-library',
                        schema_version: 1,
                        entries,
                      });
                      const ok = await download(
                        'OpenHydroNet-设备库.json',
                        JSON.stringify(
                          { format: 'openhydronet-library', schema_version: 1, entries },
                          null,
                          2,
                        ),
                      );
                      setMessage(
                        ok === false
                          ? '已取消导出库'
                          : '库已导出；完整工程另用“保存”，库草稿随工程携带',
                      );
                    } catch (e: any) {
                      setMessage('导出失败：' + e.message + '；不完整草稿仍可随工程保存');
                    }
                  }}
                >
                  导出库 JSON
                </button>
              </section>
            </div>
          </>
        ) : (
          <div className="empty-state">
            从左侧新增一个泵或阀条目，或在画布选择设备后使用参数面板。所有库数据都随工程保存。
          </div>
        )}
        <div className="library-status" role="status">
          {message}
        </div>
      </div>
    </div>
  );
}
