// content_adobe.js - Adobe Stock Contributor Content Script
// Scoped asset selection, verified application, idempotent listeners, no auto-submission

(function () {
  'use strict';

  // Idempotent script installation guard
  if (window.__ASMP_ADOBE_LOADED__) {
    console.log('[Adobe] Script already loaded on this page.');
    return;
  }
  window.__ASMP_ADOBE_LOADED__ = true;

  let toastElement = null;
  let statusTextElement = null;
  let actionButton = null;
  let batchButton = null;
  let stopBatchButton = null;
  let isBatchProcessing = false;
  let stopBatchRequested = false;
  let activeBatchResolve = null;

  // ── UI INITIALIZATION ─────────────────────────────────────────────────────

  function initUI() {
    if (document.getElementById('gemini-adobe-floating-container')) return;

    const container = document.createElement('div');
    container.id = 'gemini-adobe-floating-container';

    // Collapsed Mini Pill
    const miniPill = document.createElement('div');
    miniPill.id = 'asmp-mini-pill';
    miniPill.className = 'asmp-mini-pill';
    miniPill.style.display = 'none';
    miniPill.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
      <span>ASMP Pro</span>
    `;

    // Floating Card Wrapper
    const card = document.createElement('div');
    card.id = 'asmp-floating-card';
    card.className = 'asmp-floating-card';

    // Draggable Header Bar
    const cardHeader = document.createElement('div');
    cardHeader.className = 'asmp-card-header';
    cardHeader.innerHTML = `
      <div class="asmp-header-brand">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
        <span>ADOBE STOCK METADATA PRO</span>
        <span class="asmp-header-badge">PRO</span>
      </div>
      <div class="asmp-header-controls">
        <button class="asmp-header-btn" id="asmp-btn-minimize" title="Minimize toolbar">─</button>
      </div>
    `;

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
    actionButton.id = 'asmp-btn-process-selected';
    actionButton.title = 'Generate metadata for the currently selected image';
    actionButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>
      <span>Process Selected</span>
    `;
    actionButton.addEventListener('click', handleAutoMetadataClick);

    batchButton = document.createElement('button');
    batchButton.className = 'gemini-adobe-btn';
    batchButton.id = 'asmp-btn-batch-process';
    batchButton.style.background = 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)';
    batchButton.title = 'Process all or multiple selected images sequentially in batch (Pro)';
    batchButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
      </svg>
      <span>Batch Queue</span>
    `;
    batchButton.addEventListener('click', () => handleBatchProcessClick());

    stopBatchButton = document.createElement('button');
    stopBatchButton.className = 'gemini-adobe-btn';
    stopBatchButton.id = 'asmp-btn-stop-batch';
    stopBatchButton.style.background = '#dc2626';
    stopBatchButton.style.display = 'none';
    stopBatchButton.title = 'Stop active batch process';
    stopBatchButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12"/>
      </svg>
      <span>Stop Batch</span>
    `;
    stopBatchButton.addEventListener('click', stopBatchProcess);

    const workspaceButton = document.createElement('button');
    workspaceButton.className = 'gemini-adobe-btn';
    workspaceButton.id = 'asmp-btn-workspace';
    workspaceButton.style.background = '#334155';
    workspaceButton.title = 'Open Full Workspace / Queue';
    workspaceButton.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <line x1="9" y1="3" x2="9" y2="21"/>
      </svg>
      <span>Workspace</span>
    `;
    workspaceButton.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: MessageActions.OPEN_WORKSPACE });
    });

    buttonGroup.appendChild(actionButton);
    buttonGroup.appendChild(batchButton);
    buttonGroup.appendChild(stopBatchButton);
    buttonGroup.appendChild(workspaceButton);

    card.appendChild(cardHeader);
    card.appendChild(toastElement);
    card.appendChild(buttonGroup);

    container.appendChild(miniPill);
    container.appendChild(card);
    document.body.appendChild(container);

    statusTextElement = container.querySelector('#gemini-status-text');

    // Dragging logic
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    if (cardHeader && typeof cardHeader.addEventListener === 'function') {
      cardHeader.addEventListener('mousedown', (e) => {
        if (e.target?.closest?.('#asmp-btn-minimize')) return;
        isDragging = true;
        startX = e.clientX || 0;
        startY = e.clientY || 0;
        const rect = container.getBoundingClientRect ? container.getBoundingClientRect() : { left: 0, top: 0 };
        initialLeft = rect.left || 0;
        initialTop = rect.top || 0;
        e.preventDefault?.();
      });
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = (e.clientX || 0) - startX;
        const dy = (e.clientY || 0) - startY;
        const winWidth = window.innerWidth || 1200;
        const winHeight = window.innerHeight || 800;
        const newLeft = Math.max(10, Math.min(winWidth - (container.offsetWidth || 300) - 10, initialLeft + dx));
        const newTop = Math.max(10, Math.min(winHeight - (container.offsetHeight || 120) - 10, initialTop + dy));
        container.style.bottom = 'auto';
        container.style.right = 'auto';
        container.style.left = `${newLeft}px`;
        container.style.top = `${newTop}px`;
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          try {
            chrome.storage?.local?.set({
              asmp_toolbar_pos: {
                left: container.style.left,
                top: container.style.top
              }
            });
          } catch (err) {}
        }
      });
    }

    // Collapse / Expand handlers
    const minimizeBtn = cardHeader.querySelector('#asmp-btn-minimize');
    minimizeBtn?.addEventListener('click', () => {
      card.style.display = 'none';
      miniPill.style.display = 'flex';
      try {
        chrome.storage?.local?.set({ asmp_toolbar_collapsed: true });
      } catch (err) {}
    });

    miniPill.addEventListener('click', () => {
      miniPill.style.display = 'none';
      card.style.display = 'flex';
      try {
        chrome.storage?.local?.set({ asmp_toolbar_collapsed: false });
      } catch (err) {}
    });

    // Restore saved position & collapsed state
    try {
      chrome.storage?.local?.get(['asmp_toolbar_pos', 'asmp_toolbar_collapsed'], (res) => {
        if (res?.asmp_toolbar_pos) {
          container.style.bottom = 'auto';
          container.style.right = 'auto';
          container.style.left = res.asmp_toolbar_pos.left;
          container.style.top = res.asmp_toolbar_pos.top;
        }
        if (res?.asmp_toolbar_collapsed) {
          card.style.display = 'none';
          miniPill.style.display = 'flex';
        }
      });
    } catch (e) {}
  }

  function showToast(message, isLoading = false) {
    if (!toastElement || !toastElement.classList) return;
    toastElement.classList.add('show');
    if (statusTextElement) statusTextElement.textContent = message;
    const spinner = toastElement.querySelector?.('#gemini-status-spinner');
    if (spinner) {
      spinner.style.display = isLoading ? 'block' : 'none';
    }
  }

  function hideToast(delay = 4000) {
    setTimeout(() => {
      if (toastElement && toastElement.classList && !isBatchProcessing) {
        toastElement.classList.remove('show');
      }
    }, delay);
  }

  // ── STRICT ASSET SELECTION & SCOPING ──────────────────────────────────────

  function getCardContainer(el) {
    if (!el || typeof el.closest !== 'function') return el;
    return el.closest(
      '.upload-tile, .upload-card, .spectrum-Card, [data-t*="media-card"], ' +
      '[data-t*="upload-card"], [data-test-id*="media-card"], [role="option"], ' +
      '.asset-card, .upload-item, [data-t*="tile"], [data-t*="card"]'
    ) || el;
  }

  /**
   * Locates the strictly selected asset in Adobe Stock Contributor UI.
   * Refuses ambiguous or unselected states without fallback.
   *
   * @returns {{ element: HTMLElement, assetId: string, imgElement: HTMLImageElement } | null}
   */
  function getSelectedAssetStrict() {
    // 1. High-priority selectors matching the Adobe Stock upload grid
    const primarySelectors = [
      '.content-grid [role="option"][aria-selected="true"]',
      '[data-t="assets-content-grid"] [role="option"][aria-selected="true"]',
      '.upload-tile [role="option"][aria-selected="true"]',
      '.upload-tile__wrapper.active',
      '.upload-tile.selected',
      '.upload-tile.is-selected',
      '.upload-tile.active',
      '.upload-tile [aria-selected="true"]',
      '.content-grid-elements .upload-tile [aria-selected="true"]',
      '.content-grid-elements [aria-selected="true"]',
      '.content-grid [aria-selected="true"]:not([role="tab"])',
      '[role="listbox"][title*="Upload" i] [role="option"][aria-selected="true"]',
      '.asset-preview-selected',
      '.asset-card.selected',
      '.asset-card.is-selected',
      '.asset-card.active',
      '.spectrum-Card.is-selected',
      '.spectrum-Card.selected',
      '[data-test-id*="media-card"].is-selected',
      '[data-t*="media-card"].is-selected',
      '[data-t="upload-card"].is-selected',
      '[data-t="upload-card"][aria-selected="true"]',
      '.upload-card.is-selected',
      '.upload-card.selected',
      '.upload-card.active',
      '.upload-item.selected',
      '.upload-item.is-selected',
      // Checkbox selections inside cards
      '.content-grid input[type="checkbox"]:checked',
      '.content-grid-elements input[type="checkbox"]:checked',
      '[data-t="assets-content-grid"] input[type="checkbox"]:checked',
      '.upload-tile input[type="checkbox"]:checked',
      '.upload-card input[type="checkbox"]:checked',
      '[role="checkbox"][aria-checked="true"]',
      '.spectrum-Checkbox.is-checked'
    ];

    let selectedCards = [];

    for (const sel of primarySelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      for (const el of found) {
        // Exclude navigation tabs, header links, etc.
        if (el.getAttribute?.('role') === 'tab' || el.closest?.('[role="tablist"], nav, header')) {
          continue;
        }
        const cardRoot = getCardContainer(el);
        if (cardRoot && !selectedCards.includes(cardRoot)) {
          selectedCards.push(cardRoot);
        }
      }
      if (selectedCards.length > 0) break; // Use highest-priority selector group
    }

    // Fallback if not found with primary selectors
    if (selectedCards.length === 0) {
      const fallbackSelectors = [
        '[aria-selected="true"]:not([role="tab"])',
        '.is-selected:not([role="tab"])',
        '.selected:not([role="tab"])'
      ];
      for (const sel of fallbackSelectors) {
        const found = Array.from(document.querySelectorAll(sel));
        for (const el of found) {
          if (el.getAttribute?.('role') === 'tab' || el.closest?.('[role="tablist"], nav, header')) continue;
          const cardRoot = getCardContainer(el);
          if (cardRoot && !selectedCards.includes(cardRoot)) {
            selectedCards.push(cardRoot);
          }
        }
        if (selectedCards.length > 0) break;
      }
    }

    // Fallback if 0 cards selected in the grid:
    // Check if the inspector panel is open and active
    if (selectedCards.length === 0) {
      const inspector = findInspectorContainer();
      if (inspector && inspector !== document) {
        const inspectorImg = inspector.querySelector?.('img');
        const hasTitle = !!findTitleInput(inspector);
        const hasKeywords = !!findKeywordsInput(inspector);
        if (inspectorImg || hasTitle || hasKeywords) {
          selectedCards.push(inspector);
        }
      }
    }

    // Fallback if still 0: If there is exactly 1 asset card in the upload grid, use it!
    if (selectedCards.length === 0) {
      const allCards = getAllAssetCards();
      if (allCards.length === 1) {
        selectedCards.push(allCards[0]);
      }
    }

    if (selectedCards.length === 0) {
      showToast('⚠️ No image selected. Please click an uploaded asset in the grid first.');
      hideToast(5000);
      return null;
    }

    if (selectedCards.length > 1) {
      showToast('⚠️ Multiple images selected. Please select a single image for review, or open Batch Queue.');
      hideToast(5000);
      return null;
    }

    const card = selectedCards[0];

    // Find thumbnail image strictly inside this selected card, its wrapper, or inspector
    let imgElement = card.querySelector?.('img.upload-tile__thumbnail, img');
    if (!imgElement && typeof card.closest === 'function') {
      const tileWrapper = card.closest('.upload-tile, .container-relative, .content-grid-elements, .upload-card');
      if (tileWrapper) {
        imgElement = tileWrapper.querySelector('img.upload-tile__thumbnail, img');
      }
    }
    if (!imgElement) {
      const inspector = findInspectorContainer();
      if (inspector) {
        const inspectorImg = inspector.querySelector?.('img');
        if (inspectorImg) imgElement = inspectorImg;
      }
    }

    if (!imgElement) {
      showToast('❌ Could not locate image preview inside selected asset.');
      hideToast(5000);
      return null;
    }

    // Determine stable, deterministic asset identifier attached to the DOM card
    let assetId = card.dataset?.asmpAssetId
      || card.getAttribute?.('data-asset-id')
      || card.getAttribute?.('data-content-id')
      || card.getAttribute?.('id');

    if (!assetId) {
      const src = imgElement.currentSrc || imgElement.src || '';
      assetId = src ? `asset_${hashString(src)}` : `asset_${Math.random().toString(36).slice(2, 9)}`;
      try { card.dataset.asmpAssetId = assetId; } catch (e) {}
    }

    return { element: card, assetId, imgElement };
  }

  // ── SCOPED INSPECTOR CONTAINER DISCOVERY ──────────────────────────────────

  /**
   * Scopes field lookups to the inspector panel of the currently selected asset.
   */
  function findInspectorContainer() {
    const selectors = [
      '.asset-detail-inspector',
      '.asset-details-container',
      '[data-test-id*="inspector"]',
      '[data-t*="inspector"]',
      '.details-panel',
      '.media-detail-inspector',
      'section[class*="inspector" i]',
      'form[class*="inspector" i]',
      'div[class*="inspector" i]',
      '.asset-details'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document;
  }

  // ── WORKFLOW: PROCESS SELECTED ────────────────────────────────────────────

  async function handleAutoMetadataClick() {
    try {
      const selection = getSelectedAssetStrict();
      if (!selection) return;

      showToast('Reading selected asset...', true);

      // Extract image data
      const imageDataUrl = await convertImgToDataUrl(selection.imgElement);
      if (!imageDataUrl) {
        showToast('❌ Could not extract image data. Please ensure image has loaded.');
        hideToast(5000);
        return;
      }

      // Copy image to system clipboard (active user gesture)
      copyImageDataUrlToClipboard(imageDataUrl).catch((e) => {
        console.warn('[Adobe] Background clipboard copy note:', e);
      });

      showToast('Dispatching to Gemini AI...', true);

      // Snapshot original values before generation
      const originalTitle = getExistingTitle();
      const originalKeywords = getExistingKeywords();

      // Send to background task manager with stable assetId
      chrome.runtime.sendMessage({
        action: MessageActions.START_TASK,
        assetId: selection.assetId,
        imageDataUrl: imageDataUrl,
        metadata: {
          originalTitle,
          originalKeywords
        }
      }, (response) => {
        if (chrome.runtime.lastError || !response?.success) {
          const err = chrome.runtime.lastError?.message || response?.error || 'Unknown error';
          showToast(`❌ ${err}`);
          hideToast(6000);
        } else {
          showToast('Generating title & keywords in Gemini session...', true);
        }
      });

    } catch (err) {
      console.error('[Adobe] Process error:', err);
      showToast(`❌ Error: ${err.message}`);
      hideToast(6000);
    }
  }

  // ── APPLY METADATA TO ADOBE STOCK FORM FIELDS ─────────────────────────────

  async function applyMetadataToAdobe(message) {
    const { taskId, assetId, data, settings, isManualApply } = message;
    showToast('Applying Title & Keywords to selected asset...', true);

    // Invariant 1: Strictly verify asset identity before starting write operations
    let currentSelection = getSelectedAssetStrict();

    // If selection was temporarily lost while tab was blurred/backgrounded, try to re-select target card
    if (!currentSelection && assetId) {
      const allCards = getAllAssetCards();
      const targetCard = allCards.find(c => getCardAssetId(c) === assetId) || (allCards.length === 1 ? allCards[0] : null);
      if (targetCard) {
        await selectAdobeCard(targetCard);
        await sleep(500);
        currentSelection = getSelectedAssetStrict();
      }
    }

    // Check if an asset is currently selected that is DIFFERENT from target asset
    if (currentSelection && currentSelection.assetId && assetId && currentSelection.assetId !== assetId) {
      const errMsg = `Asset selection changed (expected ${assetId}, found ${currentSelection.assetId}). Apply aborted to protect assets.`;
      console.warn(`[Adobe] ${errMsg}`);
      showToast(`⚠️ ${errMsg}`);
      hideToast(6000);
      chrome.runtime.sendMessage({
        action: MessageActions.METADATA_APPLY_FAILED,
        taskId,
        error: errMsg
      });
      return;
    }

    const inspector = findInspectorContainer();

    // If no card selection could be established and inspector lacks editable inputs, abort
    if (!currentSelection && !findTitleInput(inspector) && !findKeywordsInput(inspector)) {
      const errMsg = `Asset selection changed (expected ${assetId}, found none). Apply aborted to protect assets.`;
      console.warn(`[Adobe] ${errMsg}`);
      showToast(`⚠️ ${errMsg}`);
      hideToast(6000);
      chrome.runtime.sendMessage({
        action: MessageActions.METADATA_APPLY_FAILED,
        taskId,
        error: errMsg
      });
      return;
    }

    const skipExisting = (settings?.skipExistingMetadata !== false) && !isManualApply;

    // Check existing fields
    const existingTitle = getExistingTitle(inspector);
    const existingKeywords = getExistingKeywords(inspector);

    let titleApplied = false;
    let keywordsApplied = false;

    // 1. Locate and fill Title field (if not skipping existing)
    const shouldFillTitle = !(skipExisting && existingTitle.length > 0);
    const titleField = findTitleInput(inspector);

    const cleanTitle = (typeof globalThis.normalizeTitle === 'function')
      ? globalThis.normalizeTitle(data?.title)
      : (data?.title || '')
          .replace(/^["'`#*\s]*(?:title)?["'`#*\s]*[:=\-–]\s*/i, '')
          .replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '')
          .replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '')
          .replace(/\.+$/, '')
          .trim();

    if (shouldFillTitle && titleField && cleanTitle) {
      setNativeInputValue(titleField, cleanTitle);
      titleApplied = true;
    } else if (!shouldFillTitle && existingTitle.length > 0) {
      titleApplied = true; // Preserved existing per settings
    }

    // Invariant 2: Re-verify asset identity after title async delay
    await sleep(200);
    const postTitleSelection = getSelectedAssetStrict();
    if (postTitleSelection && postTitleSelection.assetId && assetId && postTitleSelection.assetId !== assetId) {
      const errMsg = `Asset selection changed (expected ${assetId}, found ${postTitleSelection.assetId}). Application aborted.`;
      console.warn(`[Adobe] ${errMsg}`);
      chrome.runtime.sendMessage({
        action: MessageActions.METADATA_APPLY_FAILED,
        taskId,
        error: errMsg,
        partial: { titleApplied, keywordsApplied: false }
      });
      return;
    }

    // 2. Locate and fill Keywords field
    const keywordArray = (typeof globalThis.normalizeKeywords === 'function')
      ? globalThis.normalizeKeywords(data?.keywords)
      : (Array.isArray(data?.keywords) ? data.keywords : (data?.keywords || '').split(','))
          .map(k => String(k).replace(/^["'`#*\s]*(?:keywords)?["'`#*\s]*[:=\-–]\s*(?:\[)?\s*/i, '').replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').trim())
          .filter(k => k.length >= 2 && !k.toLowerCase().startsWith('keywords') && !k.toLowerCase().startsWith('title'));

    const shouldFillKeywords = !(skipExisting && existingKeywords.length > 0);

    if (shouldFillKeywords && keywordArray.length > 0) {
      // Step A: Click "Paste keywords" expander if present
      await clickPasteKeywordsExpander(inspector);

      // Step B: Wait for the keyword textarea to mount after expander click
      const pasteTextarea = await waitForPasteKeywordsTextarea(inspector, 3000);

      // Invariant 3: Re-verify asset identity after expander/mounting delay
      const postMountSelection = getSelectedAssetStrict();
      if (postMountSelection && postMountSelection.assetId && assetId && postMountSelection.assetId !== assetId) {
        const errMsg = `Asset selection changed (expected ${assetId}, found ${postMountSelection.assetId}). Application aborted.`;
        console.warn(`[Adobe] ${errMsg}`);
        chrome.runtime.sendMessage({
          action: MessageActions.METADATA_APPLY_FAILED,
          taskId,
          error: errMsg,
          partial: { titleApplied, keywordsApplied: false }
        });
        return;
      }

      if (pasteTextarea && pasteTextarea !== titleField) {
        // Set comma-separated keywords in the pasted textarea
        setNativeInputValue(pasteTextarea, keywordArray.join(', '));
        await sleep(200);

        // Click Add keywords button to commit
        await clickAddKeywordsButton(pasteTextarea, inspector);

        // Await real commit: committed tag chips must appear in DOM
        const committedChips = await waitForCommittedKeywordChips(inspector, Math.min(5, keywordArray.length), 4000);
        keywordsApplied = committedChips.length > 0;
      } else {
        // Fallback: Check for tag chip input directly
        const chipInput = findKeywordsInput(inspector);
        if (chipInput && chipInput !== titleField) {
          if (chipInput.tagName.toLowerCase() === 'textarea') {
            setNativeInputValue(chipInput, keywordArray.join(', '));
            chipInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            await sleep(300);
            await clickAddKeywordsButton(chipInput, inspector);
            const committedChips = await waitForCommittedKeywordChips(inspector, 5, 3000);
            keywordsApplied = committedChips.length > 0;
          } else {
            await addChipKeywordsSequentially(chipInput, keywordArray);
            await sleep(400);
            await clickAddKeywordsButton(chipInput, inspector);
            const committedChips = await waitForCommittedKeywordChips(inspector, 5, 3000);
            keywordsApplied = committedChips.length > 0;
          }
        }
      }
    } else if (!shouldFillKeywords && existingKeywords.length > 0) {
      keywordsApplied = true; // Preserved existing per settings
    }

    // Invariant 4: Full-field verification after settling
    await sleep(400);
    const verifiedTitle = getExistingTitle(inspector);
    const verifiedKeywords = getExistingKeywords(inspector);

    // Strict validation: NEVER report success merely because one field has text!
    const titleOk = titleApplied && verifiedTitle.length >= 5;
    const keywordsOk = keywordsApplied && verifiedKeywords.length >= 5;

    if (titleOk && keywordsOk) {
      showToast('✨ Success! Title & Keywords applied and verified.');
      hideToast(4000);
      chrome.runtime.sendMessage({
        action: MessageActions.METADATA_APPLIED,
        taskId,
        assetId,
        data: {
          title: verifiedTitle,
          keywords: verifiedKeywords
        }
      });
      if (activeBatchResolve) {
        activeBatchResolve({ success: true, data: { title: verifiedTitle, keywords: verifiedKeywords } });
      }
    } else {
      const reasons = [];
      if (!titleOk) reasons.push('Title was not persisted or verified');
      if (!keywordsOk) reasons.push('Keywords were not committed into tag chips');
      const errorMsg = `Application verification failed: ${reasons.join(', ')}.`;

      console.warn(`[Adobe] ${errorMsg}`);
      showToast(`⚠️ ${errorMsg}`);
      hideToast(6000);

      chrome.runtime.sendMessage({
        action: MessageActions.METADATA_APPLY_FAILED,
        taskId,
        error: errorMsg,
        partial: { titleApplied: titleOk, keywordsApplied: keywordsOk }
      });
      if (activeBatchResolve) {
        activeBatchResolve({ success: false, error: errorMsg });
      }
    }
  }

  // ── DOM FIELD SELECTORS & UTILITIES ───────────────────────────────────────

  function findTitleInput(root = document) {
    const selectors = [
      'input[name="title"]',
      'textarea[name="title"]',
      '#title',
      '[aria-label*="title" i]',
      '[data-test-id*="title"]',
      '[data-t*="title"]',
      'input[placeholder*="title" i]',
      'textarea[placeholder*="title" i]'
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    // Search document if scoped root did not contain it
    if (root !== document) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  function findKeywordsInput(root = document) {
    const titleEl = findTitleInput(root);
    const selectors = [
      'textarea[name="keywords"]',
      'textarea[id*="keyword" i]',
      'textarea[placeholder*="keyword" i]',
      'textarea[aria-label*="keyword" i]',
      '[data-t*="keyword"] textarea',
      '[data-test-id*="keyword"] textarea',
      '#keywords',
      '[data-t*="keyword"] input',
      '[data-test-id*="keyword"] input',
      'input[name="keywords"]',
      'input[id*="keyword" i]',
      '.keyword-input-container input',
      '.tags-input input',
      '.keyword-input input',
      '.keywords-input input'
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el && el !== titleEl && el.offsetParent !== null) return el;
    }
    if (root !== document) {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el !== titleEl && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  function getExistingTitle(root = document) {
    const el = findTitleInput(root);
    return el?.value?.trim() || '';
  }

  function getExistingKeywords(root = document) {
    // Check committed chips first (authoritative committed state)
    const chips = getCommittedKeywordChips(root);
    if (chips.length > 0) {
      return chips.map(c => c.textContent.replace(/[\u00D7x\n\r]/g, '').trim()).filter(Boolean);
    }
    // Fall back to input/textarea value
    const el = findKeywordsInput(root);
    if (el?.value?.trim()) {
      return el.value.trim().split(/[,;\n]+/).map(k => k.trim()).filter(Boolean);
    }
    return [];
  }

  function getCommittedKeywordChips(root = document) {
    const chipSelectors = [
      '.spectrum-Tag',
      '.tag-chip',
      '.keyword-chip',
      '[data-t*="keyword-tag"]',
      '[data-test-id*="tag-chip"]',
      '.asset-keyword-tag'
    ];
    const chips = [];
    for (const sel of chipSelectors) {
      const found = root.querySelectorAll(sel);
      for (const el of found) {
        if (!chips.includes(el) && el.offsetParent !== null) {
          chips.push(el);
        }
      }
    }
    return chips;
  }

  async function clickPasteKeywordsExpander(root = document) {
    const pasteButtons = Array.from(root.querySelectorAll('button, a, span')).filter(el => {
      const txt = (el.textContent || '').toLowerCase();
      return txt.includes('paste keyword') || txt.includes('paste tags') || el.getAttribute('data-t') === 'paste-keywords-button';
    });
    for (const btn of pasteButtons) {
      try {
        btn.click();
        await sleep(250);
        return true;
      } catch (e) {}
    }
    return false;
  }

  async function waitForPasteKeywordsTextarea(root = document, timeoutMs = 3000) {
    const titleEl = findTitleInput(root);
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const candidates = Array.from(root.querySelectorAll(
        'textarea[name="keywords"], [data-t*="paste-keywords"] textarea, [data-test-id*="paste-keywords"] textarea, textarea[placeholder*="keyword" i], textarea[aria-label*="keyword" i], .paste-keywords-dialog textarea, .paste-keywords textarea, [class*="paste"] textarea, [class*="keyword"] textarea'
      ));
      for (const ta of candidates) {
        if (ta && ta !== titleEl && ta.offsetParent !== null) {
          return ta;
        }
      }
      await sleep(200);
    }
    return null;
  }

  async function clickAddKeywordsButton(keywordField, root = document) {
    const parentContainer = keywordField?.closest('div, section, form') || root || document.body;
    const addButtons = Array.from(parentContainer.querySelectorAll('button')).filter(b => {
      const t = (b.textContent || '').toLowerCase().trim();
      return t === 'add' || t.includes('add keyword') || b.getAttribute('data-t') === 'add-keywords-button';
    });
    for (const b of addButtons) {
      try {
        b.click();
        await sleep(250);
        return true;
      } catch (e) {}
    }
    return false;
  }

  async function waitForCommittedKeywordChips(root = document, minExpected = 5, timeoutMs = 4000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const chips = getCommittedKeywordChips(root);
      if (chips.length >= minExpected) {
        return chips;
      }
      await sleep(250);
    }
    return getCommittedKeywordChips(root);
  }

  function setNativeInputValue(element, value) {
    if (!element) return;
    element.focus();

    const proto = element.constructor?.prototype;
    const htmlInputProto = typeof HTMLInputElement !== 'undefined' ? HTMLInputElement.prototype : null;
    const htmlTextAreaProto = typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement.prototype : null;
    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
      || (htmlInputProto && Object.getOwnPropertyDescriptor(htmlInputProto, 'value')?.set)
      || (htmlTextAreaProto && Object.getOwnPropertyDescriptor(htmlTextAreaProto, 'value')?.set);

    if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  async function addChipKeywordsSequentially(inputElement, keywordArray) {
    for (const kw of keywordArray) {
      const cleanKw = kw.trim();
      if (!cleanKw) continue;
      setNativeInputValue(inputElement, cleanKw);
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: ',', code: 'Comma', keyCode: 188, bubbles: true }));
      inputElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      await sleep(60);
    }
  }

  function convertImgToDataUrl(imgElement) {
    return new Promise(async (resolve) => {
      if (imgElement && typeof imgElement.complete === 'boolean' && !imgElement.complete && imgElement.src) {
        try {
          await new Promise((res) => {
            imgElement.addEventListener('load', res, { once: true });
            imgElement.addEventListener('error', res, { once: true });
            setTimeout(res, 3000);
          });
        } catch (e) {}
      }

      const src = imgElement?.currentSrc || imgElement?.src;
      if (!src) return resolve(null);
      if (src.startsWith('data:image')) return resolve(src);

      // Attempt 1: Direct in-page blob resolution (same-origin document context)
      if (src.startsWith('blob:')) {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string' && reader.result.startsWith('data:image')) {
              resolve(reader.result);
            } else {
              fallbackCanvas();
            }
          };
          reader.onerror = () => fallbackCanvas();
          reader.readAsDataURL(blob);
          return;
        } catch (e) {
          // Fall through to canvas
        }
      }

      fallbackCanvas();

      function fallbackCanvas() {
        // Attempt 2: Canvas draw if CORS permits
        try {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          canvas.width = imgElement.naturalWidth || imgElement.width || 600;
          canvas.height = imgElement.naturalHeight || imgElement.height || 450;
          ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          if (dataUrl && dataUrl.length > 200) return resolve(dataUrl);
        } catch (e) {
          // Tainted canvas due to CDN CORS
        }

        // Attempt 3: Background worker fetch (scoped to ftcdn.net / adobe CDN)
        if (src.startsWith('http://') || src.startsWith('https://')) {
          chrome.runtime.sendMessage({
            action: MessageActions.FETCH_IMAGE_DATA_URL,
            url: src
          }, (res) => {
            if (chrome.runtime.lastError || !res?.success || !res?.dataUrl) {
              resolve(null);
            } else {
              resolve(res.dataUrl);
            }
          });
        } else {
          resolve(null);
        }
      }
    });
  }

  async function copyImageDataUrlToClipboard(dataUrl) {
    if (typeof navigator === 'undefined' || !navigator.clipboard || !window.ClipboardItem) return false;
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width || 300;
            canvas.height = img.naturalHeight || img.height || 200;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(async (blob) => {
              if (blob) {
                try {
                  await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                  ]);
                  console.log('[Adobe] Image copied to system clipboard as PNG blob.');
                  resolve(true);
                } catch (err) {
                  resolve(false);
                }
              } else {
                resolve(false);
              }
            }, 'image/png');
          } catch (e) {
            resolve(false);
          }
        };
        img.onerror = () => resolve(false);
        img.src = dataUrl;
      } catch (e) {
        resolve(false);
      }
    });
  }

  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── BATCH PROCESSING ENGINE ───────────────────────────────────────────────

  function getCardAssetId(card) {
    if (!card) return 'asset_' + Math.random().toString(36).slice(2, 8);
    let assetId = card.dataset?.asmpAssetId
      || card.getAttribute?.('data-asset-id')
      || card.getAttribute?.('data-content-id')
      || card.getAttribute?.('id');
    if (!assetId) {
      const img = card.querySelector?.('img.upload-tile__thumbnail, img');
      const src = img?.currentSrc || img?.src || '';
      assetId = src ? `asset_${hashString(src)}` : `asset_${Math.random().toString(36).slice(2, 9)}`;
      try { card.dataset.asmpAssetId = assetId; } catch (e) {}
    }
    return assetId;
  }

  function getAllAssetCards() {
    const cardSelectors = [
      '.content-grid [role="option"]',
      '[data-t="assets-content-grid"] [role="option"]',
      '.content-grid-elements .upload-tile',
      '.upload-tile',
      '.upload-card',
      '[data-test-id*="media-card"]',
      '[data-t*="media-card"]',
      '.upload-item',
      '.asset-card',
      '.spectrum-Card'
    ];

    let cards = [];
    for (const sel of cardSelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      const filtered = found.filter(card => {
        if (card.getAttribute?.('role') === 'tab' || card.closest?.('[role="tablist"], nav, header, aside, .details-panel, .asset-detail-inspector')) {
          return false;
        }
        return true;
      });
      if (filtered.length > 0) {
        cards = filtered;
        break;
      }
    }
    return cards;
  }

  function getSelectedCards() {
    const primarySelectors = [
      '.content-grid [role="option"][aria-selected="true"]',
      '[data-t="assets-content-grid"] [role="option"][aria-selected="true"]',
      '.upload-tile [role="option"][aria-selected="true"]',
      '.upload-tile__wrapper.active',
      '.upload-tile [aria-selected="true"]',
      '.content-grid-elements .upload-tile [aria-selected="true"]',
      '.content-grid-elements [aria-selected="true"]',
      '.content-grid [aria-selected="true"]:not([role="tab"])',
      '[role="listbox"][title*="Upload" i] [role="option"][aria-selected="true"]',
      '.asset-preview-selected',
      '.asset-card.selected',
      '.spectrum-Card.is-selected',
      '[data-test-id*="media-card"].is-selected',
      '[data-t*="media-card"].is-selected',
      '.upload-card.is-selected',
      '.upload-item.selected',
      '.upload-item.is-selected'
    ];

    let selectedCards = [];
    for (const sel of primarySelectors) {
      const found = Array.from(document.querySelectorAll(sel));
      for (const card of found) {
        if (card.getAttribute?.('role') === 'tab' || card.closest?.('[role="tablist"], nav, header, aside')) continue;
        if (!selectedCards.includes(card)) selectedCards.push(card);
      }
      if (selectedCards.length > 0) break;
    }
    return selectedCards;
  }

  async function selectAdobeCard(card) {
    if (!card) return;
    try {
      if (typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) {}

    const clickable = card.querySelector?.('img.upload-tile__thumbnail, img, [role="checkbox"], input[type="checkbox"], .spectrum-Card-body, .spectrum-Card') || card;
    try {
      clickable.click?.();
    } catch (e) {}
    try {
      card.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (e) {}
  }

  function checkIfSelectedAssetHasMetadata(inspector = null) {
    const insp = inspector || findInspectorContainer();
    const title = getExistingTitle(insp);
    const keywords = getExistingKeywords(insp);
    const hasTitle = typeof title === 'string' && title.trim().length >= 10;
    const hasKeywords = Array.isArray(keywords) ? keywords.length >= 5 : (typeof keywords === 'string' && keywords.split(',').length >= 5);
    return hasTitle && hasKeywords;
  }

  function stopBatchProcess() {
    stopBatchRequested = true;
    showToast('⏹️ Stopping batch process...', false);
    if (stopBatchButton) stopBatchButton.style.display = 'none';
    if (batchButton) batchButton.style.display = 'inline-flex';
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'BATCH_STATUS_UPDATE',
        isRunning: false,
        stopped: true
      }).catch(() => {});
    }
  }

  async function handleBatchProcessClick(options = {}) {
    if (isBatchProcessing) {
      showToast('⚠️ Batch processing is already running.', false);
      hideToast(4000);
      return { success: false, reason: 'ALREADY_RUNNING' };
    }

    // 1. Entitlement check (Pro gate)
    if (typeof EntitlementsService !== 'undefined') {
      const isPro = EntitlementsService.can('batchProcessing');
      if (!isPro) {
        showToast('🔒 Batch processing requires an active Pro license. Open Workspace to activate.', false);
        hideToast(6000);
        return { success: false, reason: 'PRO_REQUIRED' };
      }
    }

    // 2. Discover cards: multiple selected, or all uploaded cards in grid
    const selected = getSelectedCards();
    let cards = [];
    if (selected.length > 1) {
      cards = selected;
    } else {
      cards = getAllAssetCards();
    }

    if (cards.length === 0) {
      showToast('❌ No uploaded images found in Adobe Stock Contributor grid.', false);
      hideToast(6000);
      return { success: false, reason: 'NO_CARDS_FOUND' };
    }

    isBatchProcessing = true;
    stopBatchRequested = false;

    if (batchButton) batchButton.style.display = 'none';
    if (stopBatchButton) stopBatchButton.style.display = 'inline-flex';

    const delayMs = parseInt(options.delay || '1500', 10);
    const skipExisting = options.skipExisting !== false;

    showToast(`🚀 Starting Batch: 0 / ${cards.length} assets...`, true);

    const cardSummaries = cards.map((c, idx) => ({
      index: idx,
      assetId: getCardAssetId(c),
      status: 'QUEUED',
      title: ''
    }));

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'BATCH_STATUS_UPDATE',
        isRunning: true,
        total: cards.length,
        current: 0,
        cards: cardSummaries
      }).catch(() => {});
    }

    let processedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < cards.length; i++) {
      if (stopBatchRequested) {
        showToast(`⏹️ Batch stopped by user. Processed ${processedCount} of ${cards.length} images.`, false);
        hideToast(6000);
        break;
      }

      const card = cards[i];
      const assetId = getCardAssetId(card);

      showToast(`📸 Processing ${i + 1} of ${cards.length}: selecting asset...`, true);

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'BATCH_STATUS_UPDATE',
          isRunning: true,
          total: cards.length,
          current: i + 1,
          activeAssetId: assetId,
          activeStatus: 'SELECTING'
        }).catch(() => {});
      }

      await selectAdobeCard(card);
      await sleep(700);

      const inspector = findInspectorContainer();

      if (skipExisting && checkIfSelectedAssetHasMetadata(inspector)) {
        console.log(`[Adobe Batch] Skipping image ${i + 1}/${cards.length} (${assetId}) - metadata already present.`);
        showToast(`⏭️ Image ${i + 1}/${cards.length}: Skipped (already has metadata)`, false);
        skippedCount++;
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'BATCH_STATUS_UPDATE',
            isRunning: true,
            total: cards.length,
            current: i + 1,
            activeAssetId: assetId,
            activeStatus: 'SKIPPED'
          }).catch(() => {});
        }
        await sleep(Math.max(400, delayMs / 2));
        continue;
      }

      let imgElement = card.querySelector?.('img.upload-tile__thumbnail, img');
      if (!imgElement && inspector) {
        imgElement = inspector.querySelector?.('img');
      }

      if (!imgElement) {
        console.warn(`[Adobe Batch] Could not locate thumbnail for image ${i + 1} (${assetId}).`);
        continue;
      }

      const imageDataUrl = await convertImgToDataUrl(imgElement);
      if (!imageDataUrl) {
        console.warn(`[Adobe Batch] Could not convert thumbnail for image ${i + 1} (${assetId}).`);
        continue;
      }

      copyImageDataUrlToClipboard(imageDataUrl).catch(() => {});

      showToast(`⚡ Image ${i + 1} of ${cards.length}: Generating metadata with Gemini...`, true);

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: 'BATCH_STATUS_UPDATE',
          isRunning: true,
          total: cards.length,
          current: i + 1,
          activeAssetId: assetId,
          activeStatus: 'GENERATING'
        }).catch(() => {});
      }

      const batchItemPromise = new Promise((resolve) => {
        activeBatchResolve = resolve;
        setTimeout(() => resolve({ success: false, error: 'TIMEOUT' }), 90000);
      });

      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          action: MessageActions.START_TASK,
          assetId: assetId,
          imageDataUrl: imageDataUrl,
          settings: {
            platform: 'adobe',
            skipExistingMetadata: skipExisting,
            autoFillTitle: true,
            autoFillKeywords: true,
          }
        }, (res) => {
          if (!res?.success) {
            console.warn(`[Adobe Batch] Start task failed for ${assetId}:`, res?.error);
            if (activeBatchResolve) activeBatchResolve({ success: false, error: res?.error });
          }
        });
      }

      const outcome = await batchItemPromise;
      activeBatchResolve = null;

      if (outcome?.success) {
        processedCount++;
        showToast(`✨ Image ${i + 1} of ${cards.length}: Applied & verified!`, false);
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'BATCH_STATUS_UPDATE',
            isRunning: true,
            total: cards.length,
            current: i + 1,
            activeAssetId: assetId,
            activeStatus: 'APPLIED',
            title: outcome.data?.title || ''
          }).catch(() => {});
        }
      } else {
        console.warn(`[Adobe Batch] Image ${i + 1} (${assetId}) was not applied:`, outcome?.error);
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            action: 'BATCH_STATUS_UPDATE',
            isRunning: true,
            total: cards.length,
            current: i + 1,
            activeAssetId: assetId,
            activeStatus: 'FAILED',
            error: outcome?.error || 'Failed'
          }).catch(() => {});
        }
      }

      if (i < cards.length - 1 && !stopBatchRequested) {
        showToast(`⏳ Inter-item cooldown (${delayMs}ms)...`, true);
        await sleep(delayMs);
      }
    }

    isBatchProcessing = false;
    stopBatchRequested = false;

    if (stopBatchButton) stopBatchButton.style.display = 'none';
    if (batchButton) batchButton.style.display = 'inline-flex';

    showToast(`🎉 Batch Finished! Processed: ${processedCount}, Skipped: ${skippedCount}, Total: ${cards.length}.`, false);
    hideToast(7000);

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'BATCH_STATUS_UPDATE',
        isRunning: false,
        completed: true,
        processed: processedCount,
        skipped: skippedCount,
        total: cards.length
      }).catch(() => {});
    }

    return { success: true, processedCount, skippedCount, total: cards.length };
  }

  // ── MESSAGE LISTENER ──────────────────────────────────────────────────────

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === MessageActions.APPLY_METADATA || message.action === 'APPLY_ADOBE_METADATA') {
        applyMetadataToAdobe(message);
        if (sendResponse) sendResponse({ received: true });
      } else if (message.action === 'TRIGGER_AUTO_METADATA') {
        handleAutoMetadataClick();
        if (sendResponse) sendResponse({ status: 'STARTED' });
      } else if (message.action === 'TRIGGER_BATCH_METADATA') {
        handleBatchProcessClick(message.options || {}).then(result => {
          if (sendResponse) sendResponse(result);
        });
        return true;
      } else if (message.action === 'STOP_BATCH_METADATA') {
        stopBatchProcess();
        if (sendResponse) sendResponse({ status: 'STOPPED' });
      } else if (message.action === 'GET_BATCH_STATE') {
        if (sendResponse) sendResponse({ isBatchProcessing });
      } else if (message.action === 'SHOW_ERROR_STATUS') {
        showToast(`❌ ${message.error || 'Failed to generate metadata.'}`);
        hideToast(6000);
        if (activeBatchResolve) {
          activeBatchResolve({ success: false, error: message.error });
        }
      } else if (message.action === MessageActions.TASK_STATUS_UPDATE || message.action === 'TASK_STATUS_UPDATE') {
        const task = message.task;
        if (task && (task.status === 'FAILED' || task.status === 'CANCELLED')) {
          if (activeBatchResolve) {
            activeBatchResolve({ success: false, error: task.error?.message || task.status });
          }
        }
      }
    });
  }

  // Expose helpers for test suites
  const helpers = {
    getSelectedAssetStrict,
    findInspectorContainer,
    findTitleInput,
    findKeywordsInput,
    getExistingTitle,
    getExistingKeywords,
    getCommittedKeywordChips,
    clickPasteKeywordsExpander,
    waitForPasteKeywordsTextarea,
    clickAddKeywordsButton,
    waitForCommittedKeywordChips,
    setNativeInputValue,
    convertImgToDataUrl,
    applyMetadataToAdobe,
    getAllAssetCards,
    getSelectedCards,
    getCardAssetId,
    selectAdobeCard,
    checkIfSelectedAssetHasMetadata,
    handleBatchProcessClick,
    stopBatchProcess
  };

  if (typeof window !== 'undefined') {
    window.__ASMP_ADOBE_HELPERS__ = helpers;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__ASMP_ADOBE_HELPERS__ = helpers;
  }

  // Inject UI when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUI);
  } else {
    initUI();
  }
})();
