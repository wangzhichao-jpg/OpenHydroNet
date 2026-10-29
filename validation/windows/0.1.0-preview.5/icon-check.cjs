// R2 supplement: associate the generic Electron taskbar button with this app by its 0 -> 1 -> 0 lifetime.
const L=require('./lib.cjs');const path=require('node:path');const assert=require('node:assert/strict');
const run=require('node:util').promisify(require('node:child_process').execFile);
async function taskbar(capture){const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'taskbar-target.ps1')];if(capture)args.push('-CapturePath',capture);const r=await run('powershell',args,{encoding:'utf8'});return JSON.parse(r.stdout);}
(async()=>{
 assert.deepEqual(L.packageProcesses(),[],'no previous test instance');
 const before=await taskbar();assert.equal(before.candidateCount,0,'ambiguous existing Electron taskbar button');
 const {app,page}=await L.launch();let during;
 try{
  await page.getByTestId('start-example').waitFor();
  const r=await run('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'native-frame.ps1'),'-Name','解锁后-窗口与任务栏图标'],{encoding:'utf8'});
  during=await taskbar(path.join(L.SHOTS,'R2','解锁后-实际任务栏按钮.png'));
  assert.equal(during.candidateCount,1);assert.ok(during.captured);
  L.record('R2-icon-associated',{before,during,nativeFrame:r.stdout,requiresScreenshotReview:true});
 }finally{await app.close();await new Promise(r=>setTimeout(r,5000));}
 const after=await taskbar();assert.equal(after.candidateCount,0);assert.deepEqual(L.packageProcesses(),[]);
 L.record('R2-icon-lifetime',{before,during,after,associationVerified:true,remaining:[]});
})().catch(e=>{console.error(String(e));process.exitCode=1;});
