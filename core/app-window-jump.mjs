import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run=promisify(execFile);
const safeTitle=value=>typeof value==='string'&&value.trim().length>0&&value.length<=180&&!/[\x00-\x1f]/.test(value);

// Only inspect a process System Events already sees. Never address an
// application through Launch Services, a URL, a project path, or a command.
export const existingTaskScript=`ObjC.import('AppKit');
function run(argv) {
  const title=argv[0], systemEvents=Application('System Events');
  const appName='Cursor', bundle='com.todesktop.230313mzl4w4u92';
  const processes=systemEvents.applicationProcesses.whose({bundleIdentifier:bundle})().filter(process=>{
    try{return String(process.name())===appName;}catch{return false;}
  });
  if(processes.length!==1)return processes.length?'ambiguous-app':'missing-app';
  const process=processes[0];
  // Chromium windows on another macOS Space can be absent from System Events
  // until their already-running owner is brought forward. This does not use
  // Launch Services and therefore cannot start an application or create a window.
  const running=$.NSRunningApplication.runningApplicationWithProcessIdentifier(process.unixId());
  if(!running)return 'missing-app';
  running.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);
  delay(0.8);
  const windows=process.windows().filter(window=>{
    try{return String(window.name())==='Cursor Agents';}catch{return false;}
  });
  if(!windows.length)return 'missing-window';
  const matches=[];
  for(const window of windows){
    const contents=window.entireContents();
    for(const element of contents){
      try{
        const role=String(element.role());
        if(role!=='AXButton')continue;
        const name=String(element.name());
        if(name===title){matches.push(element);if(matches.length>1)return 'matches:2';}
      }catch{}
    }
  }
  if(matches.length!==1)return 'matches:'+matches.length;
  systemEvents.click(matches[0]);
  return 'found';
}`;

export async function openExistingAppTask({title},{platform=process.platform,execute=run}={}){
  if(platform!=='darwin')return {ok:false,message:'当前仅支持 macOS 原窗口定位。'};
  if(!safeTitle(title))return {ok:false,message:'任务定位信息无效，请刷新列表。'};
  const label='Cursor';
  try{
    const {stdout}=await execute('osascript',['-l','JavaScript','-e',existingTaskScript,title],{timeout:30000});
    const result=stdout.trim();
    if(result==='found')return {ok:true,message:`已在原 ${label} 窗口定位任务。`};
    if(result==='missing-app')return {ok:false,message:`${label} 没有运行；为避免新开软件，Aster 未执行跳转。`};
    if(result==='missing-window')return {ok:false,message:`没有已打开的 ${label} 任务窗口；Aster 未新建窗口。`};
    if(result==='ambiguous-app')return {ok:false,message:`存在多个 ${label} 进程，无法安全判断原窗口。`};
    return {ok:false,message:result==='matches:0'?`原 ${label} 窗口中没有找到该任务。`:`原 ${label} 窗口中存在同名任务，无法安全定位。`};
  }catch{return {ok:false,message:`${label} 原窗口定位失败，请检查 macOS 辅助功能权限。`};}
}
