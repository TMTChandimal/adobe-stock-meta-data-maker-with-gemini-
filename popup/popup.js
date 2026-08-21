// popup.js - Extension Popup Logic

document.addEventListener('DOMContentLoaded', () => {
  const btnGenerate = document.getElementById('btn-generate');
  const btnOpenAdobe = document.getElementById('btn-open-adobe');
  const btnOpenGemini = document.getElementById('btn-open-gemini');
  const statusMessage = document.getElementById('status-message');
  const statusPill = document.getElementById('status-pill');

  // Check background status
  chrome.runtime.sendMessage({ action: 'GET_CURRENT_STATUS' }, (response) => {
    if (response && response.task) {
      updateStatusUI(response.task);
    }
  });

  const btnBatch = document.getElementById('btn-batch');

  btnGenerate.addEventListener('click', async () => {
    // 1. Get active Adobe Stock tab
    const [adobeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!adobeTab || !adobeTab.url || !adobeTab.url.includes('contributor.stock.adobe.com')) {
      statusMessage.textContent = '⚠️ Please open and switch to an Adobe Stock Contributor tab first.';
      return;
    }

    statusMessage.textContent = '🚀 Extracting image & initiating Gemini flow...';
    statusPill.textContent = 'Busy';
    statusPill.className = 'status-pill busy';

    // Execute capture directly or send message to content_adobe.js
    chrome.tabs.sendMessage(adobeTab.id, { action: 'TRIGGER_AUTO_METADATA' }, (res) => {
      if (chrome.runtime.lastError) {
        chrome.scripting.executeScript({
          target: { tabId: adobeTab.id },
          files: ['content_adobe.js']
        }).then(() => {
          statusMessage.textContent = 'Script injected. Please click Process Selected on page or try again.';
        }).catch(err => {
          statusMessage.textContent = 'Error: ' + err.message;
        });
      }
    });
  });

  btnBatch.addEventListener('click', async () => {
    const [adobeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!adobeTab || !adobeTab.url || !adobeTab.url.includes('contributor.stock.adobe.com')) {
      statusMessage.textContent = '⚠️ Please open and switch to an Adobe Stock Contributor tab first.';
      return;
    }

    statusMessage.textContent = '⚡ Starting Batch loop for all uploaded images...';
    statusPill.textContent = 'Batching';
    statusPill.className = 'status-pill busy';

    chrome.tabs.sendMessage(adobeTab.id, { action: 'TRIGGER_BATCH_METADATA' });
  });

  btnOpenAdobe.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://contributor.stock.adobe.com/' });
  });

  btnOpenGemini.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://gemini.google.com/app' });
  });

  function updateStatusUI(task) {
    if (task.status === 'PENDING_GEMINI') {
      statusMessage.textContent = '⏳ Task in progress: Processing image in Gemini tab...';
      statusPill.textContent = 'Processing';
      statusPill.className = 'status-pill busy';
    } else if (task.status === 'COMPLETED') {
      statusMessage.textContent = `✅ Last Task Completed! Title: "${task.result.title.substring(0, 30)}..."`;
      statusPill.textContent = 'Completed';
      statusPill.className = 'status-pill';
    } else if (task.status === 'FAILED') {
      statusMessage.textContent = `❌ Task Failed: ${task.error}`;
      statusPill.textContent = 'Error';
      statusPill.className = 'status-pill busy';
    }
  }
});
