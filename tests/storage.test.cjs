const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createAtomic, parseUtf8Json } = require('../desktop/storage.cjs');
test('UTF-8 JSON/BOM preserves Chinese text and rejects damaged bytes instead of replacing characters', () => {
  assert.deepEqual(parseUtf8Json(Buffer.from('\ufeff{"name":"中文工程"}', 'utf8')), {
    name: '中文工程',
  });
  assert.throws(() => parseUtf8Json(Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x7d])), /UTF-8/);
  assert.throws(() => parseUtf8Json(Buffer.from('{bad}')), /JSON/);
});
for (const phase of ['write', 'sync', 'rename'])
  test('atomic failure preserves previous project/draft: ' + phase, async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ohn-atomic-')),
      file = path.join(dir, '工程.ohn.json');
    await fs.writeFile(file, 'previous');
    let closed = false;
    const io = {
      ...fs,
      open: async (...args) => {
        const h = await fs.open(...args);
        return {
          writeFile: async (data) => {
            if (phase === 'write') {
              await h.writeFile(data.slice(0, 3));
              throw Error('injected partial write');
            }
            await h.writeFile(data);
          },
          sync: async () => {
            if (phase === 'sync') throw Error('injected fsync');
            await h.sync();
          },
          close: async () => {
            closed = true;
            await h.close();
          },
        };
      },
      rename: async (...args) => {
        if (phase === 'rename') throw Error('injected rename');
        await fs.rename(...args);
      },
    };
    try {
      await assert.rejects(createAtomic(io)(file, 'replacement'), /injected/);
      assert.equal(await fs.readFile(file, 'utf8'), 'previous');
      assert.deepEqual(await fs.readdir(dir), ['工程.ohn.json']);
      assert.equal(closed, true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
test('next atomic draft succeeds after an injected write failure', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ohn-queue-')),
    file = path.join(dir, 'recovery.ohn.json');
  let first = true;
  const io = {
    ...fs,
    rename: async (...args) => {
      if (first) {
        first = false;
        throw Error('once');
      }
      await fs.rename(...args);
    },
  };
  const atomic = createAtomic(io);
  let queue = Promise.resolve();
  try {
    queue = queue.then(() => atomic(file, 'first'));
    queue = queue.catch(() => {}).then(() => atomic(file, 'latest'));
    await queue;
    assert.equal(await fs.readFile(file, 'utf8'), 'latest');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
