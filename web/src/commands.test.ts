import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyProject,
  commit,
  undo,
  redo,
  deleteItems,
  copyItems,
  pasteItems,
  splitEdge,
  insertDevice,
  signature,
  alignItems,
} from './model';
function sample() {
  const p = emptyProject();
  p.model.nodes = [
    { id: 'a', head: 30, elevation: 0 },
    { id: 'b', head: 40, elevation: 20 },
  ];
  p.layout = { a: { x: 0, y: 0 }, b: { x: 200, y: 100 } };
  p.model.edges = [
    { id: 'p', kind: 'pipe', source: 'a', target: 'b', length: 100, diameter: 0.1, zeta: 4 },
  ];
  return p;
}
test('undo/redo retains stable ids and references', () => {
  const p = sample();
  let h = { past: [], present: p, future: [] };
  h = commit(h, deleteItems(p, ['a']));
  assert.equal(h.present.model.edges.length, 0);
  h = undo(h);
  assert.equal(h.present.model.edges[0].source, 'a');
  h = redo(h);
  assert.equal(h.present.model.nodes.length, 1);
});
test('copy paste remaps all IDs without mutating originals', () => {
  const p = sample();
  const n = pasteItems(p, copyItems(p, ['p']));
  assert.equal(n.model.nodes.length, 4);
  assert.equal(n.model.edges.length, 2);
  assert.notEqual(n.model.edges[1].source, 'a');
  const ids = new Set([...n.model.nodes, ...n.model.edges].map((x) => x.id));
  assert.equal(ids.size, 6);
  assert.equal(p.model.edges.length, 1);
});
test('split preserves length and zeta and diameter', () => {
  const n = splitEdge(sample(), 'p', 0.3);
  assert.equal(
    n.model.edges.reduce((s, e) => s + e.length, 0),
    100,
  );
  assert.equal(
    n.model.edges.reduce((s, e) => s + e.zeta, 0),
    4,
  );
  assert.ok(n.model.edges.every((e) => e.diameter === 0.1));
  assert.equal(n.model.edges[0].target, n.model.edges[1].source);
});
test('split direct resistance is additive', () => {
  const p = sample();
  p.model.edges[0] = { id: 'p', kind: 'resistance', source: 'a', target: 'b', resistance: 500000 };
  const n = splitEdge(p, 'p');
  assert.equal(
    n.model.edges.reduce((s, e) => s + e.resistance, 0),
    500000,
  );
});
test('insert valve preserves original pipe physics and references', () => {
  const n = insertDevice(sample(), 'p', 'valve');
  assert.equal(n.model.nodes.length, 4);
  assert.equal(n.model.edges.length, 3);
  assert.equal(
    n.model.edges.filter((e) => e.kind === 'pipe').reduce((s, e) => s + e.length, 0),
    100,
  );
  const ids = new Set(n.model.nodes.map((x) => x.id));
  assert.ok(n.model.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
});
test('graph alignment does not modify physical model signature', () => {
  const p = sample();
  const n = alignItems(p, ['a', 'b'], 'y');
  assert.equal(signature(n), signature(p));
  assert.equal(n.layout.a.y, n.layout.b.y);
});
test('new change invalidates redo history', () => {
  const p = sample();
  let h = commit({ past: [], present: p, future: [] }, splitEdge(p, 'p'));
  h = undo(h);
  h = commit(h, deleteItems(h.present, ['p']));
  assert.equal(h.future.length, 0);
});
