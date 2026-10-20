import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
const names: Record<string, string> = {
  node: '节点',
  pipe: '管段',
  pump: '水泵',
  valve: '阀门',
  terminal: '末端',
  resistance: '等效阻力',
  flow_control: '理想流控',
};
export default function TableImport({ getProject, onApply, onClose }: any) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const root = dialogRef.current!;
    root.querySelector<HTMLButtonElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        const items = [
          ...root.querySelectorAll<HTMLElement>('button,input,select,textarea'),
        ].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (!first) return;
        if (
          !root.contains(document.activeElement) ||
          (event.shiftKey && document.activeElement === first)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      previous?.focus?.();
    };
  }, []);
  const fileRef = useRef<HTMLInputElement>(null),
    [source, setSource] = useState<any>(null),
    [table, setTable] = useState<any>(null),
    [kind, setKind] = useState('pipe'),
    [mapping, setMapping] = useState<any>({}),
    [units, setUnits] = useState<any>({}),
    [preview, setPreview] = useState<any>(null),
    [signature, setSignature] = useState(''),
    [encoding, setEncoding] = useState('utf-8-sig'),
    [delimiter, setDelimiter] = useState(','),
    [sheet, setSheet] = useState(''),
    [sheets, setSheets] = useState<string[]>([]),
    [clearHead, setClearHead] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  function defaults(data: any, type: string) {
    const m: any = {},
      u: any = {};
    for (const f of data.fields[type]) {
      const matched = data.columns.find(
        (c: string) => c === f.key || c === `${f.key} [${f.default_unit}]`,
      );
      if (matched) m[f.key] = matched;
      u[f.key] = f.default_unit;
    }
    setMapping(m);
    setUnits(u);
    setPreview(null);
  }
  async function read(
    file: any,
    selectedSheet = '',
    encodingOverride = encoding,
    delimiterOverride = delimiter,
  ) {
    setBusy(true);
    setError('');
    setPreview(null);
    setSource(file);
    setTable(null);
    try {
      if (file.format === 'xlsx') {
        const meta = await api('table/read', { ...file, inspect_only: true });
        setSheets(meta.sheet_names);
      } else setSheets([]);
      const data = await api('table/read', {
        ...file,
        sheet: selectedSheet,
        encoding: encodingOverride,
        delimiter: delimiterOverride,
      });
      setSource(file);
      setTable(data);
      setSheet(selectedSheet || data.sheet_names[0] || '');
      defaults(data, kind);
    } catch (e: any) {
      setError('读取失败：' + e.message);
    } finally {
      setBusy(false);
    }
  }
  async function choose() {
    try {
      if (window.desktop) {
        const file = await window.desktop.importTable();
        if (file) await read(file);
      } else fileRef.current?.click();
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function review() {
    setError('');
    setBusy(true);
    setPreview(null);
    const project = getProject(),
      sig = JSON.stringify(project);
    try {
      const data = await api('table/preview', {
        project,
        rows: table.rows,
        device_kind: kind,
        mapping,
        units,
        clear_head: clearHead,
      });
      setPreview(data);
      setSignature(sig);
    } catch (e: any) {
      setError('预览失败：' + e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={dialogRef}
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="参数表映射导入"
    >
      <div className="table-import">
        <header>
          <h2>CSV / Excel 参数表 · 映射与预览</h2>
          <button onClick={onClose}>关闭导入</button>
        </header>
        <p>
          仅更新已有稳定
          ID，不创建/猜测拓扑，不改变布局。新建网络请使用画布；曲线请使用设备库。空白单元格默认不覆盖已有值。
        </p>
        <div className="button-row">
          <button disabled={busy} onClick={choose}>
            选择 CSV / XLSX
          </button>
          <span>{source?.name || '尚未选择文件'}</span>
          <label>
            设备类别{' '}
            <select
              aria-label="导入设备类别"
              disabled={busy}
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                if (table) defaults(table, e.target.value);
              }}
            >
              {Object.entries(names).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {source?.format === 'csv' && (
            <>
              <label>
                编码{' '}
                <select
                  aria-label="CSV 编码"
                  disabled={busy}
                  value={encoding}
                  onChange={(e) => {
                    setEncoding(e.target.value);
                    read(source, '', e.target.value);
                  }}
                >
                  <option value="utf-8-sig">UTF-8</option>
                  <option value="gb18030">GB18030</option>
                </select>
              </label>
              <label>
                分隔符{' '}
                <select
                  aria-label="CSV 分隔符"
                  disabled={busy}
                  value={delimiter}
                  onChange={(e) => {
                    setDelimiter(e.target.value);
                    read(source, '', encoding, e.target.value);
                  }}
                >
                  <option value=",">逗号</option>
                  <option value=";">分号</option>
                  <option value={'\t'}>制表符</option>
                </select>
              </label>
            </>
          )}
          {!!sheets.length && (
            <label>
              工作表{' '}
              <select
                aria-label="Excel 工作表"
                disabled={busy}
                value={sheet}
                onChange={(e) => read(source, e.target.value)}
              >
                {sheets.map((s: string) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {table && (
          <>
            <div className="import-columns">
              <section>
                <h3>字段映射 · {table.rows.length} 行</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>工程字段</th>
                        <th>源列</th>
                        <th>输入单位</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.fields[kind].map((f: any) => (
                        <tr key={f.key}>
                          <td>
                            {f.label}
                            {f.key === 'id' ? '（必选）' : ''}
                          </td>
                          <td>
                            <select
                              aria-label={`映射 ${f.key}`}
                              disabled={busy}
                              value={mapping[f.key] || ''}
                              onChange={(e) => {
                                setMapping({ ...mapping, [f.key]: e.target.value });
                                setPreview(null);
                              }}
                            >
                              <option value="">不导入</option>
                              {table.columns.map((c: string) => (
                                <option key={c}>{c}</option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label={`输入单位 ${f.key}`}
                              disabled={busy}
                              value={units[f.key] || f.default_unit}
                              onChange={(e) => {
                                setUnits({ ...units, [f.key]: e.target.value });
                                setPreview(null);
                              }}
                            >
                              {f.units.map((u: string) => (
                                <option key={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {kind === 'node' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={clearHead}
                      disabled={busy}
                      onChange={(e) => {
                        setClearHead(e.target.checked);
                        setPreview(null);
                      }}
                    />
                    空白定压值明确清除该节点定压边界
                  </label>
                )}
                <button disabled={busy || !mapping.id} onClick={review}>
                  转换单位并预览变化
                </button>
              </section>
              <section>
                <h3>原始数据（前 8 行）</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        {table.columns.map((c: string) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.slice(0, 8).map((r: any, i: number) => (
                        <tr key={i}>
                          {table.columns.map((c: string) => (
                            <td key={c}>{String(r[c] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <small>
                  {table.notice} · 文件上限 3 MB / 10000 行。kg/h、t/h
                  和压降换算使用当前工程水温与水密度；H 只接受测压水头 m。
                </small>
              </section>
            </div>
          </>
        )}
        {preview && (
          <section className="import-preview">
            <h3>
              待应用变化：{preview.changes.length} 项 · {preview.temperature_c} ℃，ρ=
              {preview.density_kg_m3.toFixed(3)} kg/m³
            </h3>
            <div className="table-scroll">
              <table aria-label="导入变化预览">
                <thead>
                  <tr>
                    <th>行</th>
                    <th>ID</th>
                    <th>字段</th>
                    <th>原值 SI</th>
                    <th>新值 SI</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changes.slice(0, 150).map((r: any, i: number) => (
                    <tr key={i}>
                      <td>{r.row}</td>
                      <td>{r.id}</td>
                      <td>{r.field}</td>
                      <td>{String(r.before ?? '未设置')}</td>
                      <td>{String(r.after ?? '取消定压')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.changes.length > 150 && (
              <small>仅展示前 150 项；完整变化数见标题。建议分批导入以逐项审核。</small>
            )}
            {preview.errors.map((e: any, i: number) => (
              <div className="field-error" key={i}>
                第 {e.row} 行 · {e.id}：{e.message}
              </div>
            ))}
            {preview.issues.map((e: any, i: number) => (
              <div className="field-error" key={i}>
                {e.object_id || '工程'} · {e.message} · {e.fix}
              </div>
            ))}
            <div className="button-row">
              <button
                className="primary"
                disabled={!preview.can_apply || busy}
                onClick={() => {
                  if (JSON.stringify(getProject()) !== signature) {
                    setPreview(null);
                    setError('预览后工程已变化，请重新预览；未覆盖当前工程');
                    return;
                  }
                  onApply(preview.project);
                  onClose();
                }}
              >
                确认应用（可整体撤销）
              </button>
              <span>{preview.note}</span>
            </div>
          </section>
        )}
        {error && (
          <div className="field-error" role="alert">
            {error}
          </div>
        )}
        {busy && <div role="status">本机读取/预览中…</div>}
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".csv,.xlsx"
          onChange={async (e) => {
            try {
              const file = e.target.files?.[0];
              if (file) {
                if (file.size > 3_000_000) throw Error('文件超过 3 MB');
                const bytes = new Uint8Array(await file.arrayBuffer());
                let text = '';
                for (let i = 0; i < bytes.length; i += 8192)
                  text += String.fromCharCode(...bytes.slice(i, i + 8192));
                await read({
                  name: file.name,
                  format: file.name.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv',
                  content_base64: btoa(text),
                });
              }
            } catch (error: any) {
              setError(error.message);
            }
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}
