import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { CodexLiveObserver } from './codex-live.mjs';
import { createTaskAlertTracker } from './task-state.mjs';
export class TaskMonitor extends EventEmitter {
  snapshot={tasks:[],connected:false,error:null,checkedAt:0,sourceLabel:'正在连接本机任务',limit:160};raw=this.snapshot;busy=false;
  trackAlerts=createTaskAlertTracker();pendingAlerts=new Map();
  publish(){
    const tasks=this.raw.tasks.map(t=>(t.observation!=='process'&&(t.provider==='codex'||!t.provider))?this.live.overlay(t):t);
    const alerts=this.raw.connected?this.trackAlerts(tasks):[];
    if(this.raw.connected){
      const current=new Map(tasks.map(t=>[t.id,t]));
      for(const [id,alert] of this.pendingAlerts){const task=current.get(id);if(!task||task.turnId!==alert.turnId||task.status!==alert.status)this.pendingAlerts.delete(id);}
      for(const task of alerts)this.pendingAlerts.set(task.id,task);
    }
    this.snapshot={...this.raw,tasks,alerts:[...this.pendingAlerts.values()].map(({id,turnId,status,title})=>({id,turnId,status,title}))};
    this.emit('snapshot',this.snapshot);
    if(alerts.length)this.emit('alerts',alerts);
  }
  acknowledge(status='all'){
    for(const [id,alert] of this.pendingAlerts)if(status==='all'||alert.status===status||(status==='attention'&&['approval','input','waiting','failed'].includes(alert.status)))this.pendingAlerts.delete(id);
    this.publish();
  }
  start(){this.live=new CodexLiveObserver().start();this.live.on('change',()=>{clearTimeout(this.liveTimer);this.liveTimer=setTimeout(()=>this.publish(),80);});
    this.worker=new Worker(new URL('./reader-worker.mjs',import.meta.url));
    this.worker.on('message',s=>{this.busy=false;this.raw=s;this.live.setTasks(s.tasks.filter(t=>t.observation!=='process'&&(t.provider==='codex'||!t.provider)));this.publish();});
    this.worker.on('error',()=>{this.busy=false;this.raw={...this.raw,connected:false,error:'任务读取服务暂不可用。'};this.publish();});
    this.refresh();this.timer=setInterval(()=>this.refresh(),3000);return this;
  }
  refresh(){if(!this.busy&&this.worker){this.busy=true;this.worker.postMessage({});}}
  stop(){clearInterval(this.timer);clearTimeout(this.liveTimer);this.live?.stop();this.worker?.terminate();}
}
