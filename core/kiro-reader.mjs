import { opendirSync, openSync, closeSync, readSync, fstatSync, statSync, constants } from 'node:fs';
import { join, basename, dirname, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { resolveStatus } from './task-state.mjs';
import { isKiroSessionId } from './kiro-session.mjs';

// Observed formats, not a stable public API:
// github.com/getagentseal/codeburn/blob/68ce480ec1f4e00c93777a9ca248349a4e6d3eea/docs/providers/kiro.md
// github.com/junhoyeo/tokscale/pull/847
// zenn.dev/zenogawa/articles/kiro-cli-credit (turn_end.stopReason = end_turn)
const short = (v, n = 180) => typeof v === 'string' ? v.slice(0, n) : '';
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
function time(v) {
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
function stat(path) { try { return statSync(path); } catch { return null; } }
function read(path, max, budget, tail = false) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = fstatSync(fd);
    if (!info.isFile() || (!tail && info.size > max)) return null;
    const size = Math.min(info.size, max);
    if (size > budget.bytes) return null;
    budget.bytes -= size;
    const start = tail ? info.size - size : 0;
    const buffer = Buffer.alloc(size);
    const count = readSync(fd, buffer, 0, size, start);
    let text = buffer.subarray(0, count).toString('utf8');
    if (start) {
      const newline = text.indexOf('\n');
      text = newline < 0 ? '' : text.slice(newline + 1);
    }
    return { text, at: info.mtimeMs, truncated: start > 0, complete: count === size };
  } catch { return null; } finally { if (fd !== undefined) closeSync(fd); }
}
function json(path, max, budget) {
  const file = read(path, max, budget);
  if (!file) return null;
  try { return { ...file, value: object(JSON.parse(file.text)) }; } catch { return null; }
}
function walk(root, depth, visit, budget) {
  if (depth < 0 || budget.entries <= 0) return;
  let dir;
  try {
    dir = opendirSync(root);
    let entry;
    while (budget.entries-- > 0 && (entry = dir.readSync())) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) walk(path, depth - 1, visit, budget);
      else if (entry.isFile()) visit(path);
    }
  } catch { /* Missing or concurrently removed directories are expected. */ }
  finally { dir?.closeSync(); }
}
function cwdFrom(meta) {
  const candidates = [meta.cwd, meta.workspacePath, meta.workspaceRoot, meta.workingDirectory, ...(Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [])];
  for (let path of candidates) {
    if (typeof path !== 'string' || path.length > 4096 || path.includes('\0')) continue;
    if (path.startsWith('file:')) { try { path = fileURLToPath(path); } catch { continue; } }
    if (isAbsolute(path) && stat(path)?.isDirectory()) return path;
  }
  return '';
}
function sessionSource(meta, fallback) {
  // Both IDE and newer CLI clients use sess_* directories. Only explicit
  // client identity distinguishes them; directory shape is not evidence.
  const found = new Set();
  for (const value of [meta.origin, meta.source, meta.client, meta.entrypoint]) {
    const identity = typeof value === 'string' ? value : object(value).type || object(value).name;
    if (typeof identity !== 'string') continue;
    const name = identity.trim().toLowerCase();
    if (['cli', 'kiro-cli', 'kiro_cli'].includes(name)) found.add('cli');
    if (['ide', 'kiro-ide', 'kiro_ide'].includes(name)) found.add('ide');
  }
  return found.size === 1 ? [...found][0] : found.size > 1 ? 'local' : fallback;
}
function transcript(path, budget) {
  let file = read(path, 192 * 1024, budget, true);
  if (!file) return { turn: null, latestAt: 0, events: [], invalid: false, empty: false };
  // Recover the user/terminal boundary when a long reply pushes it out of the
  // usual tail. Keep both per-session and whole-snapshot reads bounded.
  const hasBoundary = text => text.split('\n').some(line => {
    try { return ['user', 'turn_end'].includes(JSON.parse(line)?.payload?.type); } catch { return false; }
  });
  if (file.truncated && !hasBoundary(file.text)) {
    const recoveryBytes = Math.min(2 * 1024 * 1024, budget.bytes);
    if (recoveryBytes > 192 * 1024) file = read(path, recoveryBytes, budget, true) || file;
  }
  let turn = null, latestAt = 0, invalid = false;
  const events = [];
  for (const line of file.text.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); invalid = false; } catch { invalid = true; continue; }
    // CLI {version,kind,data} journals have a different contract. Do not guess
    // their lifecycle from role tags, metering records, or assistant text.
    const p = object(entry?.payload);
    const at = time(entry?.timestamp);
    const eventAt = at || file.at;
    const id = short(entry?.id, 200);
    if (p.type === 'user') {
      latestAt = Math.max(latestAt, eventAt);
      turn = { status: 'inProgress', turn_id: short(p.executionId, 200) || id || null, started_at: at };
      events.length = 0;
      events.push({ label: '收到新消息', text: '', kind: 'tool', at: eventAt });
    } else if ((p.type === 'assistant' || p.type === 'tool_call') && turn?.status === 'inProgress') {
      // Kiro may append tool records while restoring or viewing an old session.
      // They extend only a turn whose user event was observed in this bounded
      // journal range; they never invent a new running turn by themselves.
      latestAt = Math.max(latestAt, eventAt);
      events.push({ label: p.type === 'tool_call' ? '调用工具' : '回复更新', text: '', kind: 'tool', at: eventAt });
    } else if (p.type === 'turn_end') {
      latestAt = Math.max(latestAt, eventAt);
      // A terminal event alone is insufficient: error/cancellation can also end
      // a turn. Unsupported stop reasons deliberately remain unknown.
      const status = p.stopReason === 'end_turn' ? 'completed' : 'unknown';
      turn = { ...turn, status, turn_id: turn?.turn_id || short(p.executionId, 200) || id || null, completed_at: at };
      events.push({ label: status === 'completed' ? '本轮结束' : '本轮结束，结果未确认', text: '', kind: 'tool', at: eventAt });
    }
    if (events.length > 5) events.shift();
  }
  // A partially written final record may be a newer user turn. Never expose
  // a previous completed state as the current state while that is ambiguous.
  if (invalid || !file.complete) turn = null;
  return { turn, latestAt: latestAt || file.at, events: events.reverse(), invalid,
    empty: file.complete && !file.truncated && !file.text.trim() };
}

