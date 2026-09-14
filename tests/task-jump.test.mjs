import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { describeTaskJump,openTaskTarget } from '../core/task-jump.mjs';
test('jump accepts only known apps and validated targets',async()=>{
  for(const jumpTarget of [{kind:'url',url:'https://bad.example'},{kind:'project',app:'sh',cwd:tmpdir()},{kind:'terminal',tty:'/dev/ttys1; touch BAD'}]){
    assert.equal(describeTaskJump({jumpTarget}).available,false);
    const result=await openTaskTarget({jumpTarget},{platform:'darwin',execute:()=>assert.fail('must not execute')});assert.equal(result.ok,false);
  }
});
test('project jump uses an argument array, terminal jump never sends commands',async()=>{
  const calls=[];const execute=async(...args)=>{calls.push(args);return {stdout:'found\n'};};
  const result=await openTaskTarget({jumpTarget:{kind:'project',app:'Cursor',cwd:tmpdir()}},{platform:'darwin',execute});
  assert.equal(result.ok,true);assert.deepEqual(calls[0].slice(0,2),['open',['-a','Cursor',tmpdir()]]);
  assert.equal((await openTaskTarget({jumpTarget:{kind:'terminal',tty:'/dev/ttys001',app:'Terminal'}},{platform:'darwin',execute})).ok,true);
  assert.doesNotMatch(calls[1][1][1],/do script|write text/);assert.equal(calls[1][1][2],'/dev/ttys001');
});
