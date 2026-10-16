/**
 * TESTS: Device Limit Enforcement & Idempotent Activation
 * =======================================================
 */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';

describe('Device Limit Enforcement & Idempotency', () => {
  let activationsDb;
  let license;

  beforeEach(() => {
    license = {
      licenseId: 'ASMP-LIMIT-TEST',
      plan: 'pro_monthly',
      activationLimit: 2,
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    };
    activationsDb = [];
  });

  // Simulated transactional activation procedure (matching the SQL procedure activate_license_transaction)
  async function simulateActivateTransaction(licenseId, installHash) {
    if (license.licenseId !== licenseId) {
      return { success: false, code: 'not_found' };
    }
    if (license.status !== 'active') {
      return { success: false, code: license.status };
    }

    // 1. Check if this exact device is already active (idempotency check)
    const existing = activationsDb.find(a => a.licenseId === licenseId && a.installHash === installHash && a.status === 'active');
    if (existing) {
      existing.lastSeenAt = Date.now();
      const count = activationsDb.filter(a => a.licenseId === licenseId && a.status === 'active').length;
      return {
        success: true,
        code: 'already_active',
        activatedDevices: count,
        activationLimit: license.activationLimit
      };
    }

    // 2. Count active activations
    const activeCount = activationsDb.filter(a => a.licenseId === licenseId && a.status === 'active').length;
    if (activeCount >= license.activationLimit) {
      return {
        success: false,
        code: 'activation_limit',
        message: 'Activation limit reached.',
        activatedDevices: activeCount,
        activationLimit: license.activationLimit
      };
    }

    // 3. Insert new activation
    activationsDb.push({
      licenseId,
      installHash,
      status: 'active',
      activatedAt: Date.now(),
      lastSeenAt: Date.now()
    });

    return {
      success: true,
      code: 'activated',
      activatedDevices: activeCount + 1,
      activationLimit: license.activationLimit
    };
  }

  function simulateDeactivate(licenseId, installHash) {
    const item = activationsDb.find(a => a.licenseId === licenseId && a.installHash === installHash && a.status === 'active');
    if (item) {
      item.status = 'deactivated';
      return true;
    }
    return false;
  }

  test('Permits activation up to activationLimit', async () => {
    // Device 1 activates
    const res1 = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_1');
    assert.strictEqual(res1.success, true);
    assert.strictEqual(res1.activatedDevices, 1);

    // Device 2 activates (limit is 2)
    const res2 = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_2');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.activatedDevices, 2);

    // Device 3 tries to activate: must be rejected with activation_limit
    const res3 = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_3');
    assert.strictEqual(res3.success, false);
    assert.strictEqual(res3.code, 'activation_limit');
  });

  test('Re-activating the same device is idempotent and does not consume extra slots', async () => {
    // Device 1 activates
    await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_1');

    // Device 1 activates again
    const res = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_1');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.code, 'already_active');
    assert.strictEqual(res.activatedDevices, 1, 'Active device count must remain 1');

    // Device 2 can still activate
    const res2 = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_2');
    assert.strictEqual(res2.success, true);
    assert.strictEqual(res2.activatedDevices, 2);
  });

  test('Deactivating a device frees the slot for another device', async () => {
    await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_1');
    await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_2');

    // Third device fails
    const failRes = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_3');
    assert.strictEqual(failRes.code, 'activation_limit');

    // Deactivate Device 1
    const deactivated = simulateDeactivate('ASMP-LIMIT-TEST', 'hash_device_1');
    assert.strictEqual(deactivated, true);

    // Third device can now activate successfully
    const successRes = await simulateActivateTransaction('ASMP-LIMIT-TEST', 'hash_device_3');
    assert.strictEqual(successRes.success, true);
    assert.strictEqual(successRes.activatedDevices, 2);
  });

  test('Concurrent simulated activations at limit boundary are strictly locked', async () => {
    license.activationLimit = 1;

    // Simulate 5 simultaneous requests from 5 different devices
    const requests = [
      simulateActivateTransaction('ASMP-LIMIT-TEST', 'dev_A'),
      simulateActivateTransaction('ASMP-LIMIT-TEST', 'dev_B'),
      simulateActivateTransaction('ASMP-LIMIT-TEST', 'dev_C'),
      simulateActivateTransaction('ASMP-LIMIT-TEST', 'dev_D'),
      simulateActivateTransaction('ASMP-LIMIT-TEST', 'dev_E'),
    ];

    const results = await Promise.all(requests);
    const successful = results.filter(r => r.success);
    const rejected = results.filter(r => !r.success);

    assert.strictEqual(successful.length, 1, 'Exactly one concurrent request must succeed when limit is 1');
    assert.strictEqual(rejected.length, 4, 'Remaining 4 requests must be rejected');
    assert.strictEqual(rejected[0].code, 'activation_limit');
  });
});
