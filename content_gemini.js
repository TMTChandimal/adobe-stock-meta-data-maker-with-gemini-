// content_gemini.js - Gemini Automation Script
// Bulletproof multi-stage image attachment, deep shadow-DOM traversal, strict turn detection, error surfacing

(function () {
  'use strict';

  const SCRIPT_VERSION = '2.1.0';
  if (window.__ASMP_GEMINI_VERSION__ === SCRIPT_VERSION) {
    console.log(`[Gemini] Automation script v${SCRIPT_VERSION} already active.`);
    return;
  }
  window.__ASMP_GEMINI_VERSION__ = SCRIPT_VERSION;
  window.__ASMP_GEMINI_LOADED__ = true;

  console.log(`[Gemini] Adobe Stock Metadata Pro automation loaded on gemini.google.com (v${SCRIPT_VERSION})`);

  let activeTaskId = null;
  let activeAttemptId = null;
  let isTaskRunning = false;

  // ── MESSAGE LISTENER ──────────────────────────────────────────────────────

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === MessageActions.DISPATCH_GEMINI || message.action === 'PROCESS_IMAGE_IN_GEMINI') {
        const task = message.task || message;

        // 1. Check if Gemini is currently generating or busy
        const isGenerating = document.querySelector('button[aria-label*="Stop" i], .generating-spinner');
        if (isTaskRunning || isGenerating) {
          console.warn('[Gemini] Session is currently BUSY. Reporting BUSY to task manager.');
          sendResponse({ status: 'BUSY' });
          return false;
        }

        isTaskRunning = true;
        activeTaskId = task.taskId;
        activeAttemptId = task.attemptId;

        processGeminiTask(task)
          .then(() => {
            isTaskRunning = false;
          })
          .catch((err) => {
            isTaskRunning = false;
            console.error('[Gemini] Task execution failure:', err);
            chrome.runtime.sendMessage({
              action: MessageActions.GEMINI_ERROR,
              taskId: activeTaskId,
              attemptId: activeAttemptId,
              error: err.message
            });
          });

        sendResponse({ status: 'PROCESSING' });
        return true;
      }

      if (message.action === MessageActions.CANCEL_TASK) {
        if (activeTaskId === message.taskId) {
          console.log(`[Gemini] Active task ${message.taskId} cancelled by user.`);
          isTaskRunning = false;
          activeTaskId = null;
          activeAttemptId = null;
          dismissManualAttachmentHandoff();
        }
      }
    });
  }

  // ── TASK EXECUTION PIPELINE ───────────────────────────────────────────────

  async function processGeminiTask(task) {
    const { taskId, attemptId, imageDataUrl, customPrompt } = task;

    console.log(`[Gemini] Starting task execution ${taskId} (attempt ${attemptId})...`);

    // Step 1: Detect account login state
    checkLoginAndQuotaStates();

    // Step 2: Validate image payload
    if (!imageDataUrl || typeof imageDataUrl !== 'string' || !imageDataUrl.startsWith('data:')) {
      throw new Error('Invalid image payload: imageDataUrl is missing or not a valid data URL.');
    }

    // Step 3: Locate prompt editor
    const editorElement = await waitForElement([
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"].ql-editor',
      'div.ql-editor',
      'div[contenteditable="true"][role="textbox"]',
      'div[aria-label*="Enter a prompt for Gemini" i]',
      'div[data-placeholder*="Ask Gemini" i]',
      'rich-textarea [contenteditable="true"]',
      'rich-textarea p',
      'rich-textarea div[contenteditable]',
      'div[aria-label*="prompt" i][contenteditable="true"]',
      'div[aria-label*="Ask Gemini" i][contenteditable="true"]',
      'div[aria-label*="Ask" i][contenteditable="true"]',
      'div[aria-label*="Gemini" i][contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea.query-box-textarea',
      'textarea'
    ], 14000);

    if (!editorElement) {
      throw new Error('Could not locate Gemini prompt editor. Please ensure the Gemini chat interface is loaded.');
    }

    // Step 4: Record baseline response count (assistants only)
    const baselineTurnCount = getResponseCount();
    console.log('[Gemini] Baseline assistant response turns:', baselineTurnCount);

    // Step 5: Clean editor and previous attachment chips
    await prepareCleanEditorState(editorElement);

    // Step 6: Convert image DataURL to File
    const imageFile = dataURLtoFile(imageDataUrl, 'adobe_stock_asset.jpg');

    // Step 7: Direct paste & attach image into composer
    console.log('[Gemini] Pasting image into prompt composer...');
    await attachImageSequentially(editorElement, imageFile);

    // Enforce single attachment chip if duplicates appear
    await enforceSingleAttachment();

    // Settle upload progress spinner if active
    await waitForUploadSettlement(12000);

    // Step 8: Formulate and type Adobe Stock prompt (preserving format with custom prompt)
    const promptText = buildGeminiPrompt(customPrompt);
    await setEditorPromptText(editorElement, promptText);
    await sleep(800);

    // Step 9: Submit prompt cleanly and detect accepted submission
    await clickSendButton(editorElement);

    // Step 10: Await newly created response turn and completion
    console.log('[Gemini] Waiting for completed metadata response...');
    const metadata = await waitForCompletedGeminiResponse(editorElement, baselineTurnCount, 75000);

    // Verify task is still the current active attempt
    if (activeTaskId !== taskId || activeAttemptId !== attemptId) {
      console.warn('[Gemini] Response arrived after task was cancelled or re-dispatched. Discarding.');
      return;
    }

    // Step 11: Deliver result back to worker
    chrome.runtime.sendMessage({
      action: MessageActions.GEMINI_RESULT,
      taskId: taskId,
      attemptId: attemptId,
      data: metadata
    }, (res) => {
      if (chrome.runtime?.lastError) {
        console.warn('[Gemini] Result delivery notice:', chrome.runtime.lastError.message);
      } else {
        console.log('[Gemini] Metadata delivered to worker successfully.');
      }
    });
  }

  // ── PROMPT BUILDER (PRESERVES ADOBE RULES WITH CUSTOM PROMPTS) ─────────────

  function buildGeminiPrompt(customPrompt) {
    const baseRules = `CRITICAL INSTRUCTION: Analyze the attached image and generate Adobe Stock contributor metadata.
You MUST output ONLY a valid JSON object in the exact format shown below, with NO markdown code blocks, NO greeting, and NO additional commentary:

{
  "title": "<50 to 70 character factual description in English, no ending period>",
  "keywords": [
    "keyword1",
    "keyword2",
    "keyword3",
    "...",
    "keyword30"
  ]
}

ADOBE STOCK RULES:
1. Title: 50 to 70 characters (5 to 10 words), concise, natural, factual description in English, no ending period. Naturally include the primary subject terms.
2. Keywords: Exactly 25 to 35 keywords in strict relevance priority.
   - First 10 Keywords: Must be primary subject nouns and actions, repeating key terms from Title.
   - Remaining Keywords: Setting, background, lighting, camera viewpoint, mood/concept.
   - Format: English terms, lowercase, singular nouns, infinitive verbs. Meaningful multiword phrases ('artificial intelligence', 'interior design') are permitted.
3. Prohibitions: No brands, no camera technical specs, no subjective buzzwords ('best', 'stunning', 'cute', 'amazing', 'perfect').`;

    if (customPrompt && typeof customPrompt === 'string' && customPrompt.trim()) {
      return `${baseRules}\n\nUSER CUSTOM FOCUS / PREFERENCE:\n${customPrompt.trim()}\n\nRemember: Output ONLY the JSON object.`;
    }
    return baseRules;
  }

  // ── DEEP DOM TRAVERSAL (SHADOW DOM SUPPORT) ───────────────────────────────

  function querySelectorAllDeep(selector, root = document) {
    const results = [];
    const find = (node) => {
      if (!node) return;
      if (node.querySelectorAll) {
        try {
          const matches = node.querySelectorAll(selector);
          for (let i = 0; i < matches.length; i++) {
            results.push(matches[i]);
          }
        } catch (e) {}
      }
      if (node.shadowRoot) {
        find(node.shadowRoot);
      }
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) {
        find(children[i]);
      }
    };
    find(root);
    return results;
  }

  // ── ATTACHMENT STRATEGIES ─────────────────────────────────────────────────
  // Strategy: Click Gemini's "+" button (aria-label="Upload & tools") which opens
  // a dropdown menu. "Upload files" is the first menu item. Clicking it causes
  // Gemini to transiently mount a hidden input[type="file"]. We intercept that
  // file input using a MutationObserver that is registered BEFORE clicking, then
  // inject the image File object directly into the input's files property and
  // dispatch a 'change' event. This is the most reliable approach for Gemini's
  // Angular/Shadow-DOM architecture.

  async function attachImageSequentially(editorElement, file) {
    console.log(`[Gemini] Starting attachment for file: ${file.name} (${file.size} bytes, ${file.type})`);

    // Top-level DataTransfer object in scope for all dispatchers
    const dt = new DataTransfer();
    dt.items.add(file);

    // Helper: inject a File into a file input element using native value setter
    const injectFileIntoInput = (input) => {
      try {
        const inputDt = new DataTransfer();
        inputDt.items.add(file);
        try {
          Object.defineProperty(input, 'files', { value: inputDt.files, configurable: true, writable: true });
        } catch (e) {
          input.files = inputDt.files;
        }
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true, cancelable: true }));
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true, cancelable: true }));
        console.log('[Gemini] File injected into input:', input.accept || '(any)');
        return true;
      } catch (e) {
        console.warn('[Gemini] File input injection error:', e);
        return false;
      }
    };

    // Helper: find all file inputs including inside shadow DOMs
    const findAllFileInputs = () => querySelectorAllDeep('input[type="file"]');

    // ── Tier 1: Single direct Clipboard Paste onto editorElement ──
    try {
      editorElement.focus();
      editorElement.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: dt
      }));
    } catch (e) {
      console.warn('[Gemini] Direct paste dispatch notice:', e);
    }

    // Wait up to 1200ms to see if chip appeared from direct paste
    let chip = await waitForImagePreviewChip(1200);
    if (chip) {
      console.log('[Gemini] Image attached successfully via direct paste on editor.');
      return true;
    }

    // ── Tier 2: Paste on rich-textarea parent container if distinct ──
    const richTextarea = editorElement.closest('rich-textarea') || editorElement.parentElement;
    if (richTextarea && richTextarea !== editorElement) {
      try {
        richTextarea.dispatchEvent(new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clipboardData: dt
        }));
      } catch (e) {}

      chip = await waitForImagePreviewChip(1000);
      if (chip) {
        console.log('[Gemini] Image attached successfully via rich-textarea paste.');
        return true;
      }
    }

    // ── Tier 3: Synthetic Drag and Drop on editorElement only ──
    try {
      editorElement.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      editorElement.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      editorElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
    } catch (e) {
      console.warn('[Gemini] Direct drag-drop dispatch notice:', e);
    }

    chip = await waitForImagePreviewChip(1000);
    if (chip) {
      console.log('[Gemini] Image attached successfully via drag-and-drop.');
      return true;
    }

    // ── Tier 4: Inject into existing file input elements ──
    const fileInputs = findAllFileInputs();
    for (const input of fileInputs) {
      injectFileIntoInput(input);
    }

    chip = await waitForImagePreviewChip(1000);
    if (chip) {
      console.log('[Gemini] Image attached successfully via file input injection.');
      return true;
    }

    // ── Tier 5: Pre-emptive MutationObserver & Upload Button Fallback ──
    let mutationResolved = false;
    let observer = null;
    try {
      observer = new MutationObserver((mutations) => {
        if (mutationResolved) return;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const candidates = node.tagName === 'INPUT' && node.type === 'file'
              ? [node]
              : Array.from(node.querySelectorAll('input[type="file"]'));
            for (const input of candidates) {
              if (injectFileIntoInput(input)) {
                mutationResolved = true;
                if (observer) observer.disconnect();
                return;
              }
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}

    const uploadBtn = document.querySelector('button[aria-label="Upload & tools"], button[aria-label*="Upload & tools" i], button[aria-label*="Add files" i]');
    if (uploadBtn && !uploadBtn.disabled) {
      try {
        uploadBtn.click();
        await sleep(500);
        const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], .mat-mdc-menu-item, button[role="menuitem"]'));
        const uploadFilesItem = menuItems.find(el => {
          const t = (el.textContent || '').trim().toLowerCase();
          return t.includes('upload file') || t.includes('upload from computer');
        });
        if (uploadFilesItem) {
          uploadFilesItem.click();
          await sleep(300);
          for (const input of findAllFileInputs()) injectFileIntoInput(input);
        } else {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      } catch (e) {}
    }

    const chipSettled = await waitForImagePreviewChip(2500, null, getComposerArea(editorElement));
    if (observer) observer.disconnect();

    if (chipSettled) {
      console.log('[Gemini] Image attachment chip confirmed in composer.');
      return true;
    }

    // Safety fallback: if automated tiers could not mount chip, invoke user handoff
    const composer = getComposerArea(editorElement);
    const existingChip = findUploadedImageChip(composer);
    if (existingChip) {
      return true;
    }

    console.warn('[Gemini] Automated attachment tiers completed without preview chip in composer. Invoking safety handoff...');
    const confirmed = await showManualAttachmentHandoff(editorElement, file);
    if (!confirmed) {
      throw new Error('Image attachment was cancelled or not confirmed.');
    }
    return true;
  }

  // ── PREVIEW CHIP DETECTION & SETTLING ──────────────────────────────────────

  function getComposerArea(editorElement) {
    if (editorElement) {
      const area = editorElement.closest?.('.input-area-container, .input-area, rich-textarea, .chat-box, .composer-container, form, [class*="input-container"]');
      if (area) return area;
      if (editorElement.parentElement) return editorElement.parentElement;
    }
    return document.querySelector('.input-area-container, .input-area, rich-textarea, .composer-container') || document.body;
  }

  function getUploadedChips(scope = null) {
    const root = scope || getComposerArea();
    const chipSelectors = [
      'gdm-file-preview',
      'gdm-image-preview',
      'gdm-file-chip',
      'uploader-file',
      'uploader-image',
      '.file-preview',
      '.image-preview',
      '.attachment-chip',
      '.attachment-preview',
      '.file-preview-card',
      '.file-preview-container',
      'infinite-scroller [data-test-id="file-chip"]',
      'div[class*="file-chip"]',
      'div[class*="file-preview"]',
      'div[class*="image-preview"]',
      'div[class*="attachment"]',
      '[data-test-id*="attachment"]',
      '[data-test-id*="file-preview"]',
      '[data-test-id*="image-preview"]',
      '[data-test-id*="file-chip"]'
    ];

    const rawChips = [];
    for (const sel of chipSelectors) {
      const found = root.querySelectorAll(sel);
      for (const el of found) {
        if (el.closest?.('user-query, .user-query, [data-test-id="user-query"], model-response, .model-response, [role="article"], .chat-history, .conversation-container')) {
          continue;
        }
        if (!rawChips.includes(el) && el.offsetParent !== null) {
          rawChips.push(el);
        }
      }
    }

    // Crucial: Filter out descendant elements so nested containers of the SAME upload
    // (e.g. uploader-file > .file-preview-container > .file-preview-card > .image-preview)
    // are not treated as multiple separate attachments. Keep only outermost containers.
    const chips = rawChips.filter(el => {
      return !rawChips.some(other => other !== el && typeof other.contains === 'function' && other.contains(el));
    });

    if (chips.length > 0) return chips;

    // Check remove buttons
    const removeButtons = Array.from(root.querySelectorAll([
      'button[aria-label*="Remove image" i]',
      'button[aria-label*="Remove file" i]',
      'button[aria-label*="Delete image" i]',
      'button[aria-label*="Delete file" i]',
      'button[aria-label*="Remove attachment" i]',
      '.file-preview-close',
      '.delete-attachment-button'
    ].join(', '))).filter(b => {
      if (b.closest?.('user-query, .user-query, [data-test-id="user-query"], model-response, .model-response, [role="article"]')) {
        return false;
      }
      return b.offsetParent !== null;
    });

    if (removeButtons.length > 0) {
      const rawBtnChips = removeButtons.map(b => b.closest('div, mat-chip, span') || b);
      return rawBtnChips.filter((el, idx, arr) => arr.indexOf(el) === idx && !arr.some(o => o !== el && typeof o.contains === 'function' && o.contains(el)));
    }

    // Composer blob image search
    const composer = (root && root !== document.body) ? root : (document.querySelector([
      'rich-textarea',
      '.input-area-container',
      '.input-area',
      '.chat-box',
      '.composer-container',
      'chat-window'
    ].join(', ')) || document.body);

    const candidateImgs = Array.from(composer.querySelectorAll('img')).filter((img) => {
      if (img.closest?.('user-query, .user-query, [data-test-id="user-query"], model-response, .model-response, [role="article"], header, nav, .mat-mdc-menu-panel')) {
        return false;
      }
      const alt = (img.alt || '').toLowerCase();
      const cls = (typeof img.className === 'string' ? img.className : '').toLowerCase();
      const src = img.src || '';

      // Strictly exclude user avatars, profile pictures, icons, and account UI
      if (
        cls.includes('user-icon') ||
        cls.includes('user-avatar') ||
        cls.includes('avatar') ||
        cls.includes('profile') ||
        alt.includes('profile') ||
        alt.includes('avatar') ||
        alt.includes('user') ||
        src.includes('googleusercontent.com/a/') ||
        src.includes('=s32') ||
        src.includes('=s48') ||
        src.includes('=s64') ||
        src.includes('=s96') ||
        src.includes('=s128') ||
        img.closest?.('.user-icon, .user-avatar, .avatar, mat-icon, [aria-label*="Account" i], account-button, profile-button')
      ) {
        return false;
      }

      // Valid attached image thumbnail:
      if (src.startsWith('blob:') || src.startsWith('data:image')) return true;
      if (src.includes('googleusercontent.com') && !src.includes('/a/')) return true;

      // Inside an attachment preview container:
      if (img.closest?.('.file-preview, .image-preview, uploader-file, uploader-image, gdm-file-preview, .attachment-preview, .attachment-chip, [data-test-id*="file"]')) {
        return true;
      }

      const rect = (typeof img.getBoundingClientRect === 'function') ? img.getBoundingClientRect() : { width: 50, height: 50 };
      return (rect.width >= 40 && rect.height >= 40 && img.closest?.('.input-area-container, .input-area, rich-textarea, .chat-box, [class*="uploader"]'));
    });

    return candidateImgs;
  }

  function findUploadedImageChip(scope = null) {
    const chips = getUploadedChips(scope);
    return chips.length > 0 ? chips[0] : null;
  }

  async function enforceSingleAttachment(scope = null) {
    const chips = getUploadedChips(scope);
    if (chips.length > 1) {
      console.log(`[Gemini] Detected ${chips.length} attachment chips. Removing extras to guarantee exactly 1 image...`);
      const keeper = chips[0];
      for (let i = 1; i < chips.length; i++) {
        const extraChip = chips[i];
        const keeperContains = typeof keeper.contains === 'function' && keeper.contains(extraChip);
        const extraContains = typeof extraChip.contains === 'function' && extraChip.contains(keeper);
        if (keeperContains || extraContains) {
          continue;
        }
        const removeBtn = extraChip.querySelector('button[aria-label*="Remove" i], button[aria-label*="Delete" i], .file-preview-close, .delete-attachment-button');
        if (removeBtn && !(typeof keeper.contains === 'function' && keeper.contains(removeBtn))) {
          try { removeBtn.click(); await sleep(250); } catch (e) {}
        }
      }
    }
  }

  async function waitForUploadSettlement(timeoutMs = 12000, scope = null) {
    const root = scope || getComposerArea();
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const activeSpinners = root.querySelectorAll('mat-progress-spinner, .loading-spinner, .uploading, circle.mat-mdc-progress-spinner, uploader-file.uploading');
      if (activeSpinners.length === 0) {
        return true;
      }
      await sleep(350);
    }
    return false;
  }

  async function waitForImagePreviewChip(timeoutMs = 14000, onRetry = null, scope = null) {
    const startTime = Date.now();
    let retryIndex = 1;

    while (Date.now() - startTime < timeoutMs) {
      const foundEl = findUploadedImageChip(scope);

      if (foundEl) {
        const isStillUploading = !!(
          foundEl.querySelector('mat-progress-spinner, .loading-spinner, .uploading, circle.mat-mdc-progress-spinner') ||
          (foundEl.closest?.('uploader-file.uploading, .file-uploading') || foundEl.querySelector?.('uploader-file.uploading, .file-uploading'))
        );

        if (!isStillUploading) {
          console.log('[Gemini] Image attachment chip confirmed and upload settled:', foundEl);
          return true;
        } else {
          console.log('[Gemini] Image chip found, waiting for upload spinner to settle...');
        }
      }

      const elapsed = Date.now() - startTime;
      if (!foundEl && onRetry && elapsed > (retryIndex * 2500) && retryIndex <= 3) {
        retryIndex++;
        try {
          await onRetry(elapsed);
        } catch (e) {}
      }

      await sleep(350);
    }

    return false;
  }

  // ── MANUAL ATTACHMENT HANDOFF (STRICT SAFETY FALLBACK) ─────────────────────

  let manualHandoffContainer = null;

  function dismissManualAttachmentHandoff() {
    if (manualHandoffContainer && manualHandoffContainer.parentNode) {
      manualHandoffContainer.parentNode.removeChild(manualHandoffContainer);
      manualHandoffContainer = null;
    }
  }

  function showManualAttachmentHandoff(editorElement, file) {
    return new Promise((resolve) => {
      dismissManualAttachmentHandoff();

      manualHandoffContainer = document.createElement('div');
      manualHandoffContainer.id = 'asmp-gemini-manual-handoff';
      manualHandoffContainer.style.cssText = `
        position: fixed;
        bottom: 90px;
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #f8fafc;
        border: 2px solid #3b82f6;
        border-radius: 12px;
        padding: 16px 20px;
        z-index: 999999;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        max-width: 520px;
        width: 90%;
        display: flex;
        flex-direction: column;
        gap: 12px;
      `;

      manualHandoffContainer.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <div style="font-weight: 600; font-size: 15px; color: #60a5fa; display: flex; align-items: center; gap: 8px;">
            <span>📸</span> Image Attachment Required
          </div>
          <span style="font-size: 11px; background: rgba(59, 130, 246, 0.2); padding: 2px 8px; border-radius: 4px; color: #93c5fd;">Safety Gate</span>
        </div>
        <p style="margin: 0; font-size: 13px; line-height: 1.4; color: #cbd5e1;">
          Automated attachment was blocked by browser security. Please drag/paste your asset into the prompt box below, or click <strong>"I Have Attached Image"</strong> once the preview chip appears.
        </p>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
          <button id="asmp-handoff-cancel" style="background: transparent; border: 1px solid #64748b; color: #cbd5e1; border-radius: 6px; padding: 6px 14px; font-size: 12px; cursor: pointer;">Cancel</button>
          <button id="asmp-handoff-confirm" style="background: #2563eb; border: none; color: white; border-radius: 6px; padding: 6px 16px; font-size: 12px; font-weight: 500; cursor: pointer;">I Have Attached Image</button>
        </div>
      `;

      document.body.appendChild(manualHandoffContainer);

      // Auto-detect if user drops/pastes image while dialog is open
      const pollTimer = setInterval(() => {
        if (!manualHandoffContainer) {
          clearInterval(pollTimer);
          return;
        }
        if (findUploadedImageChip(getComposerArea(editorElement))) {
          clearInterval(pollTimer);
          dismissManualAttachmentHandoff();
          resolve(true);
        }
      }, 600);

      const cancelBtn = manualHandoffContainer.querySelector('#asmp-handoff-cancel');
      const confirmBtn = manualHandoffContainer.querySelector('#asmp-handoff-confirm');

      cancelBtn?.addEventListener('click', () => {
        clearInterval(pollTimer);
        dismissManualAttachmentHandoff();
        resolve(false);
      });

      confirmBtn?.addEventListener('click', () => {
        if (findUploadedImageChip(getComposerArea(editorElement))) {
          clearInterval(pollTimer);
          dismissManualAttachmentHandoff();
          resolve(true);
        } else {
          alert('No attached image preview detected in Gemini composer. Please attach the image first.');
        }
      });
    });
  }

  // ── CLEAN EDITOR & SEND CONTROLS ──────────────────────────────────────────

  async function prepareCleanEditorState(editorElement) {
    editorElement.focus();
    await sleep(150);

    const composer = getComposerArea(editorElement);

    // Remove any leftover attachment chips in composer only
    const removeButtons = Array.from(composer.querySelectorAll([
      'button[aria-label*="Remove image" i]',
      'button[aria-label*="Remove file" i]',
      'button[aria-label*="Delete file" i]',
      'button[aria-label*="Delete image" i]',
      'button[aria-label*="Remove attachment" i]',
      '.file-preview-close',
      '.delete-attachment-button'
    ].join(', '))).filter(b => !b.closest?.('user-query, .user-query, [data-test-id="user-query"], model-response, .model-response, [role="article"]'));

    for (const btn of removeButtons) {
      try {
        btn.click();
        await sleep(200);
      } catch (e) {}
    }

    // Clear editor text
    if (editorElement.isContentEditable) {
      editorElement.innerHTML = '';
      editorElement.innerText = '';
    } else {
      editorElement.value = '';
    }

    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(150);
  }

  async function setEditorPromptText(editorElement, text) {
    editorElement.focus();
    await sleep(150);

    if (editorElement.isContentEditable) {
      const p = editorElement.querySelector('p');
      if (p) {
        p.textContent = text;
      }
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch (e) {
        if (p) p.textContent = text;
        else editorElement.innerHTML = `<p>${text}</p>`;
      }
      if (!editorElement.innerText || editorElement.innerText.trim() !== text.trim()) {
        if (p) p.textContent = text;
        else editorElement.innerHTML = `<p>${text}</p>`;
      }
      editorElement.classList.remove('ql-blank');
    } else {
      editorElement.value = text;
    }

    try {
      editorElement.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text }));
    } catch (e) {}
    editorElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    await sleep(200);
  }

  async function clickSendButton(editorElement) {
    const sendSelectors = [
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Submit" i]',
      'button.send-button',
      'button[data-test-id*="send"]',
      'button[mattooltip*="Send" i]',
      '.send-button-container button'
    ];

    let sendBtn = null;
    const startTime = Date.now();
    while (Date.now() - startTime < 6000) {
      for (const sel of sendSelectors) {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          const label = (btn.getAttribute('aria-label') || '').toLowerCase();
          if (label.includes('stop') || label.includes('cancel')) {
            throw new Error('Gemini composer is currently in Stop state. Please wait.');
          }
          sendBtn = btn;
          break;
        }
      }
      if (sendBtn) break;
      await sleep(250);
    }

    if (sendBtn) {
      sendBtn.click();
      console.log('[Gemini] Clicked Send button successfully.');
    } else {
      console.log('[Gemini] Send button not enabled, dispatching Enter key fallback...');
      editorElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    // Verify accepted submission: composer text cleared or generating spinner active
    const accepted = await waitForAcceptedSubmission(editorElement, 6000);
    if (!accepted) {
      throw new Error('Submission rejected: Prompt remained in composer or send control was disabled.');
    }
  }

  async function waitForAcceptedSubmission(editorElement, timeoutMs = 6000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const isGenerating = !!document.querySelector('button[aria-label*="Stop" i], .generating-spinner');
      const text = (editorElement.isContentEditable ? editorElement.innerText : editorElement.value) || '';
      const userTurns = document.querySelectorAll('user-query, .user-query, [data-test-id="user-query"], .query-text');
      
      if (isGenerating || text.trim().length === 0 || userTurns.length > 0) {
        return true;
      }
      await sleep(300);
    }
    return false;
  }

  // ── RESPONSE TURNS & PARSING ──────────────────────────────────────────────

  function getDeepText(node) {
    if (!node) return '';
    if (typeof node.innerText === 'string' && node.innerText.trim().length > 0) {
      return node.innerText;
    }
    let text = '';
    if (node.nodeType === 3) {
      return node.nodeValue || '';
    }
    if (node.shadowRoot) {
      text += getDeepText(node.shadowRoot);
    }
    const children = node.childNodes || [];
    for (let i = 0; i < children.length; i++) {
      text += getDeepText(children[i]);
    }
    return text || node.textContent || '';
  }

  function getAssistantResponseContainers() {
    const selectors = [
      'model-response',
      'message-content',
      'markdown-renderer',
      '.response-container-content',
      '.response-content',
      '.model-response-text',
      '[data-test-id*="conversation-turn"] model-response',
      '[data-test-id*="model-response"]',
      'div[class*="model-response"]',
      'div[class*="response-container"]',
      'div[class*="message-content"]',
      '.chat-turn-assistant',
      '[role="region"][aria-label*="response" i]',
      '[role="article"]'
    ];

    const rawList = [];
    for (const sel of selectors) {
      try {
        const found = Array.from(document.querySelectorAll(sel));
        for (const el of found) {
          if (!rawList.includes(el)) rawList.push(el);
        }
      } catch (e) {}
    }

    // Exclude user queries
    const filtered = rawList.filter(el => {
      return !el.closest?.('user-query, .user-query, [data-test-id="user-query"], .query-text');
    });

    // Deduplicate nested containers so we keep top-level containers
    const topLevel = [];
    for (const c of filtered) {
      if (!topLevel.some(t => (typeof t.contains === 'function' && t.contains(c)) || (typeof c.contains === 'function' && c.contains(t)))) {
        topLevel.push(c);
      }
    }
    return topLevel.length > 0 ? topLevel : filtered;
  }

  function getResponseCount() {
    return getAssistantResponseContainers().length;
  }

  async function waitForCompletedGeminiResponse(editorElement, baselineTurnCount, timeoutMs = 75000) {
    const startTime = Date.now();
    let lastText = '';
    let stableCount = 0;

    while (Date.now() - startTime < timeoutMs) {
      await sleep(500);

      checkLoginAndQuotaStates();

      if (activeTaskId !== null && !isTaskRunning) {
        throw new Error('Task was cancelled by user.');
      }

      const responseContainers = getAssistantResponseContainers();

      let targetResponse = null;
      if (responseContainers.length > baselineTurnCount) {
        targetResponse = responseContainers[responseContainers.length - 1];
      } else if (responseContainers.length > 0) {
        // Fallback: check newest containers for valid metadata or json
        for (let i = responseContainers.length - 1; i >= 0; i--) {
          const candidateText = getDeepText(responseContainers[i]);
          if (candidateText && (candidateText.includes('"title"') || /Title\s*[:\-–]/i.test(candidateText))) {
            targetResponse = responseContainers[i];
            break;
          }
        }
        if (!targetResponse && Date.now() - startTime > 10000) {
          targetResponse = responseContainers[responseContainers.length - 1];
        }
      }

      if (targetResponse) {
        const text = getDeepText(targetResponse) || targetResponse.innerText || targetResponse.textContent || '';

        // Handle system interruption / safety refusal honestly without silent resubmission
        if (text.includes('stopped this response') || text.includes('response was stopped') || text.includes('response generation stopped')) {
          throw new Error('Gemini response was interrupted or stopped by safety filters.');
        }

        const isGenerating = !!document.querySelector('button[aria-label*="Stop" i], button[aria-label*="stop" i], .generating-spinner') ||
          !!targetResponse.querySelector('mat-progress-bar, .generating-spinner');

        // Check streaming stabilization
        if (text.length > 20) {
          if (text === lastText) {
            stableCount++;
          } else {
            stableCount = 0;
            lastText = text;
          }

          // Parse when generating spinner is gone or when text has stabilized
          if (!isGenerating || stableCount >= 4) {
            const parsed = (typeof globalThis.parseGeminiResponse === 'function')
              ? globalThis.parseGeminiResponse(text)
              : fallbackParser(text);

            if (parsed && parsed.valid) {
              console.log('[Gemini] Valid metadata received from assistant turn.');
              return {
                title: parsed.title,
                keywords: parsed.keywords
              };
            }
          }
        }
      }
    }

    throw new Error('Gemini response timed out or failed to return valid Title and Keywords.');
  }

  function fallbackParser(text) {
    if (!text || typeof text !== 'string') return { title: '', keywords: [], valid: false };

    // JSON parsing attempt 1: code block, bare JSON object, or unbraced JSON
    try {
      let jsonStr = null;
      const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      } else {
        const jsonMatch = text.match(/(\{[\s\S]*?"title"[\s\S]*?"keywords"[\s\S]*?\})/i)
          || text.match(/(\{[\s\S]*?"keywords"[\s\S]*?"title"[\s\S]*?\})/i)
          || text.match(/(\{[\s\S]*"title"[\s\S]*"keywords"[\s\S]*\})/i);
        if (jsonMatch) {
          jsonStr = jsonMatch[1].trim();
        } else {
          // Look for unbraced JSON output: "title": "..." and "keywords": [...]
          const unbracedMatch = text.match(/("title"\s*:\s*[\s\S]*?"keywords"\s*:\s*\[[\s\S]*?\]|"keywords"\s*:\s*\[[\s\S]*?\][\s\S]*?"title"\s*:\s*["'][^"'\n\r]+["'])/i);
          if (unbracedMatch) {
            jsonStr = '{' + unbracedMatch[1].trim() + '}';
          }
        }
      }
      if (jsonStr) {
        // Clean trailing commas before closing braces/brackets
        const sanitized = jsonStr.replace(/,\s*([}\]])/g, '$1');
        const parsed = JSON.parse(sanitized);
        const title = (parsed.title || '')
          .replace(/^["'`#*\s]*(?:title)?["'`#*\s]*[:=\-–]\s*/i, '')
          .replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '')
          .replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '')
          .replace(/\.+$/, '')
          .trim();
        let keywords = [];
        if (Array.isArray(parsed.keywords)) {
          keywords = parsed.keywords.map(k => String(k).replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').trim()).filter(Boolean);
        } else if (typeof parsed.keywords === 'string') {
          keywords = parsed.keywords.split(/[,;\n]+/).map(k => k.replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').trim()).filter(Boolean);
        }
        if (title.length >= 5 && keywords.length >= 5) {
          return { title, keywords, valid: true };
        }
      }
    } catch (e) {}

    // Regex fallback for Title: and Keywords:
    let title = '';
    const titleMatch = text.match(/(?:["'`#*\s]|\b)Title(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]\s*([^\n\r]+)/i);
    if (titleMatch && titleMatch[1] && titleMatch[1].trim()) {
      title = titleMatch[1].replace(/^["'`#*\s]*(?:title)?["'`#*\s]*[:=\-–]\s*/i, '').replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').replace(/\.+$/, '').trim();
    } else {
      const multilineTitle = text.match(/(?:["'`#*\s]|\b)Title(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]?\s*\n+([^\n\r]+)/i);
      if (multilineTitle && multilineTitle[1]) {
        title = multilineTitle[1].replace(/^["'`#*\s]*(?:title)?["'`#*\s]*[:=\-–]\s*/i, '').replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').replace(/\.+$/, '').trim();
      }
    }

    const kwMatch = text.match(/(?:["'`#*\s]|\b)Keywords(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]\s*([\s\S]+)/i);
    let keywords = [];
    if (kwMatch && kwMatch[1]) {
      let rawKwText = kwMatch[1].trim().replace(/^\[\s*/, '').replace(/\s*\]$/, '');
      keywords = rawKwText.split(/[,;\n\r]+/)
        .map(k => k.replace(/^["'`#*\s]*(?:keywords)?["'`#*\s]*[:=\-–]\s*(?:\[)?\s*/i, '').replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').trim())
        .filter(k => k.length >= 2 && !k.toLowerCase().startsWith('keywords') && !k.toLowerCase().startsWith('title'));
    }

    return {
      title,
      keywords,
      valid: title.length >= 5 && keywords.length >= 5
    };
  }

  function checkLoginAndQuotaStates() {
    const text = document.body.innerText || '';
    if (text.includes('Sign in to Gemini') || text.includes('Sign in with Google')) {
      throw new Error('Gemini session is not logged in. Please sign in to Google Gemini in this tab.');
    }
    if (text.includes('temporarily unavailable') || text.includes('quota exceeded') || text.includes('try again later')) {
      throw new Error('Gemini quota or capacity limit reached. Please try again later.');
    }
  }

  function dataURLtoFile(dataurl, filename) {
    try {
      const arr = dataurl.split(',');
      const mimeMatch = arr[0].match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename, { type: mime, lastModified: Date.now() });
    } catch (e) {
      console.error('[Gemini] dataURLtoFile conversion failed:', e);
      throw new Error(`Failed to decode image data URL: ${e.message}`);
    }
  }

  function waitForElement(selectors, timeout = 10000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return resolve(el);
        }
        if (Date.now() - startTime > timeout) return resolve(null);
        setTimeout(check, 350);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Expose helper functions for regression test suite
  const helpers = {
    attachImageSequentially,
    buildGeminiPrompt,
    findUploadedImageChip,
    getUploadedChips,
    enforceSingleAttachment,
    waitForAcceptedSubmission,
    waitForCompletedGeminiResponse,
    checkLoginAndQuotaStates,
    fallbackParser,
    dataURLtoFile
  };

  if (typeof window !== 'undefined') {
    window.__ASMP_GEMINI_HELPERS__ = helpers;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.__ASMP_GEMINI_HELPERS__ = helpers;
  }
})();
