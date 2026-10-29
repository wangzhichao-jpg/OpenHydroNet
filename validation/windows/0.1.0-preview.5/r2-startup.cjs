// R2: actual packaged Windows startup window; timeout/retry/quit, then normal launch.
// Only diagnostic env OHN_BACKEND_TIMEOUT_MS=1 is changed. No product file is modified.
const L = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFile} = require('node:child_process');
const runPS=require('node:util').promisify(execFile);
const { _electron } = require(path.join(__dirname,'..','..','..','node_modules','playwright'));
const { startupWindow, mainWindow } = require(path.join(__dirname,'..','..','..','tests','e2e-util.cjs'));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const dir=path.join(L.SHOTS,'R2'); fs.mkdirSync(dir,{recursive:true});
async function start(timeout){return _electron.launch({executablePath:L.EXE,cwd:L.APP,args:[],env:{...process.env,OHN_PROFILE:path.join(L.BASE,'R2-profile'),...(timeout?{OHN_BACKEND_TIMEOUT_MS:'1'}:{})},timeout:150000});}
async function failed(app){
  let win; for(let i=0;i<200;i++){win=startupWindow(app);if(win)break;await sleep(100);}
  assert.ok(win,'startup window exists');
  await win.locator('#message').filter({hasText:/启动失败：计算内核在 .* 秒内未就绪/}).waitFor({timeout:30000});
  const snap=await win.evaluate(()=>({title:document.title,message:document.querySelector('#message').innerText,hint:document.querySelector('#hint').innerText,detail:document.querySelector('#detail').innerText,retryVisible:!!document.querySelector('#retry').getBoundingClientRect().height,quitVisible:!!document.querySelector('#quit').getBoundingClientRect().height}));
  snap.detail=snap.detail.replaceAll(L.BASE,'<BASE>');
  const processes=L.pythons();assert.deepEqual(processes,[],'no python after failure');
  assert.equal(snap.title,'OpenHydroNet');assert.ok(snap.retryVisible&&snap.quitVisible);assert.match(snap.detail,/运行时：.*python.exe/);
  return {win,snap,processes};
}
async function quit(app,win){const c=app.waitForEvent('close',{timeout:30000});await win.locator('#quit').click().catch(e=>{if(!/has been closed/.test(e.message))throw e;});await c;await sleep(5000);assert.deepEqual(L.packageProcesses(),[]);}
(async()=>{
  let app;
  try{
    app=await start(true);let a=await failed(app);await a.win.screenshot({path:path.join(dir,'01-超时-中文提示.png')});L.record('R2-timeout',{ok:true,...a.snap,python:a.processes});await quit(app,a.win);app=null;L.record('R2-quit',{ok:true,leftover:[]});
    app=await start(true);a=await failed(app);
    await app.evaluate(({ipcMain})=>{globalThis.retryObserved=0;ipcMain.on('ohn:startup-retry',()=>globalThis.retryObserved++);});
    const before=Date.now();await a.win.locator('#retry').click();
    assert.equal(await app.evaluate(()=>globalThis.retryObserved),1);
    // Observe a complete new attempt, not just the still-visible previous failure.
    await a.win.waitForFunction(()=>!document.body.classList.contains('failed'),null,{timeout:10000}).catch(()=>{});
    await sleep(1200);a=await failed(app);await a.win.screenshot({path:path.join(dir,'02-重试仍超时.png')});
    L.record('R2-retry',{ok:true,attemptElapsedMs:Date.now()-before,...a.snap,python:a.processes});await quit(app,a.win);app=null;
    app=await start(false);const page=await mainWindow(app,150000);await page.getByTestId('start-example').waitFor();await page.screenshot({path:path.join(dir,'03-清除诊断变量后正常.png')});
    const native=await runPS('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'native-frame.ps1')],{encoding:'utf8'});
    L.record('R2-normal',{ok:true,workbench:true,diagnosticEnvPresent:false,native:native.stdout});await app.close();app=null;await sleep(5000);assert.deepEqual(L.packageProcesses(),[]);L.record('R2-final-processes',{ok:true,leftover:[]});
  }catch(e){L.record('R2-error',{ok:false,error:String(e).slice(0,800)});if(app){const w=startupWindow(app);if(w)await w.screenshot({path:path.join(dir,'失败现场.png')}).catch(()=>{});}process.exitCode=1;}
})();
