import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyLibrary } from './library';
import { emptyProject, uid, commit, undo } from './model';
const entry = {
  id: 'LIB-source',
  name: '虚构曲线',
  kind: 'pump',
  source_kind: 'synthetic',
  data_source: '人工构造非厂家数据',
  parameters: { curve: [32, 0, -180000], nominal_rpm: 1450 },
};
function project() {
  const p = emptyProject();
  p.model.nodes = [{ id: 'a', head: 30 }, { id: 'b' }];
  p.model.edges = [
    {
      id: 'pump',
      kind: 'pump',
      source: 'a',
      target: 'b',
      curve: [25],
      speed: 0.8,
      parallel: 2,
      closed: false,
      efficiency: 0.9,
      check_valve: false,
    },
  ];
  p.layout = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };
  return p;
}
test('library application copies nameplate data while preserving IDs, endpoints and operation', () => {
  const p = project(),
    before = structuredClone(p);
  const n = applyLibrary(p, ['pump'], entry),
    e = n.model.edges[0];
  assert.deepEqual(p, before);
  assert.equal(e.id, 'pump');
  assert.equal(e.source, 'a');
  assert.equal(e.target, 'b');
  assert.equal(e.speed, 0.8);
  assert.equal(e.parallel, 2);
  assert.equal(e.closed, false);
  assert.equal(e.check_valve, false);
  assert.equal(e.efficiency, undefined);
  assert.deepEqual(e.curve, entry.parameters.curve);
  assert.equal(e.device_data.source_kind, 'synthetic');
  assert.deepEqual(n.layout, p.layout);
});
test('deleting a library never removes copied engineering data, and application is undoable', () => {
  const p = project();
  p.library = [entry];
  const n = applyLibrary(p, ['pump'], entry);
  n.library = [];
  assert.deepEqual(n.model.edges[0].curve, [32, 0, -180000]);
  entry.parameters.curve[0] = 31;
  assert.equal(n.model.edges[0].curve[0], 32);
  entry.parameters.curve[0] = 32;
  assert.deepEqual(undo(commit({ past: [], present: p, future: [] }, n)).present, p);
});
test('mixed-type and missing selection is not silently ignored', () => {
  const p = project();
  for (const ids of [[], ['a'], ['a', 'pump'], ['missing']])
    assert.throws(() => applyLibrary(p, ids, entry));
});
test('new identifiers use the full UUID rather than 32-bit truncation', () => {
  assert.match(uid('E'), /^E-[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/);
});
