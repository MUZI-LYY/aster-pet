import test from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { existingTaskScript, openExistingAppTask } from '../core/app-window-jump.mjs';

test('existing Cursor task jump passes title as data to a fixed UI script',async()=>{
  const calls=[];
  const result=await openExistingAppTask({provider:'cursor',title:'Exact task'},{execute:async(...args)=>{calls.push(args);return {stdout:'found\n'};}});
  assert.deepEqual(result,{ok:true,message:'已在原 Cursor 窗口定位任务。'});
  assert.equal(calls[0][0],'osascript');
  assert.deepEqual(calls[0][1],['-l','JavaScript','-e',existingTaskScript,'Exact task']);
  assert.equal(calls[0][2].timeout,30000);
  assert.doesNotMatch(existingTaskScript,/openExternal|\.activate\(|Application\(['"](?:Cursor|Kiro)['"]\)|\bopen\b/);
  assert.ok(existingTaskScript.indexOf('running.activateWithOptions') < existingTaskScript.indexOf('process.windows()'));
});

test('existing Cursor task jump fails closed without running, unique, valid targets',async()=>{
  const output=stdout=>async()=>({stdout});
  for(const value of ['missing-app','missing-window','ambiguous-app','matches:0','matches:2'])assert.equal((await openExistingAppTask({title:'Task'},{execute:output(value)})).ok,false);
  assert.equal((await openExistingAppTask({provider:'cursor',title:'bad\ntitle'},{execute:()=>assert.fail('must not execute')})).ok,false);
  assert.equal((await openExistingAppTask({provider:'cursor',title:'Task'},{platform:'linux',execute:()=>assert.fail('must not execute')})).ok,false);
  assert.equal((await openExistingAppTask({provider:'cursor',title:'Task'},{execute:async()=>{throw new Error('denied');}})).ok,false);
});

function runCursorScript(names, title) {
  const clicked = [];
  const buttons = names.map(name => ({ role: () => 'AXButton', name: () => name }));
  const process = { name: () => 'Cursor', unixId: () => 1,
    windows: () => [{ name: () => 'Cursor Agents', entireContents: () => buttons }] };
  const systemEvents = { applicationProcesses: { whose: () => () => [process] },
    click: element => clicked.push(element.name()) };
  const context = vm.createContext({ ObjC: { import() {} }, Application: () => systemEvents,
    $: { NSRunningApplication: { runningApplicationWithProcessIdentifier: () => ({ activateWithOptions() {} }) },
      NSApplicationActivateIgnoringOtherApps: 1 }, delay() {} });
  vm.runInContext(existingTaskScript, context);
  return { result: context.run([title]), clicked };
}

test('Cursor clicks only a unique complete title, never a substring or duplicate', () => {
  assert.deepEqual(runCursorScript(['Fix login styling'], 'Fix login'), { result: 'matches:0', clicked: [] });
  assert.deepEqual(runCursorScript(['Fix login', 'Fix login styling'], 'Fix login'),
    { result: 'found', clicked: ['Fix login'] });
  assert.deepEqual(runCursorScript(['Fix login', 'Fix login'], 'Fix login'), { result: 'matches:2', clicked: [] });
  assert.deepEqual(runCursorScript(['Prefix Fix login', 'Fix login suffix'], 'Fix login'),
    { result: 'matches:0', clicked: [] });
});
