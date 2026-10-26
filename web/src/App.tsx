import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  ConnectionMode,
  MarkerType,
  useReactFlow,
  applyNodeChanges,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { flushSync } from 'react-dom';
import NumberField from './NumberField';
import DeviceLibrary from './DeviceLibrary';
import './workspaces.css';
import TableImport from './TableImport';
import AnalysisPanel from './AnalysisPanel';
import { statusText } from './status';
import { applyLibrary } from './library';
import { persistable } from './document';
import {
  waterDensity,
  flowFactor as getFlowFactor,
  flowUnits,
  unitLabel,
  resultFlow,
  compareFlows,
} from './units';
import { APP_VERSION } from './version';
import { api, download } from './api';
import {
  Project,
  Item,
  History,
  emptyProject,
  uid,
  clone,
  defaults,
  names,
  commit,
  undo,
  redo,
  deleteItems,
  copyItems,
  pasteItems,
  splitEdge,
  alignItems,
  insertDevice,
  signature,
} from './model';
import { Junction, HydraulicEdge, nodeTypes, edgeTypes, PressureChart } from './Graph';

const symbols: Record<string, string> = {
  pipe: '━',
  pump: '◉',
  valve: '⋈',
  terminal: '▥',
  resistance: '∿',
  flow_control: '⇥',
  node: '●',
};
const fmt = (v: any, d = 3) =>
  typeof v === 'number' && Number.isFinite(v)
    ? Number(v.toPrecision(d)).toLocaleString('zh-CN', { maximumFractionDigits: 6 })
    : '—';
// Editors inside the analysis panel do not belong to the project document.
const INVALID_EDITOR = '.workspace [aria-invalid="true"]:not(.analysis-panel *)';

