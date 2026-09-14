const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

export function cumulativeTokens(value) {
  const total = count(value);
  return total === null ? null : { total, scope: 'session' };
}

export function codexTokens(info) {
  const usage = info?.total_token_usage;
  return cumulativeTokens(usage?.total_tokens);
}

// Claude input_tokens excludes cache reads/writes. Count each message once;
// streamed content blocks can repeat usage with the same message id.
export function claudeTokens(rows) {
  const messages = new Map();
  for (const row of rows) {
    if (row?.type !== 'assistant' || row.isSidechain) continue;
    const message = row.message, usage = message?.usage;
    if (!message?.id || !usage) continue;
    const input = count(usage.input_tokens), output = count(usage.output_tokens);
    const cacheRead = count(usage.cache_read_input_tokens ?? 0);
    const cacheWrite = count(usage.cache_creation_input_tokens ?? 0);
    if ([input, output, cacheRead, cacheWrite].some(v => v === null)) continue;
    const previous = messages.get(message.id);
    const next = { input, output, cacheRead, cacheWrite };
    if (previous) for (const key of Object.keys(next)) next[key] = Math.max(previous[key], next[key]);
    messages.set(message.id, next);
  }
  if (!messages.size) return null;
  const sum = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const usage of messages.values()) for (const key of Object.keys(sum)) sum[key] += usage[key];
  const total = Object.values(sum).reduce((a, b) => a + b, 0);
  if (count(total) === null) return null;
  return { total, ...sum, scope: rows.truncated || rows.incomplete ? 'recent' : 'session' };
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const exact = new Intl.NumberFormat('en-US');
export function tokenLabel(usage) {
  return usage && count(usage.total) !== null
    ? `${usage.scope === 'recent' ? '近期' : '累计'} Token ${compact.format(usage.total)}`
    : 'Token 未提供';
}
export function tokenDescription(usage) {
  if (!usage || count(usage.total) === null) return '当前来源没有可读取的 Token 用量记录，并非消耗为 0。';
  const parts = [`${usage.scope === 'recent' ? '仅已读取的近期日志，非完整任务累计' : '该任务会话累计'}：${exact.format(usage.total)} Token`];
  for (const [key, label] of [['input', '输入（不含缓存）'], ['output', '输出'], ['cacheRead', '缓存读取'], ['cacheWrite', '缓存写入']]) {
    if (count(usage[key]) !== null) parts.push(`${label}：${exact.format(usage[key])}`);
  }
  parts.push('包含缓存 Token；用量由来源记录，不代表费用或剩余额度。');
  return parts.join('\n');
}
