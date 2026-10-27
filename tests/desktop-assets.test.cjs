// T-016 (W4-07): Chinese dialog titles and the application icon.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const desktop = path.join(__dirname, '..', 'desktop');
const read = (f) => fs.readFileSync(path.join(desktop, f), 'utf8');

test('no showErrorBox: its Windows caption is the English "Error"', () => {
  for (const f of fs.readdirSync(desktop).filter((f) => f.endsWith('.cjs')))
    assert.doesNotMatch(read(f), /showErrorBox\s*\(/, f);
});

test('every message box sets a Chinese title', () => {
  for (const f of ['main.cjs', 'document-controller.cjs']) {
    const calls = read(f).split('showMessageBox(').slice(1);
    assert.ok(calls.length > 0, f);
    for (const call of calls)
      assert.match(call.slice(0, 400), /title: '[^']*[\u4e00-\u9fa5A-Za-z]/, f);
  }
});

test('both windows use the OpenHydroNet icon; the ICO carries 16–256 px images', () => {
  const main = read('main.cjs');
  assert.equal((main.match(/icon: APP_ICON/g) || []).length, 2);
  for (const f of ['icon.png', 'icon.ico'])
    assert.ok(fs.statSync(path.join(desktop, f)).size > 1000, f);
  const ico = fs.readFileSync(path.join(desktop, 'icon.ico'));
  assert.equal(ico.readUInt16LE(2), 1, 'ICO type');
  const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + 16 * i] || 256);
  for (const s of [16, 32, 48, 256]) assert.ok(sizes.includes(s), 'ICO has ' + s + ' px');
  const png = fs.readFileSync(path.join(desktop, 'icon.png'));
  assert.equal(png.toString('latin1', 1, 4), 'PNG');
});
