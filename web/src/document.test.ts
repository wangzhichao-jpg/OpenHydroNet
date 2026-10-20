import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyProject, clone } from './model';
import { persistable } from './document';
test('normal save, native close and recovery use identical current-input provenance', () => {
  const p = emptyProject();
  const signature = JSON.stringify(p.model),
    result = {
      input_hash: 'current',
      job_id: 'J1',
      status: 'converged',
      version: 'test',
      fluid: { density_kg_m3: 998 },
    };
  const saved = persistable(p, result, signature);
  assert.equal(saved.result_metadata.input_hash, 'current');
  assert.equal(saved.result_metadata.status, 'converged');
  assert.equal(saved.result_metadata.job_id, 'J1');
  assert.equal(p.result_metadata, undefined);
});
test('changing temperature clears previous metadata even for native close/save and recovery', () => {
  const p = emptyProject(),
    signature = JSON.stringify(p.model);
  p.result_metadata = { input_hash: 'stale' };
  const original = clone(p);
  p.model.fluid.temperature = 80;
  assert.equal(persistable(p, { input_hash: 'stale' }, signature).result_metadata, undefined);
  assert.equal(persistable(p, null, '').result_metadata, undefined);
  assert.deepEqual(p.result_metadata, original.result_metadata);
});
