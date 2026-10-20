// Actual Electron screen capture; no design mockups, no cloud service.
const {_electron}=require('playwright');const {spawn}=require('node:child_process');const path=require('node:path');const fs=require('node:fs/promises');
const root=path.resolve(__dirname,'..'),kind=process.argv[2]||'quickstart';
(async()=>{const storyboard=JSON.parse(await fs.readFile(path.join(root,'media/storyboards.json'),'utf8'))[kind];if(!storyboard)throw Error('Unknown storyboard');const out=path.join(root,'artifacts/media',kind);await fs.mkdir(out,{recursive:true});const app=await _electron.launch({args:['--no-sandbox',root],env:{...process.env,OHN_PROFILE:path.join(root,'.local','recording-'+kind)}});let ffmpeg;
try{const page=await app.firstWindow();await page.getByTestId('start-example').waitFor();await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setBounds({x:0,y:0,width:1920,height:960});});await page.waitForTimeout(700);await app.evaluate(({dialog},dir)=>{dialog.showSaveDialog=async(_window,options)=>({canceled:false,filePath:dir+'/'+options.defaultPath});},out);
await page.evaluate(()=>{const dot=document.createElement('div');dot.style.cssText='position:fixed;width:28px;height:28px;border:2px solid #f2ae35;border-radius:50%;pointer-events:none;z-index:99999;box-shadow:0 0 0 4px #f2ae3530;transform:translate(-50%,-50%);left:0;top:0';document.body.append(dot);document.addEventListener('mousemove',e=>{dot.style.left=e.clientX+'px';dot.style.top=e.clientY+'px';});});
ffmpeg=spawn('ffmpeg',['-y','-hide_banner','-loglevel','warning','-f','x11grab','-draw_mouse','0','-framerate','15','-video_size','1920x1080','-i',process.env.DISPLAY,'-an','-c:v','libx264','-preset','ultrafast','-crf','19','-pix_fmt','yuv420p',path.join(out,'capture.mkv')],{stdio:['pipe','ignore','inherit']});
const started=Date.now(),events=[];let exampleOpened=false;
const wait=ms=>new Promise(r=>setTimeout(r,Math.max(0,ms)));
async function select(id){await page.getByTestId('select-'+id).click();}
async function number(label,value){const input=page.getByLabel(label,{exact:true});await input.fill(String(value));await input.press('Enter');}
async function calculate(){await page.getByRole('button',{name:'计算',exact:true}).click();await page.locator('.canvas-badge').filter({hasText:'计算通过'}).waitFor({timeout:30000});}
async function ensureExample(){if(!exampleOpened){await page.getByTestId('start-example').click();await page.getByTestId('select-P2').waitFor();exampleOpened=true;}}
async function closeHelp(){const close=page.getByRole('button',{name:'关闭 ✕',exact:true});if(await close.isVisible())await close.click();}
async function run(action){switch(action){
case 'welcome':break;
case 'example':await ensureExample();break;
case 'pipe':await select('P2');break;
case 'editpipe':await select('P2');await number('管道内径',.05);break;
case 'boundary':await select('r0');break;
case 'pump':await select('PU1');break;
case 'calculate':await page.getByRole('button',{name:'检查',exact:true}).click();await calculate();break;
case 'issues':await page.getByRole('button',{name:/问题列表/}).click();await page.locator('.issue-list button').first().click();break;
case 'pressure':await page.getByRole('button',{name:'水压图',exact:true}).click();await page.getByLabel('水压图末端').selectOption('T2');break;
case 'snapshot':await page.getByRole('button',{name:'对比',exact:true}).click();await page.getByRole('button',{name:'保存当前工况快照'}).click();break;
case 'speed':await select('PU1');await number('相对转速 n/n₀',.8);break;
case 'compare':await calculate();await page.getByRole('button',{name:'工况对比',exact:true}).click();await page.getByLabel('对比工况').selectOption({label:'工况 1'});break;
case 'terminal':await select('T2');await number('末端设计流量',15);break;
case 'quickcalculate':await select('PU1');await number('相对转速 n/n₀',.8);await page.getByRole('button',{name:'检查',exact:true}).click();await calculate();break;
case 'quickpressure':await page.getByRole('button',{name:/问题列表/}).click();if(await page.locator('.issue-list button').count())await page.locator('.issue-list button').first().click();await wait(2500);await page.getByRole('button',{name:'水压图',exact:true}).click();await page.getByLabel('水压图末端').selectOption('T2');break;
case 'export':await closeHelp();await page.getByRole('button',{name:'结果 CSV',exact:true}).click();await wait(1000);await page.getByRole('button',{name:'PDF 报告',exact:true}).click();await wait(1000);await page.getByRole('button',{name:'保存',exact:true}).click();break;
case 'help':await page.getByRole('button',{name:'帮助与快捷键',exact:true}).click();break;
case 'save':await closeHelp();await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'计算结果',exact:true}).click();await page.getByRole('button',{name:'适配画布',exact:true}).click();break;
case 'closing':await page.getByRole('button',{name:'帮助与快捷键',exact:true}).click();break;
default:throw Error('Unimplemented recording action '+action);}}
for(const scene of storyboard.segments){await wait(started+scene.at*1000-Date.now());await run(scene.action);events.push({expected_s:scene.at,actual_s:(Date.now()-started)/1000,action:scene.action,title:scene.title});await page.screenshot({path:path.join(out,`frame-${String(scene.at).padStart(3,'0')}.png`)});}
await wait(started+storyboard.duration*1000-Date.now());ffmpeg.stdin.write('q\n');await new Promise((resolve,reject)=>{ffmpeg.once('exit',code=>code===0?resolve():reject(Error('ffmpeg exited '+code)));});ffmpeg=null;await fs.writeFile(path.join(out,'recording.json'),JSON.stringify({software:'0.1.0-preview.1',commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),duration:storyboard.duration,events,method:'actual X11 capture of Electron; save dialog path predetermined for privacy; mouse ring only; no mock UI'},null,2));console.log('Recorded',kind);
}finally{if(ffmpeg){ffmpeg.stdin.write('q\n');await new Promise(r=>ffmpeg.once('exit',r));}await app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
