import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveMood} from '../core/task-state.mjs';
import {robotMoods,sampleRobotPose} from '../core/robot-motion.mjs';
import {createRobotScene} from '../src/robot-scene.js';
import * as THREE from 'three';

test('task states have distinct robot expressions and deterministic multi-task priority',()=>{
  const moods={running:'working',completed:'completed',failed:'failed',approval:'approval',input:'input',waiting:'waiting',interrupted:'interrupted',unknown:'uncertain',unconfirmed:'uncertain',idle:'idle'};
  for(const [status,mood] of Object.entries(moods))assert.equal(deriveMood([{status}],true),mood);
  assert.equal(deriveMood([],true),'idle');assert.equal(deriveMood([{status:'running'}],false),'offline');
  const tasks=['running','completed','failed','input','approval'].map(status=>({status}));
  assert.equal(deriveMood(tasks,true),'approval');assert.equal(deriveMood(tasks.reverse(),true),'approval');
  assert.equal(deriveMood([{status:'completed',updatedAt:1},{status:'interrupted',updatedAt:2}],true),'interrupted');
});

test('all moods animate, stay finite, and freeze completely with reduced motion',()=>{
  for(const mood of Object.keys(robotMoods)){
    const poses=Array.from({length:120},(_,i)=>sampleRobotPose(i/10,mood));
    assert.ok(poses.every(p=>Object.values(p).every(Number.isFinite)),mood);
    assert.ok(poses.some(p=>JSON.stringify(p)!==JSON.stringify(poses[0])),`${mood} has motion`);
    assert.ok(poses.every(p=>Math.abs(p.y)<.45&&Math.abs(p.headY)<=.45&&p.eyeY>=.04),mood);
    assert.deepEqual(sampleRobotPose(0,mood,true),sampleRobotPose(123,mood,true,122),`${mood} freezes`);
  }
  assert.equal(new Set(Object.values(robotMoods).map(m=>m.color)).size,Object.keys(robotMoods).length);
});

test('completion cheers briefly; idle greeting is occasional and working hands alternate',()=>{
  assert.ok(sampleRobotPose(1.4,'completed').rightZ>1.5);
  assert.ok(sampleRobotPose(10,'completed').rightZ<.2);
  assert.ok(sampleRobotPose(2.6,'idle').rightZ>.9);
  assert.ok(sampleRobotPose(5.5,'idle').rightZ<.2);
  const busy=sampleRobotPose(.3,'working');assert.ok(Math.abs(busy.leftX-busy.rightX)>.3);
});

test('3D state transitions ease, repeated updates do not restart the cheer, reduced mode resets pose',()=>{
  const model=createRobotScene();
  try{
    model.update(0,'idle',false);
    const arm=model.scene.getObjectByName('right-arm');const original=arm.rotation.z;
    model.update(.01,'approval',false);assert.ok(arm.rotation.z>original&&arm.rotation.z<.5);
    model.update(1,'completed',false);
    for(let i=1;i<=180;i++)model.update(1+i/30,'completed',false);
    assert.ok(arm.rotation.z<.3,'completion gesture has ended');
    model.update(8,'input',true);
    const head=model.scene.getObjectByName('head').rotation.toArray();
    model.update(10,'input',true);assert.deepEqual(model.scene.getObjectByName('head').rotation.toArray(),head);
    assert.equal(model.scene.getObjectByName('robot').position.y,0);
  }finally{model.dispose();}
});

test('enlarged gestures remain inside the native robot viewport over a full gesture cycle',()=>{
  for(const mood of Object.keys(robotMoods)){
    const model=createRobotScene();model.resize(148,180);
    try{
      const robot=model.scene.getObjectByName('robot'),meshes=[];
      robot.traverse(o=>{if(o.isMesh){o.geometry.computeBoundingBox();meshes.push(o);}});
      const p=new THREE.Vector3();
      for(let t=0;t<18;t+=.1){
        model.update(t,mood,false);model.scene.updateMatrixWorld(true);model.camera.updateMatrixWorld(true);
        for(const mesh of meshes){
          const b=mesh.geometry.boundingBox;
          for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){
            p.set(x,y,z).applyMatrix4(mesh.matrixWorld).project(model.camera);
            assert.ok(Math.abs(p.x)<.99&&Math.abs(p.y)<.99,`${mood} clips at ${t.toFixed(1)}s`);
          }
        }
      }
    }finally{model.dispose();}
  }
});

test('working greeting is brief and cheerful without obscuring task-specific expressions',()=>{
  const greeting=sampleRobotPose(5.1,'working');
  assert.ok(greeting.rightZ>1.4);
  assert.ok(Math.abs(greeting.rightX)<.05);
  assert.ok(sampleRobotPose(7,'working').rightZ<.3);
  assert.ok(sampleRobotPose(5.1,'working',true).rightZ<.3);
  assert.ok(sampleRobotPose(5.1,'idle').smileY>1);
  assert.equal(sampleRobotPose(5.1,'failed').smileY,-1);
});
