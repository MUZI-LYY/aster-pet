import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { readKiroSnapshot } from '../core/kiro-reader.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aster-kiro-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home'), userData = join(root, 'User'), cwd = join(root, 'project');
  mkdirSync(cwd);
  const now = Date.now();
  const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value)); return path; };
  const event = (type, payload = {}, age = 0) => ({ id: `${type}-${age}`, timestamp: new Date(now - age).toISOString(), payload: { type, ...payload } });
  const session = (id, events = [], metadata = {}) => {
    const dir = join(home, 'sessions', 'workspace-hash', id);
    write(join(dir, 'session.json'), { sessionId: id, title: 'Kiro task', modelId: 'claude-sonnet', workspacePaths: [cwd], ...metadata });
    write(join(dir, 'messages.jsonl'), events.map(e => typeof e === 'string' ? e : JSON.stringify(e)).join('\n') + '\n');
    return dir;
  };
  return { root, home, userData, cwd, now, write, event, session, read: (extra = {}) => readKiroSnapshot({ home, userData, now, bridgeAvailable: false, ...extra }) };
}

test('v2 lifecycle requires an explicit successful turn_end and returns no transcript content', t => {
  const f = fixture(t);
  const dir = f.session('sess_main', [f.event('user', { content: 'PRIVATE_PROMPT' }, 20), f.event('assistant', { content: 'PRIVATE_REASONING' }, 10), f.event('tool_call', { input: 'SECRET_COMMAND', output: 'SECRET_OUTPUT' })]);
  const before = f.read();
  assert.equal(before.tasks[0].status, 'running');
  assert.equal(before.tasks[0].id, 'kiro:sess_main');
  assert.equal(before.tasks[0].provider, 'kiro');
  assert.equal(before.tasks[0].source, 'local');
  assert.equal(before.tasks[0].sourceLabel, 'Kiro · 本地');
  assert.equal(before.tasks[0].model, 'claude-sonnet');
  assert.deepEqual(before.tasks[0].jumpTarget, { kind: 'kiro-session', label: '在原 Kiro 窗口定位' });
  assert.doesNotMatch(JSON.stringify(before), /PRIVATE|SECRET/);
  const journal = join(dir, 'messages.jsonl');
  f.write(journal, readFileSync(journal, 'utf8') + JSON.stringify(f.event('turn_end', { stopReason: 'end_turn', executionId: 'exec-1' })) + '\n');
  assert.equal(f.read().tasks[0].status, 'completed');
  assert.equal(f.read().tasks[0].turnId, before.tasks[0].turnId);
});

test('unsupported or missing end reason does not become completed; a new prompt supersedes completion', t => {
  const f = fixture(t);
  f.session('sess_failed', [f.event('turn_end', { stopReason: 'error' })]);
  f.session('sess_missing', [f.event('turn_end')]);
  f.session('sess_new', [f.event('turn_end', { stopReason: 'end_turn' }, 10), f.event('user')]);
  const tasks = new Map(f.read().tasks.map(task => [task.nativeId, task]));
  assert.equal(tasks.get('sess_failed').status, 'unknown');
  assert.equal(tasks.get('sess_missing').status, 'unknown');
  assert.equal(tasks.get('sess_new').status, 'running');
});

test('viewing a session cannot turn orphan tool activity into a running task', t => {
  const f = fixture(t);
  f.session('sess_viewed', [f.event('tool_call'), f.event('assistant')]);
  f.session('sess_done', [f.event('user', {}, 20), f.event('turn_end', { stopReason: 'end_turn' }, 10), f.event('tool_call')]);
  const tasks = new Map(f.read().tasks.map(task => [task.nativeId, task]));
  assert.equal(tasks.get('sess_viewed').status, 'unknown');
  assert.equal(tasks.get('sess_done').status, 'completed');
  assert.ok(tasks.get('sess_done').updatedAt < f.now);
});

test('blank New Session shells are hidden until a user starts a real turn', t => {
  const f = fixture(t);
  f.session('sess_blank', [], { title: 'New Session' });
  f.session('sess_real', [f.event('user')], { title: 'New Session' });
  assert.deepEqual(f.read().tasks.map(task => task.nativeId), ['sess_real']);
  assert.equal(f.read().tasks[0].status, 'running');
});

