// R4-W4-07: capture REAL native dialog titles. Uses WM_CLOSE to cancel while the desktop is locked.
const L=require('./lib.cjs');const path=require('node:path');const fs=require('node:fs');const assert=require('node:assert/strict');
const run=require('node:util').promisify(require('node:child_process').execFile);
const {_electron}=require(path.join(__dirname,'..','..','..','node_modules','playwright'));
const {mainWindow}=require(path.join(__dirname,'..','..','..','tests','e2e-util.cjs'));
const dir=path.join(L.SHOTS,'R4-native');fs.mkdirSync(dir,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function dialog(shot){const r=await run('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'spot-native-dlg.ps1'),'OpenHydroNet-0.1.0-preview.5-win-x64',path.join(dir,shot)],{encoding:'utf8',timeout:30000});return JSON.parse(r.stdout);}
(async()=>{
 const app=await _electron.launch({executablePath:L.EXE,cwd:L.APP,env:{...process.env,OHN_PROFILE:L.PROFILE},timeout:150000});const page=await mainWindow(app,150000);
 try{
  await page.getByTestId('start-example').click();await page.getByTestId('select-PU1').waitFor();
  const click=page.getByRole('button',{name:'保存',exact:true}).click();const save=await dialog('保存工程-标题.png');await click;assert.equal(save.title,'保存工程');await sleep(300);
  const req=app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:')).close());const close=await dialog('未保存确认-中文标题.png');await req;assert.equal(close.title,'工程尚未保存');
  await sleep(300);assert.equal(page.isClosed(),false);L.record('R4-W4-07',{ok:true,save,close,method:'unmocked native windows; WM_CLOSE cancels dialogs; screenshots reviewed separately'});
 }catch(e){L.record('R4-native-error',{ok:false,error:String(e).slice(0,500)});process.exitCode=1;}
 finally{
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await app.close();await sleep(5000);L.record('R4-native-cleanup',{leftover:L.packageProcesses()});
 }
})();
