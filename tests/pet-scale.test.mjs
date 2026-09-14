import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePetScale, scaledPetBounds, petLayoutHeight } from '../core/pet-scale.mjs';
const area={x:0,y:0,width:1440,height:900};
const bounds={x:1210,y:638,width:200,height:242};
test('scale settings migrate missing values and reject invalid persisted or IPC values',()=>{
  for(const value of [undefined,null,NaN,Infinity,'150',{}])assert.equal(normalizePetScale(value),100);
  assert.equal(normalizePetScale(-10),75);assert.equal(normalizePetScale(500),150);
  assert.equal(normalizePetScale(118),120);
});
test('scale resizes both dimensions without moving the bottom-right anchor or accumulating drift',()=>{
  const small=scaledPetBounds(bounds,area,75);
  assert.deepEqual(small,{x:1260,y:698,width:150,height:182});
  const large=scaledPetBounds(small,area,150);
  assert.deepEqual(large,{x:1110,y:517,width:300,height:363});
  assert.deepEqual(scaledPetBounds(large,area,100),bounds);
});
test('growing a pet against a screen edge keeps it on its display, including negative coordinates',()=>{
  const display={x:-1440,y:-200,width:1440,height:900};
  const result=scaledPetBounds({x:-1440,y:-200,width:200,height:242},display,150);
  assert.deepEqual(result,{x:-1440,y:-200,width:300,height:363});
});

test('extra statuses and announcements grow the compact window only as needed',()=>{
  assert.equal(petLayoutHeight(4),242);
  assert.equal(petLayoutHeight(4,true),274);
  assert.equal(petLayoutHeight(6),282);
  assert.equal(petLayoutHeight(6,true),314);
  assert.equal(scaledPetBounds(bounds,area,150,petLayoutHeight(6,true)).height,471);
});
