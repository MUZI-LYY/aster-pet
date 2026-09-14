#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:os';
import { cliHome } from '../core/cli-reader.mjs';
import { processInfo } from '../core/local-reader-utils.mjs';
import { identifyCliProvider } from '../core/cli-provider.mjs';

const input=process.argv.slice(2);
const usage='用法：node scripts/aster-run.mjs [--title "任务名称"] [--provider auto|codex|claude|cursor|kiro|cli] -- 命令 [参数…]';
if(input.length===1&&input[0]==='--help'){
  console.log(usage+'\n按命令名称识别软件；有歧义时可显式指定 --provider。仅记录软件分类、任务名称、目录、进程状态和退出码，不记录命令参数或输出。');process.exit(0);
}
let title,requestedProvider='auto';
while(input.length&&input[0]!=='--'){
  const option=input.shift();
  if(!['--title','--provider'].includes(option)||!input.length||input[0].startsWith('--')){console.error(usage);process.exit(2);}
  const value=input.shift();if(option==='--title')title=value;else requestedProvider=value;
}
if(input.shift()!=='--'||!input.length||typeof title==='string'&&!title.trim()){
  console.error(usage);process.exit(2);
}
const [command,...args]=input,home=cliHome(),id=randomUUID(),file=join(home,`${id}.json`),temp=join(home,`${id}.tmp`);
let provider;
try{provider=identifyCliProvider(command,requestedProvider);}catch{console.error(usage);process.exit(2);}
const info=processInfo(process.pid),now=Date.now();
const record={version:1,id,provider,title:(title||basename(command)).slice(0,180),cwd:process.cwd(),pid:process.pid,procStart:info?.start||null,
  tty:info?.tty||null,terminalApp:process.env.TERM_PROGRAM==='Apple_Terminal'?'Terminal':process.env.TERM_PROGRAM==='iTerm.app'?'iTerm':null,
  status:'running',startedAt:now,updatedAt:now,completedAt:null,exitCode:null};
let monitoring=true;
function persist(){record.updatedAt=Date.now();writeFileSync(temp,JSON.stringify(record),{mode:0o600});renameSync(temp,file);}
try{mkdirSync(home,{recursive:true,mode:0o700});persist();}catch{monitoring=false;console.error('Aster 监控记录不可用，原命令将照常执行。');}
// Preserve inherited terminal streams for interactive tools. No shell interpolation or output capture.
const child=spawn(command,args,{stdio:'inherit',shell:false});
let finished=false;
const timer=monitoring?setInterval(()=>{try{persist();}catch{monitoring=false;clearInterval(timer);console.error('Aster 监控记录不可用，已停止本次监控；命令继续运行。');}},3000):null;
function finish(code,signal){
  if(finished)return;finished=true;clearInterval(timer);
  record.status=signal||[130,143].includes(code)?'interrupted':code===0?'completed':'failed';
  record.exitCode=code??(128+(constants.signals[signal]||1));record.completedAt=Date.now();
  if(monitoring)try{persist();}catch{console.error('Aster 未能保存最终状态，请以命令自身结果为准。');}
  process.exitCode=record.exitCode;
}
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.on(signal,()=>{if(!finished)child.kill(signal);});
child.once('error',e=>{console.error(`命令启动失败：${e.code||'未知错误'}`);finish(127,null);});
child.once('exit',finish);
