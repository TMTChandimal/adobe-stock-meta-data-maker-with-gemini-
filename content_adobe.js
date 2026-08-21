// content_adobe.js - Adobe Stock Contributor Content Script

(function () {
  let toastElement = null;
  let statusTextElement = null;
  let actionButton = null;

  let isBatchProcessing = false;
  let stopBatchRequested = false;
  let currentMetadataResolve = null;

  function initUI() {
    if (document.getElementById('gemini-adobe-floating-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-adobe-floating-container';

    toastElement = document.createElement('div');
    toastElement.className = 'gemini-adobe-toast';
    toastElement.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div id="gemini-status-spinner" class="gemini-spinner" style="display: none;"></div>
        <span id="gemini-status-text">Ready</span>
      </div>
    `;

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.gap = '8px';

    actionButton = document.createElement('button');
    actionButton.className = 'gemini-adobe-btn';
    actionButton.title = 'Process only the selected image';
    actionButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
      </svg>
      <span>Process Selected</span>
    `;
    actionButton.addEventListener('click', handleAutoMetadataClick);

    const batchButton = document.createElement('button');
    batchButton.className = 'gemini-adobe-btn';
    batchButton.style.background = 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)';
    batchButton.title = 'Loop through all uploaded images in grid';
    batchButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <span>Process ALL Images</span>
    `;
    batchButton.addEventListener('click', handleBatchProcessClick);

    const stopButton = document.createElement('button');
    stopButton.id = 'gemini-stop-btn';
    stopButton.className = 'gemini-adobe-btn';
    stopButton.style.background = '#ef4444';
    stopButton.style.display = 'none';
    stopButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12"/>
      </svg>
      <span>Stop Batch</span>
    `;
    stopButton.addEventListener('click', stopBatchProcess);

    buttonGroup.appendChild(actionButton);
    buttonGroup.appendChild(batchButton);
    buttonGroup.appendChild(stopButton);

    container.appendChild(toastElement);
    container.appendChild(buttonGroup);
    document.body.appendChild(container);

    statusTextElement = container.querySelector('#gemini-status-text');
  }

  function showToast(message, isLoading = false) {
    if (!toastElement) return;
    toastElement.classList.add('show');
    statusTextElement.textContent = message;
    const spinner = toastElement.querySelector('#gemini-status-spinner');
    if (spinner) {
      spinner.style.display = isLoading ? 'block' : 'none';
    }
  }

  function hideToast(delay = 4000) {
    setTimeout(() => {
      if (toastElement && !isBatchProcessing) toastElement.classList.remove('show');
    }, delay);
  }

  function stopBatchProcess() {
    stopBatchRequested = true;
    isBatchProcessing = false;
    const stopBtn = document.getElementById('gemini-stop-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    showToast('⏹️ Stopping batch processing...');
    hideToast(4000);
  }

  async function handleBatchProcessClick() {
    if (isBatchProcessing) return;

    const cards = getAllAssetCards();
    if (cards.length === 0) {
      showToast('❌ No uploaded images found in the upload grid.');
      hideToast(5000);
      return;
    }

    isBatchProcessing = true;
    stopBatchRequested = false;

    const stopBtn = document.getElementById('gemini-stop-btn');
    if (stopBtn) stopBtn.style.display = 'flex';

    showToast(`🚀 Starting batch processing for ${cards.length} images...`, true);

    for (let i = 0; i < cards.length; i++) {
      if (stopBatchRequested) {
        showToast('⏹️ Batch processing cancelled by user.');
        break;
      }

      const card = cards[i];
      showToast(`📸 Processing Image ${i + 1} of ${cards.length}...`, true);

      // Select card in Adobe Stock UI
      try {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.click();
        await sleep(1000);
      } catch (e) {
        console.warn('Failed to click card element:', e);
      }

      // Check if image already has metadata (Title & Keywords)
      if (checkIfSelectedAssetHasMetadata()) {
        console.log(`Skipping Image ${i + 1} of ${cards.length}: Metadata already present.`);
        showToast(`⏭️ Skipping Image ${i + 1} of ${cards.length} (Already has metadata)`);
        await sleep(600);
        continue;
      }

      // Extract image data
      let imageDataUrl = await captureTargetImage();
      if (!imageDataUrl) {
        // Fallback: try capturing image directly inside card
        const imgInside = card.querySelector('img');
        if (imgInside) {
          imageDataUrl = await convertImgToDataUrl(imgInside);
        }
      }

      if (!imageDataUrl) {
        console.warn(`Skipping card ${i + 1}: could not extract image data.`);
        continue;
      }

      // Start metadata promise
      const metadataPromise = new Promise((resolve) => {
        currentMetadataResolve = resolve;
        // Timeout safeguard (60s)
        setTimeout(() => resolve(null), 60000);
      });

      chrome.runtime.sendMessage({
        action: 'START_METADATA_FLOW',
        imageDataUrl: imageDataUrl
      });

      // Wait for Gemini to complete and apply metadata
      const result = await metadataPromise;
      currentMetadataResolve = null;

      if (!result) {
        console.warn(`Image ${i + 1} timed out or failed.`);
      }

      await sleep(1500); // Inter-item delay
    }

    isBatchProcessing = false;
    if (stopBtn) stopBtn.style.display = 'none';

    if (!stopBatchRequested) {
      showToast(`🎉 Batch Completed! Processed all ${cards.length} images successfully.`);
      hideToast(6000);
    }
  }

  function checkIfSelectedAssetHasMetadata() {
    // 1. Check Title Field
    const titleSelectors = [
      'input[name="title"]',
      'textarea[name="title"]',
      '#title',
      '[aria-label*="title" i]',
      '[data-test-id*="title"]',
      '[data-t*="title"]',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]'
    ];

    let hasTitle = false;
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel);
      if (el && el.value && el.value.trim().length > 3) {
        hasTitle = true;
        break;
      }
    }

    // 2. Check Keywords Field
    const keywordSelectors = [
      'textarea[name="keywords"]',
      'textarea[id*="keyword" i]',
      'textarea[placeholder*="keyword" i]',
      'textarea[aria-label*="keyword" i]',
      '[data-t*="keyword"] textarea',
      '[data-test-id*="keyword"] textarea',
      '#keywords',
      'textarea.spectrum-Textfield-input',
      '[data-t*="keyword"] input',
      '[data-test-id*="keyword"] input',
      'input[name="keywords"]',
      'input[id*="keyword" i]',
      'input[placeholder*="keyword" i]',
      'input[aria-label*="keyword" i]'
    ];

    let hasKeywords = false;
    for (const sel of keywordSelectors) {
      const el = document.querySelector(sel);
      if (el && el.value && el.value.trim().length > 5) {
        hasKeywords = true;
        break;
      }
    }

    // Also check for keyword tag chips DOM elements
    if (!hasKeywords) {
      const tagChips = document.querySelectorAll('.spectrum-Tag, .tag-chip, .keyword-chip, [data-t*="keyword-tag"], .keyword-item, .tag-item');
      if (tagChips.length >= 3) {
        hasKeywords = true;
      }
    }

    return hasTitle && hasKeywords;
  }

  function getAllAssetCards() {
    const cardSelectors = [
      '.asset-card',
      '[data-test-id*="media-card"]',
      '[data-t*="media-card"]',
      '.asset-item',
      '.media-card',
      '[role="option"]',
      '.grid-item',
      '.upload-card'
    ];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      if (found.length > 0) return found;
    }
    // Fallback search
    const allImgs = Array.from(document.querySelectorAll('img')).filter(img => img.naturalWidth > 60 && img.naturalHeight > 60);
    return allImgs.map(img => img.closest('div, li, article') || img);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }


  async function handleAutoMetadataClick() {
    try {
      showToast('Extracting image data...', true);

      const imageDataUrl = await captureTargetImage();
      if (!imageDataUrl) {
        showToast('❌ Could not find an active or uploaded image. Please select an image.');
        hideToast(5000);
        return;
      }

      showToast('Opening Gemini tab...', true);

      chrome.runtime.sendMessage({
        action: 'START_METADATA_FLOW',
        imageDataUrl: imageDataUrl
      }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast('❌ Error starting flow: ' + (chrome.runtime.lastError?.message || response?.error || 'Unknown error'));
          hideToast(6000);
        } else {
          showToast('Request sent to Gemini. Generating title & keywords...', true);
        }
      });

    } catch (err) {
      console.error('Gemini metadata error:', err);
      showToast('❌ Error: ' + err.message);
      hideToast(6000);
    }
  }

  async function captureTargetImage() {
    // 1. Look for selected item image or large preview item in Adobe Stock UI
    const selectors = [
      '[aria-selected="true"] img',
      '.selected img',
      '[data-test-id*="selected"] img',
      '.asset-card.selected img',
      '.asset-detail-image img',
      '.asset-item.active img',
      '.media-card img',
      'img[src*="stock"]',
      'img[src*="adobe"]',
      'img[src*="blob:"]',
      'main img',
      '.content img'
    ];

    let targetImg = null;
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.src && el.width > 50 && el.height > 50) {
        targetImg = el;
        break;
      }
    }

    // Fallback: search all visible images on page
    if (!targetImg) {
      const allImgs = Array.from(document.querySelectorAll('img'));
      targetImg = allImgs.find(img => img.src && img.naturalWidth > 100 && img.naturalHeight > 100);
    }

    if (!targetImg) return null;

    return convertImgToDataUrl(targetImg);
  }

  function convertImgToDataUrl(imgElement) {
    return new Promise((resolve) => {
      if (imgElement.src.startsWith('data:image')) {
        resolve(imgElement.src);
        return;
      }

      // Try canvas conversion
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = imgElement.naturalWidth || imgElement.width || 800;
      canvas.height = imgElement.naturalHeight || imgElement.height || 600;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          // If tainted canvas due to CORS, fetch image blob
          fetchImageAsDataUrl(imgElement.src).then(resolve);
        }
      };
      img.onerror = () => {
        fetchImageAsDataUrl(imgElement.src).then(resolve);
      };
      img.src = imgElement.src;
    });
  }

  async function fetchImageAsDataUrl(url) {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.error('Fetch image as DataURL failed:', e);
      return null;
    }
  }

  function applyMetadataToAdobe(data) {
    const { title, keywords } = data;
    showToast('Applying Title & Keywords...', true);

    let titleApplied = false;
    let keywordsApplied = false;

    // 1. Fill Title Field
    const titleSelectors = [
      'input[name="title"]',
      'textarea[name="title"]',
      '#title',
      '[aria-label*="title" i]',
      '[data-test-id*="title"]',
      '[data-t*="title"]',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]'
    ];

    let titleField = null;
    for (const sel of titleSelectors) {
      titleField = document.querySelector(sel);
      if (titleField) break;
    }

    // Fallback search for title field among visible inputs
    if (!titleField) {
      const allTextInputs = Array.from(document.querySelectorAll('input[type="text"], textarea'));
      titleField = allTextInputs.find(el => {
        const attr = (el.id + ' ' + el.name + ' ' + el.placeholder + ' ' + el.getAttribute('aria-label')).toLowerCase();
        return attr.includes('title');
      });
    }

    if (titleField) {
      setNativeInputValue(titleField, title);
      titleApplied = true;
      console.log('Title applied successfully to Adobe Stock field:', titleField);
    }

    // 2. Fill Keywords Field
    const keywordArray = Array.isArray(keywords) ? keywords : keywords.split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);
    const keywordsFormatted = keywordArray.join(', ');

    // Check if Adobe Stock has a "Paste keywords" expander button
    const pasteButtons = Array.from(document.querySelectorAll('button, a, span')).filter(el => {
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('paste keyword') || txt.includes('paste tags') || el.getAttribute('data-t') === 'paste-keywords-button';
    });
    for (const btn of pasteButtons) {
      try {
        btn.click();
        console.log('Clicked Adobe Stock Paste Keywords button');
      } catch (e) {}
    }

    // Search for Keyword fields
    const keywordSelectors = [
      'textarea[name="keywords"]',
      'textarea[id*="keyword" i]',
      'textarea[placeholder*="keyword" i]',
      'textarea[aria-label*="keyword" i]',
      '[data-t*="keyword"] textarea',
      '[data-test-id*="keyword"] textarea',
      '#keywords',
      'textarea.spectrum-Textfield-input',
      '[data-t*="keyword"] input',
      '[data-test-id*="keyword"] input',
      'input[name="keywords"]',
      'input[id*="keyword" i]',
      'input[placeholder*="keyword" i]',
      'input[aria-label*="keyword" i]',
      '.keyword-input-container input',
      '.tags-input input'
    ];

    let keywordField = null;
    for (const sel of keywordSelectors) {
      keywordField = document.querySelector(sel);
      if (keywordField && keywordField !== titleField) break;
    }

    // Fallback search for keyword field among all inputs/textareas
    if (!keywordField) {
      const allInputs = Array.from(document.querySelectorAll('textarea, input[type="text"]'));
      keywordField = allInputs.find(el => {
        if (el === titleField) return false;
        const attr = (el.id + ' ' + el.name + ' ' + el.placeholder + ' ' + el.getAttribute('aria-label') + ' ' + el.className).toLowerCase();
        return attr.includes('keyword') || attr.includes('tag');
      });
    }

    if (keywordField) {
      console.log('Found Keyword field:', keywordField);

      // Approach 1: Write full comma-separated string
      setNativeInputValue(keywordField, keywordsFormatted);
      
      // Dispatch enter/comma keypresses to trigger Adobe tag chip creation
      keywordField.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, bubbles: true }));
      keywordField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

      // Approach 2: If it's a chip input tag, add individual keywords sequentially
      if (keywordField.tagName.toLowerCase() === 'input') {
        addChipKeywordsSequentially(keywordField, keywordArray);
      }

      // Check for any "Add" button next to keywords box and click it
      setTimeout(() => {
        const parentContainer = keywordField.closest('div, section, form') || document.body;
        const addButtons = Array.from(parentContainer.querySelectorAll('button')).filter(b => {
          const t = (b.textContent || '').toLowerCase();
          return t === 'add' || t.includes('add keyword') || t.includes('save');
        });
        for (const b of addButtons) {
          try { b.click(); } catch(e) {}
        }
      }, 300);

      keywordsApplied = true;
    }

    if (titleApplied || keywordsApplied) {
      showToast('✨ Success! Metadata applied to Adobe Stock.');
      hideToast(4000);
    } else {
      showToast('⚠️ Could not locate Title/Keyword input fields automatically. Please check your selected asset page.');
      hideToast(6000);
    }

    if (currentMetadataResolve) {
      currentMetadataResolve(data);
    }
  }

  function setNativeInputValue(element, value) {
    if (!element) return;
    element.focus();

    const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function addChipKeywordsSequentially(inputElement, keywordArray) {
    let delay = 0;
    keywordArray.forEach((kw) => {
      const cleanKw = kw.trim();
      if (!cleanKw) return;
      setTimeout(() => {
        setNativeInputValue(inputElement, cleanKw);
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, bubbles: true }));
        inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        inputElement.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }, delay);
      delay += 40;
    });
  }

  // Listen for messages from background service worker or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'APPLY_ADOBE_METADATA') {
      applyMetadataToAdobe(message.data);
    } else if (message.action === 'TRIGGER_AUTO_METADATA') {
      handleAutoMetadataClick();
      if (sendResponse) sendResponse({ status: 'STARTED' });
    } else if (message.action === 'TRIGGER_BATCH_METADATA') {
      handleBatchProcessClick();
      if (sendResponse) sendResponse({ status: 'BATCH_STARTED' });
    } else if (message.action === 'SHOW_ERROR_STATUS') {
      showToast('❌ ' + (message.error || 'Failed to generate metadata in Gemini.'));
      if (currentMetadataResolve) currentMetadataResolve(null);
      hideToast(6000);
    }
  });

  // Wait for document ready to inject UI
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
