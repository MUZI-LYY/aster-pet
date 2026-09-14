import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexLiveObserver,projectLiveState,applyLivePatches,resolveLiveStatus} from '../core/codex-live.mjs';
test('live approval and input override persisted running, completed and age',()=>{
  const live=projectLiveState({threadRuntimeStatus:{type:'active',activeFlags:['waitingOnApproval']},requests:[]});
  assert.equal(resolveLiveStatus(live,'completed'),'approval');
  assert.equal(resolveLiveStatus({...live,threadRuntimeStatus:{type:'active',activeFlags:['waitingOnUserInput']}},'unconfirmed'),'input');
  assert.equal(resolveLiveStatus({...live,threadRuntimeStatus:{type:'active',activeFlags:[]}},'unconfirmed'),'running');
  assert.equal(resolveLiveStatus({...live,threadRuntimeStatus:{type:'idle'}},'running'),'unconfirmed');
});
test('request patches resolve approval then input then running without exposing content',()=>{
  let state=projectLiveState({threadRuntimeStatus:{type:'active',activeFlags:[]},requests:[{method:'item/commandExecution/requestApproval',params:{command:'SECRET'}}]});
  assert.equal(resolveLiveStatus(state,'running'),'approval');assert.doesNotMatch(JSON.stringify(state),/SECRET/);
  state=applyLivePatches(state,[{op:'remove',path:['requests',0]},{op:'add',path:['requests',0],value:{method:'item/tool/requestUserInput',params:{questions:['PRIVATE']}}}]);
  assert.equal(resolveLiveStatus(state,'running'),'input');assert.doesNotMatch(JSON.stringify(state),/PRIVATE/);
  state=applyLivePatches(state,[{op:'replace',path:['requests'],value:[]}]);assert.equal(resolveLiveStatus(state,'running'),'running');
  assert.throws(()=>applyLivePatches(state,[{op:'add',path:['requests','__proto__','x'],value:1}]));
});
test('framed observer subscribes read-only, tracks revisions and discards disconnected state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'aster-ipc-')),path=join(dir,'observer.sock');
  const server=net.createServer();await new Promise(r=>server.listen(path,r));let peer;const sent=[];
  const emit=(message)=>{const b=Buffer.from(JSON.stringify(message)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);peer.write(Buffer.concat([h,b]));};
  server.on('connection',socket=>{peer=socket;let buffer=Buffer.alloc(0);socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32LE(0)){const n=buffer.readUInt32LE(0),m=JSON.parse(buffer.subarray(4,n+4));buffer=buffer.subarray(n+4);sent.push(m);if(m.method==='initialize')emit({type:'response',method:'initialize',resultType:'success',result:{clientId:'observer'}});if(m.method==='thread-stream-following-changed'&&m.params.following)emit({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'task',change:{type:'snapshot',revision:1,conversationState:{threadRuntimeStatus:{type:'active',activeFlags:['waitingOnApproval']},requests:[]}}}});}});});
  const observer=new CodexLiveObserver({path});observer.setTasks([{id:'task'}]);observer.start();
  const until=async predicate=>{for(let n=0;n<100&&!predicate();n++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate());};
  try{await until(()=>observer.states.has('task'));assert.equal(observer.overlay({id:'task',status:'running'}).status,'approval');
    emit({type:'broadcast',method:'thread-stream-state-changed',version:11,sourceClientId:'owner',params:{hostId:'local',conversationId:'task',change:{type:'patches',baseRevision:1,revision:2,patches:[{op:'replace',path:['threadRuntimeStatus','activeFlags'],value:[]}]}}});
    await until(()=>observer.states.get('task')?.revision===2);assert.equal(observer.overlay({id:'task',status:'completed'}).status,'running');
    assert.ok(sent.every(m=>['initialize','thread-stream-following-changed'].includes(m.method)));peer.destroy();await until(()=>observer.states.size===0);
  }finally{observer.stop();peer?.destroy();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
