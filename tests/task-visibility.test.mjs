import test from 'node:test';
import assert from 'node:assert/strict';
import { completedTaskRetentionOptions, isTaskVisible, normalizeCompletedTaskRetention } from '../core/task-visibility.mjs';

const now = 1_800_000_000_000;
const completed = { status: 'completed', completedAt: now - 3 * 86_400_000, updatedAt: now };

test('completed tasks expire at the selected boundary, using completion rather than update time', () => {
  assert.equal(isTaskVisible(completed, 4320, now - 1), true);
  assert.equal(isTaskVisible(completed, 4320, now), false);
  assert.equal(isTaskVisible(completed, 10080, now), true);
  assert.equal(isTaskVisible(completed, -1, now), true);
});

test('missing completion time falls back to update time; unknown or future times remain visible', () => {
  assert.equal(isTaskVisible({ ...completed, completedAt: null, updatedAt: now - 3 * 86_400_000 }, 4320, now), false);
  for (const timestamp of [undefined, null, NaN, 0, -1]) {
    assert.equal(isTaskVisible({ status: 'completed', completedAt: timestamp }, 4320, now), true);
  }
  assert.equal(isTaskVisible({ ...completed, completedAt: now + 60_000 }, 4320, now), true);
});

test('running work and pending decisions remain visible even with old timestamps', () => {
  for (const status of ['running', 'approval', 'input', 'waiting']) {
    assert.equal(isTaskVisible({ ...completed, status, updatedAt: now - 43 * 86_400_000 }, 4320, now), true);
  }
  const resumed = { ...completed, status: 'running' };
  assert.equal(isTaskVisible(resumed, 4320, now), true);
  assert.equal(isTaskVisible({ ...resumed, status: 'completed', completedAt: now }, 4320, now), true);
});

test('inactive history expires by last update, including the old unknown tasks in the report', () => {
  for (const status of ['failed', 'interrupted', 'idle', 'unknown', 'unconfirmed']) {
    for (const days of [14, 15, 43]) {
      const task = { status, completedAt: now, updatedAt: now - days * 86_400_000 };
      assert.equal(isTaskVisible(task, 4320, now), false);
      assert.equal(isTaskVisible(task, -1, now), true);
    }
    const task = { status, updatedAt: now - 3 * 86_400_000 };
    assert.equal(isTaskVisible(task, 4320, now - 1), true);
    assert.equal(isTaskVisible(task, 4320, now), false);
    assert.equal(isTaskVisible({ ...task, updatedAt: now }, 4320, now), true);
    for (const updatedAt of [undefined, null, 0, -1, NaN, now + 60_000]) {
      assert.equal(isTaskVisible({ status, updatedAt }, 4320, now), true);
    }
  }
});

test('changing the retention window restores hidden history without deleting it', () => {
  const tasks = [{ id: 'old', status: 'unknown', updatedAt: now - 15 * 86_400_000 }, { id: 'recent', status: 'failed', updatedAt: now - 60_000 }];
  const visible = retention => tasks.filter(task => isTaskVisible(task, retention, now)).map(task => task.id);
  assert.deepEqual(visible(4320), ['recent']);
  assert.deepEqual(visible(43200), ['old', 'recent']);
  assert.deepEqual(visible(-1), ['old', 'recent']);
  assert.equal(tasks.length, 2);
});

test('old or invalid preferences preserve visibility; valid preferences survive serialization', () => {
  for (const value of [undefined, null, '5', -2, 6, Infinity, NaN, {}, true]) {
    assert.equal(normalizeCompletedTaskRetention(value), -1);
    assert.equal(isTaskVisible(completed, value, now), true);
  }
  for (const value of [-1, 720, 1440, 4320, 10080, 43200]) {
    assert.equal(normalizeCompletedTaskRetention(JSON.parse(JSON.stringify(value))), value);
  }
});


test('hour/day/month choices remain; removed minute preferences migrate to three days', () => {
  assert.deepEqual(completedTaskRetentionOptions.map(option => option.value), [720, 1440, 4320, 10080, 43200, -1]);
  for (const previous of [0, 5, 30, 60]) {
    assert.equal(normalizeCompletedTaskRetention(previous), 4320);
  }
  for (const days of [3, 7, 30]) {
    const task = { ...completed, completedAt: now - days * 86_400_000 };
    assert.equal(isTaskVisible(task, days * 1440, now - 1), true);
    assert.equal(isTaskVisible(task, days * 1440, now), false);
  }
});

test('12 and 24 hour windows expire inactive history at the boundary and retain live work', () => {
  for (const hours of [12, 24]) {
    const retention = hours * 60;
    const timestamp = now - hours * 3_600_000;
    for (const status of ['completed', 'failed', 'interrupted', 'idle', 'unknown', 'unconfirmed']) {
      const task = status === 'completed'
        ? { status, completedAt: timestamp, updatedAt: now }
        : { status, completedAt: now, updatedAt: timestamp };
      assert.equal(isTaskVisible(task, retention, now - 1), true);
      assert.equal(isTaskVisible(task, retention, now), false);
      assert.equal(isTaskVisible(task, -1, now), true);
    }
    for (const status of ['running', 'approval', 'input', 'waiting']) {
      assert.equal(isTaskVisible({ status, updatedAt: timestamp - 1 }, retention, now), true);
    }
  }
  const task = { status: 'completed', completedAt: now - 12 * 3_600_000 };
  assert.equal(isTaskVisible(task, 720, now), false);
  assert.equal(isTaskVisible(task, 1440, now), true);
});
