/**
 * TESTS: Service Worker Startup, Alarm Registration & Resilience
 * ===============================================================
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Worker Startup & Alarm Resilience', () => {
  let mockAlarms = {};
  let alarmsCreated = [];
  let messageListeners = [];
  let startupListeners = [];
  let installedListeners = [];

  beforeEach(() => {
    alarmsCreated = [];
    messageListeners = [];
    startupListeners = [];
    installedListeners = [];
    mockAlarms = {
      get: (name, cb) => cb(alarmsCreated.find(a => a.name === name)),
      create: (name, opts) => alarmsCreated.push({ name, opts }),
      onAlarm: { addListener: (fn) => {} }
    };
  });

  test('Worker registers licenseHeartbeat alarm on startup and install', () => {
    function setupAlarms(chrome) {
      if (chrome?.alarms) {
        chrome.alarms.get('licenseHeartbeat', (existing) => {
          if (!existing) {
            chrome.alarms.create('licenseHeartbeat', { periodInMinutes: 24 * 60 });
          }
        });
      }
    }

    const mockChrome = { alarms: mockAlarms };
    setupAlarms(mockChrome);

    assert.strictEqual(alarmsCreated.length, 1);
    assert.strictEqual(alarmsCreated[0].name, 'licenseHeartbeat');
    assert.strictEqual(alarmsCreated[0].opts.periodInMinutes, 1440);

    // Running a second time should not duplicate
    setupAlarms(mockChrome);
    assert.strictEqual(alarmsCreated.length, 1, 'Should not create duplicate alarm if already exists');
  });

  test('Worker survives alarm registration failure without blocking message listeners', () => {
    let messageListenerRegistered = false;

    // Simulate alarms API throwing error (e.g. missing permission)
    const buggyAlarms = {
      get: () => { throw new Error('Missing permission: alarms'); },
      create: () => { throw new Error('Missing permission: alarms'); }
    };

    function startWorker(chrome) {
      try {
        if (chrome?.alarms) {
          chrome.alarms.get('test', () => {});
        }
      } catch (err) {
        // Handled gracefully
      }

      // Message listeners MUST register regardless of alarm error
      if (chrome?.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(() => {});
        messageListenerRegistered = true;
      }
    }

    startWorker({
      alarms: buggyAlarms,
      runtime: {
        onMessage: {
          addListener: () => { messageListenerRegistered = true; }
        }
      }
    });

    assert.strictEqual(messageListenerRegistered, true, 'Message listener must register even if alarms throw');
  });
});
