import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { short, readJson, recentFiles, directFiles, processInfo } from './local-reader-utils.mjs';
import { CLI_PROVIDERS, cliSourceLabel } from './cli-provider.mjs';
export const cliHome = () => process.env.ASTER_TASK_HOME || join(homedir(),'.aster','tasks');
export function readCliSnapshot({home=cliHome(),now=Date.now(),limit=80,getProcessInfo=processInfo}={}) {
  const base={tasks:[],connected:existsSync(home),error:null,checkedAt:now,source:'cli',sourceLabel:'CLI 进程记录',limit};
  if(!base.connected)return {...base,error:'尚未使用 Aster CLI 启动任务。'};
  let unreadable=0;
  for(const {path} of recentFiles(directFiles(home,'.json'),limit)){
    try{
      const r=readJson(path,home);
      if(r.version!==1||!/^[-\w]{1,100}$/.test(r.id)||!['running','completed','failed','interrupted'].includes(r.status)||!Number.isFinite(r.updatedAt)) {unreadable++;continue;}
      let status=r.status;
      if(status==='running'){
        const live=getProcessInfo(r.pid);
        if(!live||!r.procStart||live.start!==r.procStart||now-r.updatedAt>180000)status='unconfirmed';
      }
      const cwd=short(r.cwd,4096);
      const provider=Object.hasOwn(CLI_PROVIDERS,r.provider)?r.provider:'cli';
      base.tasks.push({id:`cli:${r.id}`,nativeId:r.id,provider,source:'cli',sourceLabel:cliSourceLabel(provider),observation:'process',title:short(r.title)||`${CLI_PROVIDERS[provider]} 任务`,
        project:cwd?basename(cwd):'无项目',cwd,model:'本机命令',status,turnId:r.id,
        startedAt:Number.isFinite(r.startedAt)?r.startedAt:null,completedAt:Number.isFinite(r.completedAt)?r.completedAt:null,updatedAt:r.updatedAt,
        evidence:status==='unconfirmed'?'包装进程已不可验证或心跳过期；无法确认命令结果':status==='running'?'CLI 包装进程存活，心跳正常':`CLI 退出记录${Number.isInteger(r.exitCode)?` · 退出码 ${r.exitCode}`:''}`,
        events:[{label:status==='running'?'命令运行中':status==='unconfirmed'?'状态待核实':'命令结束',text:Number.isInteger(r.exitCode)?`退出码 ${r.exitCode}`:'',kind:'tool',at:r.updatedAt}],
        jumpTarget:typeof r.tty==='string'&&/^\/dev\/(ttys\d+|pts\/\d+)$/.test(r.tty)?{kind:'terminal',tty:r.tty,app:['Terminal','iTerm'].includes(r.terminalApp)?r.terminalApp:null}:null});
    }catch{unreadable++;}
  }
  base.tasks.sort((a,b)=>b.updatedAt-a.updatedAt);
  if(unreadable)base.error=`${unreadable} 个 CLI 记录无法识别。`;
  return base;
}