test('old activity is unconfirmed regardless of freshly modified session metadata', t => {
  const f = fixture(t);
  f.session('sess_old', [f.event('user', {}, 300_000), f.event('assistant', {}, 290_000), f.event('session_metadata')]);
  assert.equal(f.read().tasks[0].status, 'unconfirmed');
});

test('partial last event cannot leave an old completed state, and later valid append recovers', t => {
  const f = fixture(t);
  const dir = f.session('sess_partial', [f.event('turn_end', { stopReason: 'end_turn' }), '{"payload":']);
  assert.equal(f.read().tasks[0].status, 'unknown');
  f.write(join(dir, 'messages.jsonl'), JSON.stringify(f.event('user')) + '\n');
  assert.equal(f.read().tasks[0].status, 'running');
});

test('legacy .chat and CLI journals expose metadata without inventing lifecycle', t => {
  const f = fixture(t);
  const chat = f.write(join(f.userData, 'globalStorage', 'kiro.kiroagent', 'hash', 'legacy.chat'), { executionId: 'legacy', metadata: { title: 'Legacy', workspacePath: f.cwd }, chat: [{ role: 'assistant', content: 'PRIVATE_REPLY' }] });
  const original = readFileSync(chat, 'utf8');
  f.write(join(f.home, 'sessions', 'cli', 'cli-1.json'), { session_id: 'cli-1', title: 'CLI task', session_state: { cwd: f.cwd, metering_usage: [{ content: 'PRIVATE_METERING' }] } });
  f.write(join(f.home, 'sessions', 'cli', 'cli-1.jsonl'), JSON.stringify({ version: 1, kind: 'assistant', data: { text: 'PRIVATE_CLI' } }));
  f.write(join(f.home, 'sessions', 'cli', 'orphan.jsonl'), JSON.stringify({ version: 1, kind: 'user', data: { text: 'PRIVATE_PROMPT' } }));
  const snapshot = f.read();
  assert.equal(snapshot.tasks.length, 3);
  assert.ok(snapshot.tasks.every(task => task.status === 'unknown'));
  assert.equal(snapshot.tasks.find(task => task.nativeId === 'cli-1').sourceLabel, 'Kiro · CLI');
  assert.equal(snapshot.tasks.find(task => task.nativeId === 'cli-1').jumpTarget, null);
  assert.equal(snapshot.tasks.find(task => task.nativeId === 'legacy').jumpTarget, null);
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE/);
  assert.equal(readFileSync(chat, 'utf8'), original);
});

test('missing source disconnects; invalid metadata, absent paths and unsupported formats remain conservative', t => {
  const f = fixture(t);
  assert.equal(f.read().connected, false);
  f.session('sess_nopath', [], { workspacePaths: [join(f.root,'missing-project')], cwd: 'relative-path' });
  f.write(join(f.home, 'sessions', 'hash', 'sess_broken', 'session.json'), '{');
  const snapshot = f.read();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].status, 'unknown');
  assert.deepEqual(snapshot.tasks[0].jumpTarget, { kind: 'kiro-session', label: '在原 Kiro 窗口定位' });
});

test('v2 directory does not identify its client; only explicit metadata distinguishes IDE and CLI', t => {
  const f = fixture(t);
  f.session('sess_cli', [], { origin: 'cli' });
  f.session('sess_ide', [], { client: { name: 'kiro-ide' } });
  f.session('sess_entrypoint', [], { entrypoint: 'kiro-cli' });
  f.session('sess_source', [], { source: { type: 'cli' } });
  f.session('sess_unknown', [], { origin: 'unknown-client' });
  f.session('sess_conflict', [], { origin: 'cli', source: 'ide' });
  const tasks = new Map(f.read().tasks.map(task => [task.nativeId, task]));
  for (const id of ['sess_cli', 'sess_entrypoint', 'sess_source']) {
    assert.equal(tasks.get(id).source, 'cli');
    assert.equal(tasks.get(id).sourceLabel, 'Kiro · CLI');
  }
  assert.equal(tasks.get('sess_ide').source, 'ide');
  assert.equal(tasks.get('sess_ide').sourceLabel, 'Kiro · IDE');
  assert.equal(tasks.get('sess_unknown').source, 'local');
  assert.equal(tasks.get('sess_conflict').source, 'local');
});

