import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linspace,
  adjustableParams,
  defaultObservables,
  observableOptions,
  observableLabel,
  toDisplay,
  buildScanRequest,
  scanRows,
} from './analysis';

const model: any = {
  nodes: [
    { id: 'a', name: '供水' },
    { id: 'b', name: '回水' },
  ],
  edges: [
    { id: 'PU1', name: '循环泵', kind: 'pump', speed: 1, source: 'b', target: 'a' },
    { id: 'V1', name: '阀1', kind: 'valve', opening: 0.5, source: 'a', target: 'b' },
    { id: 'P1', name: '管1', kind: 'pipe', source: 'a', target: 'b' },
    { id: 'T1', name: '末端1', kind: 'terminal', source: 'a', target: 'b' },
  ],
  fluid: { temperature: 20 },
};

test('linspace includes both ends, supports a single point and rejects bad counts', () => {
  assert.deepEqual(linspace(0.6, 1.4, 5), [0.6, 0.8, 1, 1.2, 1.4]);
  assert.deepEqual(linspace(0.3, 0.9, 1), [0.3]);
  assert.throws(() => linspace(0, 1, 0), /点数/);
  assert.throws(() => linspace(0, 1, 1001), /1000/);
  assert.throws(() => linspace(0, 1, 2.5), /点数/);
  assert.throws(() => linspace(0, NaN, 3), /数值/);
});

test('only pump speed and valve opening are adjustable, with physical limits', () => {
  const params = adjustableParams(model);
  assert.deepEqual(
    params.map((p) => [p.id, p.field, p.min, p.max, p.value]),
    [
      ['PU1', 'speed', 0, 2, 1],
      ['V1', 'opening', 0, 1, 0.5],
    ],
  );
  assert.match(params[0].label, /循环泵.*转速/);
});

test('default observables are terminal flows; options include nodes and edges', () => {
  assert.deepEqual(defaultObservables(model), [{ scope: 'edge', id: 'T1', field: 'flow_m3_s' }]);
  const options = observableOptions(model);
  assert.ok(options.some((o) => o.scope === 'node' && o.id === 'a' && o.field === 'head_m'));
  assert.ok(options.some((o) => o.scope === 'edge' && o.id === 'P1' && o.field === 'head_drop_m'));
});

test('display conversion uses the analysis density and never invents missing values', () => {
  const flow = { scope: 'edge', id: 'T1', field: 'flow_m3_s' } as const;
  assert.equal(toDisplay(flow, 0.01, 'm3/h', 998), 36);
  assert.equal(toDisplay(flow, 0.01, 'kg/h', 1000), 36000);
  assert.equal(toDisplay(flow, 0.01, 'kg/h', undefined), undefined);
  assert.equal(toDisplay(flow, null, 'm3/h', 998), undefined);
  assert.equal(
    toDisplay({ scope: 'node', id: 'a', field: 'pressure_pa_gauge' }, 2500, 'm3/h', 998),
    2.5,
  );
  assert.equal(observableLabel(flow, model, 'm3/h'), '末端1 流量 [m³/h]');
  assert.equal(
    observableLabel({ scope: 'node', id: 'a', field: 'pressure_pa_gauge' }, model, 'm3/h'),
    '供水 表压 [kPa]',
  );
});

test('scan request freezes a model copy and passes SI observables', () => {
  const request = buildScanRequest(
    model,
    [{ id: 'PU1', field: 'speed', values: [0.5, 1] }],
    defaultObservables(model),
  );
  assert.equal(request.kind, 'scan');
  assert.notEqual(request.model, model);
  assert.deepEqual(request.model, model);
});

test('scan rows convert each record and keep failed points visible', () => {
  const result = {
    fluid: { density_kg_m3: 1000 },
    observables: [{ scope: 'edge', id: 'T1', field: 'flow_m3_s' }],
    records: [
      {
        changes: [{ id: 'PU1', field: 'speed', value: 0.5 }],
        status: 'converged',
        values: [0.005],
        issues: [
          { code: 'TERMINAL_DEMAND', object_id: 'T1' },
          { code: 'NEW_CODE', object_id: null },
        ],
      },
      {
        changes: [{ id: 'PU1', field: 'speed', value: 0 }],
        status: 'numerical_failure',
        values: [null],
        issues: [],
      },
    ],
  };
  const rows = scanRows(result, 'kg/h', model);
  assert.deepEqual(rows[0].issues, ['末端低于设计流量（末端1）', 'NEW_CODE']);
  assert.deepEqual(rows[0].params, [0.5]);
  assert.deepEqual(rows[0].values, [18000]);
  assert.equal(rows[1].status, '残差未达标');
  assert.deepEqual(rows[1].values, [undefined]);
});

