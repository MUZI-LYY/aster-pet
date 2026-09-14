import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync } from 'node:fs';
import { spawn,spawnSync } from 'node:child_process';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { readCliSnapshot } from '../core/cli-reader.mjs';
import { identifyCliProvider } from '../core/cli-provider.mjs';
const runner=resolve('scripts/aster-run.mjs');
test('CLI software identity comes from executable name or explicit selection, never a title',()=>{
  for(const [command,provider] of [['claude','claude'],[join(tmpdir(),'bin','claude-code'),'claude'],['codex','codex'],['kiro-cli','kiro'],['kiro','kiro'],['cursor-agent','cursor'],[join(tmpdir(),'Cursor.app','bin','cursor'),'cursor'],['npm','cli'],['agent','cli'],['constructor','cli']])assert.equal(identifyCliProvider(command),provider);
  assert.equal(identifyCliProvider('agent','cursor'),'cursor');assert.equal(identifyCliProvider('claude','cli'),'cli');assert.throws(()=>identifyCliProvider('node','bad'));
});
test('wrapper persists software independently of its title; legacy records stay other CLI',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-provider-'));
  try{
    const result=spawnSync(process.execPath,[runner,'--provider','cursor','--title','任意任务名称','--',process.execPath,'-e','process.exit(0)'],{env:{...process.env,ASTER_TASK_HOME:home},encoding:'utf8'});
    assert.equal(result.status,0);const task=readCliSnapshot({home}).tasks[0];assert.equal(task.provider,'cursor');assert.equal(task.source,'cli');assert.equal(task.sourceLabel,'Cursor · CLI');assert.equal(task.observation,'process');assert.match(task.id,/^cli:/);
    writeFileSync(join(home,'old.json'),JSON.stringify({version:1,id:'legacy',status:'completed',title:'Claude Code',updatedAt:Date.now()}));
    assert.equal(readCliSnapshot({home}).tasks.find(t=>t.nativeId==='legacy').provider,'cli');
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('CLI wrapper preserves exit codes and never stores arguments or output',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-'));
  try{
    for(const code of [0,7]){
      const r=spawnSync(process.execPath,[runner,'--title','Build task','--',process.execPath,'-e',`console.log("SECRET_OUTPUT");process.exit(${code})`],{env:{...process.env,ASTER_TASK_HOME:home},encoding:'utf8'});
      assert.equal(r.status,code);assert.match(r.stdout,/SECRET_OUTPUT/);
    }
    const snapshot=readCliSnapshot({home});assert.deepEqual(new Set(snapshot.tasks.map(t=>t.status)),new Set(['completed','failed']));
    for(const f of readdirSync(home)){assert.doesNotMatch(readFileSync(join(home,f),'utf8'),/SECRET_OUTPUT|console\.log/);}
    const r=spawnSync(process.execPath,[runner,'--',join(home,'missing-command')],{env:{...process.env,ASTER_TASK_HOME:home}});assert.equal(r.status,127);
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('CLI heartbeat with dead/reused PID remains unconfirmed instead of claiming completion',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-'));
  try{
    writeFileSync(join(home,'x.json'),JSON.stringify({version:1,id:'x',pid:1,procStart:'old',status:'running',updatedAt:Date.now(),title:'Test'}));
    assert.equal(readCliSnapshot({home,getProcessInfo:()=>null}).tasks[0].status,'unconfirmed');
    assert.equal(readCliSnapshot({home,getProcessInfo:()=>({start:'new'})}).tasks[0].status,'unconfirmed');
    assert.equal(readCliSnapshot({home,getProcessInfo:()=>({start:'old'})}).tasks[0].status,'running');
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('unavailable monitoring storage never prevents the original command from running',()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-unavailable-'));
  try{
    const unavailable=join(home,'existing-file');writeFileSync(unavailable,'KEEP_EXISTING_CONTENT');
    const result=spawnSync(process.execPath,[runner,'--',process.execPath,'-e','console.log("ORIGINAL_COMMAND_RAN");process.exit(7)'],{env:{...process.env,ASTER_TASK_HOME:unavailable},encoding:'utf8'});
    assert.equal(result.status,7);assert.match(result.stdout,/ORIGINAL_COMMAND_RAN/);
    assert.equal(readFileSync(unavailable,'utf8'),'KEEP_EXISTING_CONTENT');
  }finally{rmSync(home,{recursive:true,force:true});}
});
test('removing Aster records during execution does not stop the original command',async()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-removed-'));
  const child=spawn(process.execPath,[runner,'--',process.execPath,'-e','setTimeout(()=>process.exit(9),3500)'],{env:{...process.env,ASTER_TASK_HOME:home},stdio:'ignore'});
  try{
    for(let i=0;i<50&&readdirSync(home).length===0;i++)await new Promise(r=>setTimeout(r,20));
    const ended=once(child,'exit');rmSync(home,{recursive:true,force:true});const [code]=await ended;
    assert.equal(code,9);
  }finally{child.kill('SIGKILL');rmSync(home,{recursive:true,force:true});}
});
test('CLI signal forwarding records interruption and exits without leaving a running record',async()=>{
  const home=mkdtempSync(join(tmpdir(),'aster-cli-'));
  const child=spawn(process.execPath,[runner,'--',process.execPath,'-e','setInterval(()=>{},1000)'],{env:{...process.env,ASTER_TASK_HOME:home},stdio:'ignore'});
  try{
    for(let i=0;i<50&&readdirSync(home).length===0;i++)await new Promise(r=>setTimeout(r,20));
    await new Promise(r=>setTimeout(r,100));
    const ended=once(child,'exit');child.kill('SIGTERM');const [code]=await ended;
    assert.equal(code,143);assert.equal(readCliSnapshot({home}).tasks[0].status,'interrupted');
  }finally{child.kill('SIGKILL');rmSync(home,{recursive:true,force:true});}
});
