import test from 'node:test';
import assert from 'node:assert/strict';
import { presentListWindow } from '../core/list-window.mjs';

test('list waits until the opening pointer event finishes before taking focus',()=>{
  const calls=[];let callback;
  const window={showInactive:()=>calls.push('show'),isDestroyed:()=>false,isVisible:()=>true,focus:()=>calls.push('focus')};
  const timer=presentListWindow(window,{schedule:fn=>{callback=fn;return 7;}});
  assert.equal(timer,7);assert.deepEqual(calls,['show']);
  callback();assert.deepEqual(calls,['show','focus']);
});

test('list does not take focus after it has been hidden or destroyed',()=>{
  for(const state of [{destroyed:true,visible:true},{destroyed:false,visible:false}]){
    let callback,focused=false;
    const window={showInactive:()=>{},isDestroyed:()=>state.destroyed,isVisible:()=>state.visible,focus:()=>{focused=true;}};
    presentListWindow(window,{schedule:fn=>{callback=fn;}});callback();assert.equal(focused,false);
  }
});
