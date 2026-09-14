import test from 'node:test';
import assert from 'node:assert/strict';
import { cumulativeTokens, codexTokens, claudeTokens, tokenLabel, tokenDescription } from '../core/token-usage.mjs';
import { legacyTail, readCodexSnapshot } from '../core/codex-reader.mjs';
import { readClaudeSnapshot } from '../core/claude-reader.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('missing and invalid counts stay distinct from measured zero; large totals format compactly',()=>{
  for(const v of [undefined,null,'123',-1,Infinity,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(cumulativeTokens(v),null);
  assert.equal(tokenLabel(null),'Token 未提供');
  assert.equal(tokenLabel(cumulativeTokens(0)),'累计 Token 0');
  assert.equal(tokenLabel(cumulativeTokens(2515576)),'累计 Token 2.52M');
  assert.match(tokenDescription(cumulativeTokens(2515576)),/2,515,576/);
});

test('Codex cumulative usage is never summed across repeated count events or reset on a new turn',()=>{
  assert.equal(codexTokens({total_token_usage:{total_tokens:100},last_token_usage:{total_tokens:20}}).total,100);
  const home=mkdtempSync(join(tmpdir(),'aster-token-legacy-')),path=join(home,'rollout.jsonl');
  try{
    const payloads=[{type:'token_count',info:{total_token_usage:{total_tokens:100}}},{type:'token_count',info:{total_token_usage:{total_tokens:100}}},{type:'task_started',turn_id:'next'},{type:'token_count',info:null}];
    writeFileSync(path,payloads.map(payload=>JSON.stringify({type:'event_msg',payload})).join('\n'));
    assert.equal(legacyTail(path,home).tokenUsage.total,100);
  }finally{rmSync(home,{recursive:true,force:true});}
});

test('Codex reads the task total and remains compatible with indexes lacking tokens_used',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-token-db-')),db=new DatabaseSync(join(home,'state_5.sqlite'));
  try{
    db.exec('CREATE TABLE threads(id TEXT,title TEXT,updated_at INTEGER,source TEXT,archived INTEGER)');
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('t','Token task',Date.now(),'appServer',0);
    assert.equal(readCodexSnapshot({home}).tasks[0].tokenUsage,null);
    db.exec('ALTER TABLE threads ADD COLUMN tokens_used INTEGER');
    db.exec('UPDATE threads SET tokens_used=1234567');
    assert.deepEqual(readCodexSnapshot({home}).tasks[0].tokenUsage,{total:1234567,scope:'session'});
    db.exec('UPDATE threads SET tokens_used=0');assert.equal(readCodexSnapshot({home}).tasks[0].tokenUsage.total,0);
  }finally{db.close();rmSync(home,{recursive:true,force:true});}
});

const message=(id,output=20)=>({type:'assistant',message:{id,usage:{input_tokens:10,output_tokens:output,cache_read_input_tokens:30,cache_creation_input_tokens:40}}});
test('Claude counts cache tokens once and deduplicates repeated/streamed messages',()=>{
  const rows=[message('a'),message('a',25),message('a'),message('b'),{...message('sub'),isSidechain:true}];
  assert.deepEqual(claudeTokens(rows),{total:205,input:20,output:45,cacheRead:60,cacheWrite:80,scope:'session'});
  rows.truncated=true;assert.equal(claudeTokens(rows).scope,'recent');
  assert.match(tokenLabel(claudeTokens(rows)),/^近期 Token/);
  assert.match(tokenDescription(claudeTokens(rows)),/非完整任务累计/);
  assert.equal(claudeTokens([{type:'assistant',message:{id:'bad',usage:{input_tokens:-1,output_tokens:3}}}]),null);
  assert.equal(claudeTokens([]),null);
});

test('Claude adapter labels a bounded tail as recent, not a full-session total',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-token-claude-')),folder=join(home,'projects','p');
  try{
    mkdirSync(folder,{recursive:true});
    const path=join(folder,'task.jsonl');
    writeFileSync(path,JSON.stringify(message('a'))+'\n');
    let task=readClaudeSnapshot({home}).tasks[0];assert.equal(task.tokenUsage.scope,'session');assert.equal(task.tokenUsage.total,100);
    writeFileSync(path,JSON.stringify({type:'metadata',ignored:'x'.repeat(270000)})+'\n'+JSON.stringify(message('b'))+'\n');
    task=readClaudeSnapshot({home}).tasks[0];assert.equal(task.tokenUsage.scope,'recent');assert.equal(task.tokenUsage.total,100);
  }finally{rmSync(home,{recursive:true,force:true});}
});