test('validated IDE sessions expose existing-window location but CLI journals do not', t => {
  const f = fixture(t);
  f.session('sess_bridge', [], { origin: 'ide' });
  f.write(join(f.home, 'sessions', 'cli', 'sess_cli.json'), { session_id: 'sess_cli', session_state: { cwd: f.cwd } });
  const tasks = new Map(f.read({ bridgeAvailable: true }).tasks.map(task => [task.nativeId, task]));
  assert.deepEqual(tasks.get('sess_bridge').jumpTarget, { kind: 'kiro-session', label: '在原 Kiro 窗口定位' });
  assert.equal(tasks.get('sess_cli').jumpTarget, null);
});

test('tail reads are bounded, ignore truncated leading JSON and retain real last events', t => {
  const f = fixture(t);
  const dir = f.session('sess_big');
  f.write(join(dir, 'messages.jsonl'), JSON.stringify(f.event('assistant', { content: 'PRIVATE'.repeat(60_000) })) + '\n' + JSON.stringify(f.event('turn_end', { stopReason: 'end_turn' })) + '\n');
  assert.equal(f.read().tasks[0].status, 'completed');
  const huge = f.write(join(f.home, 'sessions', 'hash', 'sess_huge', 'session.json'), JSON.stringify({ title: 'a'.repeat(600_000) }));
  assert.ok(f.read().tasks.every(task => task.nativeId !== 'sess_huge'));
  assert.ok(readFileSync(huge).length > 512 * 1024);
});

test('limit sorts newest sessions and discovery does not follow symlinked sessions', t => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) {
    const dir = f.session(`sess_${i}`);
    const when = new Date(f.now - (4 - i) * 10_000);
    utimesSync(join(dir, 'session.json'), when, when);
    utimesSync(join(dir, 'messages.jsonl'), when, when);
  }
  const outside = join(f.root, 'outside');
  f.write(join(outside, 'session.json'), { sessionId: 'SECRET_SYMLINK' });
  symlinkSync(outside, join(f.home, 'sessions', 'workspace-hash', 'sess_link'));
  const snapshot = readKiroSnapshot({ home: f.home, userData: f.userData, now: f.now, limit: 2 });
  assert.deepEqual(snapshot.tasks.map(task => task.nativeId), ['sess_3', 'sess_2']);
});

test('long active journals recover the user boundary outside the normal tail, including New Session', t => {
  const f = fixture(t);
  for (const [id, title] of [['sess_long_named', 'Long task'], ['sess_long_default', 'New Session']]) {
    f.session(id, [
      f.event('user', { executionId: 'exec-live' }, 20),
      f.event('assistant', { content: 'PRIVATE'.repeat(40_000) }, 10),
      f.event('tool_call'),
    ], { title });
  }
  const tasks = f.read().tasks;
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(task => task.status === 'running' && task.turnId === 'exec-live'));
  assert.doesNotMatch(JSON.stringify(tasks), /PRIVATE/);
});

test('journals beyond the recovery cap remain visible without inventing running state', t => {
  const f = fixture(t);
  f.session('sess_beyond_cap', [
    f.event('user', { executionId: 'exec-live' }, 20),
    f.event('assistant', { content: 'x'.repeat(3 * 1024 * 1024) }, 10),
    f.event('tool_call'),
  ], { title: 'New Session' });
  const task = f.read().tasks[0];
  assert.equal(task?.nativeId, 'sess_beyond_cap');
  assert.equal(task.status, 'unknown');
});

test('only completely read empty journals prove blank shells; unavailable and orphan records remain visible', t => {
  const f = fixture(t);
  const unavailable = f.session('sess_unavailable', [], { title: 'New Session' });
  rmSync(join(unavailable, 'messages.jsonl'));
  f.session('sess_orphan_default', [f.event('tool_call')], { title: 'New Session' });
  f.session('sess_empty_default', [], { title: 'New Session' });
  f.session('sess_partial_default', ['{"payload":'], { title: 'New Session' });
  const tasks = f.read().tasks;
  assert.deepEqual(tasks.map(task => task.nativeId).sort(), ['sess_orphan_default', 'sess_partial_default', 'sess_unavailable']);
  assert.ok(tasks.every(task => task.status === 'unknown'));
});

test('recovery finds a completed boundary without treating later restoration tools as a new turn', t => {
  const f = fixture(t);
  f.session('sess_restored_long', [
    f.event('user', {}, 30), f.event('turn_end', { stopReason: 'end_turn' }, 20),
    f.event('assistant', { content: 'x'.repeat(240_000) }, 10), f.event('tool_call'),
  ], { title: 'New Session' });
  assert.equal(f.read().tasks[0]?.status, 'completed');
});
