import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { resolveStatus } from './task-state.mjs';
import { claudeTokens } from './token-usage.mjs';
import { userRequest } from './user-request.mjs';
import { short, timestamp, entries, recentFiles, directFiles, readJson, jsonLines, processInfo } from './local-reader-utils.mjs';

export function parseClaudeTranscript(rows, {id,mtime,now=Date.now()} = {}) {
  let nativeId=id,cwd='',title='',firstPrompt='',subtitle='',model='',turn=null,updatedAt=0,events=[],entrypoint='';
  for(const r of rows){
    if(!r || r.isSidechain)continue;
    nativeId=short(r.sessionId)||nativeId;cwd=short(r.cwd,4096)||cwd;entrypoint=short(r.entrypoint)||entrypoint;
    if(r.type==='ai-title')title=short(r.aiTitle)||title;
    if(r.type==='custom-title')title=short(r.customTitle)||title;
    const at=timestamp(r.timestamp);const msg=r.message||{};
    const content=Array.isArray(msg.content)?msg.content:[];
    const user=r.type==='user'&&!r.isMeta&&!r.isCompactSummary&&!r.isVisibleInTranscriptOnly&&
      (typeof msg.content==='string'||content.some(c=>c.type==='text'))&&!content.some(c=>c.type==='tool_result');
    const prompt=user?userRequest(msg.content):'';
    if(prompt&&!/^\s*<(?:command-name|command-message|local-command-stdout|local-command-stderr|local-command-caveat)\b/i.test(prompt)){
      firstPrompt=firstPrompt||prompt;subtitle=prompt;
      turn={status:'inProgress',turn_id:short(r.promptId||r.uuid),started_at:at};events=[];updatedAt=at;
    }
    if(r.type==='assistant'){
      model=short(msg.model)||model;updatedAt=Math.max(updatedAt,at);
      // Only an explicit end_turn closes a round; tool_use and partial replies do not.
      if(msg.stop_reason==='end_turn')turn={...turn,turn_id:turn?.turn_id||short(msg.id||r.uuid),status:'completed',completed_at:at};
      for(const c of content){
        if(c.type==='text'&&typeof c.text==='string')events.push({label:msg.stop_reason==='end_turn'?'本轮回复':'进度更新',text:short(c.text,900),kind:'message',at});
        if(c.type==='tool_use')events.push({label:'调用工具',text:short(c.name),kind:'tool',at});
      }
    }
  }
  if(rows.incomplete)turn=null;
  updatedAt=updatedAt||mtime||now;
  return {id:`claude:${nativeId}`,nativeId,provider:'claude',source:entrypoint.includes('vscode')?'ide':'cli',sourceLabel:`Claude Code · ${entrypoint.includes('vscode')?'IDE':'CLI'}`,
    title:title||short(firstPrompt)||`Claude Code · ${cwd?basename(cwd):short(nativeId,8)}`,subtitle:subtitle&&subtitle!==(title||short(firstPrompt))?subtitle:'',project:cwd?basename(cwd):'无项目',cwd,model:model||'默认模型',tokenUsage:claudeTokens(rows),
    status:resolveStatus(turn,updatedAt,now),turnId:turn?.turn_id||null,startedAt:turn?.started_at||null,completedAt:turn?.completed_at||null,
    updatedAt,evidence:turn?'Claude Code 最近一轮会话记录':'没有明确的本轮状态记录',events:events.slice(-5).reverse(),jumpTarget:null};
}

// `sdk-cli` transcripts are individual SDK invocations created by another
// program, not user-owned Claude Code tasks. Keep them out of the task list.
export function isClaudeTaskTranscript(rows) {
  return !rows.some(row=>row?.entrypoint==='sdk-cli');
}

export function readClaudeSnapshot({home=process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),now=Date.now(),limit=80,getProcessInfo=processInfo}={}) {
  const base={tasks:[],connected:false,error:null,checkedAt:now,source:'claude',sourceLabel:'Claude Code',limit};
  if(!existsSync(home))return {...base,error:'未发现 Claude Code 本机会话。'};
  const tasks=new Map();let unreadable=0;
  const projects=join(home,'projects');
  const paths=entries(projects).filter(e=>e.isDirectory()).slice(0,2000).flatMap(e=>directFiles(join(projects,e.name),'.jsonl'));
  // Inspect extra recent candidates so SDK calls cannot crowd real tasks out
  // before filtering. Reads remain bounded by jsonLines and this candidate cap.
  const candidateLimit=Math.min(320,Math.max(limit,limit*4));
  for(const {path,mtime} of recentFiles(paths,candidateLimit)){
    try{
      const rows=jsonLines(path,home);if(!rows.length){unreadable++;continue;}
      if(!isClaudeTaskTranscript(rows))continue;
      const task=parseClaudeTranscript(rows,{id:basename(path,'.jsonl'),mtime,now});
      if(!task.nativeId||rows.every(r=>r.isSidechain))continue;
      tasks.set(task.nativeId,task);
    }catch{unreadable++;}
  }
  for(const {path,mtime} of recentFiles(directFiles(join(home,'sessions'),'.json'),limit)){
    try{
      const s=readJson(path,home);if(!s.sessionId||s.kind==='subagent')continue;
      if(s.entrypoint==='sdk-cli')continue;
      const p=getProcessInfo(s.pid);
      // A PID alone may refer to a different process after a crash/reboot.
      const normalizeStart=value=>typeof value==='string'?value.trim().replace(/\s+/g,' '):'';
      if(!p||!normalizeStart(s.procStart)||![p.start,p.startUtc].some(start=>normalizeStart(start)===normalizeStart(s.procStart)))continue;
      const t=tasks.get(s.sessionId)||parseClaudeTranscript([],{id:s.sessionId,mtime,now});
      t.cwd=short(s.cwd,4096)||t.cwd;t.project=t.cwd?basename(t.cwd):'无项目';
      if(s.nameSource!=='derived')t.title=short(s.name)||t.title;
      t.source=String(s.entrypoint).includes('vscode')?'ide':'cli';t.sourceLabel=`Claude Code · ${t.source==='ide'?'IDE':'CLI'}`;
      const at=timestamp(s.statusUpdatedAt)||timestamp(s.updatedAt)||mtime;
      if(['busy','waiting'].includes(s.status)){
        // A new turn can be registered before its first transcript record is flushed.
        if(t.status==='completed'&&at>t.updatedAt){t.turnId=`live:${s.pid}:${at}`;t.startedAt=at;}
        const waitingFor=String(s.waitingFor||'').toLowerCase();
        t.status=s.status==='waiting'?(waitingFor==='permission prompt'||waitingFor==='sandbox request'||waitingFor.startsWith('approve ')?'approval':waitingFor==='input needed'?'input':'waiting'):'running';
        t.completedAt=null;t.updatedAt=Math.max(at,t.updatedAt);
        t.evidence='Claude Code 活进程的明确状态记录';
      } else if(s.status==='idle'&&['unknown','running','waiting','approval','input','unconfirmed'].includes(t.status)){
        t.status='idle';t.evidence='会话当前空闲，但本轮缺少明确结束记录';
      }
      if(p.tty)t.jumpTarget={kind:'terminal',tty:p.tty,app:null};
      else if(t.source==='ide'&&t.cwd)t.jumpTarget={kind:'project',app:'Visual Studio Code',cwd:t.cwd};
      tasks.set(s.sessionId,t);
    }catch{unreadable++;}
  }
  return {...base,connected:true,tasks:[...tasks.values()].sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,limit),
    error:unreadable?`${unreadable} 个 Claude Code 记录暂不可读或超出大小限制。`:null};
}
