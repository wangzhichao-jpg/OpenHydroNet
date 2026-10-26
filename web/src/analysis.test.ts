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
