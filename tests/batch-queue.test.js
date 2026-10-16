/**
 * TESTS: Adobe Stock Batch Queue & Pro Gating Invariants
 * ======================================================
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

// ── MINIMAL MOCK FIXTURES ───────────────────────────────────────────────────

class MockElement {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this._value = '';
  }
  getAttribute(name) { return this.attributes[name] || null; }
  setAttribute(name, val) { this.attributes[name] = val; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {}
  dispatchEvent() { return true; }
  scrollIntoView() {}
  click() {}
}

class MockDocument {
  constructor() {
    this.readyState = 'complete';
    this.body = new MockElement('body');
  }
  getElementById() { return null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  createElement(tag) { return new MockElement(tag); }
  addEventListener() {}
}

globalThis.window = globalThis;
globalThis.document = new MockDocument();
globalThis.Event = class { constructor(type, opts = {}) { this.type = type; this.bubbles = opts.bubbles || false; } };
globalThis.MouseEvent = class extends globalThis.Event {};
globalThis.KeyboardEvent = class extends globalThis.Event {};
globalThis.InputEvent = class extends globalThis.Event {};

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
    id: 'asmp-test-ext',
    sendMessage: async () => ({ success: true }),
    onMessage: { addListener: () => {} }
  }
};

await import('../src/config/product.config.js');
await import('../src/lib/messages.js');
await import('../src/lib/entitlements.js');
await import('../content_adobe.js');

describe('Adobe Stock Batch Queue & Pro Entitlements', () => {

  beforeEach(() => {
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
        id: 'asmp-test-ext',
        sendMessage: async () => ({ success: true }),
        onMessage: { addListener: () => {} }
      }
    };
  });

  test('Batch processing is gated strictly by EntitlementsService', async () => {
    const { EntitlementsService } = globalThis;
    
    // Free plan: batchProcessing must be false
    EntitlementsService._license = null;
    EntitlementsService._initialized = true;
    assert.strictEqual(EntitlementsService.can('batchProcessing'), false);

    // Active Free license: must still be false
    EntitlementsService._license = {
      plan: 'free',
      status: 'active'
    };
    assert.strictEqual(EntitlementsService.can('batchProcessing'), false);

    // Active Pro license: must be true
    EntitlementsService._license = {
      plan: 'pro_monthly',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    };
    assert.strictEqual(EntitlementsService.can('batchProcessing'), true);

    // Expired Pro license: must be false
    EntitlementsService._license = {
      plan: 'pro_monthly',
      status: 'active',
      expiresAt: new Date(Date.now() - 86400000).toISOString()
    };
    assert.strictEqual(EntitlementsService.can('batchProcessing'), false);

    // Lifetime license: must be true
    EntitlementsService._license = {
      plan: 'lifetime',
      status: 'active',
      expiresAt: null
    };
    assert.strictEqual(EntitlementsService.can('batchProcessing'), true);
  });

  test('Adobe Stock helper exports include batch engine methods', async () => {
    const helpers = globalThis.__ASMP_ADOBE_HELPERS__;
    assert.ok(helpers, '__ASMP_ADOBE_HELPERS__ must be exported');
    assert.strictEqual(typeof helpers.getAllAssetCards, 'function');
    assert.strictEqual(typeof helpers.getSelectedCards, 'function');
    assert.strictEqual(typeof helpers.getCardAssetId, 'function');
    assert.strictEqual(typeof helpers.selectAdobeCard, 'function');
    assert.strictEqual(typeof helpers.checkIfSelectedAssetHasMetadata, 'function');
    assert.strictEqual(typeof helpers.handleBatchProcessClick, 'function');
    assert.strictEqual(typeof helpers.stopBatchProcess, 'function');
  });

  test('checkIfSelectedAssetHasMetadata validates field thresholds', () => {
    const helpers = globalThis.__ASMP_ADOBE_HELPERS__;

    // Empty inspector mock
    const emptyInspector = {
      querySelector: () => null,
      querySelectorAll: () => []
    };
    assert.strictEqual(helpers.checkIfSelectedAssetHasMetadata(emptyInspector), false);
  });

  test('stopBatchProcess halts execution cleanly without throwing', () => {
    const helpers = globalThis.__ASMP_ADOBE_HELPERS__;
    assert.doesNotThrow(() => {
      helpers.stopBatchProcess();
    });
  });

  test('handleBatchProcessClick requires Pro license to proceed', async () => {
    const helpers = globalThis.__ASMP_ADOBE_HELPERS__;
    const { EntitlementsService } = globalThis;

    // Free plan
    EntitlementsService._license = null;
    EntitlementsService._initialized = true;

    const result = await helpers.handleBatchProcessClick();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'PRO_REQUIRED');
  });

  test('handleBatchProcessClick detects zero cards cleanly', async () => {
    const helpers = globalThis.__ASMP_ADOBE_HELPERS__;
    const { EntitlementsService } = globalThis;

    // Grant Pro license
    EntitlementsService._license = { plan: 'lifetime', status: 'active', expiresAt: null };
    EntitlementsService._initialized = true;

    // In mock DOM, no cards exist
    const result = await helpers.handleBatchProcessClick();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'NO_CARDS_FOUND');
  });
});
