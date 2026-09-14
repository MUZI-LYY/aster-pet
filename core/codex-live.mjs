import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Desktop IPC is versioned but private. Only observation messages are sent;
// unsupported versions, revision gaps and disconnects discard live evidence.
const fields = new Set(['threadRuntimeStatus','requests']);
function requestMeta(r) { return {method:r?.method,completed:r?.completed,params:{tool:r?.params?.tool}}; }
export function projectLiveState(s) {
  return {threadRuntimeStatus:s.threadRuntimeStatus,requests:(s.requests||[]).map(requestMeta)};
}
export function applyLivePatches(state, patches) {
  const next=structuredClone(state);
  for(const p of patches) {
    const path=p.path;if(!Array.isArray(path))throw Error('Unsupported patch');
    if(!fields.has(path[0]))continue;
    if(path.some(k=>['__proto__','prototype','constructor'].includes(String(k))))throw Error('Invalid path');
    // Request contents never leave this process; retain only status metadata.
    let value=p.value;
    if(path[0]==='requests') {
      if(path.length===1)value=Array.isArray(value)?value.map(requestMeta):[];
      else if(path.length===2&&p.op!=='remove')value=requestMeta(value);
      else if(path.length>2&&!['method','completed','params'].includes(path[2]))continue;
      else if(path[2]==='params'&&path.length===3)value={tool:value?.tool};
      else if(path[2]==='params'&&path[3]!=='tool')continue;
    }
    let node=next;for(const k of path.slice(0,-1)){if(node[k]==null)throw Error('Missing path');node=node[k];}
    const key=path.at(-1);
    if(p.op==='remove'){if(Array.isArray(node))node.splice(Number(key),1);else delete node[key];}
    else if(p.op==='add'||p.op==='replace') {if(Array.isArray(node)&&p.op==='add')node.splice(Number(key),0,value);else node[key]=value;}
    else throw Error('Unsupported operation');
  }
  return next;
}
export function resolveLiveStatus(state, fallback) {
  const runtime=state.threadRuntimeStatus, flags=runtime?.activeFlags||[];
  const requests=(state.requests||[]).filter(r=>!r.completed);
  if(flags.includes('waitingOnApproval')||requests.some(r=>/requestApproval$|Approval$|elicitation\/request$/.test(r.method||'')))return 'approval';
  if(flags.includes('waitingOnUserInput')||requests.some(r=>/requestUserInput$|requestOptionPicker$/.test(r.method||'')||['request_onboarding_input','request_option_picker','setup_codex_step'].includes(r.params?.tool)))return 'input';
  if(runtime?.type==='active')return 'running';
  if(runtime?.type==='systemError')return 'failed';
  if(runtime?.type==='idle')return ['running','waiting','approval','input'].includes(fallback)?'unconfirmed':fallback;
  return null;
}
export class CodexLiveObserver extends EventEmitter {
  states=new Map();wanted=new Set();subscriptions=new Set();client=null;stopped=false;
  constructor({path=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'ipc/ipc.sock')}={}){super();this.path=path;}
  start(){this.connect();this.timer=setInterval(()=>this.subscribe(),15000);return this;}
  setTasks(tasks){this.wanted=new Set(tasks.map(t=>t.nativeId||t.id));this.subscribe();}
  send(message){if(!this.socket?.writable)return;const body=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32LE(body.length);this.socket.write(Buffer.concat([header,body]));}
  following(id,following){this.send({type:'broadcast',sourceClientId:this.client,method:'thread-stream-following-changed',version:1,params:{hostId:'local',conversationId:id,following}});}
  subscribe(){if(!this.client)return;for(const id of this.subscriptions)if(!this.wanted.has(id)){this.following(id,false);this.subscriptions.delete(id);this.states.delete(id);}for(const id of this.wanted)if(!this.subscriptions.has(id)||!this.states.has(id)){this.following(id,true);this.subscriptions.add(id);}}
  connect(){if(this.stopped)return;let buffer=Buffer.alloc(0);this.socket=net.createConnection(this.path);this.socket.on('connect',()=>this.send({type:'request',requestId:randomUUID(),sourceClientId:'initializing-client',method:'initialize',version:0,params:{clientType:'aster-observer'},timeoutMs:5000}));
    this.socket.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);try{while(buffer.length>=4){const size=buffer.readUInt32LE(0);if(size>64*1024*1024)throw Error('Oversized frame');if(buffer.length<size+4)break;const message=JSON.parse(buffer.subarray(4,4+size));buffer=buffer.subarray(4+size);this.handle(message);}}catch{this.socket.destroy();}});
    this.socket.on('error',()=>{});this.socket.on('close',()=>{this.client=null;this.states.clear();this.subscriptions.clear();this.emit('change');if(!this.stopped)this.retry=setTimeout(()=>this.connect(),5000);});
  }
  handle(m){
    if(m.type==='client-discovery-request'){this.send({type:'client-discovery-response',requestId:m.requestId,response:{canHandle:false}});return;}
    if(m.type==='response'&&m.method==='initialize'&&m.resultType==='success'){this.client=m.result.clientId;this.subscribe();return;}
    if(m.type!=='broadcast')return;
    if(m.method==='client-status-changed'&&m.params?.status==='disconnected'){for(const [id,s] of this.states)if(s.owner===m.params.clientId)this.states.delete(id);this.subscribe();this.emit('change');}
    if(m.method!=='thread-stream-state-changed'||m.version!==11||m.params?.hostId!=='local')return;
    const {conversationId:id,change:c}=m.params;if(!this.wanted.has(id))return;
    const previous=this.states.get(id);
    try {
      let state;
      if(c.type==='snapshot')state=projectLiveState(c.conversationState);
      else if(c.type==='patches'&&previous?.revision===c.baseRevision)state=applyLivePatches(previous.state,c.patches);
      else throw Error('Revision gap');
      this.states.set(id,{state,revision:c.revision,owner:m.sourceClientId});this.emit('change');
    }catch{this.states.delete(id);this.following(id,false);this.following(id,true);this.emit('change');}
  }
  overlay(task){const current=this.states.get(task.nativeId||task.id);if(!current)return task;const status=resolveLiveStatus(current.state,task.status);return status?{...task,status,evidence:'Codex 桌面实时状态'}:task;}
  stop(){this.stopped=true;clearInterval(this.timer);clearTimeout(this.retry);this.socket?.destroy();this.states.clear();}
}
