import test from 'node:test';import assert from 'node:assert/strict';
import {readLoginStartup,setLoginStartup} from '../core/login-startup.mjs';
function fixture(){let value={openAtLogin:false,status:'not-registered'};const writes=[];return {writes,isPackaged:true,getLoginItemSettings:()=>value,setLoginItemSettings:p=>{writes.push(p);value={openAtLogin:p.openAtLogin,status:p.openAtLogin?'enabled':'not-registered'};},external:v=>{value=v;}};}
test('startup remains untouched until explicitly toggled; enable and disable round-trip',()=>{
  const app=fixture();assert.equal(readLoginStartup(app,'darwin').openAtLogin,false);assert.deepEqual(app.writes,[]);
  assert.equal(setLoginStartup(app,true,'darwin').openAtLogin,true);assert.equal(setLoginStartup(app,false,'darwin').openAtLogin,false);
  assert.deepEqual(app.writes,[{openAtLogin:true},{openAtLogin:false}]);
});
test('system changes and pending system approval are reflected instead of trusting persisted preferences',()=>{
  const app=fixture();app.external({openAtLogin:false,status:'requires-approval'});assert.equal(readLoginStartup(app,'darwin').startupStatus,'requires-approval');assert.equal(readLoginStartup(app,'darwin').openAtLogin,true);
  app.external({openAtLogin:false,status:'not-registered'});assert.equal(readLoginStartup(app,'darwin').openAtLogin,false);assert.equal(app.writes.length,0);
});
test('development runtime and unsupported platforms cannot become login items',()=>{
  const app=fixture();app.isPackaged=false;assert.equal(readLoginStartup(app,'darwin').startupAvailable,false);assert.throws(()=>setLoginStartup(app,true,'darwin'));
  app.isPackaged=true;assert.throws(()=>setLoginStartup(app,true,'linux'));assert.throws(()=>setLoginStartup(app,'yes','darwin'));assert.deepEqual(app.writes,[]);
});
test('registration errors and silently ignored changes are reported',()=>{
  const app=fixture();app.setLoginItemSettings=()=>{};assert.throws(()=>setLoginStartup(app,true,'darwin'));
  app.getLoginItemSettings=()=>{throw Error('unavailable');};assert.equal(readLoginStartup(app,'darwin').startupAvailable,false);
});
