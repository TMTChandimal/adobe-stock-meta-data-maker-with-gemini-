// content_gemini.js - Gemini Automation Script (Same Chat Session Reuse)

(function () {
  console.log('Gemini Metadata Extension loaded on gemini.google.com');

  let isTaskRunning = false;

  // Listen for direct messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'PROCESS_IMAGE_IN_GEMINI') {
      if (isTaskRunning) {
        console.warn('Gemini task already running, ignoring concurrent message.');
        sendResponse({ status: 'BUSY' });
        return;
      }

      isTaskRunning = true;
      processGeminiTask(message.task)
        .then(() => {
          isTaskRunning = false;
        })
        .catch((err) => {
          isTaskRunning = false;
          console.error('Gemini task execution error:', err);
          chrome.runtime.sendMessage({
            action: 'GEMINI_METADATA_ERROR',
            error: err.message
          });
        });

      sendResponse({ status: 'PROCESSING' });
    }
  });

  async function processGeminiTask(task) {
    try {
      console.log('Processing new image metadata task in same chat...');
      const { imageDataUrl, promptOptions } = task;

      // 1. Locate prompt editor field
      const editorElement = await waitForElement([
        'rich-textarea p[contenteditable]',
        'rich-textarea div[contenteditable]',
        'div[contenteditable="true"].ql-editor',
        'div[contenteditable="true"]',
        'textarea.query-box-textarea',
        'textarea'
      ], 15000);

      if (!editorElement) {
        throw new Error('Could not locate Gemini prompt editor field.');
      }

      // 2. Count existing response turns to ensure we wait for a NEW response
      const baselineResponseCount = getResponseCount();
      console.log('Baseline response turns in chat:', baselineResponseCount);

      // 3. Clear editor and previous attachments from previous image
      await prepareCleanEditorState(editorElement);

      // 4. Convert DataURL to Image File
      const imageFile = dataURLtoFile(imageDataUrl, 'stock_photo.jpg');

      // 5. Attach new image to Gemini
      await attachImageToGemini(editorElement, imageFile);

      // 6. Wait for image upload completion and preview chip in Gemini UI (up to 12s)
      const uploadSuccess = await waitForImagePreviewInGemini(12000, async () => {
        console.log('Retrying image attachment...');
        await attachImageToGemini(editorElement, imageFile);
      });

      if (!uploadSuccess) {
        console.warn('Image preview chip was not detected within timeout, proceeding with caution.');
      }

      // Mandatory 2.5s delay to let Gemini frontend finish binding the uploaded image Blob to the prompt payload
      console.log('Waiting 2.5s for Gemini image upload to fully settle...');
      await sleep(2500);

      // 7. Type Prompt
      const defaultPrompt = `CRITICAL INSTRUCTION: Generate Adobe Stock metadata for this image. Output ONLY the exact two lines below. Do NOT write any greeting, explanation, conversational commentary, or introduction. Start directly with "Title:".

ADOBE STOCK RULES:
1. Title: 50 to 70 characters, factual, natural commercial description, no ending period. Naturally include the core subject terms.
2. Keywords: Exactly 25 to 35 comma-separated keywords in strict priority order.
   - First 10 Keywords: Must be the primary subject nouns/actions and repeat all key terms from Title.
   - Remaining Keywords: Environment ('indoors'/'outdoors'), demographics/age ('young adult', '30-40 years'), headcount ('one person', 'two people', or 'no people', 'nobody'), lighting, camera viewpoint ('close-up', 'high-angle view', 'aerial view', 'flat lay'), mood/concept.
   - Format: Singular nouns only (e.g. 'cat', 'tree'). Verbs in infinitive form ('run', 'smile', 'collaborate'). Split compound concepts ('red', 'dress' NOT 'red dress').
3. Strict Prohibitions: No brands/trademarks, no camera specs (ISO, 4K), no subjective buzzwords (e.g. 'beautiful', 'cute', 'amazing', 'stunning', 'perfect'), no plurals.

OUTPUT FORMAT (ONLY THIS, NO OTHER TEXT):
Title: <50-70 character factual description>
Keywords: <25-35 comma-separated keywords with the top 10 priority keywords first>`;

      const promptText = promptOptions?.customPrompt || defaultPrompt;
      await setEditorPromptText(editorElement, promptText);

      await sleep(1000);

      // 8. Submit prompt cleanly (without double-clicking or hitting Stop)
      await clickSendButton(editorElement);

      // 9. Wait for NEW response from Gemini
      console.log('Waiting for new Gemini response turn...');
      const metadata = await waitForNewGeminiResponse(editorElement, baselineResponseCount, 55000);

      console.log('Gemini metadata generated successfully:', metadata);

      // 10. Send result back to background service worker
      chrome.runtime.sendMessage({
        action: 'GEMINI_METADATA_RESULT',
        data: metadata
      });

    } catch (err) {
      console.error('Error during Gemini task execution:', err);
      chrome.runtime.sendMessage({
        action: 'GEMINI_METADATA_ERROR',
        error: err.message
      });
    }
  }

  async function prepareCleanEditorState(editorElement) {
    // Focus editor
    editorElement.focus();
    await sleep(200);

    // Clear any previous attachment remove buttons if present
    const removeAttachmentBtns = Array.from(document.querySelectorAll([
      '[aria-label*="Remove image" i]',
      '[aria-label*="Remove file" i]',
      '[aria-label*="Delete file" i]',
      '.file-preview-close',
      '.delete-attachment-button',
      'button[aria-label*="Remove" i]'
    ].join(', ')));

    for (const btn of removeAttachmentBtns) {
      try {
        btn.click();
        console.log('Cleared previous attachment chip');
        await sleep(300);
      } catch (e) {}
    }

    // Reset file input values
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    for (const input of fileInputs) {
      try { input.value = ''; } catch (e) {}
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
    await sleep(300);
  }

  async function attachImageToGemini(editorElement, file) {
    // Strategy A: File input assignment
    const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
    for (const input of fileInputs) {
      try {
        input.value = '';
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await sleep(400);
      } catch (e) {
        console.log('FileInput strategy error:', e);
      }
    }

    // Strategy B: Drag and Drop event simulation
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const dropTargets = [
        editorElement,
        document.querySelector('rich-textarea'),
        document.querySelector('.input-area'),
        document.body
      ].filter(Boolean);

      for (const target of dropTargets) {
        target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    } catch (e) {
      console.log('Drop strategy error:', e);
    }

    // Strategy C: Clipboard paste event simulation
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      editorElement.focus();
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      });
      editorElement.dispatchEvent(pasteEvent);
    } catch (e) {
      console.log('Paste strategy error:', e);
    }
  }

  async function waitForImagePreviewInGemini(timeoutMs = 12000, onRetryCallback = null) {
    const startTime = Date.now();
    let retryAttempted = false;

    const previewSelectors = [
      'gdm-file-preview',
      '.file-preview',
      '.image-preview',
      '[aria-label*="Remove image" i]',
      '[aria-label*="Remove file" i]',
      '[aria-label*="Delete image" i]',
      '[aria-label*="Delete file" i]',
      '.attachment-chip',
      'uploader-file',
      'img[src*="blob:"]',
      'img[src*="googleusercontent"]',
      '.thumbnail',
      '.file-preview-card'
    ];

    while (Date.now() - startTime < timeoutMs) {
      // Check if thumbnail preview element exists
      let previewEl = null;
      for (const sel of previewSelectors) {
        previewEl = document.querySelector(sel);
        if (previewEl) break;
      }

      if (previewEl) {
        // Check if there is an active loading/uploading spinner on the chip
        const isStillUploading = !!(
          previewEl.querySelector('mat-progress-spinner, .loading-spinner, .uploading') ||
          document.querySelector('uploader-file.uploading, .file-uploading')
        );

        if (!isStillUploading) {
          console.log('Image upload fully completed and preview confirmed in Gemini UI:', previewEl);
          return true;
        } else {
          console.log('Image chip found but still uploading... waiting for completion.');
        }
      }

      // If after 4s no preview chip is found, execute retry callback once
      if (!previewEl && !retryAttempted && (Date.now() - startTime > 4000) && onRetryCallback) {
        retryAttempted = true;
        await onRetryCallback();
      }

      await sleep(400);
    }

    console.warn('Image preview chip wait completed timeout.');
    return false;
  }

  async function setEditorPromptText(editorElement, text) {
    editorElement.focus();
    await sleep(200);

    if (editorElement.isContentEditable) {
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
      } catch (e) {
        editorElement.innerText = text;
      }
    } else {
      editorElement.value = text;
    }

    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function clickSendButton(editorElement) {
    // DO NOT click anything if Gemini is ALREADY generating a response
    const isGenerating = document.querySelector('button[aria-label*="Stop" i]') || document.querySelector('.generating-spinner');
    if (isGenerating) {
      console.log('Gemini is already generating, skipping clickSendButton.');
      return;
    }

    const sendSelectors = [
      'button[aria-label*="Send message" i]',
      'button[aria-label*="Send" i]',
      'button[aria-label*="Submit" i]',
      'button.send-button',
      'button[data-test-id*="send"]',
      '.send-button-container button',
      'button.send-button-icon'
    ];

    for (const sel of sendSelectors) {
      const btn = document.querySelector(sel);
      if (btn && !btn.disabled) {
        const label = (btn.getAttribute('aria-label') || btn.title || '').toLowerCase();
        // NEVER click if button is currently a Stop button!
        if (label.includes('stop') || label.includes('cancel')) {
          console.log('Skipping button click because it is in Stop state:', label);
          return;
        }
        btn.click();
        console.log('Clicked Gemini Send button:', sel);
        return;
      }
    }

    // Fallback: Dispatch Enter key only if not generating
    if (!isGenerating) {
      editorElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    }
  }

  function getResponseCount() {
    return document.querySelectorAll([
      'model-response',
      'message-content',
      '.response-container-content',
      '[data-test-id="conversation-turn"]',
      '.model-response-text'
    ].join(', ')).length;
  }

  async function waitForNewGeminiResponse(editorElement, baselineTurnCount, timeoutMs = 55000) {
    const startTime = Date.now();
    let reTriggered = false;

    while (Date.now() - startTime < timeoutMs) {
      await sleep(1800);

      const isGenerating = document.querySelector('button[aria-label*="Stop" i]') || document.querySelector('.generating-spinner');
      
      const responseContainers = Array.from(document.querySelectorAll([
        'model-response',
        'message-content',
        '.response-container-content',
        '[data-test-id="conversation-turn"]',
        '.model-response-text'
      ].join(', ')));

      // Only evaluate if a NEW response turn has been created
      if (responseContainers.length > baselineTurnCount) {
        const latestResponse = responseContainers[responseContainers.length - 1];
        const text = latestResponse.textContent || latestResponse.innerText || '';

        // If turn was stopped by system/interrupted ("You stopped this response")
        if ((text.includes('stopped this response') || text.includes('response was stopped')) && !reTriggered) {
          reTriggered = true;
          console.warn('Detected "You stopped this response". Safely resubmitting prompt...');
          await sleep(1500);
          await clickSendButton(editorElement);
          continue;
        }

        const hasTitle = /(?:\*\*|\b)Title(?:\*\*|\b)?\s*:/i.test(text);
        const hasKeywords = /(?:\*\*|\b)Keywords/i.test(text);

        if (hasTitle && hasKeywords && !isGenerating) {
          const parsed = parseMetadataFromText(text);
          if (parsed.title && parsed.keywords.length > 0) {
            return parsed;
          }
        }
      }
    }

    throw new Error('Gemini response timed out or did not return expected Title/Keywords format.');
  }

  function parseMetadataFromText(text) {
    let title = '';
    let keywords = [];

    // Extract Title (handles **Title:**, Title:, etc. anywhere in text)
    const titleMatch = text.match(/(?:\*\*|\b)Title(?:\*\*|\b)?\s*:\s*([^\n\r]+)/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim().replace(/^["'*_\s]+|["'*_\s]+$/g, '').replace(/\.$/, '');
    }

    // Check for split format: "Keywords (First 10 Priority):" / "Priority Keywords:"
    let priorityKeywords = [];
    const priorityMatch = text.match(/(?:\*\*|\b)(?:Keywords\s*\([^)]+\)|First\s*10\s*Keywords|Priority\s*Keywords)(?:\*\*|\b)?\s*:\s*([\s\S]+?)(?=\n\s*(?:\*\*|\b)?Additional\s*Keywords|\n\n|$)/i);
    if (priorityMatch && priorityMatch[1]) {
      priorityKeywords = priorityMatch[1]
        .split(/[,;\n\r]+/)
        .map(k => k.trim().replace(/^["'*_\s\-\d\.]+|["'*_\s]+$/g, ''))
        .filter(k => k.length > 0 && !k.toLowerCase().startsWith('title:'));
    }

    // Check for split format: "Additional Keywords:"
    let additionalKeywords = [];
    const additionalMatch = text.match(/(?:\*\*|\b)Additional\s*Keywords(?:\*\*|\b)?\s*:\s*([\s\S]+?)(?=$|\n\n|\n[A-Z][a-z]+:)/i);
    if (additionalMatch && additionalMatch[1]) {
      additionalKeywords = additionalMatch[1]
        .split(/[,;\n\r]+/)
        .map(k => k.trim().replace(/^["'*_\s\-\d\.]+|["'*_\s]+$/g, ''))
        .filter(k => k.length > 0 && !k.toLowerCase().startsWith('title:'));
    }

    if (priorityKeywords.length > 0 || additionalKeywords.length > 0) {
      keywords = [...priorityKeywords, ...additionalKeywords];
    } else {
      // Standard "Keywords:" format
      const keywordsMatch = text.match(/(?:\*\*|\b)Keywords(?:\*\*|\b)?\s*:\s*([\s\S]+?)(?=$|\n\s*\n\s*[A-Z]|\n[A-Z][a-z]+:)/i)
        || text.match(/(?:\*\*|\b)Keywords(?:\*\*|\b)?\s*:\s*([\s\S]+)/i);
      if (keywordsMatch && keywordsMatch[1]) {
        const rawKeywords = keywordsMatch[1].trim();
        keywords = rawKeywords
          .split(/[,;\n\r]+/)
          .map(k => k.trim().replace(/^["'*_\s\-\d\.]+|["'*_\s]+$/g, ''))
          .filter(k => k.length > 0 && !k.toLowerCase().startsWith('title:'));
      }
    }

    // Deduplicate while preserving strict top-10 priority order
    const seen = new Set();
    const uniqueKeywords = [];
    for (const kw of keywords) {
      const lower = kw.toLowerCase();
      if (!seen.has(lower) && kw.length > 0) {
        seen.add(lower);
        uniqueKeywords.push(kw);
      }
    }

    return { title, keywords: uniqueKeywords };
  }

  function dataURLtoFile(dataurl, filename) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
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
        setTimeout(check, 400);
      };
      check();
    });
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
