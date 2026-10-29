// R4 W4-01/02/04: inspect the unmodified packaged app. W4-03 PDF and W4-05 scale checks are separate.
const L=require('./lib.cjs');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const {app,page}=await L.launch();
 try{
  await page.getByTestId('start-example').click();await page.getByTestId('select-PU1').waitFor();
  await page.getByRole('button',{name:'计算',exact:true}).click();await page.locator('.canvas-badge').filter({hasText:'计算通过'}).waitFor({timeout:60000});
  await page.getByTestId('select-PU1').click();const sp=page.getByLabel('相对转速 n/n₀');
  await sp.fill('0.9');await sp.press('Enter');const stale=await page.locator('.statusbar').innerText();
  await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press('Control+z');await sleep(200);
  const status=await page.locator('.statusbar').innerText();const csvEnabled=await page.getByRole('button',{name:'结果 CSV',exact:true}).isEnabled();
  assert.equal(await sp.inputValue(),'1');assert.match(status,/计算通过；已回到计算时的输入，结果有效/);assert.ok(!status.includes('过期'));assert.ok(csvEnabled);
  await L.shot(page,'R4-W4-01-撤销后结果有效');L.record('R4-W4-01',{ok:true,stale,status,csvEnabled});
  await page.getByRole('button',{name:'计算结果',exact:true}).click();const pump=page.locator('.bottom-content > table tbody tr').filter({hasText:'PU1'});const cells=await pump.locator('td').allInnerTexts();const power=cells[4];assert.equal(power,'1,568');
  await L.shot(page,'R4-W4-02-计算结果功率');
  await page.getByRole('button',{name:'分析',exact:true}).click();await page.getByRole('button',{name:'水力平衡',exact:true}).click();const bal=page.getByTestId('balance-view');await bal.getByTestId('balance-pairs').locator('li').first().waitFor();await bal.getByRole('button',{name:'计算水力平衡'}).click();await page.getByTestId('balance-conclusion').waitFor({timeout:60000});
  const powerRow=await page.getByTestId('balance-compare').locator('tbody tr').filter({hasText:'泵水力功率'}).innerText();assert.equal(powerRow.split('\t')[1],power);await L.shot(page,'R4-W4-02-平衡前功率一致');L.record('R4-W4-02',{ok:true,mainPower:power,balanceRow:powerRow});
  const txt=fs.readFileSync(path.join(L.APP,'开始使用.txt'),'utf8');const manual=fs.readFileSync(path.join(L.APP,'resources','app','docs','USER_MANUAL.md'),'utf8');
  const checks={txtFilename:txt.includes('OpenHydroNet-0.1.0-preview.5-win-x64.zip'),txtCommand:/certutil|Get-FileHash/.test(txt),txtUnknown:txt.includes('未知发布者'),txtKeepSecurity:/不要关闭.*SmartScreen.*杀毒/.test(txt),manualUnknown:manual.includes('未知发布者'),manualCommand:/certutil|Get-FileHash/.test(manual),manualKeepSecurity:/不要关闭.*SmartScreen.*杀毒/.test(manual)};
  assert.ok(Object.values(checks).every(Boolean),JSON.stringify(checks));L.record('R4-W4-04',{ok:true,checks,gettingStarted:txt});
 }catch(e){L.record('R4-error',{ok:false,error:String(e).slice(0,700)});await L.shot(page,'R4-失败现场').catch(()=>{});process.exitCode=1;}
 finally{await app.evaluate(()=>{globalThis.acc.answer='放弃修改';});const c=app.waitForEvent('close');await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await c;await sleep(5000);L.record('R4-final-processes',{leftover:L.packageProcesses()});}
})();
