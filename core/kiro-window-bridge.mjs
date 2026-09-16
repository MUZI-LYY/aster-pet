import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { isKiroSessionId } from './kiro-session.mjs';

const freshFor=75000;
const run=promisify(execFile);
const safeRecord=value=>value&&value.protocol===1&&value.provider==='kiro'&&Number.isInteger(value.port)&&value.port>0&&value.port<65536&&typeof value.token==='string'&&/^[0-9a-f]{64}$/i.test(value.token)&&Number.isFinite(value.updatedAt);

function records(directory,now){
  if(!existsSync(directory))return [];
  const result=[];
  for(const name of readdirSync(directory)){
    if(!/^\d+\.json$/.test(name))continue;
    try{
      const path=join(directory,name),info=statSync(path);
      if(!info.isFile()||info.size>4096)continue;
      const value=JSON.parse(readFileSync(path,'utf8'));
      if(safeRecord(value)&&now-value.updatedAt<=freshFor&&now>=value.updatedAt-5000)result.push(value);
    }catch{}
  }
  return result;
}

function choose(values,cwd){
  if(!values.length)return null;
  if(cwd){
    if(typeof cwd!=='string'||!isAbsolute(cwd))return null;
    const target=resolve(cwd);
    const exact=values.filter(value=>Array.isArray(value.roots)&&value.roots.some(root=>typeof root==='string'&&isAbsolute(root)&&resolve(root)===target));
    return exact.length===1?exact[0]:null;
  }
  return !cwd&&values.length===1?values[0]:null;
}

function post(record,id){
  return new Promise(resolvePromise=>{
    const body=JSON.stringify({id});
    const request=http.request({host:'127.0.0.1',port:record.port,path:'/open-task',method:'POST',headers:{authorization:`Bearer ${record.token}`,'content-type':'application/json','content-length':Buffer.byteLength(body)},timeout:3000},response=>{
      response.resume();
      response.on('end',()=>resolvePromise(response.statusCode===200));
    });
    request.on('timeout',()=>request.destroy());
    request.on('error',()=>resolvePromise(false));
    request.end(body);
  });
}

export const focusKiroWindowScript=`ObjC.import('AppKit');
function run(argv){
  const hint=argv[0],systemEvents=Application('System Events');
  const processes=systemEvents.applicationProcesses.whose({bundleIdentifier:'dev.kiro.desktop'})().filter(process=>{try{return String(process.name())==='Kiro';}catch{return false;}});
  if(processes.length!==1)return 'missing-app';
  const process=processes[0],running=$.NSRunningApplication.runningApplicationWithProcessIdentifier(process.unixId());
  if(!running)return 'missing-app';
  running.activateWithOptions($.NSApplicationActivateIgnoringOtherApps);delay(0.6);
  const windowMenu=process.menuBars[0].menuBarItems.byName('Window').menus[0];
  const matches=windowMenu.menuItems().filter(item=>{try{const name=String(item.name());return name.startsWith(hint+' — ');}catch{return false;}});
  if(matches.length!==1)return 'matches:'+matches.length;
  systemEvents.click(matches[0]);return 'found';
}`;

async function focusWindow(record){
  if(typeof record.windowHint!=='string'||!record.windowHint||record.windowHint.length>180||/[\x00-\x1f]/.test(record.windowHint))return false;
  try{const {stdout}=await run('osascript',['-l','JavaScript','-e',focusKiroWindowScript,record.windowHint],{timeout:10000});return stdout.trim()==='found';}catch{return false;}
}

export async function openKiroWindowTask({id,cwd=''},{home=homedir(),now=Date.now(),send=post,focus=focusWindow}={}){
  if(!isKiroSessionId(id))return {ok:false,message:'Kiro 会话标识无效，请刷新任务。'};
  const candidates=records(join(home,'.kiro','aster-window-bridge'),now);
  const target=choose(candidates,cwd);
  if(!target)return {ok:false,message:candidates.length?'没有唯一匹配工作区的 Kiro 窗口，无法安全定位。':'Kiro 原窗口桥接未运行；Aster 未启动软件或新建窗口。'};
  if(await send(target,id)&&await focus(target))return {ok:true,message:'已在原 Kiro 窗口定位任务。'};
  return {ok:false,message:'Kiro 原窗口无法定位该任务；Aster 未启动软件或新建窗口。'};
}
