import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join } from 'node:path';
import { statSync } from 'node:fs';
const run=promisify(execFile);
const PROJECT_APPS=new Set(['Visual Studio Code']);
const APP_BUNDLES=new Map([['Cursor','Cursor.app'],['Visual Studio Code','Visual Studio Code.app']]);
const TTY=/^\/dev\/(ttys\d+|pts\/\d+)$/;
const applicationDirectoriesScript=`ObjC.import('Foundation'); JSON.stringify(ObjC.deepUnwrap($.NSSearchPathForDirectoriesInDomains($.NSApplicationDirectory,$.NSAllDomainsMask,true)))`;

export async function resolveMacApplication(app,{execute=run,inspect=statSync}={}){
  const bundle=APP_BUNDLES.get(app);if(!bundle)return null;
  try{
    const {stdout}=await execute('osascript',['-l','JavaScript','-e',applicationDirectoriesScript],{timeout:3000});
    const directories=JSON.parse(stdout);
    if(!Array.isArray(directories))return null;
    for(const directory of directories){
      if(typeof directory!=='string'||!isAbsolute(directory))continue;
      const candidate=join(directory,bundle);
      try{if(inspect(candidate).isDirectory())return candidate;}catch{}
    }
  }catch{}
  return null;
}

export function describeTaskJump(task) {
  const target=task?.jumpTarget;
  if(target?.kind==='terminal'&&TTY.test(target.tty))return {available:true,label:'前往终端',detail:'定位原终端标签页；不重新执行命令'};
  if(target?.kind==='project'&&PROJECT_APPS.has(target.app)&&isAbsolute(target.cwd||''))return {available:true,label:'打开项目',detail:`在 ${target.app} 打开项目；此来源暂不支持直达会话`};
  return {available:false,label:'暂无跳转入口',detail:'未发现可定位的终端或项目入口'};
}

const terminalScript=`on run argv
  set wantedTTY to item 1 of argv
  if application "Terminal" is running then
    tell application "Terminal"
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is wantedTTY then
            set selected tab of w to t
            set index of w to 1
            activate
            return "found"
          end if
        end repeat
      end repeat
    end tell
  end if
  return "missing"
end run`;
const itermScript=`on run argv
  set wantedTTY to item 1 of argv
  if application "iTerm" is running then
    tell application "iTerm"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if tty of s is wantedTTY then
              select s
              select t
              select w
              activate
              return "found"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  return "missing"
end run`;

// Call only on a user click, with a task looked up in the main-process snapshot.
// The renderer must never be allowed to supply an arbitrary URL/path/script.
export async function openTaskTarget(task,{platform=process.platform,execute=run,inspect=statSync}={}) {
  if(platform!=='darwin')return {ok:false,message:'当前仅支持 macOS 原生跳转。'};
  const target=task?.jumpTarget;
  if(!describeTaskJump(task).available)return {ok:false,message:'未找到可跳转的任务入口。'};
  try{
    if(target.kind==='project'){
      if(!inspect(target.cwd).isDirectory())return {ok:false,message:'原项目目录已不存在。'};
      try{await execute('open',['-a',target.app,target.cwd],{timeout:5000});}
      catch(error){
        const application=await resolveMacApplication(target.app,{execute,inspect});
        if(!application)throw error;
        await execute('open',['-a',application,target.cwd],{timeout:5000});
      }
      return {ok:true,message:`已在 ${target.app} 打开项目；请在应用内选择对应会话。`};
    }
    const apps=target.app?[target.app]:['Terminal','iTerm'];let denied=false;
    for(const app of apps){
      if(!['Terminal','iTerm'].includes(app))continue;
      try{
        const {stdout}=await execute('osascript',['-e',app==='Terminal'?terminalScript:itermScript,target.tty],{timeout:5000});
        if(stdout.trim()==='found')return {ok:true,message:'已定位原终端标签页。'};
      }catch{denied=true;}
    }
    return {ok:false,message:denied?'终端定位失败，请检查 macOS 自动化权限或手动打开原终端。':'原终端标签页已关闭，或终端应用不支持定位。'};
  }catch{return {ok:false,message:'打开失败，请确认对应应用已安装且仍可访问。'};}
}
