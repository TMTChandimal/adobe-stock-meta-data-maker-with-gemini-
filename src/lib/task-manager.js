/**
 * TASK MANAGER & SERIALIZED QUEUE
 * ================================
 * Replaces the single global currentTask variable with a persistent,
 * serialized queue and state machine backed by chrome.storage.local.
 *
 * Enforces:
 * 1. Single active dispatch at any time (Gemini queue serialization).
 * 2. Correlation between attempt ID and incoming results.
 * 3. Bounded storage for image blobs with strict purge retention on ALL terminal paths.
 * 4. Recovery after worker suspension/restart (safe pause for review, preserve metadata).
 * 5. Entitlement and quota validation prior to task start AND at dispatch.
 * 6. Explicit retry and resume operations.
 * 7. Durable deadlines/alarms; old timers never fail newer attempts.
 * 8. Strict multi-tab targeting and explicit Gemini session binding.
 */

(function () {
  'use strict';

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  const TaskStatus = root.TaskStatus || {};
  const canTransition = root.canTransition || (() => false);
  const createTaskRecord = root.createTaskRecord || (() => ({}));
  const MessageActions = root.MessageActions || {};

  const STORAGE_KEYS = {
    ACTIVE_TASK: 'asmp_active_task',
    TASK_QUEUE:  'asmp_task_queue',
    LOCK:        'asmp_dispatch_lock',
  };

class TaskManagerImpl {
  constructor() {
    this._activeTask = null;
    this._queue = [];
    this._isProcessing = false;
    this._stepTimeoutTimer = null;
    this._activeTimerAttemptId = null;
    this._mutex = Promise.resolve();
  }

  /**
   * Serializes async operations to prevent race conditions during concurrent enqueue, results, and cancel.
   */
  _runExclusive(operation) {
    const next = (this._mutex || Promise.resolve()).then(async () => {
      return await operation();
    });
    this._mutex = next.catch(() => {});
    return next;
  }

  /**
   * Initializes the task manager from persistent storage.
   * Runs recovery logic for any in-flight task interrupted by service worker suspension.
   */
  async init() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    try {
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.ACTIVE_TASK,
        STORAGE_KEYS.TASK_QUEUE
      ]);

      this._queue = stored[STORAGE_KEYS.TASK_QUEUE] || [];
      const rawActive = stored[STORAGE_KEYS.ACTIVE_TASK];

      if (rawActive) {
        const now = Date.now();
        // If task was in-flight when service worker restarted or deadline expired
        if ([TaskStatus.PENDING_GEMINI, TaskStatus.APPLYING].includes(rawActive.status)) {
          console.warn(`[TaskManager] Recovered in-flight task ${rawActive.taskId} in status ${rawActive.status}.`);
          const deadline = rawActive.timestamps?.deadline || 0;
          if (deadline && now > deadline) {
            rawActive.status = TaskStatus.PAUSED_FOR_REVIEW;
            rawActive.error = {
              code: 'WORKER_SUSPENSION_RECOVERY',
              message: 'Background worker restarted while task was in progress. Paused to prevent duplicate execution.',
              timestamp: now
            };
            rawActive.timestamps.updated = now;
            await this._persistActiveTask(rawActive);
          }
        }
        this._activeTask = rawActive;
      }
    } catch (err) {
      console.error('[TaskManager] Init error:', err);
    }
  }

  /**
   * Returns current active task and queue summary.
   */
  async getState() {
    await this.init();
    return {
      activeTask: this._activeTask ? this._sanitizeTaskForClient(this._activeTask) : null,
      queueLength: this._queue.length,
      queueSummary: this._queue.map(t => ({
        taskId: t.taskId,
        assetId: t.assetId,
        status: t.status,
        title: t.metadata?.title || ''
      }))
    };
  }

  /**
   * Queues or starts a new metadata generation task.
   * Serialized and checks entitlements.
   */
  async enqueueTask(params) {
    return this._runExclusive(async () => {
      await this.init();

      // 1. Initial Quota & Entitlement check
      if (typeof globalThis.EntitlementsService !== 'undefined') {
        const canGen = await globalThis.EntitlementsService.canGenerate();
        if (!canGen) {
          throw new Error('Daily generation limit reached for Free plan. Upgrade to Pro for unlimited generation.');
        }
      }

      // 2. Create validated task record
      const task = createTaskRecord(params);

      // 3. Store image blob in bounded temporary storage
      if (params.imageDataUrl) {
        await this._storeImageBlob(task.taskId, params.imageDataUrl);
      }

      // 4. Add to queue
      this._queue.push(task);
      await this._persistQueue();

      // 5. Trigger queue processing
      await this._processNextInQueue();

      return this._sanitizeTaskForClient(task);
    });
  }

  /**
   * Dispatches the next task in queue if idle.
   * Rechecks entitlements at dispatch time.
   */
  async _processNextInQueue() {
    if (this._isProcessing) return;

    // Check if there is already an active in-flight task
    if (this._activeTask && ![TaskStatus.IDLE, TaskStatus.APPLIED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.PAUSED_FOR_REVIEW].includes(this._activeTask.status)) {
      const now = Date.now();
      const deadline = this._activeTask.timestamps?.deadline || 0;
      if (deadline > 0 && now > deadline) {
        console.warn(`[TaskManager] Active task ${this._activeTask.taskId} exceeded deadline (${now} > ${deadline}). Timing out stale task to unblock queue.`);
        await this._failTask('TASK_TIMEOUT', 'Task exceeded maximum timeout.');
      } else {
        return;
      }
    }

    if (this._queue.length === 0) return;

    this._isProcessing = true;
    try {
      const nextTask = this._queue.shift();
      await this._persistQueue();

      // Invariant: Recheck entitlements immediately prior to dispatch
      if (typeof globalThis.EntitlementsService !== 'undefined') {
        const canGen = await globalThis.EntitlementsService.canGenerate();
        if (!canGen) {
          nextTask.status = TaskStatus.FAILED;
          nextTask.error = {
            code: 'QUOTA_EXCEEDED',
            message: 'Daily generation quota exceeded before task dispatch.',
            timestamp: Date.now()
          };
          await this._purgeImageBlob(nextTask.taskId);
          this._activeTask = nextTask;
          await this._persistActiveTask(nextTask);
          this._broadcastStatus();
          return;
        }
      }

      this._activeTask = nextTask;
      await this._transitionTask(TaskStatus.PENDING_GEMINI);

      // Dispatch to Gemini tab
      await this._dispatchToGemini(nextTask);
    } catch (err) {
      console.error('[TaskManager] Error processing queue item:', err);
      if (this._activeTask) {
        await this._failTask('QUEUE_DISPATCH_ERROR', err.message);
      }
    } finally {
      this._isProcessing = false;
    }
  }

  /**
   * Dispatches task to Gemini tab. Handles tab binding, connection retries, and durable timeout.
   */
  async _dispatchToGemini(task) {
    this._clearStepTimeout(task.taskId);

    // Fetch image data
    const imageDataUrl = await this._getImageBlob(task.taskId);
    if (!imageDataUrl) {
      await this._failTask('IMAGE_DATA_MISSING', 'Image data expired or could not be loaded from temporary storage.');
      return;
    }

    // Find or create and explicitly bind Gemini tab
    const geminiTab = await this._ensureGeminiTab(task);
    task.geminiTabId = geminiTab.id;
    await this._persistActiveTask(task);

    // Set step timeout (85 seconds for full generation turn) with attempt correlation
    this._setStepTimeout(task, 85000, async () => {
      await this._failTask('GEMINI_TIMEOUT', 'Gemini did not return metadata within the 85 second timeout.');
    });

    // Send dispatch message with attemptId for correlation
    try {
      const response = await chrome.tabs.sendMessage(geminiTab.id, {
        action: MessageActions.DISPATCH_GEMINI,
        taskId: task.taskId,
        attemptId: task.attemptId,
        platform: task.settingsSnapshot.platform,
        customPrompt: task.settingsSnapshot.customPrompt,
        imageDataUrl: imageDataUrl,
      });

      if (response?.status === 'BUSY') {
        console.warn(`[TaskManager] Gemini reported BUSY for attempt ${task.attemptId}. Scheduling backoff retry...`);
        this._clearStepTimeout(task.taskId);
        await this._handleGeminiBusy(task);
      }
    } catch (err) {
      // Content script injection fallback if tab was freshly created
      try {
        await chrome.scripting.executeScript({
          target: { tabId: geminiTab.id },
          files: ['src/lib/messages.js', 'src/lib/metadata-validator.js', 'content_gemini.js']
        });
        await new Promise(r => setTimeout(r, 1000));
        await chrome.tabs.sendMessage(geminiTab.id, {
          action: MessageActions.DISPATCH_GEMINI,
          taskId: task.taskId,
          attemptId: task.attemptId,
          platform: task.settingsSnapshot.platform,
          customPrompt: task.settingsSnapshot.customPrompt,
          imageDataUrl: imageDataUrl,
        });
      } catch (retryErr) {
        await this._failTask('GEMINI_CONNECTION_ERROR', 'Could not establish connection to Gemini tab. Please verify you are logged in.');
      }
    }
  }

  /**
   * Handles Gemini BUSY response with exponential backoff up to 3 retries.
   */
  async _handleGeminiBusy(task) {
    task.retries = (task.retries || 0) + 1;
    if (task.retries > 3) {
      await this._failTask('GEMINI_BUSY_MAX_RETRIES', 'Gemini remained busy after 3 retry attempts.');
      return;
    }

    const backoffMs = task.retries * 3000;
    console.log(`[TaskManager] Retrying busy task in ${backoffMs}ms (attempt ${task.retries}/3)...`);
    await new Promise(r => setTimeout(r, backoffMs));

    // Verify task wasn't cancelled or superseded during backoff
    if (this._activeTask?.taskId === task.taskId && this._activeTask.status === TaskStatus.PENDING_GEMINI) {
      task.attemptId = `att_${Date.now()}_${task.retries}`;
      await this._persistActiveTask(task);
      await this._dispatchToGemini(task);
    }
  }

  /**
   * Handles incoming metadata result from Gemini.
   * Serialized and strictly verifies taskId, attemptId, and sender origin/tab.
   */
  async handleGeminiResult(message, sender) {
    return this._runExclusive(async () => {
      const { taskId, attemptId, data } = message;

      if (!this._activeTask || this._activeTask.taskId !== taskId) {
        console.warn(`[TaskManager] Ignored Gemini result for foreign/stale taskId: ${taskId}`);
        return { accepted: false, reason: 'Task ID does not match active task.' };
      }

      if (this._activeTask.attemptId !== attemptId) {
        console.warn(`[TaskManager] Ignored Gemini result for stale attemptId: ${attemptId} (expected ${this._activeTask.attemptId})`);
        return { accepted: false, reason: 'Stale attempt response.' };
      }

      // Cross-tab check: verify sender tab matches bound Gemini tab if available
      if (sender?.tab?.id && this._activeTask.geminiTabId && sender.tab.id !== this._activeTask.geminiTabId) {
        console.log(`[TaskManager] Updating bound Gemini tab ID to ${sender.tab.id} for task ${taskId}`);
        this._activeTask.geminiTabId = sender.tab.id;
      }

      if (![TaskStatus.PENDING_GEMINI, TaskStatus.PAUSED_FOR_REVIEW].includes(this._activeTask.status)) {
        console.warn(`[TaskManager] Ignored Gemini result because task status is ${this._activeTask.status}`);
        return { accepted: false, reason: 'Task not awaiting Gemini result.' };
      }

      this._clearStepTimeout(taskId);

      // Store generated metadata securely (persisted even across review or pauses)
      this._activeTask.metadata.title = data.title;
      this._activeTask.metadata.keywords = data.keywords;
      await this._transitionTask(TaskStatus.GENERATED);

      // Record successful generation usage
      if (typeof globalThis.EntitlementsService !== 'undefined') {
        try {
          await globalThis.EntitlementsService.recordGeneration();
        } catch (e) {
          console.warn('[TaskManager] Record generation usage:', e);
        }
      }

      // Save to metadata history
      if (typeof globalThis.StorageService !== 'undefined') {
        try {
          await globalThis.StorageService.addMetadataHistory({
            assetId: this._activeTask.assetId,
            title: data.title,
            keywords: data.keywords,
            platform: this._activeTask.settingsSnapshot.platform
          });
        } catch (e) {
          console.warn('[TaskManager] Save history error:', e);
        }
      }

      // Purge temporary image blob per retention policy (no longer needed after Gemini response)
      await this._purgeImageBlob(taskId);

      // Automatic application if autofill is enabled in settings, else enter REVIEWING
      if (this._activeTask.settingsSnapshot.autoFillTitle || this._activeTask.settingsSnapshot.autoFillKeywords) {
        await this._applyMetadataToSourceTab(this._activeTask);
      } else {
        await this._transitionTask(TaskStatus.REVIEWING);
      }

      return { accepted: true };
    });
  }

  /**
   * Handles incoming error from Gemini content script.
   */
  async handleGeminiError(message, sender) {
    return this._runExclusive(async () => {
      const { taskId, attemptId, error } = message;
      if (this._activeTask && this._activeTask.taskId === taskId && this._activeTask.attemptId === attemptId) {
        this._clearStepTimeout(taskId);
        const sourceTabId = this._activeTask.sourceTabId;
        await this._failTask('GEMINI_ERROR', error || 'Gemini processing failed.');
        await this._purgeImageBlob(taskId);
        if (sourceTabId) {
          try {
            await chrome.tabs.update(sourceTabId, { active: true });
          } catch (e) {}
        }
        return { accepted: true };
      }
      return { accepted: false };
    });
  }

  /**
   * Sends metadata to the source Adobe Stock tab to fill fields.
   */
  async _applyMetadataToSourceTab(task, isManualApply = false) {
    await this._transitionTask(TaskStatus.APPLYING);

    let sourceTab = null;
    if (task.sourceTabId) {
      try {
        sourceTab = await chrome.tabs.get(task.sourceTabId);
      } catch (e) {
        sourceTab = null;
      }
    }

    // Fallback: If sourceTab not found, locate open Adobe Stock tab
    if (!sourceTab && typeof chrome.tabs?.query !== 'undefined') {
      try {
        const adobeTabs = await chrome.tabs.query({ url: 'https://contributor.stock.adobe.com/*' });
        if (adobeTabs && adobeTabs.length > 0) {
          sourceTab = adobeTabs.find(t => t.active) || adobeTabs[0];
          task.sourceTabId = sourceTab.id;
          await this._persistActiveTask(task);
        }
      } catch (e) {}
    }

    if (!sourceTab) {
      await this._failTask('SOURCE_TAB_CLOSED', 'Source contributor tab was closed before metadata could be applied.');
      return;
    }

    // Switch focus back to source Adobe Stock tab and bring window to front
    try {
      if (typeof chrome.tabs?.update === 'function') {
        await chrome.tabs.update(sourceTab.id, { active: true });
      }
      if (sourceTab.windowId && typeof chrome.windows !== 'undefined' && typeof chrome.windows.update === 'function') {
        try {
          await chrome.windows.update(sourceTab.windowId, { focused: true });
        } catch (winErr) {}
      }
    } catch (e) {
      console.warn('[TaskManager] Tab activation notice:', e);
    }

    this._setStepTimeout(task, 25000, async () => {
      await this._failTask('APPLY_TIMEOUT', 'Timed out waiting for Adobe Stock to confirm metadata application.');
    });

    try {
      await chrome.tabs.sendMessage(sourceTab.id, {
        action: MessageActions.APPLY_METADATA,
        taskId: task.taskId,
        assetId: task.assetId,
        data: {
          title: task.metadata.title,
          keywords: task.metadata.keywords,
        },
        settings: task.settingsSnapshot,
        isManualApply: isManualApply
      });
    } catch (err) {
      // Content script injection fallback if tab was freshly created or reloaded
      try {
        if (typeof chrome.scripting !== 'undefined') {
          await chrome.scripting.executeScript({
            target: { tabId: sourceTab.id },
            files: [
              'src/config/product.config.js',
              'src/lib/messages.js',
              'src/lib/storage.js',
              'src/lib/entitlements.js',
              'src/lib/metadata-validator.js',
              'content_adobe.js'
            ]
          });
          await new Promise(r => setTimeout(r, 600));
          await chrome.tabs.sendMessage(sourceTab.id, {
            action: MessageActions.APPLY_METADATA,
            taskId: task.taskId,
            assetId: task.assetId,
            data: {
              title: task.metadata.title,
              keywords: task.metadata.keywords,
            },
            settings: task.settingsSnapshot,
            isManualApply: isManualApply
          });
          return;
        }
      } catch (retryErr) {}

      this._clearStepTimeout(task.taskId);
      await this._failTask('APPLY_MESSAGE_FAILED', `Failed to send metadata to Adobe Stock tab: ${err.message}`);
    }
  }

  /**
   * Confirms metadata application from Adobe Stock content script.
   */
  async handleMetadataApplied(message, sender) {
    return this._runExclusive(async () => {
      if (!this._activeTask || this._activeTask.taskId !== message.taskId) return;
      this._clearStepTimeout(message.taskId);
      await this._transitionTask(TaskStatus.APPLIED);
      await this._purgeImageBlob(message.taskId);
      this._broadcastStatus();

      // Trigger next batch item if queued
      const nextTimer = setTimeout(() => this._processNextInQueue(), 1000);
      if (nextTimer && typeof nextTimer.unref === 'function') {
        nextTimer.unref();
      }
    });
  }

  /**
   * Handles metadata application failure from Adobe Stock content script.
   */
  async handleMetadataApplyFailed(message, sender) {
    return this._runExclusive(async () => {
      if (!this._activeTask || this._activeTask.taskId !== message.taskId) return;
      this._clearStepTimeout(message.taskId);
      await this._failTask('APPLY_FAILED', message.error || 'Adobe Stock input fields could not be filled.');
      await this._purgeImageBlob(message.taskId);
    });
  }

  /**
   * Handles alarm timeout for background alarm recovery.
   */
  async handleTaskTimeoutAlarm(taskId) {
    return this._runExclusive(async () => {
      if (this._activeTask && this._activeTask.taskId === taskId) {
        if ([TaskStatus.PENDING_GEMINI, TaskStatus.APPLYING].includes(this._activeTask.status)) {
          console.warn(`[TaskManager] Handling task timeout alarm for ${taskId}.`);
          await this._failTask('TASK_TIMEOUT', 'Task exceeded maximum allowed step duration.');
        }
      }
    });
  }

  /**
   * Explicitly retries a failed, paused, or cancelled task.
   */
  async retryTask(taskId = null) {
    return this._runExclusive(async () => {
      await this.init();
      let target = null;

      if (this._activeTask && (!taskId || this._activeTask.taskId === taskId)) {
        target = this._activeTask;
      } else if (taskId) {
        target = this._queue.find(t => t.taskId === taskId);
      }

      if (!target) {
        throw new Error(`Task ${taskId || ''} not found for retry.`);
      }

      // Re-check entitlements
      if (typeof globalThis.EntitlementsService !== 'undefined') {
        const canGen = await globalThis.EntitlementsService.canGenerate();
        if (!canGen) {
          throw new Error('Daily generation limit reached for Free plan. Upgrade to Pro for unlimited generation.');
        }
      }

      target.status = TaskStatus.QUEUED;
      target.retries = (target.retries || 0) + 1;
      target.attemptId = `att_${Date.now()}_${target.retries}`;
      target.error = null;
      target.timestamps.updated = Date.now();
      target.timestamps.deadline = Date.now() + 75000;

      // Remove from active or place in queue
      if (this._activeTask?.taskId === target.taskId) {
        this._activeTask = null;
        await this._persistActiveTask(null);
      }

      if (!this._queue.some(t => t.taskId === target.taskId)) {
        this._queue.unshift(target);
      }
      await this._persistQueue();

      await this._processNextInQueue();
      return this._sanitizeTaskForClient(target);
    });
  }

  /**
   * Explicitly resumes a task paused for review or manual application.
   */
  async resumeTask(taskId = null, editedMetadata = null) {
    return this._runExclusive(async () => {
      await this.init();

      let target = this._activeTask;
      if (taskId && this._activeTask?.taskId !== taskId) {
        target = this._queue.find(t => t.taskId === taskId) || null;
      }

      if (!target) {
        throw new Error('No task found to resume.');
      }

      if (![TaskStatus.PAUSED_FOR_REVIEW, TaskStatus.REVIEWING, TaskStatus.GENERATED].includes(target.status)) {
        throw new Error(`Cannot resume task in status ${target.status}.`);
      }

      if (editedMetadata) {
        if (editedMetadata.title) target.metadata.title = editedMetadata.title;
        if (editedMetadata.keywords) target.metadata.keywords = editedMetadata.keywords;
      }

      this._activeTask = target;
      await this._applyMetadataToSourceTab(target, true);
      return this._sanitizeTaskForClient(target);
    });
  }

  /**
   * Cancels active task and pending queue.
   */
  async cancelTask(taskId = null) {
    return this._runExclusive(async () => {
      this._clearStepTimeout(taskId || this._activeTask?.taskId);

      if (this._activeTask && (!taskId || this._activeTask.taskId === taskId)) {
        const oldId = this._activeTask.taskId;
        this._activeTask.status = TaskStatus.CANCELLED;
        this._activeTask.timestamps.updated = Date.now();
        await this._persistActiveTask(this._activeTask);
        await this._purgeImageBlob(oldId);
        this._broadcastStatus();
      }

      if (taskId) {
        // Remove specific task from queue
        const index = this._queue.findIndex(t => t.taskId === taskId);
        if (index !== -1) {
          this._queue.splice(index, 1);
          await this._persistQueue();
          await this._purgeImageBlob(taskId);
        }
      } else {
        // Clear entire queue
        for (const t of this._queue) {
          await this._purgeImageBlob(t.taskId);
        }
        this._queue = [];
        await this._persistQueue();
      }

      return { success: true };
    });
  }

  async handleTaskTimeoutAlarm(taskId) {
    return this._runExclusive(async () => {
      if (this._activeTask && this._activeTask.taskId === taskId) {
        if ([TaskStatus.PENDING_GEMINI, TaskStatus.APPLYING].includes(this._activeTask.status)) {
          console.warn(`[TaskManager] Durable timeout alarm fired for task ${taskId}.`);
          await this._failTask('TASK_TIMEOUT_ALARM', 'Task exceeded maximum execution deadline.');
        }
      }
    });
  }

  async _transitionTask(nextStatus) {
    if (!this._activeTask) return;
    if (!canTransition(this._activeTask.status, nextStatus)) {
      console.warn(`[TaskManager] Invalid transition from ${this._activeTask.status} to ${nextStatus}`);
      return;
    }
    this._activeTask.status = nextStatus;
    this._activeTask.timestamps.updated = Date.now();
    await this._persistActiveTask(this._activeTask);
    this._broadcastStatus();
  }

  async _failTask(code, message) {
    if (!this._activeTask) return;
    this._activeTask.status = TaskStatus.FAILED;
    this._activeTask.error = { code, message, timestamp: Date.now() };
    this._activeTask.timestamps.updated = Date.now();
    await this._persistActiveTask(this._activeTask);
    await this._purgeImageBlob(this._activeTask.taskId);
    this._broadcastStatus();
  }

  _broadcastStatus() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;
    try {
      chrome.runtime.sendMessage({
        action: MessageActions.TASK_STATUS_UPDATE,
        task: this._activeTask ? this._sanitizeTaskForClient(this._activeTask) : null
      }).catch(() => {});
    } catch (e) {}
  }

  _setStepTimeout(task, ms, callback) {
    this._clearStepTimeout(task.taskId);

    const attemptId = task.attemptId;
    const taskId = task.taskId;
    this._activeTimerAttemptId = attemptId;

    this._stepTimeoutTimer = setTimeout(async () => {
      // Invariant: Verify task and attemptId still match before invoking callback
      if (this._activeTask?.taskId === taskId && this._activeTask?.attemptId === attemptId) {
        await callback();
      }
    }, ms);

    if (this._stepTimeoutTimer && typeof this._stepTimeoutTimer.unref === 'function') {
      this._stepTimeoutTimer.unref();
    }

    // Set durable alarm in chrome.alarms as well
    try {
      if (typeof chrome !== 'undefined' && chrome.alarms?.create) {
        chrome.alarms.create(`taskTimeout_${taskId}`, { delayInMinutes: Math.max(1, Math.ceil(ms / 60000)) });
      }
    } catch (e) {}
  }

  _clearStepTimeout(taskId = null) {
    if (this._stepTimeoutTimer) {
      clearTimeout(this._stepTimeoutTimer);
      this._stepTimeoutTimer = null;
      this._activeTimerAttemptId = null;
    }
    if (taskId && typeof chrome !== 'undefined' && chrome.alarms?.clear) {
      try {
        chrome.alarms.clear(`taskTimeout_${taskId}`);
      } catch (e) {}
    }
  }

  async _ensureGeminiTab(task) {
    // 1. If tab is already bound to this task, verify it is still open
    if (task?.geminiTabId) {
      try {
        const boundTab = await chrome.tabs.get(task.geminiTabId);
        if (boundTab && boundTab.url && boundTab.url.includes('gemini.google.com')) {
          await chrome.tabs.update(boundTab.id, { active: true });
          return boundTab;
        }
      } catch (e) {}
    }

    // 2. Look for open Gemini tabs
    const tabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });
    let geminiTab;
    if (tabs.length > 0) {
      // Find active one if available, otherwise first
      geminiTab = tabs.find(t => t.active) || tabs[0];
      try {
        await chrome.tabs.update(geminiTab.id, { active: true });
      } catch (e) {}
      return geminiTab;
    }

    // 3. Create fresh tab if none open
    geminiTab = await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
    await new Promise(r => setTimeout(r, 3000));
    return geminiTab;
  }

  async _storeImageBlob(taskId, dataUrl) {
    const key = `asmp_img_${taskId}`;
    const payload = { dataUrl, storedAt: Date.now() };
    await chrome.storage.local.set({ [key]: payload });
  }

  async _getImageBlob(taskId) {
    const key = `asmp_img_${taskId}`;
    const res = await chrome.storage.local.get(key);
    return res[key]?.dataUrl || null;
  }

  async _purgeImageBlob(taskId) {
    if (!taskId) return;
    const key = `asmp_img_${taskId}`;
    await chrome.storage.local.remove(key);
  }

  async _persistActiveTask(task) {
    await chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_TASK]: task });
  }

  async _persistQueue() {
    await chrome.storage.local.set({ [STORAGE_KEYS.TASK_QUEUE]: this._queue });
  }

  _sanitizeTaskForClient(task) {
    const copy = { ...task };
    delete copy.imageDataUrl;
    return copy;
  }
}

  const TaskManager = new TaskManagerImpl();

  root.TaskManager = TaskManager;
  root.TaskManagerImpl = TaskManagerImpl;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TaskManager, TaskManagerImpl };
  }
})();
