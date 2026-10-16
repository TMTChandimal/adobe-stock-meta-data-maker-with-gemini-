// patch-gemini-attachment.mjs
// Replaces the attachImageSequentially function in content_gemini.js with
// a corrected version that uses the real Gemini DOM selectors observed on 2026-10-15.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, '..', 'content_gemini.js');

let content = fs.readFileSync(target, 'utf8');

const SECTION_START = '  // ── ATTACHMENT STRATEGIES ─────────────────────────────────────────────────';
const SECTION_END = '  // ── PREVIEW CHIP DETECTION & SETTLING ──────────────────────────────────────';

const startIdx = content.indexOf(SECTION_START);
const endIdx = content.indexOf(SECTION_END);

if (startIdx === -1 || endIdx === -1) {
  console.error('Could not locate attachment section boundaries!');
  console.error('SECTION_START found:', startIdx !== -1);
  console.error('SECTION_END found:', endIdx !== -1);
  process.exit(1);
}

const replacement = `  // ── ATTACHMENT STRATEGIES ─────────────────────────────────────────────────
  // Strategy: Click Gemini's "+" button (aria-label="Upload & tools") which opens
  // a dropdown menu. "Upload files" is the first menu item. Clicking it causes
  // Gemini to transiently mount a hidden input[type="file"]. We intercept that
  // file input using a MutationObserver that is registered BEFORE clicking, then
  // inject the image File object directly into the input's files property and
  // dispatch a 'change' event. This is the most reliable approach for Gemini's
  // Angular/Shadow-DOM architecture.

  async function attachImageSequentially(editorElement, file) {
    console.log(\`[Gemini] Starting multi-stage attachment for file: \${file.name} (\${file.size} bytes, \${file.type})\`);

    // Helper: inject a File into a file input element using native value setter
    const injectFileIntoInput = (input) => {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        // Use Object.defineProperty to bypass read-only .files restriction
        try {
          Object.defineProperty(input, 'files', { value: dt.files, configurable: true, writable: true });
        } catch (e) {
          input.files = dt.files;
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

    // ── Tier 0: Pre-emptive MutationObserver intercept ──────────────────────
    // Register before any button click so we catch the transient file input
    // the instant Gemini mounts it in response to user interaction.
    let mutationResolved = false;
    const mutationPromise = new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        if (mutationResolved) return;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const candidates = node.tagName === 'INPUT' && node.type === 'file'
              ? [node]
              : Array.from(node.querySelectorAll('input[type="file"]'));
            for (const input of candidates) {
              console.log('[Gemini] Tier 0: MutationObserver intercepted file input:', input.accept);
              if (injectFileIntoInput(input)) {
                mutationResolved = true;
                observer.disconnect();
                resolve(true);
                return;
              }
            }
          }
        }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(false); }, 10000);
    });

    // ── Tier 1: Check for pre-existing file inputs ───────────────────────────
    const existingInputs = findAllFileInputs();
    if (existingInputs.length > 0) {
      console.log(\`[Gemini] Tier 1: Found \${existingInputs.length} existing file input(s).\`);
      for (const input of existingInputs) {
        if (injectFileIntoInput(input)) {
          const quickCheck = await waitForImagePreviewChip(2000);
          if (quickCheck) return true;
        }
      }
    }

    // ── Tier 2: Click "Upload & tools" button → "Upload files" menu item ────
    // Real Gemini DOM observed 2026-10-15:
    //   The "+" button has aria-label="Upload & tools"
    //   Its dropdown contains a menu item with text "Upload files"
    // Clicking "Upload files" causes Gemini to dynamically mount input[type="file"]
    // which the MutationObserver above will immediately intercept.
    const uploadToolsSelectors = [
      'button[aria-label="Upload & tools"]',
      'button[aria-label*="Upload & tools" i]',
      'button[aria-label*="Upload and tools" i]',
      'button[aria-label*="Add files" i]',
      'button[aria-label*="Open upload" i]',
      'button[aria-label*="Upload image" i]',
      'button[aria-label*="Attach" i]',
      'button[mattooltip*="Upload" i]',
      'button[mattooltip*="Add" i]',
      'button[data-test-id*="upload"]',
      'button[data-test-id*="attach"]',
      '.upload-button',
      '.attachment-picker-button'
    ];

    let menuOpened = false;
    for (const sel of uploadToolsSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && !btn.disabled) {
          console.log(\`[Gemini] Tier 2: Clicking upload button ("\${btn.getAttribute('aria-label')}")...\`);
          btn.focus();
          btn.click();
          menuOpened = true;
          break;
        }
      } catch (e) {}
    }

    if (menuOpened) {
      // Wait for Angular Material menu animation to complete
      await sleep(700);

      // Find "Upload files" menu item by exact then partial text match
      const allMenuCandidates = Array.from(document.querySelectorAll(
        '[role="menuitem"], .mat-mdc-menu-item, .mat-menu-item, button[role="menuitem"], li[role="menuitem"], .menu-option'
      ));

      const uploadFilesItem = (
        allMenuCandidates.find(el => {
          const t = (el.textContent || el.innerText || '').trim();
          return t === 'Upload files' || t === 'Upload file';
        }) ||
        allMenuCandidates.find(el => {
          const t = (el.textContent || el.innerText || '').trim().toLowerCase();
          return (t.startsWith('upload file') || t.includes('upload from computer') || t.includes('upload from device'));
        }) ||
        allMenuCandidates.find(el => {
          const t = (el.textContent || el.innerText || '').trim().toLowerCase();
          return t.includes('upload') && !t.includes('drive') && !t.includes('more');
        })
      );

      if (uploadFilesItem) {
        console.log(\`[Gemini] Tier 2: Clicking menu item: "\${uploadFilesItem.textContent?.trim()}"\`);
        uploadFilesItem.click();
        // MutationObserver will intercept the file input as soon as it mounts
        await sleep(400);
        // Also try direct injection to any newly-visible inputs
        for (const input of findAllFileInputs()) injectFileIntoInput(input);
      } else {
        console.warn('[Gemini] Tier 2: "Upload files" menu item not found. Available items:',
          allMenuCandidates.map(el => el.textContent?.trim()).filter(Boolean));
        // Close the open menu so it doesn't block editor access
        try { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); } catch (e) {}
      }

      const tier2Result = await Promise.race([mutationPromise, waitForImagePreviewChip(5000)]);
      if (tier2Result) return true;
    }

    // ── Tier 3: Synthetic Drag-and-Drop ────────────────────────────────────
    const dispatchDragDrop = () => {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const dropTargets = [
          editorElement,
          editorElement?.closest?.('rich-textarea'),
          document.querySelector('rich-textarea'),
          document.querySelector('.input-area-container'),
          document.querySelector('.input-area'),
          document.querySelector('[class*="input-area"]'),
          document.querySelector('chat-window'),
          document.querySelector('main'),
          document.body
        ].filter(Boolean);
        for (const target of dropTargets) {
          target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
          target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
          target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
        }
      } catch (e) { console.warn('[Gemini] DragDrop error:', e); }
    };

    console.log('[Gemini] Tier 3: Synthetic drag-and-drop...');
    dispatchDragDrop();
    const dropResult = await Promise.race([mutationPromise, waitForImagePreviewChip(2000)]);
    if (dropResult) return true;

    // ── Tier 4: Synthetic Clipboard Paste ──────────────────────────────────
    const dispatchPaste = () => {
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        editorElement?.focus?.();
        const pasteTargets = [
          editorElement,
          editorElement?.closest?.('rich-textarea'),
          document.querySelector('rich-textarea'),
          document.querySelector('.input-area-container'),
          document.querySelector('.input-area'),
          document.activeElement,
          document.body
        ].filter(Boolean);
        for (const target of pasteTargets) {
          target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dt }));
        }
      } catch (e) { console.warn('[Gemini] Paste error:', e); }
    };

    console.log('[Gemini] Tier 4: Synthetic clipboard paste...');
    dispatchPaste();

    // ── Tier 5: Staggered retry sweep (up to 6 seconds) ──────────────────
    const tier5Result = await Promise.race([
      mutationPromise,
      waitForImagePreviewChip(6000, async (elapsedMs) => {
        console.log(\`[Gemini] Tier 5: Retry sweep at \${elapsedMs}ms...\`);
        for (const input of findAllFileInputs()) injectFileIntoInput(input);
        dispatchDragDrop();
        dispatchPaste();
      })
    ]);

    return !!tier5Result;
  }

`;

const newContent = content.substring(0, startIdx) + replacement + content.substring(endIdx);
fs.writeFileSync(target, newContent, 'utf8');
console.log('Patch applied successfully.');
console.log('New file size:', newContent.length, 'bytes (was:', content.length, ')');
