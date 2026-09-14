import { DatabaseSync } from 'node:sqlite';
import { readdirSync, existsSync, openSync, closeSync, readSync, fstatSync, realpathSync } from 'node:fs';
import { join, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { resolveStatus } from './task-state.mjs';
import { userRequest } from './user-request.mjs';
import { cumulativeTokens, codexTokens } from './token-usage.mjs';

const short = (value, length = 300) => typeof value === 'string' ? value.slice(0, length) : '';
const ms = v => !v ? null : v < 1e12 ? v * 1000 : v;
function latestDb(home, prefix) {
  return readdirSync(home).filter(n => new RegExp(`^${prefix}_\\d+\\.sqlite$`).test(n))
    .sort((a,b) => Number(b.match(/_(\d+)\.sqlite$/)[1]) - Number(a.match(/_(\d+)\.sqlite$/)[1]))[0];
}
function readDb(home, prefix) {
  const file = latestDb(home, prefix);
  if (!file) return null;
  const db = new DatabaseSync(join(home, file), { readOnly: true });
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1500;');
  return db;
}
function activity(item) {
  const titles = { commandExecution: '执行命令', fileChange: '修改文件', mcpToolCall: '调用工具', webSearch: '检索资料', plan: '更新计划', userMessage: '收到新消息' };
  if (item.type === 'reasoning') return null;
  if (item.type === 'agentMessage') return { label: item.phase === 'final_answer' ? '本轮回复' : '进度更新', text: short(item.text, 900), kind: 'message' };
  return { label: titles[item.type] ?? '任务活动', text: short(item.tool ?? (item.type === 'commandExecution' ? item.command : '') ?? '', 180), kind: 'tool' };
}
// Legacy logs are read from their tail only. A missing start/end marker stays unknown.
export function legacyTail(path, home) {
  if (!path || !existsSync(path)) return null;
  const real = realpathSync(path);
  if (!real.startsWith(realpathSync(home) + sep)) return null;
  const fd = openSync(real, 'r');
  try {
    const stat = fstatSync(fd), size = Math.min(stat.size, 192 * 1024);
    const buf = Buffer.alloc(size); readSync(fd, buf, 0, size, stat.size - size);
    const lines = buf.toString('utf8').split('\n'); if (stat.size > size) lines.shift();
    let turn = null; let latestAt = stat.mtimeMs; const events = []; let subtitle = ''; let tokenUsage = null;
    for (const line of lines) {
      let e; try { e = JSON.parse(line); } catch { continue; }
      const p = e.payload ?? {}; const at = Date.parse(e.timestamp) || latestAt;
      if (e.type === 'event_msg') {
        if (p.type === 'token_count') tokenUsage = codexTokens(p.info) || tokenUsage;
        if (['task_started','turn_started'].includes(p.type)) { turn = { status: 'inProgress', turn_id: p.turn_id, started_at: at }; subtitle = ''; }
        if (p.type === 'user_message') subtitle = userRequest(p.message);
        if (['task_complete','task_completed','turn_completed'].includes(p.type)) turn = { ...turn, status: 'completed', turn_id: p.turn_id ?? turn?.turn_id, completed_at: at };
        if (['turn_aborted','task_aborted'].includes(p.type)) turn = { ...turn, status: 'interrupted', completed_at: at };
        if (p.type === 'agent_message' && p.message) events.push({ label: '进度更新', text: short(p.message,900), kind:'message', at });
      }
      if (e.type === 'response_item' && p.type === 'message' && p.role === 'user') {
        const request = userRequest(p.content); if (request) subtitle = request;
      }
    }
    return { turn, latestAt, subtitle, tokenUsage, events: events.slice(-5).reverse() };
  } finally { closeSync(fd); }
}
export function readCodexSnapshot({ home = process.env.CODEX_HOME || join(homedir(), '.codex'), now = Date.now(), limit = 160 } = {}) {
  const base = { tasks: [], checkedAt: now, source: 'codex-local', sourceLabel: '本机 Codex · 只读', limit, capabilities: ['tasks.list','tasks.observe'] };
  if (!existsSync(home)) return { ...base, connected:false, error:'未找到本机 Codex 数据目录。请先在 Codex 中创建一个任务。' };
  let db, history;
  try {
    db = readDb(home, 'state'); history = readDb(home, 'thread_history');
    if (!db) return { ...base, connected:false, error:'未找到 Codex 任务索引。' };
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(c=>c.name));
    for (const required of ['id','title','updated_at','source','archived']) if (!columns.has(required)) throw new Error('Codex 索引格式已变化，需要更新适配器。');
    const optional = name => columns.has(name) ? name : `NULL AS ${name}`;
    const rows = db.prepare(`SELECT id,title,updated_at,source,${['name','model','cwd','rollout_path','agent_path','history_mode','tokens_used'].map(optional).join(',')} FROM threads WHERE archived=0 AND source IN ('cli','vscode','appServer') ORDER BY updated_at DESC LIMIT ?`).all(limit);
    const latestTurn = history?.prepare('SELECT turn_id,status,started_at,completed_at,error_json FROM thread_turns WHERE thread_id=? ORDER BY rollout_ordinal DESC LIMIT 1');
    // User text is selected separately from activity, scoped to the current turn.
    const latestUser = history?.prepare(`SELECT json_extract(item_json,'$.content') AS content FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type='userMessage' ORDER BY rollout_ordinal DESC LIMIT 1`);
    // Activity excludes reasoning and tool outputs.
    const latestItems = history?.prepare(`SELECT item_id,created_at_ms,item_type,json_extract(item_json,'$.phase') AS phase,json_extract(item_json,'$.status') AS status,json_extract(item_json,'$.tool') AS tool,substr(json_extract(item_json,'$.text'),1,900) AS text FROM thread_items WHERE thread_id=? AND turn_id=? AND item_type != 'reasoning' ORDER BY rollout_ordinal DESC LIMIT 10`);
    const latestTime = history?.prepare('SELECT MAX(created_at_ms) AS at FROM thread_items WHERE thread_id=? AND turn_id=?');
    const tasks = rows.map(row => {
      let turn = latestTurn?.get(row.id), latestAt = ms(row.updated_at), events = [], waiting = false, subtitle = '', tokenUsage = cumulativeTokens(row.tokens_used);
      if (turn) {
        latestAt = Math.max(latestAt, latestTime.get(row.id,turn.turn_id)?.at || 0, ms(turn.started_at)||0, ms(turn.completed_at)||0);
        const items = latestItems.all(row.id,turn.turn_id);
        const content = latestUser.get(row.id,turn.turn_id)?.content;
        if (content) { try { subtitle = userRequest(JSON.parse(content)); } catch { subtitle = userRequest(content); } }
        waiting = items.some(i => i.status === 'waitingForApproval') ? 'approval' : items.some(i => i.status === 'waitingForInput') ? 'input' : false;
        events = items.filter(i=>i.item_type !== 'userMessage').map(i => ({ ...activity({ type:i.item_type, phase:i.phase, text:i.text, tool:i.tool }), at:i.created_at_ms, id:i.item_id }));
      } else if (row.history_mode !== 'paginated') {
        const legacy = legacyTail(row.rollout_path,home); if (legacy) { turn=legacy.turn;latestAt=Math.max(latestAt,legacy.latestAt);events=legacy.events;subtitle=legacy.subtitle;tokenUsage=tokenUsage||legacy.tokenUsage; }
      }
      return { id:row.id, provider:'codex',nativeId:row.id,source:row.source,sourceLabel:row.source==='cli'?'Codex CLI':'Codex', title:short(row.name || row.title || '未命名任务',180), subtitle, tokenUsage, project: row.cwd ? basename(row.cwd) : '无项目', cwd: row.cwd || '', model:row.model || '默认模型', status:resolveStatus(turn,latestAt,now,waiting), turnId:turn?.turn_id || null, startedAt:ms(turn?.started_at), completedAt:ms(turn?.completed_at), updatedAt:latestAt, evidence:turn ? '最近一轮任务记录' : '没有可确认的本轮状态', events };
    });
    return { ...base, connected:true, tasks, error:null };
  } catch(e) {
    return { ...base, connected:false, error:e.message.includes('格式') ? e.message : '暂时无法读取 Codex 记录，请稍后重试。', diagnostic: short(e.message,180) };
  } finally { history?.close();db?.close(); }
}
