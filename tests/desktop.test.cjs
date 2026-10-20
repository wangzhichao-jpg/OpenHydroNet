const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDocumentController } = require('../desktop/document-controller.cjs');
function setup(response = 2, cancelSave = false) {
  const writes = [],
    messages = [];
  let flushes = 0,
    finishes = 0;
  const c = createDocumentController({
    dialog: {
      showMessageBox: async (_w, opts) => {
        messages.push(opts);
        return { response };
      },
      showSaveDialog: async () => ({ canceled: cancelSave, filePath: 'public-example.ohn.json' }),
    },
    getWindow: () => null,
    atomic: async (f, text) => writes.push([f, JSON.parse(text)]),
    flushRenderer: async () => {
      flushes++;
    },
  });
  c.update({
    dirty: true,
    valid: true,
    project: {
      format: 'openhydronet',
      schema_version: 1,
      name: '测试',
      model: { nodes: [], edges: [] },
    },
  });
  return {
    c,
    writes,
    messages,
    finish: async () => {
      finishes++;
    },
    stats: () => ({ flushes, finishes }),
  };
}
test('cancel close preserves running application and never writes', async () => {
  const s = setup(2);
  assert.equal(await s.c.requestQuit(s.finish), false);
  assert.equal(s.writes.length, 0);
  assert.equal(s.stats().finishes, 0);
});
test('discard is explicit and flush happens before finishing', async () => {
  const s = setup(1);
  assert.equal(await s.c.requestQuit(s.finish), true);
  assert.deepEqual(s.stats(), { flushes: 1, finishes: 1 });
  assert.equal(s.writes.length, 0);
});
test('save then quit writes full project before finish', async () => {
  const s = setup(0);
  assert.equal(await s.c.requestQuit(s.finish), true);
  assert.equal(s.writes[0][1].name, '测试');
  assert.equal(s.stats().finishes, 1);
});
test('cancelling save dialog cancels quit', async () => {
  const s = setup(0, true);
  assert.equal(await s.c.requestQuit(s.finish), false);
  assert.equal(s.stats().finishes, 0);
});
test('uncommitted invalid field cannot be silently saved as old value', async () => {
  const s = setup(0);
  s.c.update({ ...s.c.getState(), valid: false });
  assert.equal(await s.c.requestQuit(s.finish), false);
  assert.equal(s.writes.length, 0);
  assert.equal(s.messages.length, 2);
});
test('a concurrent quit request does not create duplicate dialogs', async () => {
  const s = setup(1);
  await Promise.all([s.c.requestQuit(s.finish), s.c.requestQuit(s.finish)]);
  assert.equal(s.messages.length, 1);
  assert.equal(s.stats().finishes, 1);
});
