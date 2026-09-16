import { readCodexSnapshot } from './codex-reader.mjs';
import { readClaudeSnapshot } from './claude-reader.mjs';
import { readCursorSnapshot } from './cursor-reader.mjs';
import { readKiroSnapshot } from './kiro-reader.mjs';
import { readCliSnapshot } from './cli-reader.mjs';

const defaults={codex:readCodexSnapshot,claude:readClaudeSnapshot,cursor:readCursorSnapshot,kiro:readKiroSnapshot,cli:readCliSnapshot};
const names={codex:'Codex',claude:'Claude Code',cursor:'Cursor',kiro:'Kiro',cli:'其他 CLI'};
// Each provider fails independently. Optional paths make the same adapters usable in fixtures.
export function readAllSnapshot({now=Date.now(),limit=320,readers=defaults,...options}={}) {
  limit=Number.isFinite(limit)?Math.max(1,Math.min(1000,Math.floor(limit))):320;
  const tasks=[],reports=new Map();
  for(const [readerProvider,reader] of Object.entries(readers)){
    let result;
    try{result=reader({...options[readerProvider],now});}
    catch{result={connected:false,tasks:[],error:`${names[readerProvider]||readerProvider} 任务读取暂不可用。`};}
    reports.set(readerProvider,result);
    for(const task of result.tasks||[]){
      const provider=readerProvider==='cli'&&Object.hasOwn(names,task.provider)?task.provider:readerProvider;
      const nativeId=task.nativeId||task.id;
      const observation=task.observation||(readerProvider==='cli'?'process':'session');
      const codexJump=provider==='codex'&&observation!=='process'&&/^[0-9a-f-]{36}$/i.test(nativeId)?{kind:'codex-thread',label:'打开 Codex 任务'}:null;
      tasks.push({...task,provider,nativeId,
        id:readerProvider==='codex'?task.id:task.id.startsWith(`${readerProvider}:`)?task.id:`${readerProvider}:${task.id}`,
        observation,
        source:task.source||'local',sourceLabel:task.sourceLabel||(provider==='codex'?`Codex${task.source==='cli'?' · CLI':task.source==='vscode'?' · IDE':''}`:names[provider]),jumpTarget:task.jumpTarget||codexJump});
    }
  }
  const providers=new Set([...reports.keys(),...tasks.map(t=>t.provider)]);
  const sources=[...providers].map(provider=>{
    const report=reports.get(provider),count=tasks.filter(t=>t.provider===provider).length;
    return {provider,sourceLabel:names[provider]||provider,connected:Boolean(report?.connected)||count>0,
      error:report?.error?(count>0?`原生会话：${report.error}`:report.error):null,count};
  });
  const connected=sources.some(s=>s.connected);
  const active=t=>['running','waiting','approval','input'].includes(t.status)?0:1;
  tasks.sort((a,b)=>active(a)-active(b)||b.updatedAt-a.updatedAt);
  return {tasks:tasks.slice(0,limit),sources,connected,error:connected?null:'尚未发现可读取的本机任务。',checkedAt:now,source:'local-agents',sourceLabel:'本机多工具 · 只读',limit,capabilities:['tasks.list','tasks.observe','tasks.open']};
}
