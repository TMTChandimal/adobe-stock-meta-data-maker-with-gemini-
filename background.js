// Background Service Worker for Adobe Stock Metadata Pro
// Manifest V3 Compliant — Persistent State Machine & Safe Concurrency

importScripts(
  'src/config/product.config.js',
  'src/lib/messages.js',
  'src/lib/task-state.js',
  'src/lib/storage.js',
  'src/lib/license-client.js',
  'src/lib/entitlements.js',
  'src/lib/task-manager.js'
);

// ── WORKER INITIALIZATION & ALARM RECOVERY ──────────────────────────────────

// Register daily heartbeat alarm safely with try/catch
function setupAlarms() {
  try {
    if (typeof chrome !== 'undefined' && chrome.alarms) {
      chrome.alarms.get('licenseHeartbeat', (existing) => {
        if (!existing) {
          chrome.alarms.create('licenseHeartbeat', { periodInMinutes: 24 * 60 });
          console.log('[Background] Registered licenseHeartbeat alarm (24h period).');
        }
      });
    }
  } catch (err) {
    console.warn('[Background] Alarms registration error:', err.message);
  }
}

// Set up alarms on installation and startup
chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
});

// Periodic license validation heartbeat
if (chrome.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'licenseHeartbeat') {
      try {
        const license = await StorageService.getLicense();
        if (license && license.status === 'active') {
          const installId = await StorageService.getInstallationId();
          await LicenseClient.validate(license.licenseCode, installId);
          await EntitlementsService.refresh();
        }
      } catch (err) {
        console.warn('[Background] Heartbeat validation error:', err.message);
      }
    } else if (alarm.name.startsWith('taskTimeout_')) {
      const taskId = alarm.name.replace('taskTimeout_', '');
      try {
        await TaskManager.handleTaskTimeoutAlarm(taskId);
      } catch (err) {
        console.warn('[Background] Task timeout alarm handling error:', err.message);
      }
    }
  });
}

// Initialize services asynchronously without blocking listener registration
(async () => {
  try {
    await EntitlementsService.init();
    await TaskManager.init();
    setupAlarms();
  } catch (e) {
    console.warn('[Background] Service initialization notice:', e);
  }
})();

