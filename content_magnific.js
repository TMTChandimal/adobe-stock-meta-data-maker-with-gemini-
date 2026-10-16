// content_magnific.js - Magnific & Freepik Contributor Content Script

(function () {
  let toastElement = null;
  let statusTextElement = null;
  let actionButton = null;

  let isBatchProcessing = false;
  let stopBatchRequested = false;
  let currentMetadataResolve = null;

  function initUI() {
    if (typeof EntitlementsService !== 'undefined') {
      EntitlementsService.init().catch(e => console.warn('[Magnific] Entitlements init:', e));
    }

    if (document.getElementById('gemini-magnific-floating-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-magnific-floating-container';

    toastElement = document.createElement('div');
    toastElement.className = 'gemini-magnific-toast';
    toastElement.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px;">
        <div id="gemini-magnific-spinner" class="gemini-magnific-spinner" style="display: none;"></div>
        <span id="gemini-magnific-status-text">Ready</span>
      </div>
    `;

    const buttonGroup = document.createElement('div');
    buttonGroup.style.display = 'flex';
    buttonGroup.style.gap = '8px';

    actionButton = document.createElement('button');
    actionButton.className = 'gemini-magnific-btn';
    actionButton.title = 'Process only the selected Magnific image';
    actionButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
      </svg>
      <span>Process Selected</span>
    `;
    actionButton.addEventListener('click', handleAutoMetadataClick);

    const batchButton = document.createElement('button');
    batchButton.className = 'gemini-magnific-btn';
    batchButton.style.background = 'linear-gradient(135deg, #10b981 0%, #0ea5e9 100%)';
    batchButton.title = 'Loop through all uploaded images in Magnific contributor grid';
    batchButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <span>Process ALL Images</span>
    `;
    batchButton.addEventListener('click', handleBatchProcessClick);

    const stopButton = document.createElement('button');
    stopButton.id = 'gemini-magnific-stop-btn';
    stopButton.className = 'gemini-magnific-btn';
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

    statusTextElement = container.querySelector('#gemini-magnific-status-text');
  }

  function showToast(message, isLoading = false) {
    if (!toastElement) return;
    toastElement.classList.add('show');
    statusTextElement.textContent = message;
    const spinner = toastElement.querySelector('#gemini-magnific-spinner');
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
    const stopBtn = document.getElementById('gemini-magnific-stop-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    showToast('⏹️ Stopping batch processing...');
    hideToast(4000);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isElementVisible(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // -------------------------------------------------------------
  // Card & Image Extraction with Strict Exclusions
  // -------------------------------------------------------------

  function isValidAssetImage(img) {
    if (!img || !img.src) return false;
    const src = img.src.toLowerCase();

    // STRICT EXCLUSIONS (Avoid profile photos, logos, UI icons, badges)
    if (src.includes('googleusercontent.com')) return false;
    if (src.includes('avatar') || src.includes('user-default')) return false;
    if (src.includes('logo') || src.includes('aigenerated') || src.includes('favicon') || src.includes('onetrust')) return false;
    if (src.endsWith('.svg') || src.includes('.svg?')) return false;

    // Check parent tree
    if (img.closest('.avatar, #header, #menu, .nav, .user, .logo, .aiIcon, .badge--notifications')) {
      return false;
    }

    return true;
  }

  function getAllAssetCards() {
    const cards = Array.from(document.querySelectorAll('[data-cy="preitem"], .catalog__item, .card-resource, .resource-card, .file-card'));
    return cards.filter(card => {
      if (card.classList.contains('catalog__item--fake')) return false;
      const img = card.querySelector('img[data-cy="preitemImg-grid"], .thumbnail img, img');
      return img && isValidAssetImage(img);
    });
  }

  function isCardSelected(card) {
    const input = card.querySelector('input[type="checkbox"], input[name="checkbox"]');
    if (input && input.checked) return true;
    if (card.classList.contains('active') || card.classList.contains('selected') || card.classList.contains('is-selected')) return true;
    const indicator = card.querySelector('[data-cy="preitemCheck"]');
    if (indicator && indicator.querySelector('.icon--check')) return true;
    return false;
  }

  function selectCard(card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const indicator = card.querySelector('[data-cy="preitemCheck"]');
    const label = card.querySelector('label.checkbox');
    const input = card.querySelector('input[type="checkbox"], input[name="checkbox"]');
    const thumbnail = card.querySelector('.thumbnail, img[data-cy="preitemImg-grid"]');

    if (input && !input.checked) {
      if (indicator) {
        indicator.click();
      } else if (label) {
        label.click();
      } else {
        input.click();
      }
    } else if (thumbnail) {
      thumbnail.click();
    } else {
      card.click();
    }
  }

  function unselectCard(card) {
    const input = card.querySelector('input[type="checkbox"], input[name="checkbox"]');
    const indicator = card.querySelector('[data-cy="preitemCheck"]');
    const label = card.querySelector('label.checkbox');

    if (input && input.checked) {
      if (indicator) {
        indicator.click();
      } else if (label) {
        label.click();
      } else {
        input.click();
      }
    }
  }

  function unselectAllCards() {
    const allCards = getAllAssetCards();
    for (const card of allCards) {
      unselectCard(card);
    }
  }

  function getTargetImageElement() {
    console.log('Searching for target asset image in Magnific UI...');

    // 1. Look inside the right sidebar / edit panel (visible when a card is selected)
    const sidebarContainers = Array.from(document.querySelectorAll('.layout-sidebar, .sidebar, .panel-edit, .metadata-form, .catalog__detail, .catalog-view aside, [data-cy*="sidebar"], .metadata-panel, div:has(> .thumbnail)'));
    for (const panel of sidebarContainers) {
      if (panel.id === 'menu' || panel.closest('#menu')) continue;
      const imgs = Array.from(panel.querySelectorAll('img')).filter(isValidAssetImage);
      if (imgs.length > 0) {
        console.log('Found asset image in edit sidebar:', imgs[0].src);
        return imgs[0];
      }
    }

    // 2. Check for checked/selected card in grid
    const cards = getAllAssetCards();
    console.log(`Found ${cards.length} asset cards in grid.`);

    for (const card of cards) {
      if (isCardSelected(card)) {
        const img = card.querySelector('img[data-cy="preitemImg-grid"], .thumbnail img, img');
        if (img && isValidAssetImage(img)) {
          console.log('Found image from selected card:', img.src);
          return img;
        }
      }
    }

    // 3. Fallback: Take the first valid card in the grid
    if (cards.length > 0) {
      const img = cards[0].querySelector('img[data-cy="preitemImg-grid"], .thumbnail img, img');
      if (img && isValidAssetImage(img)) {
        console.log('Defaulting to first asset image in grid:', img.src);
        return img;
      }
    }

    // 4. Ultimate fallback: find ANY valid uploaded image
    const anyImgs = Array.from(document.querySelectorAll('img[data-cy="preitemImg-grid"], .catalog__item .thumbnail img, .thumbnail img, img[src*="img-contributor.magnific.com"], img[src*="img-contributor.freepik.com"], img[src*="/data/ftp/"]'))
      .filter(isValidAssetImage);

    if (anyImgs.length > 0) {
      console.log('Found asset thumbnail via global search:', anyImgs[0].src);
      return anyImgs[0];
    }

    return null;
  }

  async function captureTargetImage() {
    const imgEl = getTargetImageElement();
    if (!imgEl) {
      console.warn('getTargetImageElement returned null');
      return null;
    }
    return getSafeImageDataUrl(imgEl);
  }

  async function getSafeImageDataUrl(imgElement) {
    if (!imgElement || !imgElement.src) return null;
    const src = imgElement.src;
    console.log('Converting image to DataURL:', src);

    if (src.startsWith('data:image')) {
      return src;
    }

    // Priority 1: Delegate fetch to background worker (bypasses CORS restrictions completely)
    try {
      console.log('Delegating fetch to background service worker...');
      const bgResponse = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'FETCH_IMAGE_AS_DATA_URL', url: src }, (res) => {
          if (chrome.runtime.lastError) {
            console.warn('Background message error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(res);
          }
        });
      });

      if (bgResponse && bgResponse.success && bgResponse.dataUrl) {
        console.log('Background worker fetched DataURL successfully!');
        return bgResponse.dataUrl;
      }
    } catch (e) {
      console.warn('Background worker fetch error:', e);
    }

    // Priority 2: Canvas conversion if image is loaded
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = imgElement.naturalWidth || imgElement.width || 600;
      canvas.height = imgElement.naturalHeight || imgElement.height || 600;
      ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      if (dataUrl && dataUrl.length > 500 && !dataUrl.includes('data:,')) {
        return dataUrl;
      }
    } catch (e) {
      console.log('Direct canvas conversion failed, trying fetch:', e);
    }

    // Priority 3: Content script fetch
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
      if (dataUrl && dataUrl.length > 500) return dataUrl;
    } catch (e) {
      console.log('Content script fetch failed:', e);
    }

    return null;
  }

  // -------------------------------------------------------------
  // Metadata Check & Input Fillers (Vue 3 Compatible)
  // -------------------------------------------------------------

  function findTitleField() {
    // Direct selectors
    const selectors = [
      'input[name="title"]',
      'textarea[name="title"]',
      'input[data-cy*="title"]',
      'textarea[data-cy*="title"]',
      '#title',
      '.resource-title input',
      '.title-input input',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]',
      '.metadata-form input[type="text"]',
      '.catalog__detail input[type="text"]'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && isElementVisible(el)) return el;
    }

    // Search by label "Title"
    const allLabels = Array.from(document.querySelectorAll('label, span, p, h4, h5, div')).filter(el => {
      if (el.closest('#menu, #header, .nav')) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'title' || t === 'title*' || t === 'title:';
    });

    for (const lbl of allLabels) {
      const parent = lbl.closest('div, section, form, fieldset') || lbl.parentElement;
      if (parent) {
        const input = parent.querySelector('input[type="text"], textarea');
        if (input && isElementVisible(input) && !input.placeholder.toLowerCase().includes('prompt')) {
          return input;
        }
      }
    }

    // Search in right edit sidebar for text input that is not Prompt or Search
    const allInputs = Array.from(document.querySelectorAll('input[type="text"], textarea')).filter(el => {
      if (!isElementVisible(el)) return false;
      if (el.closest('#menu, #header, .nav, .catalog__actions')) return false;
      const ph = (el.placeholder || '').toLowerCase();
      const nm = (el.name || '').toLowerCase();
      const cy = (el.getAttribute('data-cy') || '').toLowerCase();
      return !ph.includes('prompt') && !nm.includes('prompt') && !cy.includes('prompt') &&
             !ph.includes('search') && !nm.includes('search') && !ph.includes('tag') && !nm.includes('tag');
    });

    if (allInputs.length > 0) {
      return allInputs[0];
    }

    return null;
  }

  function findTagField(titleField) {
    const selectors = [
      '[data-cy*="tag"] input',
      '[data-cy*="tag"] textarea',
      'input[name="tags"]',
      'textarea[name="tags"]',
      'input[name="keywords"]',
      'textarea[name="keywords"]',
      '#tags',
      '#keywords',
      '[data-testid*="tag"] input',
      '[data-testid*="tag"] textarea',
      'input[placeholder*="tag" i]',
      'textarea[placeholder*="tag" i]',
      'input[placeholder*="keyword" i]',
      'textarea[placeholder*="keyword" i]',
      'input[aria-label*="tag" i]',
      'textarea[aria-label*="tag" i]',
      '.tags-input input',
      '.tag-input input',
      '.keywords-input input',
      '.multiselect__input',
      '.vue-tags-input input',
      '.v-select input',
      '.react-tagsinput-input',
      '.chip-input input'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el !== titleField && isElementVisible(el)) return el;
    }

    // Search by label "Tags" or "Keywords"
    const allLabels = Array.from(document.querySelectorAll('label, span, p, h4, h5, div')).filter(el => {
      if (el.closest('#menu, #header, .nav')) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t === 'tags' || t === 'tags*' || t === 'keywords' || t === 'keywords*' || t.includes('tag');
    });

    for (const lbl of allLabels) {
      const parent = lbl.closest('div, section, form, fieldset') || lbl.parentElement;
      if (parent) {
        const input = parent.querySelector('input[type="text"], textarea');
        if (input && input !== titleField && isElementVisible(input)) {
          return input;
        }
      }
    }

    // Fallback: second visible text input that is not titleField
    const allInputs = Array.from(document.querySelectorAll('textarea, input[type="text"]')).filter(el => {
      if (el === titleField || !isElementVisible(el)) return false;
      if (el.closest('#menu, #header, .nav, .catalog__actions')) return false;
      const ph = (el.placeholder || '').toLowerCase();
      const nm = (el.name || '').toLowerCase();
      return !ph.includes('prompt') && !nm.includes('prompt') && !ph.includes('search') && !nm.includes('search');
    });

    if (allInputs.length > 0) {
      return allInputs[0];
    }

    return null;
  }

  function checkIfSelectedAssetHasMetadata() {
    const titleField = findTitleField();
    const hasTitle = !!(titleField && titleField.value && titleField.value.trim().length > 3 && titleField.value.trim().toLowerCase() !== 'opened ingredient');

    const tagField = findTagField(titleField);
    let hasTags = !!(tagField && tagField.value && tagField.value.trim().length > 5);

    if (!hasTags) {
      const tagChips = document.querySelectorAll('.tag, .tag-item, .chip, .badge, .v-chip, .vue-tags-input .ti-tag, [data-cy*="tag-item"], .resource-tag');
      if (tagChips.length >= 3) {
        hasTags = true;
      }
    }

    return hasTitle && hasTags;
  }

  function setNativeInputValue(element, value) {
    if (!element) return;
    element.focus();
    element.click();

    // Use native prototype descriptor so Vue / React reactive bindings update
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || Object.getOwnPropertyDescriptor(element.constructor.prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }

    // Dispatch all standard events for Vue reactive watchers
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: value }));

    // ExecCommand fallback
    try {
      element.select();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
    } catch (e) {}

    element.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
  }

  function addChipTagsSequentially(inputElement, keywordArray) {
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

  function triggerSaveAction() {
    // Search for floppy disk / save button in sidebar
    const saveBtns = Array.from(document.querySelectorAll('button, a')).filter(btn => {
      if (btn.closest('#menu, #header, .nav')) return false;
      const t = (btn.textContent || '').trim().toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const cy = (btn.getAttribute('data-cy') || '').toLowerCase();
      const hasSaveIcon = !!btn.querySelector('.icon--save, .icon--floppy, .icon--disk, [class*="save"]');
      return t.includes('save') || t.includes('guardar') || t.includes('apply') || title.includes('save') || cy.includes('save') || hasSaveIcon;
    });

    for (const btn of saveBtns) {
      try {
        console.log('Clicking Magnific Save button:', btn);
        btn.click();
        return;
      } catch (e) {}
    }
  }

  async function applyMetadataToMagnific(data) {
    const { title, keywords } = data;
    showToast('Applying Title & Tags to Magnific...', true);

    console.log('Applying metadata to Magnific:', { title, keywords });

    let titleApplied = false;
    let tagsApplied = false;

    // 1. Fill Title Field
    const titleField = findTitleField();
    if (titleField) {
      console.log('Found Title field:', titleField);
      setNativeInputValue(titleField, title);
      titleApplied = true;
    } else {
      console.warn('Could not locate Title field!');
    }

    // 2. Fill Tags / Keywords Field
    const keywordArray = Array.isArray(keywords) ? keywords : keywords.split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);
    const keywordsFormatted = keywordArray.join(', ');

    const tagField = findTagField(titleField);
    if (tagField) {
      console.log('Found Tag field:', tagField);
      setNativeInputValue(tagField, keywordsFormatted);

      tagField.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, bubbles: true }));
      tagField.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

      if (tagField.tagName.toLowerCase() === 'input') {
        addChipTagsSequentially(tagField, keywordArray);
      }

      tagsApplied = true;
    } else {
      console.warn('Could not locate Tag field!');
    }

    // 3. Trigger Save button
    await sleep(600);
    triggerSaveAction();

    if (titleApplied && tagsApplied) {
      showToast('✨ Success! Title & Tags applied to Magnific.');
      hideToast(4000);
    } else if (titleApplied || tagsApplied) {
      showToast('✨ Metadata applied to Magnific.');
      hideToast(4000);
    } else {
      showToast('⚠️ Metadata generated, but edit inputs were not found. Please click an asset to open edit sidebar.');
      hideToast(6000);
    }

    if (currentMetadataResolve) {
      currentMetadataResolve(data);
    }
  }

  // -------------------------------------------------------------
  // Execution Handlers (Single & Batch)
  // -------------------------------------------------------------

  async function handleAutoMetadataClick() {
    try {
      if (typeof EntitlementsService !== 'undefined') {
         const canGen = await EntitlementsService.canGenerate();
         if (!canGen) {
           showToast('⚠️ Daily limit reached. Upgrade to Pro for unlimited generation.');
           hideToast(5000);
           return;
         }
      }

      showToast('Extracting image data...', true);

      // Check if an asset is already selected/ticked
      const cards = getAllAssetCards();
      const selectedCards = cards.filter(isCardSelected);

      if (selectedCards.length === 0 && cards.length > 0) {
        // Automatically select/tick the first card if none is ticked
        console.log('No card selected, automatically ticking first card in grid...');
        selectCard(cards[0]);
        await sleep(800); // Wait for sidebar to open
      }

      const imageDataUrl = await captureTargetImage();
      if (!imageDataUrl) {
        showToast('❌ Could not find an uploaded image. Please click an image card to select it.');
        hideToast(5000);
        return;
      }

      showToast('Opening Gemini tab...', true);

      chrome.runtime.sendMessage({
        action: 'START_METADATA_FLOW',
        platform: 'magnific',
        imageDataUrl: imageDataUrl
      }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast('❌ Error starting flow: ' + (chrome.runtime.lastError?.message || response?.error || 'Unknown error'));
          hideToast(6000);
        } else {
          showToast('Request sent to Gemini. Generating title & tags...', true);
        }
      });

    } catch (err) {
      console.error('Gemini Magnific metadata error:', err);
      showToast('❌ Error: ' + err.message);
      hideToast(6000);
    }
  }

  async function handleBatchProcessClick() {
    if (isBatchProcessing) return;

    if (typeof EntitlementsService !== 'undefined') {
      const canBatch = await EntitlementsService.can('batchProcessing');
      if (!canBatch) {
        showToast('⚠️ Batch processing requires a Pro license.');
        hideToast(5000);
        return;
      }
    }

    const cards = getAllAssetCards();
    if (cards.length === 0) {
      showToast('❌ No uploaded images found in Magnific contributor grid.');
      hideToast(5000);
      return;
    }

    isBatchProcessing = true;
    stopBatchRequested = false;

    const stopBtn = document.getElementById('gemini-magnific-stop-btn');
    if (stopBtn) stopBtn.style.display = 'flex';

    showToast(`🚀 Starting batch processing for ${cards.length} images...`, true);

    for (let i = 0; i < cards.length; i++) {
      if (stopBatchRequested) {
        showToast('⏹️ Batch processing cancelled by user.');
        break;
      }

      const card = cards[i];
      showToast(`📸 Processing Image ${i + 1} of ${cards.length}...`, true);

      // 1. Unselect all previous cards and select/tick ONLY this card
      unselectAllCards();
      await sleep(300);
      selectCard(card);
      await sleep(1000); // Wait for sidebar to open and bind to this item

      // 2. Check if this asset already has Title and Tags
      if (checkIfSelectedAssetHasMetadata()) {
        console.log(`Skipping Image ${i + 1} of ${cards.length}: Metadata already present.`);
        showToast(`⏭️ Skipping Image ${i + 1} of ${cards.length} (Already has metadata)`);
        await sleep(600);
        unselectCard(card);
        continue;
      }

      // 3. Extract image data directly from current card or sidebar
      let imageDataUrl = null;
      const imgInside = card.querySelector('img[data-cy="preitemImg-grid"], .thumbnail img, img');
      if (imgInside && isValidAssetImage(imgInside)) {
        imageDataUrl = await getSafeImageDataUrl(imgInside);
      }

      if (!imageDataUrl) {
        imageDataUrl = await captureTargetImage();
      }

      if (!imageDataUrl) {
        console.warn(`Skipping card ${i + 1}: could not extract image data.`);
        unselectCard(card);
        continue;
      }

      // 4. Start metadata promise & dispatch to Gemini
      const metadataPromise = new Promise((resolve) => {
        currentMetadataResolve = resolve;
        setTimeout(() => resolve(null), 60000); // 60s timeout safeguard
      });

      chrome.runtime.sendMessage({
        action: 'START_METADATA_FLOW',
        platform: 'magnific',
        imageDataUrl: imageDataUrl
      });

      // 5. Wait for Gemini to complete and apply metadata
      const result = await metadataPromise;
      currentMetadataResolve = null;

      if (!result) {
        console.warn(`Image ${i + 1} timed out or failed.`);
      }

      await sleep(1000);
      unselectCard(card);
      await sleep(600); // Inter-item delay
    }

    isBatchProcessing = false;
    if (stopBtn) stopBtn.style.display = 'none';

    if (!stopBatchRequested) {
      showToast(`🎉 Batch Completed! Processed all ${cards.length} images successfully.`);
      hideToast(6000);
    }
  }

  // Listen for messages from background service worker or popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'APPLY_MAGNIFIC_METADATA' || message.action === 'APPLY_METADATA') {
      applyMetadataToMagnific(message.data);
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
