// Background Service Worker for Adobe Stock Metadata Generator
let currentTask = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'START_METADATA_FLOW') {
    handleStartFlow(message, sender, sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === 'CHECK_PENDING_TASK') {
    if (currentTask && currentTask.status === 'PENDING_GEMINI') {
      sendResponse({ hasTask: true, task: currentTask });
    } else {
      sendResponse({ hasTask: false });
    }
    return true;
  }

  if (message.action === 'GEMINI_METADATA_RESULT') {
    handleGeminiResult(message, sender);
    sendResponse({ status: 'ACKNOWLEDGED' });
    return true;
  }

  if (message.action === 'GEMINI_METADATA_ERROR') {
    handleGeminiError(message);
    sendResponse({ status: 'ACKNOWLEDGED' });
    return true;
  }

  if (message.action === 'GET_CURRENT_STATUS') {
    sendResponse({ task: currentTask });
    return true;
  }
});

async function handleStartFlow(message, sender, sendResponse) {
  try {
    const adobeTabId = sender?.tab?.id || message.adobeTabId;
    if (!adobeTabId) {
      sendResponse({ success: false, error: 'Could not determine Adobe Stock tab ID.' });
      return;
    }

    currentTask = {
      adobeTabId: adobeTabId,
      imageDataUrl: message.imageDataUrl,
      promptOptions: message.promptOptions || {},
      status: 'PENDING_GEMINI',
      timestamp: Date.now()
    };

    // Find active or open Gemini tab without refreshing or navigating away
    const geminiTabs = await chrome.tabs.query({ url: 'https://gemini.google.com/*' });

    let geminiTab;
    if (geminiTabs.length > 0) {
      geminiTab = geminiTabs[0];
      // Simply activate the existing Gemini tab in the same conversation session
      await chrome.tabs.update(geminiTab.id, { active: true });
    } else {
      // Create Gemini tab if not open at all
      geminiTab = await chrome.tabs.create({ url: 'https://gemini.google.com/app', active: true });
      await sleep(2500); // Wait for tab creation load
    }

    // Ensure single task dispatch to Gemini tab
    try {
      await chrome.tabs.sendMessage(geminiTab.id, {
        action: 'PROCESS_IMAGE_IN_GEMINI',
        task: currentTask
      });
    } catch (e) {
      // If content script was not injected yet, inject once and send
      await chrome.scripting.executeScript({
        target: { tabId: geminiTab.id },
        files: ['content_gemini.js']
      });
      await sleep(400);
      await chrome.tabs.sendMessage(geminiTab.id, {
        action: 'PROCESS_IMAGE_IN_GEMINI',
        task: currentTask
      });
    }

    sendResponse({ success: true, message: 'Gemini process initiated.' });
  } catch (err) {
    console.error('Error starting metadata flow:', err);
    sendResponse({ success: false, error: err.message });
  }
}

async function handleGeminiResult(message, sender) {
  if (!currentTask || !currentTask.adobeTabId) {
    console.error('Received Gemini result but no active task found.');
    return;
  }

  const { title, keywords } = message.data;
  const adobeTabId = currentTask.adobeTabId;

  currentTask.status = 'COMPLETED';
  currentTask.result = { title, keywords };

  try {
    // Switch focus back to Adobe Stock Contributor tab
    await chrome.tabs.update(adobeTabId, { active: true });

    // Send metadata to Adobe Stock content script
    await chrome.tabs.sendMessage(adobeTabId, {
      action: 'APPLY_ADOBE_METADATA',
      data: { title, keywords }
    });
  } catch (err) {
    console.error('Failed to send metadata back to Adobe Stock tab:', err);
  }
}

async function handleGeminiError(message) {
  if (!currentTask || !currentTask.adobeTabId) return;

  currentTask.status = 'FAILED';
  currentTask.error = message.error;

  try {
    await chrome.tabs.update(currentTask.adobeTabId, { active: true });
    await chrome.tabs.sendMessage(currentTask.adobeTabId, {
      action: 'SHOW_ERROR_STATUS',
      error: message.error
    });
  } catch (err) {
    console.error('Error notifying Adobe Stock tab of failure:', err);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
