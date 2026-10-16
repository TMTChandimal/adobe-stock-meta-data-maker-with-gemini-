/**
 * MESSAGE CONTRACTS & SENDER AUTHORIZATION
 * ========================================
 * Standardized message schemas, action constants, and security validation.
 */

(function () {
  'use strict';

  const MessageActions = {
  // Flow control
  START_TASK: 'START_TASK',
  CANCEL_TASK: 'CANCEL_TASK',
  RETRY_TASK: 'RETRY_TASK',
  RESUME_TASK: 'RESUME_TASK',
  GET_STATE: 'GET_STATE',
  CLEAR_QUEUE: 'CLEAR_QUEUE',

  // Gemini pipeline
  DISPATCH_GEMINI: 'DISPATCH_GEMINI',
  GEMINI_RESULT: 'GEMINI_RESULT',
  GEMINI_ERROR: 'GEMINI_ERROR',
  GEMINI_BUSY: 'GEMINI_BUSY',

  // Adobe application
  APPLY_METADATA: 'APPLY_METADATA',
  METADATA_APPLIED: 'METADATA_APPLIED',
  METADATA_APPLY_FAILED: 'METADATA_APPLY_FAILED',

  // Status events (broadcast)
  TASK_STATUS_UPDATE: 'TASK_STATUS_UPDATE',
  BATCH_PROGRESS_UPDATE: 'BATCH_PROGRESS_UPDATE',

  // Entitlements & Licensing
  CHECK_ENTITLEMENTS: 'CHECK_ENTITLEMENTS',
  ACTIVATE_LICENSE: 'ACTIVATE_LICENSE',
  DEACTIVATE_LICENSE: 'DEACTIVATE_LICENSE',
  VALIDATE_LICENSE: 'VALIDATE_LICENSE',

  // Consent & First-Use
  GET_CONSENT_STATUS: 'GET_CONSENT_STATUS',
  SET_CONSENT_STATUS: 'SET_CONSENT_STATUS',

  // UI Utilities
  FETCH_IMAGE_DATA_URL: 'FETCH_IMAGE_DATA_URL',
  OPEN_WORKSPACE: 'OPEN_WORKSPACE'
};

/**
 * Validates that an incoming Chrome runtime message originated from an authorized source.
 *
 * @param {object} sender - chrome.runtime.MessageSender
 * @param {object} options
 * @param {string[]} [options.allowedOrigins] - Allowed URL origins
 * @param {number} [options.expectedTabId] - Specific expected tab ID
 * @param {boolean} [options.allowExtensionPages=true] - Whether extension internal pages (popup, app) are allowed
 * @returns {{ authorized: boolean, error?: string }}
 */
function authorizeMessageSender(sender, options = {}) {
  // 1. Extension ID check: Must always match current extension
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    if (sender?.id !== chrome.runtime.id) {
      return { authorized: false, error: 'Unauthorized sender: extension ID mismatch.' };
    }
  }

  const {
    allowedOrigins = [],
    expectedTabId = null,
    allowExtensionPages = true,
  } = options;

  const senderUrl = sender?.url || sender?.tab?.url || '';

  // 2. Check extension internal pages (popup, sidepanel, options, app page)
  const isExtensionPage = senderUrl.startsWith('chrome-extension://');
  if (isExtensionPage) {
    if (allowExtensionPages) {
      return { authorized: true };
    }
    return { authorized: false, error: 'Extension pages not authorized for this action.' };
  }

  // 3. Check allowed web origins if specified
  if (allowedOrigins.length > 0) {
    const isAllowed = allowedOrigins.some(origin => senderUrl.startsWith(origin));
    if (!isAllowed) {
      return { authorized: false, error: `Sender origin ${senderUrl} not in allowed origins list.` };
    }
  }

  // 4. Check expected tab ID if specified
  if (expectedTabId !== null && sender?.tab?.id) {
    if (sender.tab.id !== expectedTabId) {
      return { authorized: false, error: `Sender tab ID ${sender.tab.id} does not match expected tab ${expectedTabId}.` };
    }
  }

  return { authorized: true };
}

  // Global exposure for non-module extension scripts
  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.MessageActions = MessageActions;
  root.authorizeMessageSender = authorizeMessageSender;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { MessageActions, authorizeMessageSender };
  }
})();
