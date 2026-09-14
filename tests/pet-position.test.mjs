import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePetPosition,rememberPetPosition,restorePetBounds} from '../core/pet-position.mjs';
const screen={id:1,workArea:{x:0,y:25,width:1440,height:850}},size={width:200,height:242};
test('first launch and invalid saved data use top right of usable screen',()=>{
  for(const value of [undefined,null,{}, {x:Infinity,y:20,displayId:1,workArea:screen.workArea}])assert.deepEqual(restorePetBounds([screen],1,value,size),{x:1216,y:45,...size});
  assert.equal(normalizePetPosition({x:'20',y:30}),null);
});
test('dragged coordinates survive serialization and restart without anchor drift',()=>{
  const saved=JSON.parse(JSON.stringify(rememberPetPosition({x:350,y:125,...size},screen)));
  assert.deepEqual(restorePetBounds([screen],1,saved,size),{x:350,y:125,...size});
  assert.deepEqual(restorePetBounds([screen],1,saved,{width:300,height:363}),{x:350,y:125,width:300,height:363});
});
test('remembered monitor moves, shrinks or disconnects without leaving the pet offscreen',()=>{
  const secondary={id:2,workArea:{x:-1440,y:25,width:1440,height:850}};
  const saved=rememberPetPosition({x:-250,y:620,...size},secondary);
  const moved={id:2,workArea:{x:1440,y:25,width:1000,height:650}};
  assert.deepEqual(restorePetBounds([screen,moved],1,saved,size),{x:2240,y:433,...size});
  assert.deepEqual(restorePetBounds([screen],1,saved,size),{x:1216,y:45,...size});
});

test('large system display IDs remain valid',()=>{
  const display={...screen,id:4294967295};const saved=rememberPetPosition({x:350,y:125,...size},display);
  assert.ok(saved);assert.deepEqual(restorePetBounds([display],display.id,saved,size),{x:350,y:125,...size});
});
