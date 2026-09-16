import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { describeTaskJump,openTaskTarget,resolveMacApplication } from '../core/task-jump.mjs';
test('jump accepts only known apps and validated targets',async()=>{
  for(const jumpTarget of [{kind:'url',url:'https://bad.example'},{kind:'application',app:'sh'},{kind:'application',app:'Kiro'},{kind:'cursor-session'},{kind:'project',app:'Cursor',cwd:tmpdir()},{kind:'terminal',tty:'/dev/ttys1; touch BAD'}]){
    assert.equal(describeTaskJump({jumpTarget}).available,false);
    const result=await openTaskTarget({jumpTarget},{platform:'darwin',execute:()=>assert.fail('must not execute')});assert.equal(result.ok,false);
  }
});
test('terminal jump never sends commands',async()=>{
  const calls=[];const execute=async(...args)=>{calls.push(args);return {stdout:'found\n'};};
  assert.equal((await openTaskTarget({jumpTarget:{kind:'terminal',tty:'/dev/ttys001',app:'Terminal'}},{platform:'darwin',execute})).ok,true);
  assert.doesNotMatch(calls[0][1][1],/do script|write text/);assert.equal(calls[0][1][2],'/dev/ttys001');
});
test('application resolver rejects unknown apps and invalid directory results',async()=>{
  const execute=async()=>({stdout:JSON.stringify(['relative'])});
  assert.equal(await resolveMacApplication('sh',{execute,inspect:()=>assert.fail('must not inspect')}),null);
  assert.equal(await resolveMacApplication('Cursor',{execute,inspect:()=>assert.fail('must not inspect')}),null);
});