// ── CENTRAL MESSAGE ROUTER & AUTHORIZATION ──────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Authorize sender extension ID
  const auth = authorizeMessageSender(sender);
  if (!auth.authorized) {
    console.warn('[Background] Rejected unauthorized message:', auth.error);
    sendResponse({ success: false, error: auth.error });
    return false;
  }

  handleMessage(message, sender)
    .then(res => sendResponse(res))
    .catch(err => {
      console.error('[Background] Message handling error:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // Keep message channel open for async response
});

async function handleMessage(message, sender) {
  const action = message.action;

  // 1. Task Management: Enqueue / Start Flow
  if (action === MessageActions.START_TASK || action === 'START_METADATA_FLOW') {
    const sourceTabId = sender?.tab?.id || message.sourceTabId || message.adobeTabId;
    if (!sourceTabId) {
      return { success: false, error: 'Could not determine contributor tab ID.' };
    }

    try {
      const task = await TaskManager.enqueueTask({
        assetId: message.assetId || `asset_${Date.now()}`,
        sourceTabId: sourceTabId,
        imageDataUrl: message.imageDataUrl,
        settings: {
          platform: message.platform || 'adobe',
          customPrompt: message.promptOptions?.customPrompt || message.customPrompt,
          autoFillTitle: message.settings?.autoFillTitle ?? true,
          autoFillKeywords: message.settings?.autoFillKeywords ?? true,
          skipExistingMetadata: message.settings?.skipExistingMetadata ?? true,
        }
      });
      return { success: true, task };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 2. Task Management: Cancel
  if (action === MessageActions.CANCEL_TASK || action === 'CANCEL_METADATA_FLOW') {
    await TaskManager.cancelTask(message.taskId);
    return { success: true };
  }

  // 2b. Task Management: Retry
  if (action === MessageActions.RETRY_TASK || action === 'RETRY_METADATA_FLOW') {
    try {
      const task = await TaskManager.retryTask(message.taskId);
      return { success: true, task };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 2c. Task Management: Resume
  if (action === MessageActions.RESUME_TASK || action === 'RESUME_METADATA_FLOW' || action === 'APPLY_REVIEWED_METADATA') {
    try {
      const task = await TaskManager.resumeTask(message.taskId, message.metadata);
      return { success: true, task };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 3. Task Management: Get State / Status
  if (action === MessageActions.GET_STATE || action === 'GET_CURRENT_STATUS' || action === 'CHECK_PENDING_TASK') {
    const state = await TaskManager.getState();
    return { success: true, ...state };
  }

  // 4. Gemini Pipeline: Result
  if (action === MessageActions.GEMINI_RESULT || action === 'GEMINI_METADATA_RESULT') {
    const authGemini = authorizeMessageSender(sender, {
      allowedOrigins: ['https://gemini.google.com']
    });
    if (!authGemini.authorized) {
      return { success: false, error: 'Unauthorized Gemini sender.' };
    }
    const res = await TaskManager.handleGeminiResult(message, sender);
    return { success: true, ...res };
  }

  // 5. Gemini Pipeline: Error
  if (action === MessageActions.GEMINI_ERROR || action === 'GEMINI_METADATA_ERROR') {
    const res = await TaskManager.handleGeminiError(message, sender);
    return { success: true, ...res };
  }

  // 6. Adobe Application Confirmation
  if (action === MessageActions.METADATA_APPLIED) {
    await TaskManager.handleMetadataApplied(message);
    return { success: true };
  }

  if (action === MessageActions.METADATA_APPLY_FAILED) {
    await TaskManager.handleMetadataApplyFailed(message);
    return { success: true };
  }

  // 7. License & Entitlements
  if (action === MessageActions.CHECK_ENTITLEMENTS) {
    await EntitlementsService.refresh();
    const info = EntitlementsService.getLicenseInfo();
    const usage = await EntitlementsService.getDailyUsage();
    return { success: true, info, usage };
  }

  if (action === MessageActions.ACTIVATE_LICENSE) {
    const installId = await StorageService.getInstallationId();
    const result = await LicenseClient.activate(message.licenseCode, installId);
    if (result.success) {
      await StorageService.setLicense({
        licenseCode: message.licenseCode,
        licenseId: result.data.licenseId,
        plan: result.data.plan,
        status: 'active',
        expiresAt: result.data.expiresAt,
        activationLimit: result.data.activationLimit,
        activatedDevices: result.data.activatedDevices,
        signedLease: result.data.signedLease || null,
        lastVerifiedAt: Date.now()
      });
      await EntitlementsService.refresh();
    }
    return result;
  }

  if (action === MessageActions.DEACTIVATE_LICENSE) {
    const license = await StorageService.getLicense();
    if (!license) return { success: true };
    const installId = await StorageService.getInstallationId();
    const result = await LicenseClient.deactivate(license.licenseCode, installId);
    if (result.success) {
      await StorageService.clearLicense();
      await EntitlementsService.refresh();
    }
    return result;
  }

  // 8. First-Use Consent Status
  if (action === MessageActions.GET_CONSENT_STATUS) {
    const result = await chrome.storage.local.get('asmp_user_consent');
    return { success: true, consent: !!result.asmp_user_consent };
  }

  if (action === MessageActions.SET_CONSENT_STATUS) {
    await chrome.storage.local.set({ asmp_user_consent: true, asmp_consent_time: Date.now() });
    return { success: true };
  }

  // 9. Fetch Image DataURL from Contributor Page (bypasses CORS restrictions)
  if (action === MessageActions.FETCH_IMAGE_DATA_URL || action === 'FETCH_IMAGE_AS_DATA_URL') {
    try {
      const dataUrl = await fetchImageAsDataUrlFromBackground(message.url);
      return { success: true, dataUrl };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  // 10. Open Workspace View (Extension page or Side Panel)
  if (action === MessageActions.OPEN_WORKSPACE) {
    try {
      if (chrome.sidePanel && sender?.tab?.id) {
        await chrome.sidePanel.open({ tabId: sender.tab.id });
        return { success: true, type: 'sidePanel' };
      }
    } catch (e) {
      // Fallback to extension tab
    }
    const appUrl = chrome.runtime.getURL('ui/app.html');
    const tab = await chrome.tabs.create({ url: appUrl, active: true });
    return { success: true, type: 'tab', tabId: tab.id };
  }

  return { success: false, error: `Unknown message action: ${action}` };
}

async function fetchImageAsDataUrlFromBackground(url) {
  if (!url || typeof url !== 'string') {
    throw new Error('Missing or invalid image URL');
  }

  // Validate URL host strictly against observed Adobe & CDN domains
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    throw new Error(`Invalid URL format: ${url}`);
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    throw new Error(`Forbidden protocol: ${parsedUrl.protocol}`);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const allowedHostPatterns = [
    /^([a-z0-9-]+\.)?ftcdn\.net$/i,
    /^([a-z0-9-]+\.)?adobe\.com$/i,
    /^contributor\.stock\.adobe\.com$/i,
    /^stock\.adobe\.com$/i
  ];

  const isAllowedHost = allowedHostPatterns.some(rx => rx.test(hostname));
  if (!isAllowedHost) {
    throw new Error(`Forbidden image host: ${hostname}. Only observed Adobe and CDN hosts are permitted.`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error(`Non-image payload received from CDN: ${contentType}. Expected image format.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000; // 32KB chunks
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  const base64 = btoa(binary);
  return `data:${contentType};base64,${base64}`;
}