// ---- T-005 accessibility ----
import {
  defaultConstraintRows,
  constraintsToSI,
  constraintToDisplay,
  constraintFromDisplay,
  buildAccessibilityRequest,
  checkRows,
  conclusionText,
  constraintProblems,
} from './analysis';

const withDesign: any = structuredClone(model);
withDesign.edges.find((e: any) => e.id === 'T1').design_flow = 0.004;
withDesign.edges.push({ id: 'T9', name: '无设计流量', kind: 'terminal', source: 'a', target: 'b' });

test('default constraints are terminal design flows, stored in SI so unit switches cannot change them', () => {
  const rows = defaultConstraintRows(withDesign);
  assert.deepEqual(
    rows.map((r) => [r.id, r.kind, r.si]),
    [['T1', 'min_flow', 0.004]],
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  assert.equal(constraintToDisplay(rows[0], 'm3/h', 998), 14.4);
});

test('constraint display ↔ SI round trip for every flow unit; heads stay in metres', () => {
  for (const unit of ['m3/h', 'kg/h', 't/h', 'L/s']) {
    const shown = constraintToDisplay(
      { key: 'k', id: 'T1', kind: 'min_flow', si: 0.004 },
      unit,
      990,
    );
    assert.ok(Math.abs(constraintFromDisplay('min_flow', shown!, unit, 990) - 0.004) < 1e-15, unit);
  }
  assert.equal(constraintFromDisplay('min_head', 8, 'kg/h', NaN), 8);
  assert.equal(
    constraintToDisplay({ key: 'k', id: 'T1', kind: 'min_flow', si: 0.004 }, 'kg/h', NaN),
    undefined,
  );
  assert.throws(() => constraintFromDisplay('min_flow', 1, 'kg/h', NaN), /密度/);
  assert.deepEqual(constraintsToSI([{ key: 'k', id: 'T1', kind: 'min_head', si: 8 }]), [
    { id: 'T1', min_head: 8 },
  ]);
});

test('accessibility request is a frozen fixed check', () => {
  const req = buildAccessibilityRequest(withDesign, defaultConstraintRows(withDesign));
  assert.equal(req.kind, 'accessibility');
  assert.notEqual(req.model, withDesign);
  assert.deepEqual(req.constraints, [{ id: 'T1', min_flow: 0.004 }]);
  assert.deepEqual(req.variables, []);
});

test('check rows use the result density and name objects; conclusions never say infeasible', () => {
  const result = {
    fluid: { density_kg_m3: 1000 },
    checks: [
      {
        id: 'T1',
        kind: 'min_flow',
        actual: 0.0038,
        required: 0.004,
        violation: 0.05,
        satisfied: false,
      },
      { id: 'T1', kind: 'min_head', actual: 9, required: 8, violation: 0, satisfied: true },
    ],
  };
  const rows = checkRows(result, withDesign, 'kg/h');
  assert.equal(rows[0].object, '末端1');
  assert.equal(rows[0].kind, '最小流量 [kg/h]');
  assert.ok(Math.abs(rows[0].required! - 14400) < 1e-9 && Math.abs(rows[0].actual! - 13680) < 1e-9);
  assert.equal(rows[0].satisfied, false);
  assert.equal(rows[0].shortfall, '5.0%');
  assert.equal(rows[1].kind, '最小压降（资用压头） [m]');
  for (const c of [
    'feasible_at_this_point',
    'not_satisfied_at_this_point',
    'feasible_point_found',
    'undetermined',
  ])
    assert.doesNotMatch(conclusionText[c], /不可行/);
  assert.match(conclusionText.undetermined, /未确定/);
});

test('constraint problems are found before running, mirroring kernel validation', () => {
  const row = (id: string, kind: any, si: number) => ({ key: id + kind + si, id, kind, si });
  assert.deepEqual(constraintProblems([], withDesign), ['请至少设置一条约束']);
  assert.deepEqual(constraintProblems([row('T1', 'min_flow', 0.004)], withDesign), []);
  assert.match(
    constraintProblems([row('T1', 'min_flow', 0.004), row('T1', 'min_flow', 0.005)], withDesign)[0],
    /重复/,
  );
  assert.match(
    constraintProblems([row('T1', 'min_flow', 0.005), row('T1', 'max_flow', 0.004)], withDesign)[0],
    /下限大于上限/,
  );
  assert.match(constraintProblems([row('gone', 'min_flow', 0.004)], withDesign)[0], /已不存在/);
  assert.match(constraintProblems([row('T1', 'min_head', -1)], withDesign)[0], /不能为负/);
});

// ---- T-006 bounded local search ----
import { searchVariables, searchProblems, adjustmentRows } from './analysis';

test('search variables list every adjustable parameter, off by default, with bounds inside limits', () => {
  const vars = searchVariables(withDesign);
  assert.deepEqual(
    vars.map((v) => [v.id, v.field, v.lower, v.upper, v.step, v.enabled]),
    [
      ['PU1', 'speed', 0.6, 1.4, 0.01, false],
      ['V1', 'opening', 0.1, 1, 0.01, false],
    ],
  );
  const fast = structuredClone(withDesign);
  fast.edges[0].speed = 1.9;
  assert.deepEqual([searchVariables(fast)[0].lower, searchVariables(fast)[0].upper], [1.5, 2]);
});

test('only enabled variables are sent; bad bounds are caught before running', () => {
  const vars = searchVariables(withDesign).map((v, i) => ({ ...v, enabled: i === 0 }));
  const req = buildAccessibilityRequest(withDesign, defaultConstraintRows(withDesign), vars);
  assert.deepEqual(req.variables, [
    { id: 'PU1', field: 'speed', lower: 0.6, upper: 1.4, step: 0.01 },
  ]);
  assert.deepEqual(searchProblems(vars), []);
  assert.match(searchProblems([{ ...vars[0], lower: 1.4, upper: 1.4 }])[0], /下界必须小于上界/);
  assert.match(searchProblems([{ ...vars[0], upper: 2.5 }])[0], /0–2/);
  assert.deepEqual(searchProblems([{ ...vars[0], upper: 2.5, enabled: false }]), []);
  assert.match(searchProblems([{ ...vars[0], step: 0 }])[0], /设定精度/);
  assert.match(searchProblems([{ ...vars[0], step: 0.9 }])[0], /设定精度/);
});

test('adjustment rows compare found values with the frozen model', () => {
  const result = {
    changes: [
      { id: 'PU1', field: 'speed', value: 1.1348 },
      { id: 'V1', field: 'opening', value: 0.5 },
    ],
  };
  const rows = adjustmentRows(result, withDesign);
  assert.equal(rows[0].label, '循环泵 · 相对转速');
  assert.deepEqual([rows[0].from, rows[0].to], [1, 1.1348]);
  assert.ok(Math.abs(rows[0].delta - 0.1348) < 1e-12);
  assert.equal(rows[1].delta, 0);
  assert.deepEqual(adjustmentRows({ changes: null }, withDesign), []);
});

// ---- T-007 apply / save found point ----
import { applyAdjustments, adjustmentSummary, refinementNotes } from './analysis';

test('found adjustments patch a copy of the model and only touch speed/opening', () => {
  const patched = applyAdjustments(withDesign, [
    { id: 'PU1', field: 'speed', value: 1.1348 },
    { id: 'V1', field: 'opening', value: 0.5 },
  ]);
  assert.equal(patched.edges[0].speed, 1.1348);
  assert.equal(withDesign.edges[0].speed, 1, 'original untouched');
  assert.notEqual(patched, withDesign);
  assert.throws(
    () => applyAdjustments(withDesign, [{ id: 'P1', field: 'diameter', value: 1 }]),
    /仅限/,
  );
  assert.throws(
    () => applyAdjustments(withDesign, [{ id: 'gone', field: 'speed', value: 1 }]),
    /不存在/,
  );
});

test('adjustment summary names only real changes', () => {
  const s = adjustmentSummary(
    {
      changes: [
        { id: 'PU1', field: 'speed', value: 1.1348 },
        { id: 'V1', field: 'opening', value: 0.5000001 },
      ],
    },
    {
      ...withDesign,
      edges: withDesign.edges.map((e: any) => (e.id === 'V1' ? { ...e, opening: 0.5 } : e)),
    },
  );
  assert.equal(s, '循环泵 · 相对转速 1 → 1.135');
});

// ---- T-009 min change + settable precision ----
test('refinement notes explain first point → least adjustment → rounding, honestly', () => {
  const base = {
    conclusion: 'feasible_point_found',
    objective: 'min_change_local',
    first_feasible_changes: [{ id: 'PU1', field: 'speed', value: 1.1348 }],
    unrounded_changes: [{ id: 'PU1', field: 'speed', value: 1.05141 }],
    changes: [{ id: 'PU1', field: 'speed', value: 1.06 }],
  };
  assert.deepEqual(
    refinementNotes(
      { ...base, rounding: { status: 'rounded_feasible', steps: [0.01] } },
      withDesign,
    ),
    [
      '首个可行点：循环泵 · 相对转速 1.135',
      '尽量少调整（局部，不保证最小）：循环泵 · 相对转速 1.051',
      '按设定精度取整：循环泵 · 相对转速 1.06，已重新验算，满足全部约束',
    ],
  );
  const bad = refinementNotes(
    {
      ...base,
      changes: base.unrounded_changes,
      rounding: {
        status: 'rounded_infeasible',
        rounded_changes: [{ id: 'PU1', field: 'speed', value: 1.05 }],
        rounded_violations: [{ id: 'T1', kind: 'min_flow' }],
      },
    },
    withDesign,
  );
  assert.equal(
    bad[2],
    '按设定精度取整为 循环泵 · 相对转速 1.05 时不满足约束（末端1），以下保留未取整值',
  );
  assert.deepEqual(refinementNotes({ conclusion: 'undetermined' }, withDesign), []);
  assert.match(
    refinementNotes({ ...base, rounding: { status: 'exact' } }, withDesign)[2],
    /无需取整/,
  );
  assert.match(
    refinementNotes({ ...base, rounding: { status: 'not_verified' } }, withDesign)[2],
    /评估上限/,
  );
});

// ---- T-002 scan chart and CSV ----
import { niceTicks, seriesSegments, unitGroups, scanCsv } from './analysis';

test('nice ticks cover the data with round steps; flat data still gets a range', () => {
  assert.deepEqual(niceTicks(0, 24.5), [0, 5, 10, 15, 20, 25]);
  assert.deepEqual(niceTicks(10.48, 24.52), [10, 12, 14, 16, 18, 20, 22, 24, 26]);
  const flat = niceTicks(13.6, 13.6);
  assert.ok(flat[0] < 13.6 && flat[flat.length - 1] > 13.6);
  assert.deepEqual(niceTicks(0, 0).length > 1, true);
});

test('a failed point breaks the line instead of being interpolated', () => {
  assert.deepEqual(seriesSegments([0.6, 0.8, 1, 1.2], [1, undefined, 3, 4]), [
    [[0.6, 1]],
    [
      [1, 3],
      [1.2, 4],
    ],
  ]);
  assert.deepEqual(seriesSegments([1, 2], [undefined, undefined]), []);
});

test('observables are grouped by display unit for the y axis', () => {
  const obs: any = [
    { scope: 'edge', id: 'T1', field: 'flow_m3_s' },
    { scope: 'node', id: 'a', field: 'pressure_pa_gauge' },
    { scope: 'edge', id: 'P1', field: 'flow_m3_s' },
  ];
  assert.deepEqual(unitGroups(obs, 'm3/h'), [
    { unit: 'm³/h', indexes: [0, 2] },
    { unit: 'kPa', indexes: [1] },
  ]);
});

test('scan CSV: BOM, unit headers, full precision, blanks for missing, formula-safe text', () => {
  const evil: any = structuredClone(withDesign);
  evil.edges.find((e: any) => e.id === 'T1').name = '=HYPERLINK("x")';
  const result = {
    fluid: { density_kg_m3: 1000 },
    variables: [{ id: 'PU1', field: 'speed', values: [0.6, 1] }],
    observables: [{ scope: 'edge', id: 'T1', field: 'flow_m3_s' }],
    records: [
      {
        changes: [{ id: 'PU1', field: 'speed', value: 0.6 }],
        status: 'converged',
        values: [0.00291234567],
        issues: [],
      },
      {
        changes: [{ id: 'PU1', field: 'speed', value: 1 }],
        status: 'numerical_failure',
        values: [null],
        issues: [{ code: 'RESIDUAL', object_id: null }],
      },
    ],
  };
  const csv = scanCsv(result, evil, 'm3/h');
  assert.ok(csv.startsWith('\ufeff'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], `循环泵 · 相对转速,"'=HYPERLINK(""x"") 流量 [m³/h]",状态,问题`);
  assert.equal(lines[1], '0.6,10.484444412,计算通过,');
  assert.equal(lines[2], '1,,残差未达标,残差未达标');
});
