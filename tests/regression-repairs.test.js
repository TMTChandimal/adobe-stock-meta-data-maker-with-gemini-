/**
 * REGRESSION TESTS: PRODUCTION ADAPTERS, QUEUE COORDINATION & GEMINI PIPELINE
 * ===========================================================================
 * Comprehensive regression coverage for 12 critical failure modes:
 * 1. missing/duplicate attachments
 * 2. send rejection
 * 3. stale/user-turn parsing
 * 4. slow partial responses
 * 5. changed asset selection
 * 6. delayed keyword editor mounting
 * 7. full keyword completion
 * 8. save failure
 * 9. autofill/skip-existing settings
 * 10. cancellation mid-operation
 * 11. concurrent queue requests
 * 12. worker restart recovery
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// ── REALISTIC DOM FIXTURE SIMULATOR ─────────────────────────────────────────

class MockClassList {
  constructor(el) {
    this.el = el;
    this._classes = new Set();
  }
  add(cls) { this._classes.add(cls); this._sync(); }
  remove(cls) { this._classes.delete(cls); this._sync(); }
  contains(cls) { return this._classes.has(cls); }
  toggle(cls, force) {
    if (force !== undefined) {
      if (force) this.add(cls); else this.remove(cls);
    } else {
      if (this.contains(cls)) this.remove(cls); else this.add(cls);
    }
  }
  _sync() {
    this.el._className = Array.from(this._classes).join(' ');
  }
}

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.dataset = {};
    this.classList = new MockClassList(this);
    this._className = '';
    this.id = '';
    this.name = '';
    this.value = '';
    this._text = '';
    this.disabled = false;
    this.style = {};
    this.listeners = {};
    this.offsetParent = {}; // truthy = visible
    this.isContentEditable = false;
  }

  get className() { return this._className || ''; }
  set className(val) {
    this._className = String(val);
    this.classList._classes = new Set(String(val).split(/\s+/).filter(Boolean));
  }

  get innerText() { return this._text; }
  set innerText(val) { this._text = String(val); }

  get textContent() {
    if (this._text) return this._text;
    return this.children.map(c => c.textContent).join(' ');
  }
  set textContent(val) { this._text = String(val); }

  get innerHTML() { return this._text; }
  set innerHTML(val) { this._text = String(val); }

  getAttribute(attr) {
    if (attr === 'id') return this.id || null;
    if (attr === 'name') return this.name || null;
    if (attr === 'class') return this.className || null;
    return this.attributes[attr.toLowerCase()] || null;
  }

  setAttribute(attr, val) {
    const lower = attr.toLowerCase();
    this.attributes[lower] = String(val);
    if (lower === 'id') this.id = String(val);
    if (lower === 'name') this.name = String(val);
    if (lower === 'class') {
      this.className = String(val);
    }
    if (lower.startsWith('data-')) {
      const key = lower.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[key] = String(val);
    }
  }

  removeAttribute(attr) {
    delete this.attributes[attr.toLowerCase()];
  }

  appendChild(child) {
    if (!child) return;
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  addEventListener(event, handler) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(handler);
  }

  removeEventListener(event, handler) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(h => h !== handler);
  }

  dispatchEvent(event) {
    const handlers = (this.listeners[event.type] || []).slice();
    for (const h of handlers) {
      try { h.call(this, event); } catch (e) {}
    }
    if (event.bubbles && this.parentNode) {
      this.parentNode.dispatchEvent(event);
    }
    return true;
  }

  click() {
    this.dispatchEvent({ type: 'click', bubbles: true, target: this });
  }

  focus() {
    this.dispatchEvent({ type: 'focus', bubbles: false, target: this });
  }

  getBoundingClientRect() {
    return { width: 100, height: 100, top: 0, left: 0, bottom: 100, right: 100 };
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (curr.matches && curr.matches(selector)) return curr;
      curr = curr.parentNode;
    }
    return null;
  }

  matches(selector) {
    const parts = selector.split(',').map(s => s.trim());
    return parts.some(part => this._matchesSingle(part));
  }

  _matchesSingle(sel) {
    if (sel === '*') return true;
    if (sel.startsWith('#')) return this.id === sel.slice(1);

    let target = sel;
    // Attribute matcher e.g. [data-test-id*="inspector"], [aria-label*="Send" i]
    const attrMatch = target.match(/\[([a-zA-Z0-9_\-]+)([\*\^$]?=)?["']?([^"'\]]*)["']?(\s+i)?\]/i);
    if (attrMatch) {
      const [fullMatch, attrName, op, expectedVal, caseInsensitive] = attrMatch;
      const actualVal = this.getAttribute(attrName);
      if (actualVal === null) return false;
      if (op) {
        const a = caseInsensitive ? actualVal.toLowerCase() : actualVal;
        const e = caseInsensitive ? expectedVal.toLowerCase() : expectedVal;
        if (op === '=' && a !== e) return false;
        if (op === '*=' && !a.includes(e)) return false;
        if (op === '^=' && !a.startsWith(e)) return false;
        if (op === '$=' && !a.endsWith(e)) return false;
      }
      target = target.replace(fullMatch, '').trim();
      if (!target) return true;
    }

    if (target.includes('.')) {
      const parts = target.split('.');
      const tag = parts[0];
      const classes = parts.slice(1).filter(Boolean);
      if (tag && tag.toLowerCase() !== this.tagName.toLowerCase()) return false;
      return classes.every(c => this.classList.contains(c));
    }

    if (target.toLowerCase() === this.tagName.toLowerCase()) return true;

    return false;
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }

  querySelectorAll(selector) {
    const results = [];
    const traverse = (node) => {
      for (const child of node.children) {
        if (child.matches && child.matches(selector)) {
          results.push(child);
        }
        traverse(child);
      }
    };
    traverse(this);
    return results;
  }

  getElementById(id) {
    return this.querySelector('#' + id);
  }
}

class MockDocument extends MockElement {
  constructor() {
    super('#document');
    this.body = new MockElement('body');
    this.head = new MockElement('head');
    this.appendChild(this.head);
    this.appendChild(this.body);
  }

  createElement(tag) {
    return new MockElement(tag);
  }
}

// ── SETUP ENVIRONMENT & LOAD PRODUCTION SCRIPTS ─────────────────────────────

globalThis.window = globalThis;
globalThis.document = new MockDocument();
globalThis.Event = class { constructor(type, opts = {}) { this.type = type; this.bubbles = opts.bubbles || false; } };
globalThis.KeyboardEvent = class extends globalThis.Event { constructor(type, opts = {}) { super(type, opts); this.key = opts.key; } };
globalThis.InputEvent = class extends globalThis.Event { constructor(type, opts = {}) { super(type, opts); this.data = opts.data; } };
globalThis.DragEvent = class extends globalThis.Event { constructor(type, opts = {}) { super(type, opts); this.dataTransfer = opts.dataTransfer; } };
globalThis.ClipboardEvent = class extends globalThis.Event { constructor(type, opts = {}) { super(type, opts); this.clipboardData = opts.clipboardData; } };

globalThis.chrome = {
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    },
    onChanged: { addListener: () => {} }
  },
  runtime: {
    id: 'asmp-prod-extension-id',
    onMessage: { addListener: () => {} },
    sendMessage: async () => {}
  },
  tabs: {
    query: async () => [{ id: 701, url: 'https://gemini.google.com/app', active: true }],
    create: async (opts) => ({ id: 701, url: opts.url, active: true }),
    sendMessage: async () => ({ status: 'PROCESSING' }),
    get: async (id) => ({ id, active: true }),
    update: async () => {}
  },
  alarms: {
    create: () => {},
    clear: () => {}
  }
};

await import('../src/config/product.config.js');
await import('../src/lib/messages.js');
await import('../src/lib/task-state.js');
await import('../src/lib/storage.js');
await import('../src/lib/entitlements.js');
await import('../src/lib/task-manager.js');
await import('../src/lib/metadata-validator.js');
await import('../content_adobe.js');
await import('../content_gemini.js');

const { TaskStatus, canTransition, createTaskRecord } = globalThis;
const { TaskManagerImpl } = globalThis;
const adobeHelpers = globalThis.__ASMP_ADOBE_HELPERS__;
const geminiHelpers = globalThis.__ASMP_GEMINI_HELPERS__;

describe('Production Pipeline Regression Test Suite (12 Core Invariants)', () => {

  let mockStorage = {};

  beforeEach(() => {
    mockStorage = {};
    globalThis.document = new MockDocument();
    globalThis.chrome = {
      storage: {
        local: {
          get: async (keys) => {
            if (Array.isArray(keys)) {
              const res = {};
              keys.forEach(k => { res[k] = mockStorage[k]; });
              return res;
            }
            if (typeof keys === 'string') return { [keys]: mockStorage[keys] };
            return { ...mockStorage };
          },
          set: async (obj) => { Object.assign(mockStorage, obj); },
          remove: async (k) => { delete mockStorage[k]; }
        }
      },
      tabs: {
        query: async () => [{ id: 701, url: 'https://gemini.google.com/app', active: true }],
        create: async (opts) => ({ id: 701, url: opts.url, active: true }),
        sendMessage: async () => ({ status: 'PROCESSING' }),
        get: async (id) => ({ id, active: true })
      },
      runtime: {
        id: 'asmp-prod-extension-id',
        sendMessage: async () => {}
      },
      alarms: {
        create: () => {},
        clear: () => {}
      }
    };
  });

  // 1. Missing & Duplicate Attachments
  test('Regression 1: missing/duplicate attachments handled strictly', async () => {
    // 1A: Duplicate chips cleanup
    const composer = document.createElement('div');
    composer.className = 'input-area';
    document.body.appendChild(composer);

    const chip1 = document.createElement('div');
    chip1.className = 'attachment-chip';
    const closeBtn1 = document.createElement('button');
    closeBtn1.setAttribute('aria-label', 'Remove file');
    chip1.appendChild(closeBtn1);

    const chip2 = document.createElement('div');
    chip2.className = 'attachment-chip';
    let chip2Removed = false;
    const closeBtn2 = document.createElement('button');
    closeBtn2.setAttribute('aria-label', 'Remove file');
    closeBtn2.addEventListener('click', () => { chip2Removed = true; });
    chip2.appendChild(closeBtn2);

    composer.appendChild(chip1);
    composer.appendChild(chip2);

    const chipsBefore = geminiHelpers.getUploadedChips();
    assert.strictEqual(chipsBefore.length, 2, 'Should observe 2 initial chips');

    await geminiHelpers.enforceSingleAttachment();
    assert.strictEqual(chip2Removed, true, 'Excess chip must have its remove button clicked');

    // 1B: Missing attachment detection
    composer.removeChild(chip1);
    composer.removeChild(chip2);
    const chipAfter = geminiHelpers.findUploadedImageChip();
    assert.strictEqual(chipAfter, null, 'No image chip should be detected when empty');
  });

  // 2. Send Rejection
  test('Regression 2: send rejection detects unaccepted submission and times out safely', async () => {
    const editor = document.createElement('div');
    editor.isContentEditable = true;
    editor.innerText = 'Unaccepted Prompt Text';
    document.body.appendChild(editor);

    // Send button is disabled
    const sendBtn = document.createElement('button');
    sendBtn.setAttribute('aria-label', 'Send message');
    sendBtn.disabled = true;
    document.body.appendChild(sendBtn);

    // waitForAcceptedSubmission must return false when prompt remains in editor and not generating
    const accepted = await geminiHelpers.waitForAcceptedSubmission(editor, 400);
    assert.strictEqual(accepted, false, 'Must report unaccepted submission when prompt is not cleared');
  });

  // 3. Stale & User-Turn Parsing
  test('Regression 3: stale/user-turn parsing ignores user turns and prior replies', async () => {
    // Turn 1: User prompt turn (contains "Title:" and "Keywords:" keywords!)
    const userTurn = document.createElement('div');
    userTurn.className = 'user-query';
    const userText = document.createElement('div');
    userText.className = 'query-text';
    userText.innerText = 'Title: Prompt instruction text\nKeywords: prompt, instruction, tags';
    userTurn.appendChild(userText);
    document.body.appendChild(userTurn);

    // Turn 2: Assistant turn (the valid model response)
    const assistantTurn = document.createElement('div');
    assistantTurn.className = 'model-response';
    const assistantText = document.createElement('div');
    assistantText.className = 'model-response-text';
    assistantText.innerText = 'Title: Solitary oak tree in morning mist\nKeywords: tree, oak, nature, mist, morning, landscape, sunrise';
    assistantTurn.appendChild(assistantText);
    document.body.appendChild(assistantTurn);

    // With baselineTurnCount = 0, it should parse the assistant response, not the user query
    const res = await geminiHelpers.waitForCompletedGeminiResponse(userTurn, 0, 2000);
    assert.strictEqual(res.title, 'Solitary oak tree in morning mist');
    assert.strictEqual(res.keywords[0], 'tree');
  });

  // 4. Slow Partial Streaming Responses
  test('Regression 4: slow partial responses are awaited until streaming finishes', async () => {
    const modelTurn = document.createElement('div');
    modelTurn.className = 'model-response';
    const textEl = document.createElement('div');
    textEl.className = 'model-response-text';
    modelTurn.appendChild(textEl);
    document.body.appendChild(modelTurn);

    // Simulating active generating spinner (streaming in-progress)
    const spinner = document.createElement('div');
    spinner.className = 'generating-spinner';
    document.body.appendChild(spinner);

    textEl.innerText = 'Title: Partial Title Only';

    // Simulate streaming finish after 400ms
    setTimeout(() => {
      textEl.innerText = 'Title: Architectural blueprint on dark wooden drafting table\nKeywords: blueprint, architecture, design, plan, drawing, drafting, wooden, table';
      document.body.removeChild(spinner);
    }, 400);

    const res = await geminiHelpers.waitForCompletedGeminiResponse(modelTurn, 0, 4000);
    assert.strictEqual(res.title, 'Architectural blueprint on dark wooden drafting table');
    assert.ok(res.keywords.length >= 7);
  });

  // 5. Changed Asset Selection
  test('Regression 5: changed asset selection aborts write and prevents overwriting wrong asset', async () => {
    // Asset card for Asset A
    const cardA = document.createElement('div');
    cardA.className = 'upload-card is-selected';
    cardA.setAttribute('data-asset-id', 'asset_A');
    const imgA = document.createElement('img');
    imgA.src = 'https://t4.ftcdn.net/jpg/asset_A.jpg';
    cardA.appendChild(imgA);
    document.body.appendChild(cardA);

    let failedMsg = null;
    chrome.runtime.sendMessage = (msg) => {
      if (msg.action === MessageActions.METADATA_APPLY_FAILED) {
        failedMsg = msg;
      }
    };

    // User switches selection to Asset B before write executes
    cardA.className = 'upload-card'; // Deselected
    const cardB = document.createElement('div');
    cardB.className = 'upload-card is-selected';
    cardB.setAttribute('data-asset-id', 'asset_B');
    document.body.appendChild(cardB);

    // Call applyMetadataToAdobe for asset_A
    await adobeHelpers.applyMetadataToAdobe({
      taskId: 'task_asset_A',
      assetId: 'asset_A',
      data: { title: 'New Title', keywords: ['k1', 'k2', 'k3', 'k4', 'k5'] }
    });

    assert.ok(failedMsg, 'METADATA_APPLY_FAILED message must be sent');
    assert.match(failedMsg.error, /Asset selection changed/i);
  });

  // 6. Delayed Keyword Editor Mounting
  test('Regression 6: delayed keyword editor mounting is awaited and discovered', async () => {
    const inspector = document.createElement('div');
    inspector.className = 'asset-detail-inspector';
    document.body.appendChild(inspector);

    // Paste keywords expander button
    const expandBtn = document.createElement('button');
    expandBtn.textContent = 'Paste keywords';
    inspector.appendChild(expandBtn);

    // Simulate delayed mounting of textarea upon expander click
    expandBtn.addEventListener('click', () => {
      setTimeout(() => {
        const textarea = document.createElement('textarea');
        textarea.name = 'keywords';
        inspector.appendChild(textarea);
      }, 250);
    });

    await adobeHelpers.clickPasteKeywordsExpander(inspector);
    const discoveredTextarea = await adobeHelpers.waitForPasteKeywordsTextarea(inspector, 1500);
    assert.ok(discoveredTextarea, 'Textarea must be discovered after async expander mount');
    assert.strictEqual(discoveredTextarea.name, 'keywords');
  });

  // 7. Full Keyword Completion (Textarea vs Committed Chips)
  test('Regression 7: full keyword completion distinguishes textarea entry from committed chips', async () => {
    const inspector = document.createElement('div');
    inspector.className = 'asset-detail-inspector';
    document.body.appendChild(inspector);

    const textarea = document.createElement('textarea');
    textarea.name = 'keywords';
    inspector.appendChild(textarea);

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    inspector.appendChild(addBtn);

    // Clicking Add creates real committed tag chips
    addBtn.addEventListener('click', () => {
      ['mountain', 'hike', 'trail', 'adventure', 'outdoor', 'summit'].forEach(tag => {
        const chip = document.createElement('div');
        chip.className = 'spectrum-Tag';
        chip.textContent = tag;
        inspector.appendChild(chip);
      });
    });

    // Before clicking Add, committed chips are 0
    assert.strictEqual(adobeHelpers.getCommittedKeywordChips(inspector).length, 0);

    await adobeHelpers.clickAddKeywordsButton(textarea, inspector);
    const chips = await adobeHelpers.waitForCommittedKeywordChips(inspector, 5, 1000);
    assert.strictEqual(chips.length, 6, 'Must commit and observe all 6 keyword chips');
    assert.strictEqual(chips[0].textContent, 'mountain');
  });

  // 8. Save Failure
  test('Regression 8: save failure reports honest error when fields fail to persist', async () => {
    const card = document.createElement('div');
    card.className = 'upload-card is-selected';
    card.setAttribute('data-asset-id', 'asset_save_fail');
    const img = document.createElement('img');
    img.src = 'https://t4.ftcdn.net/jpg/test.jpg';
    card.appendChild(img);
    document.body.appendChild(card);

    const inspector = document.createElement('div');
    inspector.className = 'asset-detail-inspector';
    // Title input that rejects value persistence (read-only / broken)
    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    inspector.appendChild(titleInput);
    document.body.appendChild(inspector);

    let failureResult = null;
    chrome.runtime.sendMessage = (msg) => {
      if (msg.action === MessageActions.METADATA_APPLY_FAILED) failureResult = msg;
    };

    // Override value getter so it returns empty (simulating persistence failure)
    Object.defineProperty(titleInput, 'value', { get: () => '', set: () => {} });

    await adobeHelpers.applyMetadataToAdobe({
      taskId: 'task_fail',
      assetId: 'asset_save_fail',
      data: { title: 'Some Title', keywords: ['k1', 'k2', 'k3', 'k4', 'k5'] }
    });

    assert.ok(failureResult, 'Must report failure when fields cannot be verified in DOM');
    assert.match(failureResult.error, /verification failed/i);
  });

  // 9. Autofill & Skip-Existing Settings
  test('Regression 9: autofill/skip-existing settings preserve existing metadata unless authorized', async () => {
    const card = document.createElement('div');
    card.className = 'upload-card is-selected';
    card.setAttribute('data-asset-id', 'asset_existing');
    const img = document.createElement('img');
    img.src = 'https://t4.ftcdn.net/jpg/test.jpg';
    card.appendChild(img);
    document.body.appendChild(card);

    const inspector = document.createElement('div');
    inspector.className = 'asset-detail-inspector';
    const titleInput = document.createElement('input');
    titleInput.name = 'title';
    titleInput.value = 'Existing Original Title That Should Not Be Overwritten';
    inspector.appendChild(titleInput);

    // Existing chips
    ['existing1', 'existing2', 'existing3', 'existing4', 'existing5'].forEach(kw => {
      const chip = document.createElement('div');
      chip.className = 'spectrum-Tag';
      chip.textContent = kw;
      inspector.appendChild(chip);
    });
    document.body.appendChild(inspector);

    // Test 9A: skipExistingMetadata = true and isManualApply = false
    await adobeHelpers.applyMetadataToAdobe({
      taskId: 'task_skip',
      assetId: 'asset_existing',
      data: { title: 'New Gemini Title', keywords: ['new1', 'new2', 'new3', 'new4', 'new5'] },
      settings: { skipExistingMetadata: true },
      isManualApply: false
    });

    assert.strictEqual(
      titleInput.value,
      'Existing Original Title That Should Not Be Overwritten',
      'Existing title must be preserved when skipExistingMetadata is enabled'
    );

    // Test 9B: isManualApply = true authorizes overwrite
    await adobeHelpers.applyMetadataToAdobe({
      taskId: 'task_overwrite',
      assetId: 'asset_existing',
      data: { title: 'Authorized Overwrite Title', keywords: ['new1', 'new2', 'new3', 'new4', 'new5'] },
      settings: { skipExistingMetadata: true },
      isManualApply: true
    });

    assert.strictEqual(
      titleInput.value,
      'Authorized Overwrite Title',
      'Explicit manual Apply must authorize replacing existing metadata'
    );
  });

  // 10. Cancellation Mid-Operation
  test('Regression 10: cancellation mid-operation halts execution, clears blob, and stops writes', async () => {
    const tm = new TaskManagerImpl();
    await tm.init();

    const task = await tm.enqueueTask({
      assetId: 'asset_cancel_mid',
      sourceTabId: 701,
      imageDataUrl: 'data:image/jpeg;base64,blob_to_cancel'
    });

    assert.strictEqual(tm._activeTask.status, TaskStatus.PENDING_GEMINI);
    const activeAttemptId = tm._activeTask.attemptId;

    // User cancels task mid-operation
    await tm.cancelTask(task.taskId);
    assert.strictEqual(tm._activeTask.status, TaskStatus.CANCELLED);

    // Image blob must be purged on terminal path
    const blob = await tm._getImageBlob(task.taskId);
    assert.strictEqual(blob, null, 'Cancelled task blob must be purged');

    // Stale Gemini result arriving after cancellation must be rejected
    const staleResult = await tm.handleGeminiResult({
      taskId: task.taskId,
      attemptId: activeAttemptId,
      data: { title: 'Too Late Title', keywords: ['k1', 'k2'] }
    });
    assert.strictEqual(staleResult.accepted, false, 'Late result after cancellation must be rejected');
  });

  // 11. Concurrent Queue Requests
  test('Regression 11: concurrent queue requests are serialized without race conditions', async () => {
    const tm = new TaskManagerImpl();
    await tm.init();

    // 3 concurrent enqueue calls fired at the same tick
    const p1 = tm.enqueueTask({ assetId: 'conc_1', sourceTabId: 101, imageDataUrl: 'data:image/jpeg;base64,1' });
    const p2 = tm.enqueueTask({ assetId: 'conc_2', sourceTabId: 102, imageDataUrl: 'data:image/jpeg;base64,2' });
    const p3 = tm.enqueueTask({ assetId: 'conc_3', sourceTabId: 103, imageDataUrl: 'data:image/jpeg;base64,3' });

    const [t1, t2, t3] = await Promise.all([p1, p2, p3]);

    assert.notStrictEqual(t1.taskId, t2.taskId);
    assert.notStrictEqual(t2.taskId, t3.taskId);

    const state = await tm.getState();
    assert.strictEqual(state.activeTask.assetId, 'conc_1');
    assert.strictEqual(state.queueLength, 2);
    assert.strictEqual(state.queueSummary[0].assetId, 'conc_2');
    assert.strictEqual(state.queueSummary[1].assetId, 'conc_3');
  });

  // 12. Worker Restart Recovery
  test('Regression 12: worker restart recovery safely pauses expired task and allows resume/retry', async () => {
    // Seed storage simulating worker crash while in PENDING_GEMINI with generated metadata
    mockStorage['asmp_active_task'] = {
      taskId: 'crashed_task_42',
      attemptId: 'att_crash_1',
      assetId: 'asset_crash',
      sourceTabId: 701,
      status: TaskStatus.PENDING_GEMINI,
      timestamps: {
        created: Date.now() - 90000,
        updated: Date.now() - 70000,
        deadline: Date.now() - 10000 // deadline expired
      },
      metadata: {
        title: 'Preserved Generated Title',
        keywords: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5']
      },
      settingsSnapshot: { autoFillTitle: true, autoFillKeywords: true }
    };

    const tm = new TaskManagerImpl();
    await tm.init();

    // Invariant: Expired in-flight task transitioned to PAUSED_FOR_REVIEW without losing metadata
    assert.strictEqual(tm._activeTask.status, TaskStatus.PAUSED_FOR_REVIEW);
    assert.strictEqual(tm._activeTask.metadata.title, 'Preserved Generated Title');

    // Invariant: User can explicitly resume the recovered task
    let messageSent = false;
    chrome.tabs.sendMessage = async (tabId, msg) => {
      if (msg.action === MessageActions.APPLY_METADATA) {
        messageSent = true;
      }
      return { received: true };
    };

    await tm.resumeTask('crashed_task_42');
    assert.strictEqual(messageSent, true, 'Resume must dispatch application to source tab');
    assert.strictEqual(tm._activeTask.status, TaskStatus.APPLYING);
  });
});