function Workbench() {
  const [history, setHistory] = useState<History>({
    past: [],
    present: emptyProject(),
    future: [],
  });
  const p = history.present;
  const pRef = useRef(p);
  pRef.current = p;
  const [savedSignature, setSavedSignature] = useState(() => JSON.stringify(emptyProject()));
  const savedRef = useRef(savedSignature);
  savedRef.current = savedSignature;
  const dirty = JSON.stringify(p) !== savedSignature;
  const [welcome, setWelcome] = useState(true),
    [examples, setExamples] = useState<Project[]>([]),
    [recovery, setRecovery] = useState<Project | null>(null),
    [wizard, setWizard] = useState(false);
  const [selected, setSelection] = useState<string[]>([]),
    [result, setResult] = useState<any>(null),
    [resultSig, setResultSig] = useState(''),
    [issues, setIssues] = useState<any[]>([]),
    [tab, setView] = useState('results'),
    [message, setMessage] = useState('从示例或向导开始，沿主路径完成第一次计算'),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [importing, setImporting] = useState(false);
  const [tool, setTool] = useState('pipe'),
    [search, setSearch] = useState(''),
    [metric, setMetric] = useState('flow_m3_h'),
    [labels, setLabels] = useState(true),
    [manualMax, setManualMax] = useState(''),
    [comparison, setComparison] = useState(''),
    [terminal, setTerminal] = useState(''),
    [fontScale, setFontScale] = useState(100);
  const [dragNodes, setDragNodes] = useState<any[] | null>(null);
  const resultRef = useRef(result),
    resultSigRef = useRef(resultSig);
  resultRef.current = result;
  resultSigRef.current = resultSig;
  const documentEpoch = useRef(0),
    epoch = documentEpoch.current;
  const runRef = useRef(0);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const jobRef = useRef<any>(null),
    clipboard = useRef<any>(null),
    fileRef = useRef<HTMLInputElement>(null);
  const rf = useReactFlow();
  const edit = useCallback((next: Project) => {
    setHistory((h) => commit(h, next));
  }, []);
  const loadDocument = useCallback(
    (next: Project, saved = false) => {
      ++runRef.current;
      ++documentEpoch.current;
      setImporting(false);
      setBusy(false);
      if (jobRef.current) {
        api('jobs/' + jobRef.current.id, undefined, 'DELETE').catch(() => {});
        jobRef.current = null;
        setBusy(false);
      }
      setSavedSignature(saved ? JSON.stringify(next) : JSON.stringify(emptyProject()));
      setHistory({ past: [], present: next, future: [] });
      setSelection([]);
      setResult(null);
      setResultSig('');
      setIssues([]);
      setWelcome(false);
      setTimeout(() => rf.fitView({ padding: 0.18, maxZoom: 1.1 }), 150);
    },
    [rf],
  );
  const stale = !!result && signature(p) !== resultSig;
  useEffect(() => {
    if (stale) setMessage('输入已变更，请重新计算；旧结果过期，不能导出为当前结果');
  }, [stale]);
  const item =
    p.model.nodes.find((x) => selected.includes(x.id)) ||
    p.model.edges.find((x) => selected.includes(x.id));
  const isNode = !!item && p.model.nodes.some((n) => n.id === item.id);
  const flowUnit = p.preferences.flow_unit || 'm3/h';
  const t = p.model.fluid.temperature ?? 20;
  const rho = waterDensity(t);
  const flowFactor: Record<string, number> = Object.fromEntries(
    flowUnits.map((unit) => [unit, getFlowFactor(unit, rho)]),
  );
  useEffect(() => {
    api('examples')
      .then(setExamples)
      .catch((e) => setMessage('本地计算服务不可用：' + e.message));
    (async () => {
      try {
        const draft = window.desktop
          ? await window.desktop.draft()
          : JSON.parse(localStorage.getItem('ohn-draft') || 'null');
        if (draft?.format === 'openhydronet') setRecovery(await api('check-project', draft));
      } catch {
        setMessage('恢复草稿读取失败；可打开上次保存的工程');
      }
    })();
  }, []);
  useEffect(() => {
    if (welcome) return;
    const timer = setTimeout(() => {
      const draft = clone(persistable(p, resultRef.current, resultSigRef.current));
      if (window.desktop)
        window.desktop.draft(draft).catch(() => setMessage('自动保存失败，请手动保存工程'));
      else
        try {
          localStorage.setItem('ohn-draft', JSON.stringify(draft));
        } catch {
          setMessage('浏览器草稿空间不足，请保存工程');
        }
    }, 800);
    return () => clearTimeout(timer);
  }, [p, welcome]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${(fontScale / 100) * 14}px`;
  }, [fontScale]);
  useEffect(() => {
    if (!window.desktop) return;
    const valid = !document.querySelector(INVALID_EDITOR);
    window.desktop
      .documentState({ project: persistable(p, result, resultSig), dirty: dirty || !valid, valid })
      .catch(() => {});
  }, [p, dirty, result, resultSig]);
  useEffect(() => {
    if (window.desktop)
      return window.desktop.onFlushEditor(async () => {
        flushSync(() => (document.activeElement as HTMLElement)?.blur?.());
        const valid = !document.querySelector(INVALID_EDITOR);
        await window.desktop!.documentState({
          project: persistable(pRef.current, resultRef.current, resultSigRef.current),
          dirty: JSON.stringify(pRef.current) !== savedRef.current || !valid,
          valid,
        });
      });
    const handler = (event: BeforeUnloadEvent) => {
      flushSync(() => (document.activeElement as HTMLElement)?.blur?.());
      if (
        JSON.stringify(pRef.current) !== savedRef.current ||
        document.querySelector(INVALID_EDITOR)
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);
  function rejectInvalidEditor() {
    const invalid = document.querySelector(INVALID_EDITOR) as HTMLElement;
    if (!invalid) return false;
    invalid.focus();
    setMessage('请先修正未提交的无效参数；没有使用旧值冒充本次输入。');
    return true;
  }
  function setSelected(ids: React.SetStateAction<string[]>) {
    if (!rejectInvalidEditor()) setSelection(ids);
  }
  function setTab(next: React.SetStateAction<string>) {
    if (!rejectInvalidEditor()) setView(next);
  }
  async function allowReplacement() {
    if (
      JSON.stringify(pRef.current) === savedRef.current &&
      !document.querySelector(INVALID_EDITOR)
    )
      return true;
    const choice = window.desktop
      ? await window.desktop.confirmUnsaved('是否切换工程？')
      : window.confirm('当前工程尚未保存。确定放弃修改并切换？')
        ? 'discard'
        : 'cancel';
    return choice === 'discard' || (choice === 'save' && (await save()));
  }
  async function replace(next: Project, saved = false) {
    if (!(await allowReplacement())) return false;
    loadDocument(next, saved);
    return true;
  }
  function updateItem(key: string, value: any) {
    const next = clone(p);
    const objects = [...next.model.nodes, ...next.model.edges];
    for (const id of selected) {
      const obj = objects.find((x) => x.id === id);
      if (obj && ((isNode && next.model.nodes.includes(obj)) || obj.kind === item?.kind)) {
        obj[key] = value;
        if (
          obj.device_data &&
          [
            'curve',
            'valid_flow',
            'nominal_rpm',
            'efficiency',
            'kv',
            'characteristic',
            'rangeability',
          ].includes(key)
        )
          obj.device_data.modified = true;
      }
    }
    edit(next);
  }
  function locate(id: string) {
    setSelected([id]);
    const node = p.model.nodes.find((x) => x.id === id),
      edge = p.model.edges.find((e) => e.id === id);
    const pos = p.layout[node?.id || edge?.source];
    if (pos)
      rf.setCenter(pos.x + 20, pos.y + 20, { zoom: Math.max(0.65, rf.getZoom()), duration: 250 });
  }
  async function open() {
    try {
      if (!(await allowReplacement())) return;
      if (window.desktop) {
        const data = await window.desktop.open();
        if (data) loadDocument(await api('check-project', data), true);
      } else fileRef.current?.click();
    } catch (e: any) {
      setMessage('打开失败：' + e.message);
    }
  }
  async function save() {
    if (rejectInvalidEditor()) return false;
    const snapshot = clone(pRef.current);
    try {
      const saved = persistable(snapshot, resultRef.current, resultSigRef.current);
      if (window.desktop) {
        setMessage('正在原子保存当前工程快照…');
        if (!(await window.desktop.save(saved))) {
          setMessage('已取消保存，未改变磁盘工程');
          return false;
        }
        setMessage('工程已原子保存；设备数据和布局随工程携带');
      } else {
        await download(snapshot.name + '.ohn.json', JSON.stringify(saved, null, 2));
        setMessage('已请求导出；浏览器不能确认磁盘写入，仍保留未保存保护，请核对下载文件');
      }
      if (window.desktop) setSavedSignature(JSON.stringify(snapshot));
      return true;
    } catch (e: any) {
      setMessage('保存失败：' + e.message);
      return false;
    }
  }
  async function check() {
    if (rejectInvalidEditor()) return;
    try {
      const r = await api('validate', pRef.current.model);
      setIssues(r.issues);
      setTab('issues');
      setMessage(
        r.issues.length
          ? `发现 ${r.issues.length} 个问题，点击问题可定位`
          : '模型检查通过，下一步点击“计算”',
      );
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  async function calculate() {
    if (busy || rejectInvalidEditor()) return;
    const run = ++runRef.current,
      owner = crypto.randomUUID();
    setBusy(true);
    setMessage('正在独立进程中计算，可继续编辑或取消任务');
    const model = clone(pRef.current.model),
      sig = JSON.stringify(model);
    try {
      const job = await api('jobs', { model, owner });
      if (run !== runRef.current) {
        api('jobs/' + job.id, undefined, 'DELETE').catch(() => {});
        return;
      }
      jobRef.current = job;
      const poll = async () => {
        if (run !== runRef.current || jobRef.current?.id !== job.id) return;
        try {
          const j = await api('jobs/' + job.id);
          if (run !== runRef.current || jobRef.current?.id !== job.id) return;
          if (j.status === 'running') {
            setTimeout(poll, 150);
            return;
          }
          setBusy(false);
          jobRef.current = null;
          if (j.status !== 'completed') {
            setMessage(j.error || '任务已取消');
            return;
          }
          setResult(j.result);
          setResultSig(sig);
          setIssues(j.result.issues || []);
          setTab((current) =>
            current === 'library' || current === 'analysis'
              ? current
              : j.result.status === 'invalid_model'
                ? 'issues'
                : 'results',
          );
          setMessage(
            JSON.stringify(pRef.current.model) !== sig
              ? '输入已变更，请重新计算；本次结果对应计算开始时的输入'
              : (statusText[j.result.status] || j.result.status) + '；点击管段或表格查看详情',
          );
        } catch (e: any) {
          if (run === runRef.current) {
            setBusy(false);
            setMessage('任务查询失败：' + e.message);
          }
        }
      };
      poll();
    } catch (e: any) {
      if (run === runRef.current) {
        setBusy(false);
        setMessage('计算启动失败：' + e.message);
      }
    }
  }
  async function cancel() {
    const cancellation = ++runRef.current;
    if (!jobRef.current) {
      setBusy(false);
      setMessage('已取消本次启动意图；收到任务 ID 后将请求终止进程');
      return;
    }
    const id = jobRef.current.id;
    try {
      await api('jobs/' + id, undefined, 'DELETE');
      jobRef.current = null;
      setBusy(false);
      setMessage('已请求终止计算进程');
    } catch (e: any) {
      if (runRef.current === cancellation) {
        jobRef.current = null;
        setBusy(false);
        setMessage('取消状态未确认：' + e.message + '；旧任务可能仍在执行，服务端有超时终止保护');
      }
    }
  }
  async function exportResult(kind: string) {
    if (rejectInvalidEditor()) return;
    if (kind !== 'parameters-xlsx' && (!result?.edges || stale)) {
      setMessage('请先对当前输入完成一次有效计算，再导出结果');
      return;
    }
    try {
      setMessage('正在生成导出文件…');
      const content = await api('export', {
        project: p,
        result,
        kind: kind === 'pdf' ? 'html' : kind,
      });
      const exported = await download(
        p.name +
          (kind.endsWith('xlsx')
            ? (kind === 'parameters-xlsx' ? '·输入参数' : '·计算结果') + '.xlsx'
            : kind === 'csv'
              ? '.csv'
              : kind === 'pdf'
                ? '.pdf'
                : '.html'),
        kind.endsWith('xlsx') ? content.content_base64 : content,
        kind.endsWith('xlsx') ? 'xlsx' : kind,
      );
      setMessage(
        exported === false
          ? '已取消导出，没有写入文件'
          : window.desktop
            ? '导出完成：包含所选输入快照的归属及计算信息'
            : '已请求导出，请确认浏览器下载文件',
      );
    } catch (e: any) {
      setMessage('导出失败：' + e.message);
    }
  }
  function snapshot() {
    if (rejectInvalidEditor()) return;
    if (!result?.edges || stale) {
      setMessage('请先计算当前工况');
      return;
    }
    const next = clone(p),
      label = '工况 ' + (next.scenarios.length + 1);
    next.scenarios.push({
      id: uid('S'),
      name: label,
      model: clone(p.model),
      result: clone(result),
    });
    edit(next);
    setTab('compare');
    setMessage(label + ' 已保存为独立输入/结果快照');
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushSync(() => (document.activeElement as HTMLElement)?.blur?.());
        save();
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        flushSync(() => (document.activeElement as HTMLElement)?.blur?.());
        calculate();
        return;
      }
      if ((e.target as HTMLElement)?.matches('input,textarea,select')) return;
      if (ctrl && e.key === 'z') {
        e.preventDefault();
        setHistory(e.shiftKey ? redo : undo);
      } else if (ctrl && e.key === 'y') {
        e.preventDefault();
        setHistory(redo);
      } else if (ctrl && e.key === 'c') {
        e.preventDefault();
        clipboard.current = copyItems(pRef.current, selected);
        setMessage('已复制选中对象及必要端点');
      } else if (ctrl && e.key === 'v' && clipboard.current) {
        e.preventDefault();
        edit(pasteItems(pRef.current, clipboard.current));
      } else if (e.key === 'Delete') {
        e.preventDefault();
        edit(deleteItems(pRef.current, selected));
        setSelected([]);
      } else if (e.key === 'F5') {
        e.preventDefault();
        calculate();
      } else if (e.key === 'Escape') {
        setSelected([]);
        setHelp(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selected, p, busy, result, stale]);
  const select = useCallback((id: string) => setSelected([id]), []);
  const selectionChange = useCallback(({ nodes, edges }: any) => {
    const ids = [...nodes, ...edges].map((x) => x.id).sort();
    setSelected((old) => (JSON.stringify([...old].sort()) === JSON.stringify(ids) ? old : ids));
  }, []);
  const rfNodes = useMemo(
    () =>
      p.model.nodes.map((n) => ({
        id: n.id,
        type: 'junction',
        width: 40,
        height: 40,
        position: p.layout[n.id] || { x: 0, y: 0 },
        selected: selected.includes(n.id),
        data: {
          name: n.name || n.id,
          fixed: n.head != null,
          labels,
          showValue: labels && result && !stale,
          value: result?.nodes?.[n.id]
            ? fmt(result.nodes[n.id].pressure_pa_gauge / 1000) + ' kPa(g)'
            : '',
        },
      })),
    [p, selected, result, stale, labels],
  );
  const maxValue =
    Number(manualMax) > 0
      ? Number(manualMax)
      : Math.max(
          0.001,
          ...p.model.edges.map((e) => Math.abs(result?.edges?.[e.id]?.[metric] || 0)),
        );
  const rfEdges = useMemo(
    () =>
      p.model.edges.map((e) => {
        const r = result?.edges?.[e.id],
          val = r?.[metric] || 0;
        const color =
          result && !stale
            ? `hsl(${205 - Math.min(1, Math.abs(val) / maxValue) * 190} 65% 43%)`
            : e.closed || e.opening === 0
              ? '#98a6b4'
              : e.kind === 'pump'
                ? '#0d887e'
                : '#54728c';
        const a = p.layout[e.source],
          b = p.layout[e.target];
        const sourceHandle =
          a && b
            ? Math.abs(a.x - b.x) > Math.abs(a.y - b.y)
              ? b.x > a.x
                ? '2'
                : '0'
              : b.y > a.y
                ? '3'
                : '1'
            : '2';
        const targetHandle =
          a && b
            ? Math.abs(a.x - b.x) > Math.abs(a.y - b.y)
              ? b.x > a.x
                ? '0'
                : '2'
              : b.y > a.y
                ? '1'
                : '3'
            : '0';
        const arrow = { type: MarkerType.ArrowClosed, width: 18, height: 18, color };
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle,
          targetHandle,
          type: 'hydraulic',
          selected: selected.includes(e.id),
          style: {
            stroke: color,
            strokeWidth: selected.includes(e.id) ? 4 : 2.5,
            strokeDasharray: e.closed || e.opening === 0 ? '7 5' : undefined,
          },
          markerEnd: r?.flow_m3_s < 0 ? undefined : arrow,
          markerStart: r?.flow_m3_s < 0 ? arrow : undefined,
          data: {
            ...e,
            labels,
            select,
            symbol: symbols[e.kind],
            value:
              r && !stale
                ? (r.flow_m3_s < 0 ? '← ' : '') +
                  fmt(resultFlow(result, e.id, flowUnit)) +
                  ' ' +
                  unitLabel[flowUnit]
                : '',
            name: e.name || e.id,
          },
        };
      }),
    [p, selected, result, stale, metric, maxValue, flowUnit, labels],
  );
  const onConnect = (c: any) => {
    if (c.source === c.target) {
      setMessage('连接无效：不能连接同一个节点。交叉线本身不形成连接。');
      return;
    }
    const next = clone(p);
    next.model.edges.push({
      id: uid('E'),
      name: names[tool],
      kind: tool,
      source: c.source,
      target: c.target,
      ...defaults(tool),
    });
    edit(next);
    setMessage('连接成功，可继续画管；点击支路编辑实际管长和内径');
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const kind = event.dataTransfer.getData('application/ohn');
    if (!kind) return;
    const pos = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const at = { x: Math.round(pos.x / 20) * 20, y: Math.round(pos.y / 20) * 20 };
    const next = clone(p),
      a = uid();
    next.model.nodes.push({
      id: a,
      name: kind === 'node' ? '新节点' : names[kind] + '入口',
      head: null,
      elevation: 0,
      demand: 0,
    });
    next.layout[a] = at;
    if (kind !== 'node') {
      const b = uid();
      next.model.nodes.push({
        id: b,
        name: names[kind] + '出口',
        head: null,
        elevation: 0,
        demand: 0,
      });
      next.layout[b] = { x: at.x + 160, y: at.y };
      next.model.edges.push({
        id: uid('E'),
        kind,
        name: names[kind],
        source: a,
        target: b,
        ...defaults(kind),
      });
    }
    edit(next);
    setSelected([a]);
    setMessage('设备已放入画布；从圆形端口拖向另一个端口连接。几何交叉不代表连接。');
  };
  function graphSvg() {
    const coords = Object.values(p.layout);
    const minx = Math.min(0, ...coords.map((x) => x.x)) - 60,
      miny = Math.min(0, ...coords.map((x) => x.y)) - 60,
      maxx = Math.max(900, ...coords.map((x) => x.x)) + 180,
      maxy = Math.max(550, ...coords.map((x) => x.y)) + 100;
    const esc = (s: any) =>
      String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minx} ${miny} ${maxx - minx} ${maxy - miny}" width="1600" height="900"><rect x="${minx}" y="${miny}" width="100%" height="100%" fill="white"/><g font-family="sans-serif" font-size="14">${p.model.edges
      .map((e) => {
        const a = p.layout[e.source],
          b = p.layout[e.target];
        if (!a || !b) return '';
        return `<path d="M${a.x + 20},${a.y + 20} L${b.x + 20},${a.y + 20} L${b.x + 20},${b.y + 20}" stroke="#2583ad" stroke-width="3" fill="none"/><text x="${(a.x + b.x) / 2 + 25}" y="${(a.y + b.y) / 2 + 10}">${esc(e.name || e.id)} ${result && !stale ? esc(fmt(resultFlow(result, e.id, flowUnit)) + ' ' + unitLabel[flowUnit]) : ''}</text>`;
      })
      .join('')}${p.model.nodes
      .map((n) => {
        const a = p.layout[n.id];
        if (!a) return '';
        return `<circle cx="${a.x + 20}" cy="${a.y + 20}" r="7" fill="${n.head != null ? '#0d887e' : '#233f55'}"/><text x="${a.x + 30}" y="${a.y + 45}">${esc(n.name || n.id)}</text>`;
      })
      .join(
        '',
      )}<text x="${minx + 20}" y="${miny + 30}">OpenHydroNet · ${esc(p.name)} ${stale ? '（旧结果过期）' : ''}</text></g></svg>`;
  }
  async function exportGraph(kind: string) {
    try {
      const svg = graphSvg();
      if (kind === 'svg') await download(p.name + '.svg', svg, 'svg');
      else {
        const image = new Image();
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        image.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1920;
          canvas.height = 1080;
          canvas.getContext('2d')!.drawImage(image, 0, 0, 1920, 1080);
          const data = canvas.toDataURL('image/png');
          URL.revokeObjectURL(url);
          await download(p.name + '.png', data, 'png');
        };
        image.src = url;
      }
    } catch (e: any) {
      setMessage(e.message);
    }
  }
  const field = (
    key: string,
    label: string,
    unit: string,
    value: any,
    min = -Infinity,
    max = Infinity,
    hint = '',
    strict = false,
    integer = false,
    optional = false,
  ) => (
    <NumberField
      key={key}
      label={label}
      unit={unit}
      value={value}
      min={min}
      max={max}
      strict={strict}
      integer={integer}
      optional={optional}
      hint={hint}
      onApply={(v: number) => updateItem(key, v)}
    />
  );
  const compared = p.scenarios.find((s) => s.id === comparison);
  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand-mark">
          O<span>H</span>
        </div>
        <div className="brand">
          <b>OpenHydroNet</b>
          <span>供热与空调水系统工作台</span>
        </div>
        <span className="version">{APP_VERSION}</span>
        <div className="project-title">
          {p.name}
          <small>{dirty ? '未保存修改 · ' : ''}离线工程 · SI 计算内核</small>
        </div>
        <button onClick={() => setWelcome(true)}>新建 / 模板</button>
        <button onClick={open}>打开工程</button>
        <button onClick={save}>保存</button>
        <button aria-label="帮助与快捷键" onClick={() => setHelp(true)}>
          ？ 帮助
        </button>
      </header>
      <nav className="workflow">
        <span className="workflow-title">工程工作流</span>
        <button className="step" onClick={() => setTab('results')}>
          <i>1</i> 建模
        </button>
        <span>›</span>
        <button className="step" aria-label="检查" onClick={check}>
          <i>2</i> 检查
        </button>
        <span>›</span>
        <button
          className="primary"
          aria-label={busy ? '计算中' : '计算'}
          onClick={calculate}
          disabled={busy}
        >
          <i>3</i> {busy ? '计算中…' : '计算'}
        </button>
        {busy && <button onClick={cancel}>取消</button>}
        <span>›</span>
        <button className="step" onClick={() => setTab('pressure')}>
          <i>4</i> 分析
        </button>
        <span>›</span>
        <button className="step" aria-label="对比" onClick={() => setTab('compare')}>
          <i>5</i> 对比
        </button>
        <span>›</span>
        <button className="step" onClick={() => exportResult('csv')}>
          <i>6</i> 导出 CSV
        </button>
        <div className="workflow-end">
          <span className="offline-dot" />
          本地计算 · 无遥测
          <select
            aria-label="系统场景"
            value={p.preferences.scenario}
            onChange={(e) => {
              const next = clone(p);
              next.preferences.scenario = e.target.value;
              edit(next);
            }}
          >
            <option value="heating">供热 / 供冷</option>
            <option value="airconditioning">空调水系统</option>
          </select>
          <select
            aria-label="流量单位"
            value={flowUnit}
            onChange={(e) => {
              const next = clone(p);
              next.preferences.flow_unit = e.target.value;
              edit(next);
            }}
          >
            {Object.keys(flowFactor).map((u) => (
              <option key={u} value={u}>
                {unitLabel[u]}
              </option>
            ))}
          </select>
        </div>
      </nav>
      <main className="workspace">
        <aside className="left-panel">
          <h2>设备与工程</h2>
          <div className="section-label">拖入画布，或选择连线模型</div>
          <div className="palette">
            {['node', 'pipe', 'pump', 'valve', 'terminal', 'resistance', 'flow_control'].map(
              (k) => (
                <button
                  key={k}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/ohn', k)}
                  className={tool === k ? 'chosen' : ''}
                  onClick={() => {
                    if (k !== 'node') setTool(k);
                    setMessage(
                      k === 'node'
                        ? '将节点按钮拖到画布上'
                        : '当前连线模型：' + names[k] + '；从一个节点端口拖向另一个端口',
                    );
                  }}
                >
                  <span>{symbols[k]}</span>
                  {names[k]}
                </button>
              ),
            )}
          </div>
          <div className="tip">
            管线交叉 ≠ 水力连接
            <br />
            移动图形不会改变实际管长
          </div>
          <h3>
            工程结构{' '}
            <small>
              {p.model.nodes.length} 点 / {p.model.edges.length} 支路
            </small>
          </h3>
          <input
            aria-label="搜索设备"
            placeholder="搜索名称或 ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="structure">
            {[...p.model.nodes, ...p.model.edges]
              .filter(
                (x) =>
                  (x.name || x.id).toLowerCase().includes(search.toLowerCase()) ||
                  x.id.toLowerCase().includes(search.toLowerCase()),
              )
              .map((x) => (
                <button
                  data-testid={'select-' + x.id}
                  key={x.id}
                  className={selected.includes(x.id) ? 'selected' : ''}
                  onClick={() => locate(x.id)}
                >
                  <span>{symbols[x.kind || 'node']}</span>
                  <span>
                    {x.name || x.id}
                    <small>
                      {x.id} · {names[x.kind || 'node']}
                    </small>
                  </span>
                  {issues.some((i) => i.object_id === x.id) && <b className="warn-icon">!</b>}
                </button>
              ))}
          </div>
          <button className="help-card" onClick={() => setHelp(true)}>
            <b>第一次使用？</b>
            <span>跟随闭式循环示例完成 5 个步骤 →</span>
          </button>
        </aside>
        <section className="center">
          <div className="canvas-toolbar">
            <button
              title="撤销 Ctrl+Z"
              disabled={!history.past.length}
              onClick={() => setHistory(undo)}
            >
              ↶ 撤销
            </button>
            <button
              title="重做 Ctrl+Y"
              disabled={!history.future.length}
              onClick={() => setHistory(redo)}
            >
              ↷
            </button>
            <span className="divider" />
            <button onClick={() => rf.fitView({ padding: 0.18, maxZoom: 1.1 })}>适配画布</button>
            <button onClick={() => edit(alignItems(p, selected, 'y'))}>水平对齐</button>
            <button onClick={() => edit(alignItems(p, selected, 'x'))}>垂直对齐</button>
            <button onClick={() => edit(alignItems(p, selected, 'distribute'))}>等距分布</button>
            <label className="inline">
              <input
                type="checkbox"
                checked={labels}
                onChange={(e) => setLabels(e.target.checked)}
              />{' '}
              标签
            </label>
            <span className="canvas-caption">网格吸附 · 正交连线</span>
          </div>
          <div
            className="canvas"
            onDrop={onDrop}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
          >
            <ReactFlow
              nodes={dragNodes || rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onConnect={onConnect}
              connectionMode={ConnectionMode.Loose}
              isValidConnection={(c) => c.source !== c.target}
              onNodeClick={(_, n) => setSelected([n.id])}
              onEdgeClick={(_, e) => setSelected([e.id])}
              onSelectionChange={selectionChange}
              onNodesChange={(changes) => {
                if (changes.some((x) => x.type === 'position'))
                  setDragNodes((cur) => applyNodeChanges(changes, cur || rfNodes));
              }}
              onNodeDragStop={(_, node, nodes) => {
                const next = clone(p);
                for (const n of nodes) next.layout[n.id] = n.position;
                edit(next);
                setDragNodes(null);
              }}
              onPaneClick={() => setSelected([])}
              onNodesDelete={(nodes) =>
                edit(
                  deleteItems(
                    p,
                    nodes.map((n) => n.id),
                  ),
                )
              }
              onEdgesDelete={(edges) =>
                edit(
                  deleteItems(
                    p,
                    edges.map((e) => e.id),
                  ),
                )
              }
              deleteKeyCode={null}
              snapToGrid
              snapGrid={[20, 20]}
              selectionOnDrag
              panOnDrag={[1, 2]}
              multiSelectionKeyCode="Shift"
              ariaLabelConfig={{
                'node.a11yDescription.default':
                  '按 Enter 选中节点，方向键移动图形，Escape 取消选择。',
                'node.a11yDescription.keyboardDisabled': '按 Enter 选中节点，Escape 取消选择。',
                'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) =>
                  `节点已向${({ left: '左', right: '右', up: '上', down: '下' } as Record<string, string>)[direction] || direction}移动至画布坐标 ${x.toFixed(0)}, ${y.toFixed(0)}；物理参数未改变。`,
                'edge.a11yDescription.default': '按 Enter 选中支路，Escape 取消选择。',
                'controls.ariaLabel': '画布视图控制',
                'controls.zoomIn.ariaLabel': '放大画布',
                'controls.zoomOut.ariaLabel': '缩小画布',
                'controls.fitView.ariaLabel': '适配全部图形',
                'controls.interactive.ariaLabel': '切换图形编辑锁定',
                'minimap.ariaLabel': '管网缩略图',
                'handle.ariaLabel': '设备连接端口',
              }}
              fitView
              minZoom={0.2}
              maxZoom={2.5}
              proOptions={{ hideAttribution: false }}
            >
              <Background gap={20} size={1} color="#cfdce8" />
              <Controls showInteractive={false} />
              <MiniMap
                style={{ width: 140, height: 90 }}
                nodeColor={(n) => (n.data.fixed ? '#188f89' : '#6486a4')}
                maskColor="#e9eff688"
                pannable
                zoomable
              />
            </ReactFlow>
            {p.model.nodes.length === 0 && (
              <div className="canvas-empty">
                <h2>让第一个系统从这里开始</h2>
                <p>拖入节点和设备，再从端口连接管线。也可以直接使用经过计算验证的公开示例。</p>
                <button
                  className="primary"
                  onClick={() => examples[0] && replace(clone(examples[0]))}
                >
                  打开闭式循环示例
                </button>
              </div>
            )}
            <div className="canvas-badge">
              {busy
                ? '◌ 计算任务运行中'
                : stale
                  ? '⚠ 输入已变更 · 旧结果过期'
                  : result
                    ? '✓ ' + (statusText[result.status] || result.status)
                    : '○ 尚未计算'}
            </div>
            {result && !stale && (
              <div className="legend">
                <b>
                  {metric === 'flow_m3_h'
                    ? '体积流量 [m³/h]'
                    : metric === 'velocity_m_s'
                      ? '流速 [m/s]'
                      : '测压水头差 [m]'}
                </b>
                <div className="gradient" />
                <span>
                  0 <i>{fmt(maxValue)}</i>
                </span>
              </div>
            )}
          </div>
          <section
            className={
              'bottom-panel' + (tab === 'library' || tab === 'analysis' ? ' library-panel' : '')
            }
          >
            <div className="tabbar">
              {[
                ['results', '计算结果'],
                ['pressure', '水压图'],
                ['issues', `问题列表 ${issues.length || ''}`],
                ['compare', '工况对比'],
                ['library', '设备库 / 曲线'],
                ['analysis', '分析'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={tab === id ? 'active' : ''}
                  onClick={() => {
                    if (!rejectInvalidEditor()) setTab(id);
                  }}
                >
                  {label}
                </button>
              ))}
              <div className="tabbar-end">
                {result?.residuals && (
                  <small>
                    质量残差 {result.residuals.mass_m3_s.toExponential(2)} m³/s · 能量残差{' '}
                    {result.residuals.energy_m.toExponential(2)} m
                  </small>
                )}
              </div>
            </div>
            {stale && tab !== 'analysis' && (
              <div className="stale-banner">
                旧计算结果仅供参考，不再代表当前输入；请重新计算后导出。
              </div>
            )}
            <div className="bottom-content">
              <div className="analysis-host" hidden={tab !== 'analysis'}>
                <AnalysisPanel key={epoch} model={p.model} flowUnit={flowUnit} />
              </div>
              {tab === 'library' && (
                <DeviceLibrary
                  key={epoch}
                  project={p}
                  selectedDevices={selected}
                  onMutate={(fn: any) => {
                    if (documentEpoch.current !== epoch) return false;
                    const next = clone(pRef.current);
                    fn(next);
                    if (next.library.length > 500) {
                      setMessage('设备库最多 500 项，请拆分；未覆盖原库');
                      return false;
                    }
                    edit(next);
                    return true;
                  }}
                  onApply={(entry: any, baseline: string, ids: string[]) => {
                    if (rejectInvalidEditor()) throw Error('存在未提交的无效参数，未应用旧值');
                    if (
                      documentEpoch.current !== epoch ||
                      JSON.stringify(pRef.current) !== baseline ||
                      JSON.stringify(selectedRef.current) !== JSON.stringify(ids)
                    )
                      throw Error('校验期间工程或选择已变化，请重新应用；未覆盖当前输入');
                    edit(applyLibrary(pRef.current, ids, entry));
                    setMessage('设备数据副本已应用，保留稳定 ID、连接和运行设置');
                  }}
                />
              )}
              {tab === 'results' &&
                (result?.edges ? (
                  <>
                    <table>
                      <thead>
                        <tr>
                          <th>设备 / ID</th>
                          <th>流量 [{unitLabel[flowUnit]}]</th>
                          <th>流速 [m/s]</th>
                          <th>水头差 [m]</th>
                          <th>水力功率 [W]</th>
                          <th>状态</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.model.edges.map((e) => {
                          const r = result.edges[e.id];
                          return (
                            <tr
                              key={e.id}
                              className={selected.includes(e.id) ? 'selected' : ''}
                              onClick={() => locate(e.id)}
                            >
                              <td>
                                {e.name || e.id}
                                <small> {e.id}</small>
                              </td>
                              <td>{fmt(resultFlow(result, e.id, flowUnit), 5)}</td>
                              <td>{fmt(r?.velocity_m_s)}</td>
                              <td>{fmt(r?.head_drop_m, 5)}</td>
                              <td>{fmt(r?.hydraulic_power_w)}</td>
                              <td>
                                {!r
                                  ? '无对应结果'
                                  : r?.state === 'closed'
                                    ? '关闭'
                                    : r?.state === 'closed_check'
                                      ? '止回关闭'
                                      : r?.flow_m3_s < 0
                                        ? '← 反向'
                                        : '→ 正向'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <div className="empty-state">
                    <b>先建模，再检查，然后计算</b>
                    <p>计算完成后，这里会显示流量、流速、压降与功率。点击结果行可以定位设备。</p>
                  </div>
                ))}
              {tab === 'pressure' && (
                <>
                  <div className="chart-options">
                    路径末端{' '}
                    <select
                      aria-label="水压图末端"
                      value={terminal}
                      onChange={(e) => setTerminal(e.target.value)}
                    >
                      <option value="">默认末端</option>
                      {p.model.edges
                        .filter((e) => e.kind === 'terminal')
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name || e.id}
                          </option>
                        ))}
                    </select>
                    <span>H 为测压水头，不是总水头；供回水沿完整循环路径排列。</span>
                  </div>
                  {stale ? (
                    <div className="empty-state">
                      当前输入已变化，暂不混合新标高与旧水头绘图；请重新计算。
                    </div>
                  ) : (
                    <PressureChart
                      project={p}
                      result={result}
                      terminal={terminal}
                      onSelect={locate}
                    />
                  )}
                </>
              )}
              {tab === 'issues' &&
                (issues.length ? (
                  <div className="issue-list">
                    {issues.map((i, index) => (
                      <button key={index} onClick={() => i.object_id && locate(i.object_id)}>
                        <span className={'severity ' + i.severity}>
                          {i.severity === 'error' ? '错误' : '提示'}
                        </span>
                        <div>
                          <b>{i.message}</b>
                          {i.fix && <p>建议：{i.fix}</p>}
                          <small>
                            {i.code} · {i.object_id || '工程'}
                          </small>
                        </div>
                        <span>定位 →</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    当前没有已报告的问题。参数和拓扑检查不等于工程设计已经符合所有规范。
                  </div>
                ))}
              {tab === 'compare' && (
                <>
                  <div className="compare-tools">
                    <button onClick={snapshot}>保存当前工况快照</button>
                    <select
                      aria-label="对比工况"
                      value={comparison}
                      onChange={(e) => setComparison(e.target.value)}
                    >
                      <option value="">选择基准工况</option>
                      {p.scenarios.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    {compared && (
                      <button
                        onClick={() => {
                          const next = clone(p);
                          next.model = clone(compared.model);
                          edit(next);
                          setResult(compared.result);
                          setResultSig(JSON.stringify(compared.model));
                        }}
                      >
                        恢复该工况输入
                      </button>
                    )}
                    {compared && (
                      <button
                        className="danger"
                        onClick={() => {
                          if (rejectInvalidEditor()) return;
                          const next = clone(p);
                          next.scenarios = next.scenarios.filter((s) => s.id !== comparison);
                          edit(next);
                          setComparison('');
                          setMessage('已删除所选快照，可撤销；当前物理输入未改变');
                        }}
                      >
                        删除所选快照
                      </button>
                    )}
                    <small>快照保存完整输入/结果。质量流量按各自密度换算；不是动态模拟。</small>
                  </div>
                  {compared && result?.edges ? (
                    <table>
                      <thead>
                        <tr>
                          <th>设备</th>
                          <th>基准 [{unitLabel[flowUnit]}]</th>
                          <th>当前 [{unitLabel[flowUnit]}]</th>
                          <th>差值</th>
                          <th>变化比例</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.model.edges.map((e) => {
                          const values = compareFlows(compared.result, result, e.id, flowUnit);
                          return (
                            <tr key={e.id} onClick={() => locate(e.id)}>
                              <td>{e.name || e.id}</td>
                              <td>{fmt(values.baseline)}</td>
                              <td>{fmt(values.current)}</td>
                              <td>{fmt(values.delta)}</td>
                              <td>
                                {values.percent !== undefined
                                  ? fmt(values.percent) + '%'
                                  : '基准为零或缺数据 / 不可比'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="empty-state">
                      先计算并保存一个工况，再调节泵速或阀位重新计算，选择基准查看差异。
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </section>
        <aside className="right-panel">
          <h2>
            上下文属性{' '}
            <small>
              {selected.length > 1
                ? `${selected.length} 项选中`
                : item
                  ? names[item.kind || 'node']
                  : '工程设置'}
            </small>
          </h2>
          <div className="property-scroll">
            {item ? (
              <>
                <div className="object-title">
                  <span>{symbols[item.kind || 'node']}</span>
                  <div>
                    <b>{item.name || item.id}</b>
                    <small>稳定 ID · {item.id}</small>
                  </div>
                </div>
                {item.device_data && (
                  <div className="tip">
                    库来源：{item.device_data.name} · {item.device_data.data_source}
                    <br />
                    {item.device_data.modified
                      ? '有手工覆盖，请复核当前参数'
                      : '参数副本随工程保存，不依赖库条目仍然存在'}
                  </div>
                )}
                <label className="field">
                  <span>名称</span>
                  <input
                    aria-label="设备名称"
                    value={item.name || ''}
                    onChange={(e) => updateItem('name', e.target.value)}
                  />
                </label>
                {selected.length > 1 && (
                  <div className="tip">参数将应用于同类型的已选对象；端点和 ID 不批量修改。</div>
                )}
                {isNode ? (
                  <>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={item.head != null}
                        onChange={(e) => updateItem('head', e.target.checked ? 30 : null)}
                      />
                      定压边界 / 参考点
                    </label>
                    {item.head != null &&
                      field(
                        'head',
                        '测压水头 H',
                        'm',
                        item.head,
                        -Infinity,
                        Infinity,
                        'H = 标高 + 表压 / (ρg)，不是建筑循环扬程',
                      )}
                    {field('elevation', '节点标高 z', 'm', item.elevation ?? 0)}
                    {field(
                      'demand',
                      '漏水 / 补水',
                      'm³/s',
                      item.demand ?? 0,
                      -Infinity,
                      Infinity,
                      '正数为漏水或外流；负数为补水。与循环末端不同。',
                    )}
                  </>
                ) : (
                  <>
                    <div className="connection-info">
                      {item.source} → {item.target}
                      <br />
                      图线交叉不产生新连接
                    </div>
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={!!item.closed}
                        onChange={(e) => updateItem('closed', e.target.checked)}
                      />
                      关闭 / 隔离支路
                    </label>
                    {item.kind === 'pipe' && (
                      <>
                        {field(
                          'length',
                          '实际管长',
                          'm',
                          item.length ?? 100,
                          0,
                          Infinity,
                          '实际长度不随图形移动变化',
                          true,
                        )}
                        {field(
                          'diameter',
                          '管道内径',
                          'm',
                          item.diameter ?? 0.1,
                          0,
                          Infinity,
                          '输入内径，不是公称直径；0.08 m = 80 mm',
                          true,
                        )}
                        {advanced && (
                          <>
                            {field(
                              'roughness',
                              '绝对粗糙度',
                              'm',
                              item.roughness ?? 0.00005,
                              0,
                              Infinity,
                              '默认 0.00005 m 为教学估值，请按材质与老化修正',
                            )}
                            <label className="field">
                              <span>局部阻力方式</span>
                              <select
                                value={item.local_mode || 'zeta'}
                                onChange={(e) => {
                                  const next = clone(p);
                                  for (const edge of next.model.edges)
                                    if (selected.includes(edge.id)) {
                                      edge.local_mode = e.target.value;
                                      edge.zeta = 0;
                                      edge.local_ratio = 0;
                                    }
                                  edit(next);
                                }}
                              >
                                <option value="zeta">动压倍数 ζ</option>
                                <option value="ratio">沿程阻力倍率</option>
                              </select>
                            </label>
                            {item.local_mode === 'ratio'
                              ? field(
                                  'local_ratio',
                                  '附加沿程阻力倍数',
                                  '无量纲',
                                  item.local_ratio ?? 0,
                                  0,
                                )
                              : field('zeta', '局部阻力系数 ζ', '无量纲', item.zeta ?? 0, 0)}
                          </>
                        )}
                        <div className="button-row">
                          <button
                            onClick={() => {
                              if (rejectInvalidEditor()) return;
                              try {
                                edit(splitEdge(p, item.id));
                              } catch (error: any) {
                                setMessage(error.message);
                                return;
                              }
                              setMessage('已按 50% 拆分长度及局部阻力；总物理长度不变，可撤销');
                            }}
                          >
                            等分管段
                          </button>
                          <button
                            onClick={() => {
                              if (rejectInvalidEditor()) return;
                              try {
                                edit(insertDevice(p, item.id, 'valve'));
                              } catch (error: any) {
                                setMessage(error.message);
                                return;
                              }
                              setMessage('已在管段中插入阀门；原管长与局部阻力分摊保留');
                            }}
                          >
                            插入阀门
                          </button>
                        </div>
                      </>
                    )}
                    {item.kind === 'pump' && (
                      <>
                        {field(
                          'speed',
                          '相对转速 n/n₀',
                          '比例',
                          item.speed ?? 1,
                          0,
                          2,
                          '0 停泵并隔离；不是额定转速 rpm',
                        )}
                        {field(
                          'parallel',
                          '相同并联泵台数',
                          '台',
                          item.parallel ?? 1,
                          1,
                          20,
                          '整数台数，假设同型同速并联',
                          false,
                          true,
                        )}
                        {field(
                          'nominal_rpm',
                          '基准曲线额定转速',
                          'rpm，可留空',
                          item.nominal_rpm ?? '',
                          0,
                          Infinity,
                          '只声明曲线基准，不自动重算系数；未知时仅使用相对转速',
                          true,
                          false,
                          true,
                        )}
                        {item.nominal_rpm > 0 && (
                          <NumberField
                            label="实际转速"
                            unit="rpm"
                            value={(item.speed ?? 1) * item.nominal_rpm}
                            min={0}
                            max={item.nominal_rpm * 2}
                            onApply={(v: number) => updateItem('speed', v / item.nominal_rpm)}
                            hint="由实际转速 / 基准额定转速换算相对转速"
                          />
                        )}
                        <div className="formula">H(Q,n,k) = n² H₀(Q / kn)</div>
                        {(item.curve || [25, 0, -50000]).map((c: number, i: number) => (
                          <NumberField
                            key={i}
                            label={['关死扬程 a₀', '一次系数 a₁', '二次系数 a₂', '三次系数 a₃'][i]}
                            unit={i === 0 ? 'm' : `m / (m³/s)^${i}`}
                            value={c}
                            onApply={(v: number) => {
                              const curve = [...(item.curve || [25, 0, -50000])];
                              curve[i] = v;
                              updateItem('curve', curve);
                            }}
                          />
                        ))}
                        {advanced && (
                          <>
                            {field(
                              'efficiency',
                              '整机效率（用户提供）',
                              '0–1',
                              item.efficiency ?? '',
                              0,
                              1,
                              '没有数据请留空；仅输出水力功率',
                              true,
                              false,
                              true,
                            )}
                            <button onClick={() => updateItem('efficiency', null)}>
                              清除效率假设
                            </button>
                            <label className="check-field">
                              <input
                                type="checkbox"
                                checked={item.check_valve !== false}
                                onChange={(e) => updateItem('check_valve', e.target.checked)}
                              />
                              带止回装置
                            </label>
                          </>
                        )}
                        <div className="tip">
                          {item.data_source || '用户数据，未经厂家认证'}
                          。教学泵不能作为真实选型依据。
                        </div>
                      </>
                    )}
                    {item.kind === 'valve' && (
                      <>
                        {field(
                          'opening',
                          '阀门开度',
                          '0–1',
                          item.opening ?? 1,
                          0,
                          1,
                          '0 为完全关闭，会改变连通关系',
                        )}
                        {field(
                          'kv',
                          '全开 Kv',
                          'm³/h @ 1 bar',
                          item.kv ?? 100,
                          0,
                          Infinity,
                          '水介质标准定义；不是无量纲 ζ',
                          true,
                        )}
                        <label className="field">
                          <span>开度特性</span>
                          <select
                            aria-label="阀门特性"
                            value={item.characteristic || 'linear'}
                            onChange={(e) => updateItem('characteristic', e.target.value)}
                          >
                            <option value="linear">线性 Kv</option>
                            <option value="equal_percentage">等百分比 Kv</option>
                          </select>
                        </label>
                        {item.characteristic === 'equal_percentage' &&
                          field('rangeability', '可调比 R', '无量纲', item.rangeability ?? 50, 1)}
                      </>
                    )}
                    {item.kind === 'terminal' && (
                      <>
                        {
                          <NumberField
                            label="末端设计流量"
                            unit={unitLabel[flowUnit]}
                            value={(item.design_flow ?? 0.01) * flowFactor[flowUnit]}
                            min={0}
                            strict
                            onApply={(v: number) =>
                              updateItem('design_flow', v / flowFactor[flowUnit])
                            }
                          />
                        }{' '}
                        {field(
                          'design_head',
                          '末端设计压降',
                          'm 水头',
                          item.design_head ?? 10,
                          0,
                          Infinity,
                          '定义为定阻末端 R=H设计/Q设计²，并不强制达到设计流量',
                          true,
                        )}
                        <div className="formula">ΔH = H设计 × (Q / Q设计)²</div>
                      </>
                    )}
                    {item.kind === 'resistance' &&
                      field(
                        'resistance',
                        '等效阻力 R',
                        's²/m⁵',
                        item.resistance ?? 100000,
                        0,
                        Infinity,
                        'ΔH = R Q|Q|，Q 使用 m³/s',
                        true,
                      )}
                    {item.kind === 'flow_control' && (
                      <>
                        {field(
                          'set_flow',
                          '设定流量',
                          'm³/s',
                          item.set_flow ?? 0.01,
                          0,
                          Infinity,
                          '理想调节器模型，不是无条件可实现的固定流量',
                          true,
                        )}
                        {field('min_head', '最低资用水头差', 'm', item.min_head ?? 3, 0)}
                      </>
                    )}
                    <div className="button-row">
                      <button
                        onClick={() => {
                          const next = clone(p),
                            e = next.model.edges.find((x) => x.id === item.id)!;
                          [e.source, e.target] = [e.target, e.source];
                          edit(next);
                          setMessage('支路方向已反转。泵和流控的物理作用方向也随之反转，请复核。');
                        }}
                      >
                        反转方向
                      </button>
                      <button
                        className="danger"
                        onClick={() => {
                          edit(deleteItems(p, selected));
                          setSelected([]);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
                {result && !stale && (
                  <div className="property-results">
                    <h3>当前结果</h3>
                    {isNode ? (
                      <>
                        <p>
                          表压{' '}
                          <b>{fmt(result.nodes?.[item.id]?.pressure_pa_gauge / 1000)} kPa(g)</b>
                        </p>
                        <p>
                          测压水头 <b>{fmt(result.nodes?.[item.id]?.head_m)} m</b>
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          流量{' '}
                          <b>
                            {fmt(resultFlow(result, item.id, flowUnit))} {unitLabel[flowUnit]}
                          </b>
                        </p>
                        <p>
                          水头差 <b>{fmt(result.edges?.[item.id]?.head_drop_m)} m</b>
                        </p>
                        {item.kind === 'pump' && (
                          <>
                            <p>
                              水力功率 <b>{fmt(result.edges?.[item.id]?.hydraulic_power_w)} W</b>
                            </p>
                            <p>
                              估算输入功率 <b>{fmt(result.edges?.[item.id]?.input_power_w)} W</b>
                            </p>
                            <small>“—”表示没有效率数据，不推测电功率。</small>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
                <button className="advanced-toggle" onClick={() => setAdvanced(!advanced)}>
                  {advanced ? '收起高级参数 ↑' : '显示高级参数与模型说明 ↓'}
                </button>
              </>
            ) : (
              <>
                <div className="object-title">
                  <span>⌘</span>
                  <div>
                    <b>工程设置</b>
                    <small>选择节点或支路编辑属性</small>
                  </div>
                </div>
                <label className="field">
                  <span>工程名称</span>
                  <input
                    aria-label="工程名称"
                    value={p.name}
                    onChange={(e) => edit({ ...p, name: e.target.value })}
                  />
                </label>
                <NumberField
                  label="水温"
                  unit="℃"
                  value={p.model.fluid.temperature ?? 20}
                  min={0}
                  max={100}
                  hint="温度决定全网密度和黏度；当前为等温水力计算"
                  onApply={(v: number) => {
                    const next = clone(p);
                    next.model.fluid.temperature = v;
                    edit(next);
                  }}
                />
                <NumberField
                  label="当地大气压"
                  unit="Pa 绝压"
                  value={p.model.fluid.atmospheric_pressure ?? 101325}
                  min={0}
                  strict
                  hint="用于绝压及汽化筛查，不代替 NPSH 校核"
                  onApply={(v: number) => {
                    const next = clone(p);
                    next.model.fluid.atmospheric_pressure = v;
                    edit(next);
                  }}
                />
                <div className="tip">
                  闭式循环中，建筑高度改变静压分布，不应简单加到循环泵扬程。
                </div>
              </>
            )}
            <h3>结果表达</h3>
            <label className="field">
              <span>支路着色</span>
              <select
                aria-label="结果着色"
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                <option value="flow_m3_h">体积流量 [m³/h]</option>
                <option value="velocity_m_s">流速 [m/s]</option>
                <option value="head_drop_m">测压水头差 [m]</option>
              </select>
            </label>
            <NumberField
              label="色标上限"
              unit={metric === 'flow_m3_h' ? 'm³/h' : metric === 'velocity_m_s' ? 'm/s' : 'm'}
              value={manualMax}
              min={0}
              strict
              optional
              hint="留空使用自动色标；必须为正数，不把非法值改成默认值"
              onApply={(v: number | null) => setManualMax(v == null ? '' : String(v))}
            />
            <div className="button-row">
              <button onClick={() => setTab('library')}>设备库 / 泵曲线</button>
              <button
                onClick={() => {
                  if (!rejectInvalidEditor()) setImporting(true);
                }}
              >
                导入参数表
              </button>
            </div>
            <div className="button-row">
              <button onClick={() => exportResult('parameters-xlsx')}>参数 Excel</button>
              <button disabled={!result?.edges || stale} onClick={() => exportResult('xlsx')}>
                结果 Excel
              </button>
            </div>
            <div className="button-row">
              <button onClick={() => exportGraph('svg')}>导出 SVG</button>
              <button onClick={() => exportGraph('png')}>导出 PNG</button>
            </div>
            <div className="button-row">
              <button disabled={!result?.edges || stale} onClick={() => exportResult('csv')}>
                结果 CSV
              </button>
              <button
                disabled={!result?.edges || stale}
                onClick={() => exportResult(window.desktop ? 'pdf' : 'html')}
              >
                {window.desktop ? 'PDF 报告' : 'HTML 报告'}
              </button>
            </div>
            <label className="field">
              <span>界面文字缩放</span>
              <select
                aria-label="界面文字缩放"
                value={fontScale}
                onChange={(e) => setFontScale(Number(e.target.value))}
              >
                {[90, 100, 110, 125].map((n) => (
                  <option key={n} value={n}>
                    {n}%
                  </option>
                ))}
              </select>
            </label>
          </div>
        </aside>
      </main>
      <footer className="statusbar" role="status">
        <span className={busy ? 'spinner' : ''}>{busy ? '◌' : '●'}</span>
        <span>{message}</span>
        <span className="status-end">
          {selected.length ? selected.length + ' 个对象选中 · ' : ''}Ctrl+S 保存 · F5 计算 · Shift
          多选
        </span>
      </footer>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.ohn.json"
        hidden
        onChange={async (e) => {
          try {
            const f = e.target.files?.[0];
            if (f) loadDocument(await api('check-project', JSON.parse(await f.text())), true);
          } catch (err: any) {
            setMessage('工程读取失败：' + err.message);
          }
          e.target.value = '';
        }}
      />
      {welcome && (
        <div className="modal-backdrop">
          <section className="welcome modal" role="dialog" aria-label="开始使用">
            <div className="welcome-eyebrow">OPENHYDRONET / 离线工程工作台</div>
            <h1>
              从一张管网图，
              <br />
              走向可解释的水力计算。
            </h1>
            <p>不必手工填写节点关联矩阵。选择起点，我们一起完成第一次计算。</p>
            <div className="welcome-grid">
              <button
                data-testid="start-example"
                onClick={() =>
                  examples[0]
                    ? replace(clone(examples[0]))
                    : setMessage('示例尚未加载，请检查本地服务')
                }
              >
                <span>◉</span>
                <b>打开公开示例</b>
                <small>
                  双末端闭式循环
                  <br />
                  已附验证结果与操作说明
                </small>
                <em>推荐新用户 →</em>
              </button>
              <button
                onClick={() => {
                  setWizard(true);
                  setWelcome(false);
                }}
              >
                <span>⌁</span>
                <b>向导建立系统</b>
                <small>
                  输入设计流量和泵扬程
                  <br />
                  自动生成最小闭式循环
                </small>
                <em>按步骤开始 →</em>
              </button>
              <button onClick={() => replace(emptyProject())}>
                <span>＋</span>
                <b>空白工程</b>
                <small>
                  从设备区拖放与连接
                  <br />
                  适合熟悉系统的用户
                </small>
                <em>自由建模 →</em>
              </button>
            </div>
            <div className="welcome-footer">
              <span>预览版：稳态等温水力计算，不含水锤或热动态。</span>
              {recovery && <button onClick={() => replace(recovery)}>恢复自动保存草稿</button>}
              <button onClick={() => setWelcome(false)}>返回工作台</button>
            </div>
          </section>
        </div>
      )}
      {importing && (
        <TableImport
          getProject={() => clone(pRef.current)}
          onApply={(next: Project) => {
            edit(next);
            setMessage('参数表已按预览整体应用；可撤销，旧结果已标记过期');
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {wizard && (
        <Wizard
          onClose={() => setWizard(false)}
          onBuild={async (next) => {
            if (!(await replace(next))) return;
            setWizard(false);
            setMessage('向导已建立最小闭式循环。下一步检查参数，再点击计算。');
          }}
        />
      )}
      {help && (
        <div className="modal-backdrop">
          <section className="modal help-modal" role="dialog" aria-label="帮助">
            <button className="close" onClick={() => setHelp(false)}>
              关闭 ✕
            </button>
            <h1>第一次有效计算 · 5 个步骤</h1>
            <ol>
              <li>
                <b>从示例开始：</b>“新建 / 模板” →
                “打开公开示例”。左侧是工程结构，中间是管网，右侧是选中对象属性。
              </li>
              <li>
                <b>修改管径：</b>搜索 P2，点击管段，将内径从 0.065 改为 0.05 m，按 Enter
                确认。画布长度不是实际管长。
              </li>
              <li>
                <b>调节水泵：</b>点击 PU1，把相对转速改为 0.8。示例泵为虚构教学数据，不能直接选型。
              </li>
              <li>
                <b>检查并计算：</b>点击“检查”后“计算”。问题列表可定位。查看末端 T2
                是否低于设计需求；“水压图”可看测压水头和标高。
              </li>
              <li>
                <b>对比并保存：</b>
                计算后“保存当前工况快照”，修改转速并重新计算，在对比页选择基准。使用“保存”与“导出
                CSV”留存工程和结果。
              </li>
            </ol>
            <h3>常用操作</h3>
            <p>
              拖动设备到画布。鼠标移到节点可见四个连接端口，从端口拖动连接。滚轮缩放，中键或右键平移；Shift
              多选，空白区拖动框选。缩小时隐藏密集标签。
            </p>
            <p>
              Ctrl+Z 撤销 · Ctrl+Y / Ctrl+Shift+Z 重做 · Ctrl+C/V 复制粘贴 · Delete 删除 · Ctrl+S
              保存 · F5 计算 · Esc 取消选择。
            </p>
            <h3>重要模型边界</h3>
            <p>
              末端是定阻模型，设计流量不是强制流量。阀关闭会拆分拓扑。H=z+p/(ρg)，p
              为表压。没有效率数据只输出水力功率。调节后重新计算属于新的稳态工况，不是真实时间动态。
            </p>
            <p>
              本预览版仍不完整覆盖参考软件。请阅读随附用户手册、公式说明和已知限制，勿未经复核直接用于安全关键设计。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
function Wizard({ onClose, onBuild }: any) {
  const [flow, setFlow] = useState(14.4),
    [head, setHead] = useState(25),
    [load, setLoad] = useState(8);
  return (
    <div className="modal-backdrop">
      <section className="modal wizard" role="dialog">
        <h1>建立最小闭式循环</h1>
        <p>1. 输入末端设计值 → 2. 给出泵扬程 → 3. 生成模型并计算</p>
        <NumberField label="设计流量" unit="m³/h" value={flow} min={0} strict onApply={setFlow} />
        <NumberField label="末端设计压降" unit="m" value={load} min={0} strict onApply={setLoad} />
        <NumberField
          label="示例泵关死扬程"
          unit="m"
          value={head}
          min={0}
          strict
          onApply={setHead}
        />
        <div className="tip">
          向导使用虚构二次泵曲线。实际项目应替换为可核查的泵性能数据；定压参考默认为 30
          m，须按系统静压要求复核。
        </div>
        <div className="button-row">
          <button onClick={onClose}>返回</button>
          <button
            className="primary"
            onClick={() => {
              const n = emptyProject();
              n.name = '向导闭式循环';
              n.model.nodes = ['a', 'b', 'c', 'd'].map((id, i) => ({
                id,
                name: ['定压点 / 泵入口', '泵出口', '末端供水', '末端回水'][i],
                elevation: 0,
                demand: 0,
                head: i === 0 ? 30 : null,
              }));
              n.layout = {
                a: { x: 160, y: 420 },
                b: { x: 160, y: 140 },
                c: { x: 620, y: 140 },
                d: { x: 620, y: 420 },
              };
              n.model.edges = [
                {
                  id: 'PU1',
                  kind: 'pump',
                  name: '虚构教学泵',
                  source: 'a',
                  target: 'b',
                  curve: [head, 0, -100000],
                  speed: 1,
                  parallel: 1,
                },
                {
                  id: 'P1',
                  kind: 'pipe',
                  name: '供水管',
                  source: 'b',
                  target: 'c',
                  ...defaults('pipe'),
                },
                {
                  id: 'T1',
                  kind: 'terminal',
                  name: '末端',
                  source: 'c',
                  target: 'd',
                  design_flow: flow / 3600,
                  design_head: load,
                },
                {
                  id: 'P2',
                  kind: 'pipe',
                  name: '回水管',
                  source: 'd',
                  target: 'a',
                  ...defaults('pipe'),
                },
              ];
              onBuild(n);
            }}
          >
            生成闭式循环 →
          </button>
        </div>
      </section>
    </div>
  );
}
export default function App() {
  return (
    <ReactFlowProvider>
      <Workbench />
    </ReactFlowProvider>
  );
}
