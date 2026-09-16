import test from 'node:test';
import assert from 'node:assert/strict';
import { readAllSnapshot } from '../core/all-readers.mjs';
const task=(id,status='completed',updatedAt=100)=>({id,status,updatedAt});
test('one provider failure never hides other sources, IDs cannot collide',()=>{
  const s=readAllSnapshot({now:123,readers:{codex:()=>({connected:true,tasks:[task('same')]}),claude:()=>({connected:true,tasks:[task('same','running',1)]}),cursor:()=>{throw Error('SECRET');}}});
  assert.equal(s.connected,true);assert.equal(s.checkedAt,123);assert.deepEqual(s.tasks.map(t=>t.id),['claude:same','same']);
  assert.equal(s.sources[2].connected,false);assert.doesNotMatch(JSON.stringify(s),/SECRET/);
});
test('aggregate cap retains active tasks first and sources retain original counts',()=>{
  const s=readAllSnapshot({limit:1,readers:{kiro:()=>({connected:true,tasks:[task('kiro:x'),task('kiro:y','waiting',1)]})}});
  assert.equal(s.tasks[0].id,'kiro:y');assert.equal(s.tasks[0].nativeId,'kiro:y');assert.equal(s.sources[0].count,2);
});
test('CLI collection preserves software identity and adds it to the correct software filter/count',()=>{
  const s=readAllSnapshot({readers:{codex:()=>({connected:true,tasks:[task('session')]}),cursor:()=>({connected:false,tasks:[],error:'No native store'}),cli:()=>({connected:true,tasks:[{...task('cli:wrap1'),provider:'cursor',source:'cli',sourceLabel:'Cursor · CLI',observation:'process'},{...task('cli:wrap2'),provider:'codex',source:'cli',sourceLabel:'Codex · CLI',observation:'process'},task('cli:other')]})}});
  assert.equal(s.tasks.find(t=>t.id==='cli:wrap1').provider,'cursor');
  const codex=s.tasks.filter(t=>t.provider==='codex');assert.equal(codex.length,2);assert.equal(codex.find(t=>t.id==='cli:wrap2').observation,'process');
  assert.equal(s.sources.find(s=>s.provider==='codex').count,2);assert.equal(s.sources.find(s=>s.provider==='cursor').connected,true);assert.equal(s.sources.find(s=>s.provider==='cli').count,1);assert.equal(s.sources.find(s=>s.provider==='cli').sourceLabel,'其他 CLI');
});
test('native Codex tasks keep their app deep link while process observations do not invent one',()=>{
  const id='12345678-1234-1234-1234-123456789abc';
  const s=readAllSnapshot({readers:{codex:()=>({connected:true,tasks:[task(id)]}),cli:()=>({connected:true,tasks:[{...task(`cli:${id}`),provider:'codex',observation:'process'}]})}});
  assert.deepEqual(s.tasks.find(t=>t.id===id).jumpTarget,{kind:'codex-thread',label:'打开 Codex 任务'});
  assert.equal(s.tasks.find(t=>t.id===`cli:${id}`).jumpTarget,null);
});
