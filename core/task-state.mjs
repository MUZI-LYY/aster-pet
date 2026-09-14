export const STALE_MS = 180_000;
export function resolveStatus(turn, latestAt, now = Date.now(), waiting = false) {
  if (!turn) return 'unknown';
  if (turn.status === 'completed') return 'completed';
  if (turn.status === 'interrupted') return 'interrupted';
  if (turn.status === 'failed') return 'failed';
  if (turn.status === 'inProgress') {
    if (waiting) return typeof waiting === 'string' ? waiting : 'waiting';
    if (now - latestAt > STALE_MS) return 'unconfirmed';
    return waiting ? 'waiting' : 'running';
  }
  return 'unknown';
}
export function changedToTerminal(before, after) {
  const previous = new Map(before.map(t => [t.id, t]));
  return after.filter(t => {
    const old = previous.get(t.id);
    return old && !!t.turnId && old.turnId === t.turnId && ['running', 'waiting', 'approval', 'input', 'unconfirmed'].includes(old.status)
      && ['completed', 'failed'].includes(t.status);
  });
}
export function deriveMood(tasks, connected) {
  if (!connected) return 'offline';
  // Explicit attention states win over background work, independently of list order.
  for (const status of ['approval','failed','input','waiting','running']) {
    if (tasks.some(t => t.status === status)) return status === 'running' ? 'working' : status;
  }
  const latest=tasks.reduce((last,t)=>!last||(t.updatedAt||0)>(last.updatedAt||0)?t:last,null);
  if (latest?.status === 'completed') return 'completed';
  if (latest?.status === 'interrupted') return 'interrupted';
  if (latest && ['unknown','unconfirmed'].includes(latest.status)) return 'uncertain';
  return 'idle';
}

export const statusLabels = {running:'进行中',completed:'已完成',failed:'失败',approval:'待授权',input:'待输入',waiting:'待确认'};
export const statusOrder = ['running','completed','failed','approval','input','waiting'];
export const attentionStatuses = ['approval','input','waiting'];

// Establish a baseline without replaying history; deduplicate terminal alerts per turn.
export function createTaskAlertTracker() {
  let previous;
  const terminalSeen = new Set();
  return tasks => {
    const current = new Map(tasks.map(t => [t.id,t]));
    if (!previous) {
      for (const t of tasks) if (['completed','failed'].includes(t.status)) terminalSeen.add(JSON.stringify([t.id,t.turnId,t.status]));
      previous = current; return [];
    }
    const terminal = new Set(changedToTerminal([...previous.values()],tasks).map(t => t.id));
    const alerts = tasks.filter(t => {
      const old = previous.get(t.id);
      if (attentionStatuses.includes(t.status)) return !old || old.status !== t.status || old.turnId !== t.turnId;
      const key = JSON.stringify([t.id,t.turnId,t.status]);
      if (terminal.has(t.id) && !terminalSeen.has(key)) { terminalSeen.add(key); return true; }
      return false;
    });
    // Retain only keys for current turns, keeping long-running monitors bounded.
    for (const key of terminalSeen) {
      const [id,turnId] = JSON.parse(key);
      if (current.get(id)?.turnId !== turnId) terminalSeen.delete(key);
    }
    previous = current;
    return alerts;
  };
}
