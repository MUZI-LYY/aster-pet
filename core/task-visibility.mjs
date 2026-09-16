export const completedTaskRetentionOptions = [
  { value: 720, label: '12 小时后' },
  { value: 1440, label: '24 小时后' },
  { value: 4320, label: '3 天后' },
  { value: 10080, label: '7 天后' },
  { value: 43200, label: '1 个月后' },
  { value: -1, label: '始终显示' },
];

export function normalizeCompletedTaskRetention(value) {
  if ([0, 5, 30, 60].includes(value)) return 4320;
  return completedTaskRetentionOptions.some(option => option.value === value) ? value : -1;
}

/** @param {{status: string, completedAt?: number | null, updatedAt?: number}} task */
export function isTaskVisible(task, retentionMinutes, now = Date.now()) {
  const retention = normalizeCompletedTaskRetention(retentionMinutes);
  // Live work and pending decisions must remain reachable regardless of age.
  if (retention === -1 || !['completed', 'failed', 'interrupted', 'idle', 'unknown', 'unconfirmed'].includes(task.status)) return true;
  // Completed turns expire from completion; other history expires from last activity.
  // Missing timestamps are not evidence that a task is old.
  const lastActivityAt = task.status === 'completed' && Number.isFinite(task.completedAt) && task.completedAt > 0
    ? task.completedAt : task.updatedAt;
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return true;
  return now - lastActivityAt < retention * 60_000;
}
