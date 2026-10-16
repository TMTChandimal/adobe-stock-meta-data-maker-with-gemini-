/**
 * TESTS: Task State Machine, Queue Serialization, & Gemini Coordination
 * =====================================================================
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import '../src/lib/messages.js';
import '../src/lib/task-state.js';
import '../src/lib/task-manager.js';
const { TaskStatus, canTransition, createTaskRecord, generateImageFingerprint } = globalThis;
const { TaskManagerImpl } = globalThis;

describe('Task State Machine & Queue Coordination', () => {
  let mockStorage = {};

  beforeEach(() => {
    mockStorage = {};
    globalThis.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            if (Array.isArray(keys)) {
              const res = {};
              keys.forEach(k => { res[k] = mockStorage[k]; });
              return res;
            }
            if (typeof keys === 'string') {
              return { [keys]: mockStorage[keys] };
            }
            return { ...mockStorage };
          },
          set: async (obj) => {
            Object.assign(mockStorage, obj);
          },
          remove: async (key) => {
            delete mockStorage[key];
          }
        }
      },
      tabs: {
        query: async () => [{ id: 999, url: 'https://gemini.google.com/app' }],
        create: async (opts) => ({ id: 999, url: opts.url }),
        sendMessage: async () => ({ status: 'PROCESSING' }),
        get: async (id) => ({ id, active: true })
      },
      runtime: {
        id: 'mock-extension-id',
        sendMessage: async () => {}
      }
    };
  });

  test('Enforces valid state machine transitions', () => {
    assert.strictEqual(canTransition(TaskStatus.IDLE, TaskStatus.QUEUED), true);
    assert.strictEqual(canTransition(TaskStatus.QUEUED, TaskStatus.PENDING_GEMINI), true);
    assert.strictEqual(canTransition(TaskStatus.PENDING_GEMINI, TaskStatus.GENERATED), true);
    assert.strictEqual(canTransition(TaskStatus.GENERATED, TaskStatus.APPLYING), true);
    assert.strictEqual(canTransition(TaskStatus.APPLYING, TaskStatus.APPLIED), true);

    // Invalid transitions
    assert.strictEqual(canTransition(TaskStatus.IDLE, TaskStatus.APPLIED), false);
    assert.strictEqual(canTransition(TaskStatus.APPLIED, TaskStatus.PENDING_GEMINI), false);
    assert.strictEqual(canTransition(TaskStatus.CANCELLED, TaskStatus.GENERATED), false);
  });

  test('createTaskRecord generates complete, validated task structure', () => {
    const task = createTaskRecord({
      assetId: 'adobe_asset_1001',
      imageDataUrl: 'data:image/jpeg;base64,1234567890abcdef',
      sourceTabId: 42,
      settings: {
        autoFillTitle: true,
        autoFillKeywords: false,
        platform: 'adobe'
      }
    });

    assert.ok(task.taskId);
    assert.ok(task.attemptId);
    assert.strictEqual(task.assetId, 'adobe_asset_1001');
    assert.strictEqual(task.sourceTabId, 42);
    assert.strictEqual(task.status, TaskStatus.QUEUED);
    assert.ok(task.timestamps.created > 0);
    assert.ok(task.timestamps.deadline > task.timestamps.created);
    assert.strictEqual(task.settingsSnapshot.autoFillTitle, true);
    assert.strictEqual(task.settingsSnapshot.autoFillKeywords, false);
    assert.ok(task.imageFingerprint.startsWith('fp_'));
  });

  test('Queues multiple tasks from distinct tabs in serialized order', async () => {
    const tm = new TaskManagerImpl();
    await tm.init();

    // Tab 1 queues a task
    const task1 = await tm.enqueueTask({
      assetId: 'asset_tab_1',
      sourceTabId: 101,
      imageDataUrl: 'data:image/jpeg;base64,aaa'
    });

    // Tab 2 queues a task while task 1 is active
    const task2 = await tm.enqueueTask({
      assetId: 'asset_tab_2',
      sourceTabId: 102,
      imageDataUrl: 'data:image/jpeg;base64,bbb'
    });

    assert.notStrictEqual(task1.taskId, task2.taskId);
    const state = await tm.getState();
    assert.strictEqual(state.activeTask.taskId, task1.taskId);
    assert.strictEqual(state.queueLength, 1);
    assert.strictEqual(state.queueSummary[0].assetId, 'asset_tab_2');
  });

  test('Rejects stale or foreign Gemini results', async () => {
    const tm = new TaskManagerImpl();
    await tm.init();

    await tm.enqueueTask({
      assetId: 'asset_active',
      sourceTabId: 101,
      imageDataUrl: 'data:image/jpeg;base64,active'
    });

    const active = tm._activeTask;

    // 1. Foreign task ID
    const foreignRes = await tm.handleGeminiResult({
      taskId: 'some_other_task_id',
      attemptId: active.attemptId,
      data: { title: 'Test', keywords: ['k1'] }
    });
    assert.strictEqual(foreignRes.accepted, false);
    assert.match(foreignRes.reason, /does not match active task/i);

    // 2. Stale attempt ID (e.g. from an earlier retried attempt)
    const staleRes = await tm.handleGeminiResult({
      taskId: active.taskId,
      attemptId: 'stale_attempt_id',
      data: { title: 'Test', keywords: ['k1'] }
    });
    assert.strictEqual(staleRes.accepted, false);
    assert.match(staleRes.reason, /Stale attempt/i);

    // 3. Matching task ID and attempt ID succeeds
    const goodRes = await tm.handleGeminiResult({
      taskId: active.taskId,
      attemptId: active.attemptId,
      data: { title: 'Valid Title', keywords: ['k1', 'k2'] }
    });
    assert.strictEqual(goodRes.accepted, true);
    assert.strictEqual(tm._activeTask.metadata.title, 'Valid Title');
  });

  test('Cancellation invalidates active attempt and clears image blob', async () => {
    const tm = new TaskManagerImpl();
    await tm.init();

    await tm.enqueueTask({
      assetId: 'asset_to_cancel',
      sourceTabId: 101,
      imageDataUrl: 'data:image/jpeg;base64,cancelme'
    });

    const taskId = tm._activeTask.taskId;
    assert.strictEqual(tm._activeTask.status, TaskStatus.PENDING_GEMINI);

    await tm.cancelTask(taskId);
    assert.strictEqual(tm._activeTask.status, TaskStatus.CANCELLED);

    // Stored image blob must be deleted
    const blob = await tm._getImageBlob(taskId);
    assert.strictEqual(blob, null, 'Cancelled task image blob must be purged');
  });

  test('Worker suspension recovery transitions expired in-flight task to PAUSED_FOR_REVIEW', async () => {
    // Seed storage with an expired in-flight task
    mockStorage['asmp_active_task'] = {
      taskId: 'interrupted_task_1',
      attemptId: 'att_1',
      status: TaskStatus.PENDING_GEMINI,
      timestamps: {
        created: Date.now() - 100000,
        updated: Date.now() - 80000,
        deadline: Date.now() - 20000 // deadline expired 20s ago
      }
    };

    const tm = new TaskManagerImpl();
    await tm.init();

    assert.strictEqual(tm._activeTask.status, TaskStatus.PAUSED_FOR_REVIEW, 'Expired in-flight task must be paused for review');
    assert.strictEqual(tm._activeTask.error.code, 'WORKER_SUSPENSION_RECOVERY');
  });
});
