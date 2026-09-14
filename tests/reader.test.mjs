import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodexSnapshot,legacyTail } from '../core/codex-reader.mjs';
import { resolveStatus,changedToTerminal } from '../core/task-state.mjs';
test('does not claim an old unfinished turn is live or finished',()=>{
  assert.equal(resolveStatus({status:'inProgress'},100,200000),'unconfirmed');
  assert.equal(resolveStatus({status:'completed'},100,200000),'completed');
  assert.equal(resolveStatus(null,100,200000),'unknown');
  assert.equal(resolveStatus({status:'inProgress'},100,200,true),'waiting');
});
test('notifications require a known transition of the same turn',()=>{
  const t={id:'a',turnId:'1',status:'completed'};
  assert.equal(changedToTerminal([], [t]).length,0);
  assert.equal(changedToTerminal([{...t,status:'running'}],[t]).length,1);
  assert.equal(changedToTerminal([{...t,turnId:'0',status:'running'}],[t]).length,0);
  assert.equal(changedToTerminal([t],[t]).length,0);
});
test('reads real schema, excludes internal agents and private content, observes transitions',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-reader-'));const now=Date.now();
  const db=new DatabaseSync(join(home,'state_5.sqlite')),h=new DatabaseSync(join(home,'thread_history_1.sqlite'));
  try{
    db.exec('CREATE TABLE threads(id TEXT,title TEXT,name TEXT,updated_at INTEGER,source TEXT,archived INTEGER,history_mode TEXT)');
    const row=db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)');row.run('main','original','My task',Math.floor(now/1000),'vscode',0,'paginated');row.run('private','DO NOT SHOW',null,Math.floor(now/1000),'{"subagent":{"other":"guardian"}}',0,'legacy');row.run('archived','HIDDEN',null,Math.floor(now/1000),'cli',1,'paginated');
    h.exec('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT);CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT)');
    h.prepare('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)').run('main','turn',1,'inProgress',Math.floor(now/1000),null,null);
    const add=h.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?)');add.run('main','turn','r',1,now,'reasoning',JSON.stringify({type:'reasoning',content:'PRIVATE_REASONING'}));add.run('main','turn','m',2,now,'agentMessage',JSON.stringify({type:'agentMessage',phase:'commentary',text:'Public update'}));add.run('main','turn','c',3,now,'commandExecution',JSON.stringify({type:'commandExecution',status:'completed',command:'SECRET_COMMAND',aggregatedOutput:'SECRET_OUTPUT'}));
    const before=readCodexSnapshot({home,now});assert.equal(before.connected,true);assert.equal(before.tasks.length,1);assert.equal(before.tasks[0].title,'My task');assert.equal(before.tasks[0].status,'running');assert.match(JSON.stringify(before),/Public update/);assert.doesNotMatch(JSON.stringify(before),/SECRET|PRIVATE|DO NOT SHOW|HIDDEN/);
    h.exec("UPDATE thread_turns SET status='completed'");const after=readCodexSnapshot({home,now});assert.equal(after.tasks[0].status,'completed');assert.equal(changedToTerminal(before.tasks,after.tasks).length,1);
    assert.equal(db.prepare('SELECT count(*) as n FROM threads').get().n,3);
  }finally{h.close();db.close();rmSync(home,{recursive:true,force:true});}
});
test('missing source is disconnected, not demo data',()=>{const s=readCodexSnapshot({home:join(tmpdir(),`aster-missing-${process.pid}-${Date.now()}`)});assert.equal(s.connected,false);assert.deepEqual(s.tasks,[]);});
test('legacy terminal events and truncated lines remain conservative',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-legacy-'));try{const path=join(home,'rollout.jsonl');writeFileSync(path,JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_complete',turn_id:'old'}})+'\n{"partial":');assert.equal(legacyTail(path,home).turn.status,'completed');writeFileSync(path,'{"partial":');assert.equal(legacyTail(path,home).turn,null);}finally{rmSync(home,{recursive:true,force:true});}
});

test('subtitle uses the latest user request in the current turn, beyond the activity window',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-subtitle-')),now=Date.now();
  const db=new DatabaseSync(join(home,'state_5.sqlite')),h=new DatabaseSync(join(home,'thread_history_1.sqlite'));
  try{
    db.exec('CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER,source TEXT,archived INTEGER,history_mode TEXT)');
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?)').run('main','任务主题',now,'appServer',0,'paginated');
    h.exec('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,started_at INTEGER,completed_at INTEGER,error_json TEXT);CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT)');
    h.prepare('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)').run('main','current',2,'inProgress',now,null,null);
    const add=h.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?,?,?)');
    const user=(turn,id,ordinal,text)=>add.run('main',turn,id,ordinal,now,'userMessage',JSON.stringify({content:[{type:'image',url:'PRIVATE_IMAGE'},{type:'text',text}]}));
    user('old','old',0,'OLD_REQUEST');user('current','first',1,'FIRST_REQUEST');
    user('current','latest',2,'# Files mentioned by the user:\nPRIVATE_PATH\n\n## My request:\n&#x20;增加子标题，展示具体问题\n<image name="reference">PRIVATE_IMAGE</image>');
    for(let i=3;i<18;i++)add.run('main','current',String(i),i,now,'agentMessage',JSON.stringify({text:'公开进度'}));
    let result=readCodexSnapshot({home,now});
    assert.equal(result.connected,true);assert.equal(result.tasks[0].title,'任务主题');assert.equal(result.tasks[0].subtitle,'增加子标题，展示具体问题');
    assert.doesNotMatch(JSON.stringify(result),/PRIVATE|OLD_REQUEST|FIRST_REQUEST/);
    h.prepare('INSERT INTO thread_turns VALUES(?,?,?,?,?,?,?)').run('main','new',3,'inProgress',now,null,null);
    result=readCodexSnapshot({home,now});assert.equal(result.tasks[0].subtitle,'');
  }finally{h.close();db.close();rmSync(home,{recursive:true,force:true});}
});

test('legacy subtitle skips context and clears on a new turn',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-subtitle-legacy-')),path=join(home,'rollout.jsonl');
  const rows=[{type:'event_msg',payload:{type:'task_started',turn_id:'one'}},{type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'# AGENTS.md instructions\nPRIVATE_CONTEXT'}]}},{type:'event_msg',payload:{type:'user_message',message:'具体问题\n第二行'}}];
  try{
    writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n'));assert.equal(legacyTail(path,home).subtitle,'具体问题 第二行');
    rows.push({type:'event_msg',payload:{type:'task_started',turn_id:'two'}});
    writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n'));assert.equal(legacyTail(path,home).subtitle,'');
  }finally{rmSync(home,{recursive:true,force:true});}
});
