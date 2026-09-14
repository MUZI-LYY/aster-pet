import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskAlertTracker, deriveMood } from '../core/task-state.mjs';
import { TaskMonitor } from '../core/monitor.mjs';
const task=(status,extra={})=>({id:'one',provider:'cli',turnId:'turn-1',status,title:'测试任务',...extra});

test('alerts do not replay history, repeat polls, or terminal regressions',()=>{
  const track=createTaskAlertTracker();
  assert.deepEqual(track([task('completed')]),[]);
  track([task('running')]);
  assert.deepEqual(track([task('completed')]),[]);
  assert.deepEqual(track([task('running',{turnId:'turn-2'})]),[]);
  assert.equal(track([task('completed',{turnId:'turn-2'})]).length,1);
  assert.deepEqual(track([task('completed',{turnId:'turn-2'})]),[]);
  track([task('running',{turnId:'turn-2'})]);
  assert.deepEqual(track([task('completed',{turnId:'turn-2'})]),[]);
  track([task('running',{turnId:'turn-3'})]);
  assert.equal(track([task('failed',{turnId:'turn-3'})]).length,1);
});

test('approval, input and confirmation alert once per entry, including newly discovered tasks',()=>{
  const track=createTaskAlertTracker();track([task('running')]);
  for(const status of ['approval','input','waiting']){
    assert.equal(track([task(status)]).length,1);
    assert.deepEqual(track([task(status)]),[]);
  }
  track([task('running')]);assert.equal(track([task('approval')]).length,1);
  assert.equal(track([task('approval'),task('input',{id:'two',turnId:null})]).length,1);
});

test('monitor retains simultaneous alerts across polls and acknowledges only the viewed status',()=>{
  const monitor=new TaskMonitor();let emissions=0;
  monitor.on('alerts',tasks=>{emissions+=tasks.length;});
  const publish=(tasks,connected=true)=>{monitor.raw={tasks,connected};monitor.publish();};
  publish([task('running'),task('running',{id:'two'}),task('running',{id:'three'})]);
  const next=[task('completed'),task('failed',{id:'two'}),task('approval',{id:'three'})];
  publish(next);publish(next);assert.equal(emissions,3);assert.equal(monitor.snapshot.alerts.length,3);
  monitor.acknowledge('completed');assert.deepEqual(monitor.snapshot.alerts.map(t=>t.status),['failed','approval']);
  publish(next);assert.equal(monitor.snapshot.alerts.length,2);assert.equal(emissions,3);
  publish(next,false);assert.equal(monitor.snapshot.alerts.length,2);
  publish([task('completed'),task('failed',{id:'two'}),task('running',{id:'three'})]);
  assert.deepEqual(monitor.snapshot.alerts.map(t=>t.status),['failed']);
  monitor.acknowledge('all');assert.equal(monitor.snapshot.alerts.length,0);
});

test('disconnect is not a transition, and new rounds clear old unread alerts',()=>{
  const monitor=new TaskMonitor();
  const publish=(tasks,connected=true)=>{monitor.raw={tasks,connected};monitor.publish();};
  publish([],false);publish([task('completed')]);assert.deepEqual(monitor.snapshot.alerts,[]);
  publish([task('running',{turnId:'two'})]);publish([],false);
  publish([task('failed',{turnId:'two'})]);assert.equal(monitor.snapshot.alerts.length,1);
  publish([task('running',{turnId:'three'})]);assert.equal(monitor.snapshot.alerts.length,0);
  assert.equal(deriveMood([task('failed')],true),'failed');
});
