const { _electron } = require('playwright');
const { shot } = require('./e2e-util.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..'),
  version = require('../package.json').version,
  out = path.join(root, 'artifacts', 'jobs', version),
  profile = path.join(root, '.local', 'jobs-test-profile');
(async () => {
  await fs.mkdir(out, { recursive: true });
  await fs.mkdir(profile, { recursive: true });
  await fs.writeFile(
    path.join(profile, 'recovery.ohn.json'),
    JSON.stringify({
      format: 'openhydronet',
      schema_version: 1,
      model: { nodes: [{ id: 'bad', name: {} }], edges: [] },
    }),
  );
  const app = await _electron.launch({
    args: [...(process.platform === 'linux' ? ['--no-sandbox'] : []), root],
    env: { ...process.env, OHN_PROFILE: profile },
  });
  const errors = [],
    jobs = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  try {
    await app.evaluate(({ dialog }, dir) => {
      dialog.showMessageBox = async () => ({ response: 1 });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: dir + '/owned-project.ohn.json',
      });
    }, out);
    const page = await app.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('.statusbar').filter({ hasText: '恢复草稿读取失败' }).waitFor();
    const backup = JSON.parse(
      await fs.readFile(path.join(profile, 'recovery.previous.ohn.json'), 'utf8'),
    );
    assert.deepEqual(backup.model.nodes[0].name, {});
    await page.getByTestId('start-example').click();
    await page.getByTestId('select-PU1').waitFor();
    await page.route('**/api/jobs', async (route) => {
      const response = await route.fetch();
      const job = await response.json();
      jobs.push(job);
      if (jobs.length === 1) await gate;
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: '计算', exact: true }).click();
    for (let i = 0; i < 100 && !jobs.length; i++) await page.waitForTimeout(20);
    assert.equal(jobs.length, 1);
    await page.getByRole('button', { name: '新建 / 模板', exact: true }).click();
    await page.getByTestId('start-example').click();
    await page.getByRole('button', { name: '计算', exact: true }).click();
    for (let i = 0; i < 100 && jobs.length < 2; i++) await page.waitForTimeout(20);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].input_hash, jobs[1].input_hash);
    assert.notEqual(jobs[0].id, jobs[1].id);
    assert.notEqual(jobs[0].owner, jobs[1].owner);
    release();
    await page.locator('.canvas-badge').filter({ hasText: '计算通过' }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.locator('.statusbar').filter({ hasText: '工程已原子保存' }).waitFor();
    const saved = JSON.parse(await fs.readFile(path.join(out, 'owned-project.ohn.json'), 'utf8'));
    assert.equal(saved.result_metadata.job_id, jobs[1].id);
    const states = await page.evaluate(
      async (ids) => {
        const headers = { 'X-Session-Token': sessionStorage.getItem('ohn-session') };
        return Promise.all(
          ids.map((id) => fetch('/api/jobs/' + id, { headers }).then((r) => r.json())),
        );
      },
      jobs.map((j) => j.id),
    );
    assert.equal(states[1].status, 'completed');
    assert.ok(['completed', 'cancelled'].includes(states[0].status));
    assert.deepEqual(errors, []);
    await shot(page, { path: path.join(out, '01-owned-current-result.png') });
    await fs.writeFile(
      path.join(out, 'test-result.json'),
      JSON.stringify(
        {
          version,
          status: 'passed',
          checks: [
            'corrupt recovery draft cannot crash renderer and raw backup is retained',
            'delayed old request cannot attach to replacement document',
            'same input hash uses distinct request owners',
            'cancelling superseded request does not cancel new one',
            'save provenance belongs to current job',
          ],
          jobs: states.map(({ id, owner, status, process_stopped }) => ({
            id,
            owner,
            status,
            process_stopped,
          })),
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log('PASS: delayed-job ownership isolation and corrupt-draft protection');
  } catch (e) {
    console.error(e, errors);
    process.exitCode = 1;
    try {
      await (await app.firstWindow()).screenshot({ path: path.join(out, 'failure.png') });
    } catch {}
  } finally {
    release();
    await app.close();
  }
})();
