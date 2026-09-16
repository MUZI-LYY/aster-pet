import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openKiroWindowTask } from '../core/kiro-window-bridge.mjs';

const token='a'.repeat(64);
function fixture(records){
  const home=mkdtempSync(join(tmpdir(),'aster-bridge-'));
  const directory=join(home,'.kiro','aster-window-bridge');mkdirSync(directory,{recursive:true});
  records.forEach((value,index)=>writeFileSync(join(directory,`${index+1}.json`),JSON.stringify({protocol:1,provider:'kiro',pid:index+1,port:12000+index,token,updatedAt:100000,...value})));
  return {home,dispose:()=>rmSync(home,{recursive:true,force:true})};
}

test('Kiro bridge selects the existing window by exact workspace root and native ID',async()=>{
  const other=join(tmpdir(),'other'),project=join(tmpdir(),'project');
  const f=fixture([{workspace:'other',roots:[other],windowHint:'other.md'},{workspace:'project',roots:[project],windowHint:'target.md'}]);
  try{
    let selected;
    const result=await openKiroWindowTask({id:'sess_existing',cwd:project},{home:f.home,now:100100,send:async(record,id)=>{selected={record,id};return true;},focus:async record=>record.windowHint==='target.md'});
    assert.equal(result.ok,true);assert.equal(selected.record.port,12001);assert.equal(selected.id,'sess_existing');
  }finally{f.dispose();}
});

test('Kiro bridge fails closed for stale, ambiguous, invalid, or rejected targets',async()=>{
  let f=fixture([{workspace:'one'},{workspace:'two'}]);
  try{assert.equal((await openKiroWindowTask({id:'sess_task'},{home:f.home,now:100100,send:()=>assert.fail('must not send')})).ok,false);}finally{f.dispose();}
  f=fixture([{updatedAt:1}]);
  try{assert.equal((await openKiroWindowTask({id:'sess_task'},{home:f.home,now:100100,send:()=>assert.fail('must not send')})).ok,false);}finally{f.dispose();}
  f=fixture([{}]);
  try{
    assert.equal((await openKiroWindowTask({id:'sess_task',cwd:join(tmpdir(),'missing')},{home:f.home,now:100100,send:()=>assert.fail('must not send')})).ok,false);
    assert.equal((await openKiroWindowTask({id:'bad id'},{home:f.home,now:100100,send:()=>assert.fail('must not send')})).ok,false);
    assert.equal((await openKiroWindowTask({id:'sess_task'},{home:f.home,now:100100,send:async()=>false,focus:()=>assert.fail('must not focus')})).ok,false);
  }finally{f.dispose();}
});

test('Kiro never falls back to a shared directory name or disambiguates duplicate exact roots by name', async () => {
  const target = join(tmpdir(), 'team-a', 'demo');
  const other = join(tmpdir(), 'team-b', 'demo');
  for (const records of [
    [{ workspace: 'demo', roots: [other] }],
    [{ workspace: 'demo' }],
    [{ workspace: 'demo', roots: [target] }, { workspace: 'renamed', roots: [target] }],
  ]) {
    const f = fixture(records);
    try {
      const result = await openKiroWindowTask({ id: 'sess_target', cwd: target }, {
        home: f.home, now: 100100, send: () => assert.fail('must not send to an unverified window'),
        focus: () => assert.fail('must not focus an unverified window'),
      });
      assert.equal(result.ok, false);
    } finally { f.dispose(); }
  }
});

test('Kiro exact root wins over a same-name workspace and supports multiple roots', async () => {
  const target = join(tmpdir(), 'team-a', 'demo');
  const f = fixture([
    { workspace: 'demo', roots: [join(tmpdir(), 'team-b', 'demo')] },
    { workspace: 'multi-root', roots: [join(tmpdir(), 'other'), target] },
  ]);
  try {
    let selected;
    const result = await openKiroWindowTask({ id: 'sess_target', cwd: target }, {
      home: f.home, now: 100100, send: async record => { selected = record.port; return true; }, focus: async () => true,
    });
    assert.equal(result.ok, true);
    assert.equal(selected, 12001);
  } finally { f.dispose(); }
});
