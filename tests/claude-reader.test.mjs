import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readClaudeSnapshot,parseClaudeTranscript } from '../core/claude-reader.mjs';
const now=Date.now();
const user={type:'user',sessionId:'s',cwd:join(tmpdir(),'aster-fixture-project'),timestamp:new Date(now-2000).toISOString(),uuid:'u',message:{content:'修复登录问题'}};
const tool={type:'assistant',sessionId:'s',timestamp:new Date(now-1000).toISOString(),message:{model:'test',stop_reason:'tool_use',content:[{type:'thinking',thinking:'PRIVATE'},{type:'tool_use',name:'Bash',input:{command:'SECRET_COMMAND'}},{type:'text',text:'Public progress'}]}};
test('Claude requires explicit end_turn; excludes thinking, tool inputs and tool results',()=>{
  const rows=[user,tool,{type:'user',timestamp:new Date(now).toISOString(),message:{content:[{type:'tool_result',content:'SECRET_OUTPUT'}]}}];
  let t=parseClaudeTranscript(rows,{id:'s',now});
  assert.equal(t.status,'running');assert.equal(t.turnId,'u');assert.equal(t.events.length,2);assert.doesNotMatch(JSON.stringify(t),/SECRET|PRIVATE/);
  t=parseClaudeTranscript([...rows,{...tool,message:{content:[{type:'text',text:'Done'}],stop_reason:'end_turn'}}],{id:'s',now});
  assert.equal(t.status,'completed');
  assert.equal(parseClaudeTranscript([tool],{id:'s',now}).status,'unknown');
  assert.equal(parseClaudeTranscript(rows,{id:'s',now:now+200000}).status,'unconfirmed');
});

test('Claude titles use real requests and ignore local commands, injected metadata, and tool results',()=>{
  const done={...tool,message:{stop_reason:'end_turn',content:[{type:'text',text:'Done'}]}};
  const ignored=[
    {...user,isMeta:true,message:{content:'PRIVATE_METADATA'}},
    {...user,isCompactSummary:true,message:{content:'PRIVATE_SUMMARY'}},
    {...user,isSidechain:true,message:{content:'PRIVATE_SIDECHAIN'}},
    {...user,message:{content:'<command-name>/model</command-name><command-args>PRIVATE_COMMAND</command-args>'}},
    {...user,message:{content:'<local-command-stdout>PRIVATE_OUTPUT</local-command-stdout>'}},
    {...user,message:{content:[{type:'tool_result',content:'PRIVATE_RESULT'}]}},
  ];
  const t=parseClaudeTranscript([user,{...user,uuid:'second',message:{content:[{type:'text',text:'检查手机验证码'}]}},done,...ignored],{id:'s',now});
  assert.equal(t.title,'修复登录问题');assert.equal(t.subtitle,'检查手机验证码');
  assert.equal(t.turnId,'second');assert.equal(t.status,'completed');
  assert.doesNotMatch(JSON.stringify(t),/PRIVATE|\/model/);
  const named=parseClaudeTranscript([user,{type:'custom-title',customTitle:'登录修复'}],{id:'s',now});
  assert.equal(named.title,'登录修复');assert.equal(named.subtitle,'修复登录问题');
});

test('Claude UTC process start matches local-time host and derived names do not replace the request',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-claude-timezone-'));
  try{
    mkdirSync(join(home,'projects','p'),{recursive:true});mkdirSync(join(home,'sessions'));
    writeFileSync(join(home,'projects','p','s.jsonl'),[user,tool].map(JSON.stringify).join('\n'));
    const file=join(home,'sessions','1.json');
    const registry={pid:1,procStart:'Mon Sep 14 14:50:33 2026',sessionId:'s',status:'busy',cwd:join(tmpdir(),'aster-fixture-project'),entrypoint:'cli',name:'project-a2',nameSource:'derived'};
    writeFileSync(file,JSON.stringify(registry));
    const options={home,now,getProcessInfo:()=>({start:'Mon Sep 14 22:50:33 2026',startUtc:'Mon Sep 14 14:50:33 2026',tty:'/dev/ttys000'})};
    const t=readClaudeSnapshot(options).tasks[0];
    assert.equal(t.title,'修复登录问题');assert.equal(t.jumpTarget.tty,'/dev/ttys000');
    writeFileSync(file,JSON.stringify({...registry,procStart:'Mon Sep 14 14:51:33 2026'}));
    assert.equal(readClaudeSnapshot(options).tasks[0].jumpTarget,null);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('Claude live registry wins with verified process identity; idle is not completion',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-claude-'));
  try{
    mkdirSync(join(home,'projects','p'),{recursive:true});mkdirSync(join(home,'sessions'));
    writeFileSync(join(home,'projects','p','s.jsonl'),[user,tool].map(JSON.stringify).join('\n'));
    const file=join(home,'sessions','1.json');
    const registry={pid:1,procStart:'start',sessionId:'s',status:'waiting',statusUpdatedAt:now-999999,cwd:join(tmpdir(),'aster-fixture-project'),entrypoint:'claude-vscode'};
    writeFileSync(file,JSON.stringify(registry));
    const options={home,now,getProcessInfo:()=>({start:'start',tty:'/dev/ttys001'})};
    let t=readClaudeSnapshot(options).tasks[0];assert.equal(t.status,'waiting');assert.equal(t.jumpTarget.kind,'terminal');assert.equal(t.source,'ide');
    writeFileSync(file,JSON.stringify({...registry,waitingFor:'permission prompt'}));assert.equal(readClaudeSnapshot(options).tasks[0].status,'approval');
    writeFileSync(file,JSON.stringify({...registry,waitingFor:'input needed'}));assert.equal(readClaudeSnapshot(options).tasks[0].status,'input');
    writeFileSync(file,JSON.stringify({...registry,status:'idle'}));assert.equal(readClaudeSnapshot(options).tasks[0].status,'idle');
    writeFileSync(file,JSON.stringify({...registry,procStart:'reused'}));assert.equal(readClaudeSnapshot(options).tasks[0].status,'running');
    assert.equal(readClaudeSnapshot({...options,getProcessInfo:()=>null}).tasks[0].jumpTarget,null);
    const outside=mkdtempSync(join(tmpdir(),'aster-outside-'));
    try{const target=join(outside,'record.jsonl');writeFileSync(target,'{}');symlinkSync(target,join(home,'projects','p','bad.jsonl'));
      assert.equal(readClaudeSnapshot(options).tasks.length,1);
    }finally{rmSync(outside,{recursive:true,force:true});}
    assert.equal(readClaudeSnapshot(options).tasks.length,1);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('Claude metadata after final reply does not revive the task',()=>{
  const done={...tool,message:{stop_reason:'end_turn',content:[{type:'text',text:'Done'}]}};
  const t=parseClaudeTranscript([user,done,{type:'queue-operation',timestamp:new Date(now+10000).toISOString()},{type:'ai-title',aiTitle:'Task title'}],{id:'s',now});
  assert.equal(t.status,'completed');assert.equal(t.title,'Task title');assert.equal(t.updatedAt,now-1000);
});
test('Claude partially flushed last record does not expose a prior completion as current',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-claude-partial-'));
  try{
    mkdirSync(join(home,'projects','p'),{recursive:true});
    const end={...tool,message:{stop_reason:'end_turn',content:[]}};
    writeFileSync(join(home,'projects','p','s.jsonl'),[user,end].map(JSON.stringify).join('\n')+'\n{"type":"user"');
    assert.equal(readClaudeSnapshot({home,now}).tasks[0].status,'unknown');
  }finally{rmSync(home,{recursive:true,force:true});}
});
