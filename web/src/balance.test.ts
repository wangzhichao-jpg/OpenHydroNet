import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultBalanceSettings,
  balanceProblems,
  buildBalanceRequest,
  pairingLines,
  balanceRows,
  unpairedRows,
  comparisonRows,
  balanceConclusionText,
  indexText,
  pointSignature,
} from './balance';

const model: any = {
  nodes: [],
  edges: [
    { id: 'PU1', name: '循环泵', kind: 'pump', speed: 1, source: 'r', target: 's' },
    { id: 'V1', name: '阀1', kind: 'valve', opening: 1, source: 's', target: 't1' },
    { id: 'T1', name: '末端1', kind: 'terminal', design_flow: 0.004, source: 't1', target: 'r' },
    { id: 'T2', name: '末端2', kind: 'terminal', design_flow: 0.004, source: 's', target: 'r' },
  ],
  fluid: { temperature: 20 },
};

test('defaults: variable speed around the current pump speed, 0.01 step, ±5 % tolerance', () => {
  assert.deepEqual(defaultBalanceSettings(model), {
    mode: 'variable',
    pump: 'PU1',
    lower: 0.5,
    upper: 1.5,
    step: 0.01,
    tolerancePercent: 5,
  });
  const noPump = { ...model, edges: model.edges.slice(1) };
  assert.equal(defaultBalanceSettings(noPump).mode, 'fixed');
});

test('settings are validated before running and converted for the kernel', () => {
  const s = defaultBalanceSettings(model);
  assert.deepEqual(balanceProblems(s, model), []);
  assert.match(balanceProblems({ ...s, lower: 1.5 }, model)[0], /下限/);
  assert.match(balanceProblems({ ...s, tolerancePercent: 0 }, model)[0], /容差/);
  assert.match(balanceProblems({ ...s, step: 0.5 }, model)[0], /精度/);
  assert.match(balanceProblems({ ...s, pump: '' }, model)[0], /泵/);
  assert.deepEqual(balanceProblems({ ...s, mode: 'fixed', pump: '', lower: 9 }, model), []);
  const req = buildBalanceRequest(model, s);
  assert.equal(req.kind, 'balance');
  assert.equal(req.tolerance, 0.05);
  assert.notEqual(req.model, model);
  assert.equal(buildBalanceRequest(model, { ...s, mode: 'fixed' }).pump, 'PU1');
});

test('pairing preview names terminals, valves, missing and ambiguous valves', () => {
  const lines = pairingLines(
    {
      paired: [{ terminal: 'T1', valve: 'V1' }],
      unpaired: ['T2'],
      ambiguous: [{ terminal: 'T9', valves: ['A', 'B'] }],
    },
    model,
  );
  assert.deepEqual(lines, [
    { text: '末端1 ← 阀1', ok: true },
    { text: '末端2：没有串联平衡阀，不参与调节，只报告平衡后的流量', ok: false },
    { text: 'T9：串联多个阀门（A、B），请只保留一个平衡阀', ok: false },
  ]);
});

const result: any = {
  conclusion: 'balanced',
  mode: 'variable',
  tolerance: 0.05,
  index_terminal: 'T1',
  fluid: { density_kg_m3: 1000 },
  pairs: [
    {
      terminal: 'T1',
      valve: 'V1',
      design_flow_m3_s: 0.004,
      opening: 1,
      opening_exact: 0.9999,
      status: 'ok',
      verified_flow_m3_s: 0.00404,
      deviation: 0.01,
    },
  ],
  unpaired: [
    { terminal: 'T2', design_flow_m3_s: 0.004, verified_flow_m3_s: 0.0048, deviation: 0.2 },
  ],
  before: { pump: { speed: 1, head_m: 18.5, flow_m3_s: 0.0086, hydraulic_power_w: 1568.4 } },
  after: { pump: { speed: 0.98, head_m: 19.19, flow_m3_s: 0.008, hydraulic_power_w: 1504.4 } },
};

test('balance rows: display units, deviation, tolerance flag, index marker', () => {
  const [r] = balanceRows(result, model, 'm3/h');
  assert.equal(r.terminal, '末端1');
  assert.equal(r.valve, '阀1');
  assert.ok(Math.abs(r.design! - 14.4) < 1e-9 && Math.abs(r.verified! - 14.544) < 1e-9);
  assert.equal(r.deviation, '+1.0%');
  assert.equal(r.withinTolerance, true);
  assert.equal(r.opening, '1');
  assert.equal(r.note, '最不利环路，保持全开');
  const [u] = unpairedRows(result, model, 'm3/h');
  assert.equal(u.withinTolerance, false);
  assert.equal(u.deviation, '+20.0%');
});

test('status notes are specific and honest', () => {
  const rows = balanceRows(
    {
      ...result,
      index_terminal: null,
      pairs: [
        { ...result.pairs[0], status: 'small_opening', opening: 0.12 },
        {
          ...result.pairs[0],
          terminal: 'T2',
          status: 'needs_more_head',
          opening: null,
          missing_head_m: 1.96,
        },
        { ...result.pairs[0], terminal: 'T2', status: 'cannot_throttle', opening: null },
      ],
    },
    model,
    'm3/h',
  );
  assert.equal(rows[0].note, '开度小于 0.2：阀门口径可能偏大，调节性能差');
  assert.equal(rows[1].note, '开到全开仍差 1.96 m 压头');
  assert.equal(rows[1].opening, '—');
  assert.equal(rows[2].note, '阀门过大：关到最小仍节流不足');
});

test('before/after comparison with changes; conclusions never overclaim', () => {
  const rows = comparisonRows(result, 'm3/h');
  assert.deepEqual(
    rows.map((r) => [r.label, r.change]),
    [
      ['泵相对转速', '-2.0%'],
      ['泵扬程 [m]', '+3.7%'],
      ['泵流量 [m³/h]', '-7.0%'],
      ['泵水力功率 [W]', '-4.1%'],
    ],
  );
  assert.equal(balanceConclusionText.balanced, '平衡完成：各末端验证流量均在容差内');
  assert.match(balanceConclusionText.not_achievable, /给定条件下/);
  assert.equal(indexText(result, model), '最不利环路：末端1（阀1 保持全开）');
  assert.equal(indexText({ ...result, mode: 'fixed', index_terminal: null }, model), '');
});

test('point signature is the frozen model with the suggested changes applied', () => {
  const changes = [{ id: 'V1', field: 'opening', value: 0.22 }];
  const sig = pointSignature(changes, model)!;
  assert.equal(JSON.parse(sig).edges[1].opening, 0.22);
  assert.equal(pointSignature(null, model), null);
});

test('not achievable names the circuit that falls shortest, not a fully open index', () => {
  const r = {
    ...result,
    conclusion: 'not_achievable',
    pairs: [{ ...result.pairs[0], status: 'needs_more_head', opening: null, missing_head_m: 2.5 }],
  };
  assert.equal(indexText(r, model), '差距最大：末端1（泵速到上限、阀门全开仍差 2.5 m）');
});
