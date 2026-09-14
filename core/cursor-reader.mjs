import { DatabaseSync } from 'node:sqlite';
import { opendirSync, openSync, closeSync, readSync, fstatSync, statSync, realpathSync } from 'node:fs';
import { basename, join, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveStatus } from './task-state.mjs';

const MAX_JSON = 8 * 1024 * 1024;
const TAIL_BYTES = 192 * 1024;
const short = (s, n = 180) => typeof s === 'string' ? s.slice(0, n) : '';
const parse = s => { try { return JSON.parse(s); } catch { return null; } };
const timestamp = v => {
  if (typeof v === 'string' && !/^\d+(\.\d+)?$/.test(v)) return Date.parse(v) || null;
  const n = Number(v); return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
};
const cwdPath = value => typeof value === 'string' && isAbsolute(value) && !value.includes('\0') ? value : '';
function entries(dir, limit = 160) {
  let handle; const result = [];
  try { handle = opendirSync(dir); for (let item; result.length < limit && (item = handle.readSync());) result.push(item); } catch {} finally { handle?.closeSync(); }
  return result;
}
function within(file, root) {
  try { return realpathSync(file).startsWith(realpathSync(root) + sep); } catch { return false; }
}
function readPart(file, root, tail = false, max = TAIL_BYTES) {
  if (!within(file, root)) return null;
  const fd = openSync(file, 'r');
  try {
    const stat = fstatSync(fd); if (!stat.isFile()) return null;
    const size = Math.min(stat.size, max), offset = tail ? stat.size - size : 0;
    const buf = Buffer.alloc(size); readSync(fd, buf, 0, size, offset);
    let text = buf.toString('utf8'); if (offset) text = text.slice(text.indexOf('\n') + 1);
    return { text, at: stat.mtimeMs, truncated: stat.size > size };
  } finally { closeSync(fd); }
}
function database(file, root) {
  if (!within(file, root)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try { db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 250;'); return db; } catch (error) { db.close(); throw error; }
}
// Unknown/numeric enums are intentionally not interpreted. A public reply alone is not completion.
function state(status, generating = false) {
  if (['completed', 'complete'].includes(status)) return { status: 'completed' };
  if (['failed', 'error'].includes(status)) return { status: 'failed' };
  if (['interrupted', 'aborted', 'cancelled', 'canceled'].includes(status)) return { status: 'interrupted' };
  if (generating || ['generating', 'inProgress', 'running', 'waitingForApproval', 'waitingForInput'].includes(status)) return { status: 'inProgress' };
  return null;
}
function task(id, source, meta, now) {
  const cwd = cwdPath(meta.cwd), turn = meta.turn ?? state(meta.status, meta.generating);
  const updatedAt = meta.updatedAt || 0;
  const resolved = resolveStatus(turn, updatedAt, now, ['waitingForApproval', 'waitingForInput'].includes(meta.status));
  return {
    id: `cursor:${id}`, nativeId: id, provider: 'cursor', source, sourceLabel: `Cursor · ${source === 'ide' ? 'IDE' : 'CLI'}`,
    title: short(meta.name || `Cursor ${source === 'ide' ? '任务' : 'CLI'} · ${id}`), project: cwd ? basename(cwd) : '无项目', cwd,
    model: short(meta.model || '默认模型'), status: resolved === 'waiting' ? (meta.status === 'waitingForApproval' ? 'approval' : 'input') : resolved,
    turnId: meta.turnId || null, startedAt: meta.startedAt || null, completedAt: turn && ['completed', 'failed', 'interrupted'].includes(turn.status) ? updatedAt : null,
    updatedAt, evidence: turn ? 'Cursor 显式状态记录' : '没有可确认的本轮状态', events: meta.events || [],
    ...(cwd ? { jumpTarget: { kind: 'project', app: 'Cursor', cwd } } : {}),
  };
}
// Only explicitly named public fields are selected. agentKv, thinking and tool results are never selected.
const safeJson = `CASE WHEN length(value) <= ${MAX_JSON} AND json_valid(value) THEN value ELSE '{}' END`;
function metadataQuery(table, condition) {
  return `SELECT key, json_extract(j,'$.composerId') AS composerId, substr(json_extract(j,'$.name'),1,180) AS name,
    json_extract(j,'$.status') AS status, json_extract(j,'$.createdAt') AS createdAt,
    json_extract(j,'$.lastUpdatedAt') AS lastUpdatedAt, json_array_length(j,'$.generatingBubbleIds') AS generating,
    substr(json_extract(j,'$.modelConfig.modelName'),1,180) AS model FROM (SELECT key, ${safeJson} AS j FROM ${table} WHERE ${condition})`;
}
function workspaceIndex(userData, warnings) {
  const index = new Map(); let found = false;
  const root = join(userData, 'workspaceStorage');
  for (const dir of entries(root)) {
    if (!dir.isDirectory()) continue;
    const folder = join(root, dir.name), file = join(folder, 'state.vscdb'); let db;
    try {
      db = database(file, root); if (!db) continue;
      const record = db.prepare("SELECT 1 FROM ItemTable WHERE key='composer.composerData' LIMIT 1").get();
      if (!record) continue; found = true;
      const workspace = parse(readPart(join(folder, 'workspace.json'), root, false, 32 * 1024)?.text);
      let cwd = ''; try { if (workspace?.folder?.startsWith('file:')) cwd = cwdPath(fileURLToPath(workspace.folder)); } catch {}
      // allComposers is an index, not the full conversation store.
      const rows = db.prepare(`SELECT substr(json_extract(c.value,'$.composerId'),1,256) AS composerId,
        substr(json_extract(c.value,'$.name'),1,180) AS name, json_extract(c.value,'$.createdAt') AS createdAt,
        json_extract(c.value,'$.lastUpdatedAt') AS lastUpdatedAt FROM ItemTable, json_each(${safeJson.replaceAll('value', 'ItemTable.value')},'$.allComposers') c
        WHERE ItemTable.key='composer.composerData' AND c.type='object' LIMIT 160`).all();
      for (const row of rows) if (row.composerId) index.set(row.composerId, { ...row, cwd });
      const selectedIds = db.prepare(`SELECT c.value AS composerId FROM ItemTable,
        json_each(${safeJson.replaceAll('value', 'ItemTable.value')},?) c
        WHERE ItemTable.key='composer.composerData' AND c.type='text' AND length(c.value) BETWEEN 1 AND 256 LIMIT 160`);
      for (const path of ['$.selectedComposerIds', '$.lastFocusedComposerIds']) {
        for (const { composerId } of selectedIds.all(path)) index.set(composerId, { ...index.get(composerId), cwd });
      }
    } catch { warnings.add('部分 Cursor 工作区记录无法读取'); } finally { db?.close(); }
  }
  return { index, found };
}
function publicEvents(db, id) {
  const key = `composerData:${id}`;
  const events = db.prepare(`SELECT substr(json_extract(c.value,'$.text'),1,900) AS text,
    json_extract(c.value,'$.createdAt') AS at FROM cursorDiskKV, json_each(${safeJson.replaceAll('value', 'cursorDiskKV.value')},'$.conversation') c
    WHERE cursorDiskKV.key=? AND c.type='object' AND json_extract(c.value,'$.type')=2 ORDER BY CAST(c.key AS INTEGER) DESC LIMIT 5`).all(key)
    .filter(r => r.text).map(r => ({ label: '公开回复', kind: 'message', text: r.text, at: timestamp(r.at) }));
  if (events.length) return events;
  const headers = db.prepare(`SELECT substr(json_extract(c.value,'$.bubbleId'),1,256) AS id FROM cursorDiskKV,
    json_each(${safeJson.replaceAll('value', 'cursorDiskKV.value')},'$.fullConversationHeadersOnly') c
    WHERE cursorDiskKV.key=? AND c.type='object' AND json_extract(c.value,'$.type')=2 ORDER BY CAST(c.key AS INTEGER) DESC LIMIT 5`).all(key);
  const bubble = db.prepare(`SELECT substr(json_extract(j,'$.text'),1,900) AS text, json_extract(j,'$.createdAt') AS at
    FROM (SELECT ${safeJson} AS j FROM cursorDiskKV WHERE key=?) WHERE json_extract(j,'$.type')=2`);
  for (const header of headers) {
    if (!header.id) continue; const row = bubble.get(`bubbleId:${id}:${header.id}`);
    if (row?.text) events.push({ label: '公开回复', kind: 'message', text: row.text, at: timestamp(row.at) });
  }
  return events;
}
function readIde(userData, now, limit, warnings) {
  const { index, found } = workspaceIndex(userData, warnings), tasks = []; let connected = found, db;
  try {
    db = database(join(userData, 'globalStorage', 'state.vscdb'), userData);
    if (db) {
      const rows = db.prepare(`${metadataQuery('cursorDiskKV', "key GLOB 'composerData:*'")} ORDER BY CAST(lastUpdatedAt AS REAL) DESC LIMIT ?`).all(limit);
      connected = true;
      for (const row of rows) {
        const id = row.key.slice('composerData:'.length); if (!id || id.length > 256) continue;
        const workspace = index.get(id);
        tasks.push(task(id, 'ide', { ...workspace, ...row, updatedAt: timestamp(row.lastUpdatedAt || workspace?.lastUpdatedAt || row.createdAt), startedAt: timestamp(row.createdAt), generating: row.generating > 0, events: publicEvents(db, id) }, now));
        index.delete(id);
      }
    }
  } catch { warnings.add('部分 Cursor IDE 记录无法读取'); } finally { db?.close(); }
  for (const [id, meta] of index) { if (tasks.length >= limit) break; tasks.push(task(id, 'ide', { ...meta, updatedAt: timestamp(meta.lastUpdatedAt || meta.createdAt) }, now)); }
  return { tasks, connected };
}
function publicText(event) {
  if (event.type !== 'assistant' && event.role !== 'assistant') return '';
  const content = event.message?.content ?? event.content;
  if (typeof content === 'string') return short(content, 900);
  if (Array.isArray(content)) return short(content.filter(x => x?.type === 'text' && typeof x.text === 'string').map(x => x.text).join('\n'), 900);
  return '';
}
function readTranscript(file, home, now) {
  const tail = readPart(file, home, true); if (!tail) return null;
  const id = basename(file).replace(/\.(jsonl|txt)$/i, '');
  const meta = { updatedAt: tail.at, events: [] };
  if (file.endsWith('.jsonl')) {
    // The prefix can identify the workspace even when initialization has fallen outside the tail.
    const head = readPart(file, home, false, 16 * 1024);
    for (const line of head.text.split('\n')) { const e = parse(line); if (e?.type === 'system' && e.subtype === 'init') { meta.cwd = cwdPath(e.cwd); meta.model = short(e.model); break; } }
    let lastLineInvalid = false;
    for (const line of tail.text.split('\n')) {
      if (!line.trim()) continue;
      const e = parse(line);
      lastLineInvalid = !e || typeof e !== 'object' || Array.isArray(e);
      if (lastLineInvalid) continue;
      const at = timestamp(e.timestamp ?? e.timestamp_ms) || tail.at;
      // A new prompt invalidates an older terminal marker, but does not itself prove execution.
      if (e.type === 'user' || e.role === 'user') { meta.turn = null; meta.events = []; }
      if (e.type === 'system' && e.subtype === 'init') { meta.turn = { status: 'inProgress' }; meta.startedAt = at; meta.cwd = cwdPath(e.cwd) || meta.cwd; }
      if (e.type === 'result') {
        if (e.is_error === true || (typeof e.subtype === 'string' && e.subtype.startsWith('error'))) meta.turn = { status: 'failed' };
        else if (e.subtype === 'success' && e.is_error !== true) meta.turn = { status: 'completed' };
      }
      // Cursor stream-json tool calls contain lifecycle markers; ignore tool inputs and outputs.
      if (e.type === 'tool_call' && e.subtype === 'started') meta.turn = { status: 'inProgress' };
      const text = publicText(e); if (text) { meta.events.push({ label: '公开回复', kind: 'message', text, at }); meta.events = meta.events.slice(-5); }
      if (['system', 'result', 'tool_call', 'assistant', 'user'].includes(e.type)) meta.updatedAt = at;
    }
    if (lastLineInvalid && ['completed', 'failed', 'interrupted'].includes(meta.turn?.status)) meta.turn = null;
    meta.events.reverse();
  }
  // Text transcripts have no documented lifecycle markers. Do not classify their prose.
  return task(id, 'cli', meta, now);
}
export function readCursorSnapshot({ home = process.env.CURSOR_HOME || join(homedir(), '.cursor'), userData = join(homedir(), 'Library', 'Application Support', 'Cursor', 'User'), now = Date.now(), limit = 80 } = {}) {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(160, Math.floor(limit))) : 80;
  const base = { tasks: [], connected: false, error: null, checkedAt: now, source: 'cursor', sourceLabel: 'Cursor', limit };
  const warnings = new Set(); const ide = readIde(userData, now, limit, warnings), tasks = [...ide.tasks];
  const root = join(home, 'projects'), files = []; let connected = ide.connected;
  for (const dir of entries(root)) {
    if (!dir.isDirectory()) continue;
    const transcripts = join(root, dir.name, 'agent-transcripts');
    for (const item of entries(transcripts)) {
      if (!item.isFile() || !/\.(jsonl|txt)$/.test(item.name)) continue;
      const file = join(transcripts, item.name); if (!within(file, home)) continue;
      try { files.push({ file, at: statSync(file).mtimeMs }); } catch {}
      if (files.length >= 640) break;
    }
    if (files.length >= 640) break;
  }
  for (const { file } of files.sort((a, b) => b.at - a.at).slice(0, limit)) {
    try { const entry = readTranscript(file, home, now); if (entry) { connected = true; tasks.push(entry); } } catch { warnings.add('部分 Cursor CLI 记录无法读取'); }
  }
  const unique = new Map(); for (const entry of tasks.sort((a, b) => b.updatedAt - a.updatedAt)) if (!unique.has(entry.id)) unique.set(entry.id, entry);
  return { ...base, connected, tasks: [...unique.values()].slice(0, limit), error: warnings.size ? [...warnings].join('；') : connected ? null : '未找到可读取的 Cursor IDE 或 CLI 任务记录。' };
}
