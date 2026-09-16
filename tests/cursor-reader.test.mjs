import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCursorSnapshot } from '../core/cursor-reader.mjs';

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'aster-cursor-'));
  const home = join(root, '.cursor'), userData = join(root, 'User');
  mkdirSync(home); mkdirSync(userData);
  try { fn({ root, home, userData, now: 1_800_000_000_000 }); } finally { rmSync(root, { recursive: true, force: true }); }
}
function dbAt(file, table = 'cursorDiskKV') {
  mkdirSync(join(file, '..'), { recursive: true });
  const db = new DatabaseSync(file); db.exec(`CREATE TABLE ${table}(key TEXT PRIMARY KEY,value TEXT)`); return db;
}
function insert(db, key, value, table = 'cursorDiskKV') { db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(key, typeof value === 'string' ? value : JSON.stringify(value)); }
function transcript(home, id, data, ext = 'jsonl') {
  const dir = join(home, 'projects', 'project-slug', 'agent-transcripts'); mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.${ext}`); writeFileSync(file, typeof data === 'string' ? data : data.map(e => JSON.stringify(e)).join('\n')); return file;
}
test('Cursor IDE reads explicit states and public bubbles and maps only a known workspace', () => fixture(({ userData, home, root, now }) => {
  const db = dbAt(join(userData, 'globalStorage', 'state.vscdb'));
  const workspaceDir = join(userData, 'workspaceStorage', 'workspace');
  const workspace = dbAt(join(workspaceDir, 'state.vscdb'), 'ItemTable');
  try {
    writeFileSync(join(workspaceDir, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(join(root, 'My project')).href }));
    insert(workspace, 'composer.composerData', { allComposers: [{ composerId: 'live', name: 'Index title' }] }, 'ItemTable');
    insert(db, 'composerData:live', { composerId: 'live', name: 'Live task', status: 'generating', lastUpdatedAt: now, createdAt: now - 1000, fullConversationHeadersOnly: [{ type: 1, bubbleId: 'prompt' }, { type: 2, bubbleId: 'reply' }] });
    insert(db, 'bubbleId:live:reply', { type: 2, text: 'Public reply', thinking: 'PRIVATE_REASONING', toolResults: 'PRIVATE_TOOL_OUTPUT' });
    insert(db, 'bubbleId:live:prompt', { type: 1, text: 'PRIVATE_PROMPT' });
    insert(db, 'agentKv:private', { text: 'PRIVATE_AGENT_KV' });
    insert(db, 'composerData:done', { status: 'completed', lastUpdatedAt: now - 5000, conversation: [{ type: 1, text: 'PRIVATE_PROMPT' }, { type: 2, text: 'Finished public reply', thinking: 'PRIVATE_REASONING' }] });
    insert(db, 'composerData:resumed', { name: 'Resumed task', status: 'completed', generatingBubbleIds: ['current'], lastUpdatedAt: now });
    insert(db, 'composerData:bubble-live', { name: 'New schema live task', status: 'aborted', lastUpdatedAt: now - 5000, fullConversationHeadersOnly: [{ type: 2, bubbleId: 'active' }] });
    insert(db, 'bubbleId:bubble-live:active', { type: 2, startedAtMs: now - 1000, text: 'Working' });
    insert(db, 'composerData:bubble-done', { name: 'New schema done task', status: 'completed', lastUpdatedAt: now - 1000, fullConversationHeadersOnly: [{ type: 2, bubbleId: 'finished' }] });
    // Cursor may leave the final text bubble without its own terminal field; the
    // parent timestamp catching up proves that the bubble was committed.
    insert(db, 'bubbleId:bubble-done:finished', { type: 2, startedAtMs: now - 1000, text: 'Finished' });
    insert(db, 'composerData:enum', { name: 'Enum task', status: 2, lastUpdatedAt: now });
    insert(db, 'composerData:empty', { lastUpdatedAt: now });
    const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
    assert.equal(result.connected, true); assert.equal(result.error, null); assert.equal(result.tasks.length, 6);
    const live = result.tasks.find(t => t.nativeId === 'live');
    assert.equal(live.id, 'cursor:live'); assert.equal(live.provider, 'cursor'); assert.equal(live.source, 'ide'); assert.equal(live.status, 'running');
    assert.equal(live.title, 'Live task'); assert.equal(live.jumpTarget, null);
    assert.match(JSON.stringify(result), /Public reply/); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
    assert.equal(result.tasks.find(t => t.nativeId === 'done').status, 'completed');
    assert.equal(result.tasks.find(t => t.nativeId === 'resumed').status, 'running');
    assert.equal(result.tasks.find(t => t.nativeId === 'bubble-live').status, 'running');
    assert.equal(result.tasks.find(t => t.nativeId === 'bubble-live').updatedAt, now - 1000);
    assert.equal(result.tasks.find(t => t.nativeId === 'bubble-done').status, 'completed');
    assert.equal(result.tasks.find(t => t.nativeId === 'enum').status, 'unknown');
    assert.equal(result.tasks.find(t => t.nativeId === 'enum').jumpTarget, null);
    assert.equal(db.prepare('SELECT count(*) AS n FROM cursorDiskKV').get().n, 12);
  } finally { workspace.close(); db.close(); }
}));
test('Cursor stale generation is unconfirmed and empty or damaged records are not tasks', () => fixture(({ home, userData, now }) => {
  const db = dbAt(join(userData, 'globalStorage', 'state.vscdb'));
  try {
    insert(db, 'composerData:old', { generatingBubbleIds: ['bubble'], lastUpdatedAt: now - 900000 });
    insert(db, 'composerData:broken', '{partial:');
    insert(db, 'composerData:unrecognized', { status: { unexpected: true }, conversation: ['unknown shape'] });
    const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
    assert.equal(result.connected, true); assert.equal(result.error, null);
    assert.equal(result.tasks.find(t => t.nativeId === 'old').status, 'unconfirmed');
    assert.equal(result.tasks.find(t => t.nativeId === 'broken'), undefined);
    assert.equal(result.tasks.find(t => t.nativeId === 'unrecognized'), undefined);
    assert.equal(readCursorSnapshot({ home, userData, now, limit: 1, bridgeAvailable: false }).tasks.length, 1);
  } finally { db.close(); }
}));
test('Cursor selected and last-focused composer indexes map projects without inventing metadata', () => fixture(({ home, userData, root, now }) => {
  const db = dbAt(join(userData, 'globalStorage', 'state.vscdb'));
  const workspaceDir = join(userData, 'workspaceStorage', 'new-schema');
  const workspace = dbAt(join(workspaceDir, 'state.vscdb'), 'ItemTable');
  try {
    writeFileSync(join(workspaceDir, 'workspace.json'), JSON.stringify({ folder: pathToFileURL(join(root, 'Mapped project')).href }));
    insert(workspace, 'composer.composerData', { selectedComposerIds: ['selected', 'index-only', '', 42], lastFocusedComposerIds: ['focused', 'selected', { composerId: 'invalid' }] }, 'ItemTable');
    insert(db, 'composerData:selected', { name: 'Original title', lastUpdatedAt: now, status: 'completed' });
    insert(db, 'composerData:focused', { name: 'Focused title', lastUpdatedAt: now - 2000 });
    const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
    assert.equal(result.tasks.length, 3); assert.equal(result.error, null);
    for (const entry of result.tasks) assert.equal(entry.jumpTarget, null);
    assert.equal(result.tasks.find(t => t.nativeId === 'selected').title, 'Original title');
    const indexOnly = result.tasks.find(t => t.nativeId === 'index-only');
    assert.equal(indexOnly.status, 'unknown'); assert.equal(indexOnly.updatedAt, 0); assert.equal(indexOnly.startedAt, null);
  } finally { workspace.close(); db.close(); }
}));
test('Cursor CLI requires explicit result and excludes reasoning and tool outputs', () => fixture(({ home, userData, root, now }) => {
  const init = { type: 'system', subtype: 'init', timestamp_ms: now - 1000, cwd: join(root, 'project'), model: 'cursor-model' };
  transcript(home, 'done', [init, { type: 'assistant', message: { content: [{ type: 'text', text: 'Public text' }, { type: 'thinking', thinking: 'PRIVATE_REASONING' }] } }, { type: 'tool_call', subtype: 'completed', output: 'PRIVATE_OUTPUT' }, { type: 'result', subtype: 'success', timestamp_ms: now, is_error: false }]);
  transcript(home, 'plain', [{ type: 'assistant', message: { content: 'All done.' } }]);
  transcript(home, 'failed', [init, { type: 'result', subtype: 'error_max_turns', is_error: true, timestamp_ms: now }]);
  transcript(home, 'text', 'user:\nPRIVATE_PROMPT\nassistant:\nI finished.\n', 'txt');
  transcript(home, 'next-turn', [{ type: 'assistant', message: { content: 'PREVIOUS_TURN_COMPLETION' } }, { type: 'result', subtype: 'success', timestamp_ms: now - 1000 }, { type: 'user', message: { content: 'PRIVATE_NEW_PROMPT' }, timestamp_ms: now }, { type: 'assistant', message: { content: 'Working on the next request.' }, timestamp_ms: now }]);
  const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
  assert.equal(result.connected, true); assert.equal(result.tasks.length, 5);
  const done = result.tasks.find(t => t.nativeId === 'done');
  assert.equal(done.status, 'completed'); assert.equal(done.sourceLabel, 'Cursor · CLI'); assert.equal(done.jumpTarget, null);
  assert.equal(result.tasks.find(t => t.nativeId === 'failed').status, 'failed');
  assert.equal(result.tasks.find(t => t.nativeId === 'plain').status, 'unknown');
  assert.equal(result.tasks.find(t => t.nativeId === 'text').status, 'unknown');
  assert.equal(result.tasks.find(t => t.nativeId === 'next-turn').status, 'unknown');
  assert.match(JSON.stringify(result), /Public text/); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|PREVIOUS_TURN_COMPLETION/);
  assert.equal(result.tasks.find(t => t.nativeId === 'next-turn').events.length, 1);
}));
test('Cursor CLI tail tolerates truncation, large logs and symlink escapes', () => fixture(({ home, userData, root, now }) => {
  const init = JSON.stringify({ type: 'system', subtype: 'init', cwd: join(root, 'known-project') });
  transcript(home, 'large', `${init}\n${' '.repeat(220000)}\n${JSON.stringify({ type: 'result', subtype: 'success', timestamp_ms: now })}\n{"partial":`);
  const external = join(root, 'private.jsonl'); writeFileSync(external, JSON.stringify({ type: 'assistant', content: 'PRIVATE_EXTERNAL' }));
  symlinkSync(external, join(home, 'projects', 'project-slug', 'agent-transcripts', 'escape.jsonl'));
  const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
  assert.equal(result.tasks.length, 1); assert.equal(result.tasks[0].status, 'unknown');
  assert.equal(result.tasks[0].cwd, join(root, 'known-project')); assert.doesNotMatch(JSON.stringify(result), /PRIVATE_EXTERNAL/);
}));
test('Cursor unfinished final JSON clears stale terminal states but tolerates earlier damage and trailing whitespace', () => fixture(({ home, userData, now }) => {
  transcript(home, 'partial-failure', `${JSON.stringify({ type: 'result', subtype: 'error', is_error: true, timestamp_ms: now })}\n{"type":\n\n  `);
  transcript(home, 'valid-last', `{broken\n${JSON.stringify({ type: 'result', subtype: 'success', timestamp_ms: now })}\n\n  `);
  const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
  assert.equal(result.tasks.find(t => t.nativeId === 'partial-failure').status, 'unknown');
  assert.equal(result.tasks.find(t => t.nativeId === 'valid-last').status, 'completed');
}));
test('Cursor missing data is disconnected; damaged IDE does not block a valid CLI', () => fixture(({ home, userData, now }) => {
  assert.equal(readCursorSnapshot({ home, userData, now, bridgeAvailable: false }).connected, false);
  mkdirSync(join(userData, 'globalStorage')); writeFileSync(join(userData, 'globalStorage', 'state.vscdb'), 'broken database');
  transcript(home, 'valid', [{ type: 'result', subtype: 'success', timestamp_ms: now }]);
  const result = readCursorSnapshot({ home, userData, now, bridgeAvailable: false });
  assert.equal(result.connected, true); assert.equal(result.tasks[0].status, 'completed'); assert.match(result.error, /IDE/);
}));

test('only validated Cursor IDE composer IDs expose existing-window location', () => fixture(({ home, userData, now }) => {
  const db = dbAt(join(userData, 'globalStorage', 'state.vscdb'));
  const valid='12345678-1234-1234-1234-123456789abc';
  try {
    insert(db, `composerData:${valid}`, { name: 'Exact task', status: 'completed', lastUpdatedAt: now });
    insert(db, 'composerData:not-a-uuid', { name: 'Legacy task', status: 'completed', lastUpdatedAt: now - 1 });
    const tasks=new Map(readCursorSnapshot({ home, userData, now, bridgeAvailable: true }).tasks.map(task=>[task.nativeId,task]));
    assert.deepEqual(tasks.get(valid).jumpTarget,{kind:'cursor-session',label:'在原 Cursor 窗口定位'});
    assert.equal(tasks.get('not-a-uuid').jumpTarget,null);
  } finally { db.close(); }
}));
