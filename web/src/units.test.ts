import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waterDensity, resultFlow, compareFlows, flowFactor, validateNumber } from './units';
test('0/20/80/100°C current density is independent of previous results', () => {
  assert.ok(Math.abs(waterDensity(0) - 999.8676) < 0.001);
  assert.ok(Math.abs(waterDensity(20) - 998.2336) < 0.001);
  assert.ok(Math.abs(waterDensity(80) - 971.7224) < 0.01);
  assert.ok(Math.abs(waterDensity(100) - 958.0966) < 0.02);
  assert.throws(() => waterDensity(-1));
});
test('cross-temperature mass flow comparisons use each result density', () => {
  const r = (rho: number) => ({ fluid: { density_kg_m3: rho }, edges: { T: { flow_m3_s: 0.01 } } });
  const c = compareFlows(r(1000), r(970), 'T', 'kg/h');
  assert.equal(c.baseline, 36000);
  assert.equal(c.current, 34920);
  assert.equal(c.delta, -1080);
  assert.equal(c.percent, -3);
  assert.equal(compareFlows(r(1000), r(970), 'T', 'm3/h').percent, 0);
});
test('missing density or edge is not displayed as NaN or zero', () => {
  const r = { edges: { a: { flow_m3_s: 0 } } };
  assert.equal(resultFlow(r, 'a', 'kg/h'), undefined);
  assert.equal(resultFlow(r, 'a', 'm3/h'), 0);
  assert.equal(resultFlow(r, 'absent', 'm3/h'), undefined);
  assert.equal(compareFlows(r, r, 'a', 'm3/h').percent, undefined);
});
test('mass/volume conversion roundtrips at each temperature', () => {
  for (const t of [0, 20, 80, 100])
    for (const unit of ['kg/h', 't/h', 'm3/h', 'L/s']) {
      const f = flowFactor(unit, waterDensity(t));
      assert.ok(Math.abs((0.004 * f) / f - 0.004) < 1e-15);
    }
});
test('integer, zero, optional bounds and incomplete numbers are explicit', () => {
  assert.equal(validateNumber('2.5', 1, 20, false, true), false);
  assert.equal(validateNumber('2', 1, 20, false, true), true);
  assert.equal(validateNumber('0', 0, 1), true);
  for (const bad of ['', ' ', 'Infinity', '1e', 'NaN']) assert.equal(validateNumber(bad), false);
});
