/**
 * TASK STATE MACHINE DEFINITIONS
 * ===============================
 * Defines explicit task states, transitions, and task object schemas.
 */

(function () {
  'use strict';

  const TaskStatus = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  PENDING_GEMINI: 'PENDING_GEMINI',
  GENERATED: 'GENERATED',
  REVIEWING: 'REVIEWING',
  APPLYING: 'APPLYING',
  APPLIED: 'APPLIED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  PAUSED_FOR_REVIEW: 'PAUSED_FOR_REVIEW'
};

// Valid transitions map
const VALID_TRANSITIONS = {
  [TaskStatus.IDLE]: [TaskStatus.QUEUED, TaskStatus.PENDING_GEMINI],
  [TaskStatus.QUEUED]: [TaskStatus.PENDING_GEMINI, TaskStatus.CANCELLED, TaskStatus.FAILED],
  [TaskStatus.PENDING_GEMINI]: [TaskStatus.GENERATED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.PAUSED_FOR_REVIEW],
  [TaskStatus.GENERATED]: [TaskStatus.REVIEWING, TaskStatus.APPLYING, TaskStatus.CANCELLED, TaskStatus.FAILED],
  [TaskStatus.REVIEWING]: [TaskStatus.APPLYING, TaskStatus.CANCELLED, TaskStatus.FAILED, TaskStatus.IDLE],
  [TaskStatus.APPLYING]: [TaskStatus.APPLIED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.PAUSED_FOR_REVIEW],
  [TaskStatus.APPLIED]: [TaskStatus.IDLE, TaskStatus.QUEUED],
  [TaskStatus.FAILED]: [TaskStatus.IDLE, TaskStatus.QUEUED, TaskStatus.CANCELLED],
  [TaskStatus.CANCELLED]: [TaskStatus.IDLE, TaskStatus.QUEUED],
  [TaskStatus.PAUSED_FOR_REVIEW]: [TaskStatus.GENERATED, TaskStatus.APPLYING, TaskStatus.REVIEWING, TaskStatus.QUEUED, TaskStatus.PENDING_GEMINI, TaskStatus.CANCELLED, TaskStatus.FAILED, TaskStatus.IDLE]
};

/**
 * Validates if a transition from current to target status is permitted.
 */
function canTransition(current, next) {
  if (current === next) return true;
  const allowed = VALID_TRANSITIONS[current];
  return !!(allowed && allowed.includes(next));
}

/**
 * Compute quick deterministic fingerprint of an image DataURL
 */
function generateImageFingerprint(imageDataUrl) {
  if (!imageDataUrl || typeof imageDataUrl !== 'string') return 'none';
  const len = imageDataUrl.length;
  const sample = imageDataUrl.slice(0, 50) + imageDataUrl.slice(Math.floor(len / 2), Math.floor(len / 2) + 50) + imageDataUrl.slice(-50);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash) + sample.charCodeAt(i);
    hash |= 0;
  }
  return `fp_${len}_${Math.abs(hash).toString(16)}`;
}

/**
 * Creates a validated Task object.
 */
function createTaskRecord(params) {
  const now = Date.now();
  const timeoutMs = params.timeoutMs || 75000;

  return {
    taskId: params.taskId || (crypto.randomUUID ? crypto.randomUUID() : `task_${now}_${Math.random().toString(36).slice(2, 8)}`),
    attemptId: params.attemptId || `att_${now}_1`,
    assetId: params.assetId || `asset_${now}`,
    imageFingerprint: params.imageFingerprint || generateImageFingerprint(params.imageDataUrl),
    sourceTabId: params.sourceTabId || null,
    geminiTabId: params.geminiTabId || null,
    status: params.status || TaskStatus.QUEUED,
    timestamps: {
      created: now,
      updated: now,
      deadline: now + timeoutMs,
    },
    settingsSnapshot: {
      autoFillTitle: params.settings?.autoFillTitle ?? true,
      autoFillKeywords: params.settings?.autoFillKeywords ?? true,
      skipExistingMetadata: params.settings?.skipExistingMetadata ?? true,
      customPrompt: params.settings?.customPrompt || null,
      platform: params.settings?.platform || 'adobe',
    },
    metadata: {
      title: params.metadata?.title || '',
      keywords: Array.isArray(params.metadata?.keywords) ? params.metadata.keywords : [],
      originalTitle: params.metadata?.originalTitle || '',
      originalKeywords: params.metadata?.originalKeywords || [],
    },
    error: params.error ? {
      code: params.error.code || 'UNKNOWN_ERROR',
      message: params.error.message || String(params.error),
      timestamp: now,
    } : null,
    retries: params.retries || 0,
  };
}

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.TaskStatus = TaskStatus;
  root.canTransition = canTransition;
  root.createTaskRecord = createTaskRecord;
  root.generateImageFingerprint = generateImageFingerprint;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TaskStatus, canTransition, createTaskRecord, generateImageFingerprint };
  }
})();