export function readKiroSnapshot({ home = process.env.KIRO_HOME || join(homedir(), '.kiro'), userData = join(homedir(), 'Library/Application Support/Kiro/User'), now = Date.now(), limit = 80 } = {}) {
  limit = Number.isFinite(limit) ? Math.max(1, Math.min(160, Math.floor(limit))) : 80;
  const base = { tasks: [], connected: false, error: null, checkedAt: now, source: 'kiro', sourceLabel: 'Kiro', limit };
  const sessionRoot = join(home, 'sessions');
  const legacyRoot = join(userData, 'globalStorage/kiro.kiroagent');
  if (!stat(sessionRoot)?.isDirectory() && !stat(legacyRoot)?.isDirectory()) return { ...base, error: '未找到本机 Kiro 会话记录。' };
  const budget = { entries: 6000, bytes: 12 * 1024 * 1024 };
  const candidates = [];
  const add = (path, source, format, journal) => {
    const info = stat(path);
    if (!info?.isFile()) return;
    const at = Math.max(info.mtimeMs, journal ? stat(journal)?.mtimeMs || 0 : 0);
    candidates.push({ path, source, format, journal, at });
  };
  walk(sessionRoot, 2, path => {
    if (basename(path) === 'session.json' && basename(dirname(path)).startsWith('sess_')) add(path, 'local', 'v2', join(dirname(path), 'messages.jsonl'));
    else if (dirname(path) === join(sessionRoot, 'cli') && path.endsWith('.json')) add(path, 'cli', 'cli', path.slice(0, -5) + '.jsonl');
    else if (dirname(path) === join(sessionRoot, 'cli') && path.endsWith('.jsonl') && !stat(path.slice(0, -1))) add(path, 'cli', 'journal', path);
  }, budget);
  walk(legacyRoot, 4, path => { if (path.endsWith('.chat')) add(path, 'ide', 'legacy'); }, budget);
  candidates.sort((a, b) => b.at - a.at);
  const tasks = new Map();
  for (const candidate of candidates.slice(0, limit * 2)) {
    const file = candidate.format === 'journal' ? { value: {}, at: candidate.at } : json(candidate.path, candidate.format === 'legacy' ? 2 * 1024 * 1024 : 512 * 1024, budget);
    if (!file) continue;
    const raw = file.value;
    const meta = { ...object(raw.metadata), ...object(raw.session_state), ...raw };
    const fallback = candidate.format === 'v2' ? basename(dirname(candidate.path)) : basename(candidate.path).replace(/\.(chat|jsonl?)$/, '');
    const nativeId = short(meta.sessionId || meta.session_id || meta.id || meta.executionId || fallback, 200);
    if (!nativeId) continue;
    const state = candidate.journal ? transcript(candidate.journal, budget) : { turn: null, latestAt: 0, events: [] };
    const cwd = cwdFrom(meta);
    const source = candidate.format === 'v2' ? sessionSource(meta, candidate.source) : candidate.source;
    const evidenceAt = Math.max(time(meta.updatedAt) || time(meta.updated_at) || 0, state.latestAt);
    const updatedAt = evidenceAt || candidate.at;
    const title = short(meta.title || meta.name).trim();
    // Kiro persists blank tabs as untitled session records. They are UI shells,
    // not tasks, until a user event creates a real turn.
    if (candidate.format === 'v2' && /^(new session|新会话)$/i.test(title) && state.empty) continue;
    const task = {
      id: `kiro:${nativeId}`, nativeId, provider: 'kiro', source,
      sourceLabel: `Kiro · ${{ cli: 'CLI', ide: 'IDE', local: '本地' }[source]}`,
      title: title || 'Kiro 会话', project: cwd ? basename(cwd) : '无项目', cwd,
      model: short(meta.modelId || meta.model, 100) || '默认模型',
      status: resolveStatus(state.turn, state.latestAt, now), turnId: state.turn?.turn_id || null,
      startedAt: state.turn?.started_at || null, completedAt: state.turn?.completed_at || null, updatedAt,
      evidence: state.turn ? 'Kiro 本地会话事件' : state.invalid ? '最新记录尚未写入完整' : '仅有会话记录，没有可确认的本轮状态',
      events: state.events,
      jumpTarget: source !== 'cli' && isKiroSessionId(nativeId) ? { kind: 'kiro-session', label: '在原 Kiro 窗口定位' } : null
    };
    if (!tasks.has(task.id) || tasks.get(task.id).updatedAt < updatedAt) tasks.set(task.id, task);
  }
  const result = [...tasks.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  return { ...base, connected: true, tasks: result, error: candidates.length && !result.length ? 'Kiro 记录暂时无法读取，或格式尚未支持。' : null };
}
