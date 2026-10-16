/**
 * TESTS: Cryptographic Licensing, Offline Grace, Fail-Closed, & Entitlements
 * =========================================================================
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import '../src/lib/license-client.js';
import '../src/lib/entitlements.js';
const { LicenseClientImpl, EntitlementsService } = globalThis;

let ed;

describe('Licensing & Entitlements Security', () => {
  let privKey;
  let pubKey;
  let pubKeyB64;
  let client;

  before(async () => {
    const candidatePaths = [
      new URL('../license-admin/node_modules/@noble/ed25519/index.js', import.meta.url),
      pathToFileURL('C:/Users/thari/Music/sample project/lison  making for image metadate gen/license-admin/node_modules/@noble/ed25519/index.js'),
    ];

    for (const p of candidatePaths) {
      try {
        ed = await import(p.href);
        break;
      } catch {}
    }

    if (!ed) {
      throw new Error('Could not find @noble/ed25519 in license-admin node_modules.');
    }

    privKey = ed.utils.randomPrivateKey();
    pubKey = await ed.getPublicKeyAsync(privKey);
    pubKeyB64 = Buffer.from(pubKey).toString('base64');

    client = new LicenseClientImpl();
    client._config = {
      PRODUCT_ID: 'adobe-stock-metadata-pro',
      LICENSE: {
        PUBLIC_KEY_BASE64: pubKeyB64,
        API_URL: 'https://example.supabase.co/functions/v1',
        ANON_KEY: 'mock-anon-key',
        OFFLINE_GRACE_PERIOD_DAYS: 7,
        CODE_PREFIX: 'ASMP'
      }
    };
  });

  async function generateTestLicenseCode(payloadOverrides = {}) {
    const payload = {
      licenseId: `ASMP-TEST-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      product: 'adobe-stock-metadata-pro',
      plan: 'pro_monthly',
      customerEmail: 'customer@example.com',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      activationLimit: 2,
      features: ['batchProcessing', 'metadataHistory'],
      version: 1,
      ...payloadOverrides
    };

    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    const sig = await ed.signAsync(payloadBytes, privKey);

    const combined = new Uint8Array(payloadBytes.length + sig.length);
    combined.set(payloadBytes, 0);
    combined.set(sig, payloadBytes.length);

    const b64 = Buffer.from(combined).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    const planPart = (payload.plan || 'PRO').replace(/_/g, '').toUpperCase();
    return `ASMP-${planPart}-${b64}`;
  }

  test('Valid Ed25519 signature parses and verifies locally', async () => {
    const code = await generateTestLicenseCode();
    const res = await client.parseAndVerifyLocal(code);
    assert.strictEqual(res.valid, true, 'Valid code should pass verification');
    assert.strictEqual(res.payload.customerEmail, 'customer@example.com');
    assert.strictEqual(res.payload.plan, 'pro_monthly');
  });

  test('Tampered license payload fails signature verification', async () => {
    const code = await generateTestLicenseCode();
    const parts = code.split('-');
    const rawPayload = parts[2];

    // Flip bits in the base64 payload to simulate tampering
    const tamperedPayload = rawPayload.slice(0, 10) + (rawPayload[10] === 'A' ? 'B' : 'A') + rawPayload.slice(11);
    const tamperedCode = `${parts[0]}-${parts[1]}-${tamperedPayload}`;

    const res = await client.parseAndVerifyLocal(tamperedCode);
    assert.strictEqual(res.valid, false, 'Tampered code must fail verification');
    assert.match(res.error, /invalid/i);
  });

  test('Expired license is rejected during local check', async () => {
    const code = await generateTestLicenseCode({
      expiresAt: new Date(Date.now() - 86400000).toISOString() // expired yesterday
    });
    const res = await client.parseAndVerifyLocal(code);
    assert.strictEqual(res.valid, false, 'Expired license must not be valid');
    assert.match(res.error, /expired/i);
  });

  test('Wrong product ID claim is rejected', async () => {
    const code = await generateTestLicenseCode({
      product: 'some-other-extension'
    });
    const res = await client.parseAndVerifyLocal(code);
    assert.strictEqual(res.valid, false, 'Wrong product must not be valid');
    assert.match(res.error, /another product/i);
  });

  test('Active free plan record NEVER grants Pro entitlements', () => {
    // Inject a cached free plan record with status 'active'
    EntitlementsService._license = {
      licenseId: 'FREE-1234',
      plan: 'free',
      status: 'active',
      expiresAt: null
    };

    assert.strictEqual(EntitlementsService._isProActive(), false, 'Free plan with active status must NOT be Pro active');
    assert.strictEqual(EntitlementsService.can('batchProcessing'), false, 'Free plan must not have batchProcessing entitlement');
    assert.strictEqual(EntitlementsService.can('basicMetadata'), true, 'Free plan has basicMetadata entitlement');
  });

  test('Active pro_monthly plan grants Pro entitlements', () => {
    EntitlementsService._license = {
      licenseId: 'ASMP-PRO-1234',
      plan: 'pro_monthly',
      status: 'active',
      expiresAt: new Date(Date.now() + 86400000).toISOString()
    };

    assert.strictEqual(EntitlementsService._isProActive(), true, 'Active Pro plan must be recognized as active');
    assert.strictEqual(EntitlementsService.can('batchProcessing'), true, 'Pro plan has batchProcessing');
    assert.strictEqual(EntitlementsService.can('metadataHistory'), true, 'Pro plan has metadataHistory');
  });

  test('First activation fails closed if server returns 404 or network error', async () => {
    const code = await generateTestLicenseCode();

    // Mock fetch to simulate 404 (endpoint not deployed or invalid)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not Found' })
    });

    try {
      const res = await client.activate(code, 'install_id_123');
      assert.strictEqual(res.success, false, 'First activation on 404 must fail closed');
      assert.strictEqual(res.data, null);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('First activation fails closed on network outage (offline network error is not success)', async () => {
    const code = await generateTestLicenseCode();

    // Mock fetch to throw network error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('Failed to fetch: net::ERR_INTERNET_DISCONNECTED');
    };

    try {
      const res = await client.activate(code, 'install_id_123');
      assert.strictEqual(res.success, false, 'First activation without network must fail closed');
      assert.match(res.error, /active internet connection/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('Offline grace verification enforces installation binding, 7-day limit, and clock rollback', async () => {
    const now = Date.now();
    const installId = 'test_device_uuid_999';
    const installHash = await client._sha256(installId);

    // 1. Valid signed lease within 7 days
    const validLease = btoa(JSON.stringify({
      licenseId: 'ASMP-VALID-1',
      installHash,
      plan: 'pro_yearly',
      issuedAt: now - 3600000, // 1 hour ago
      expiresAt: now + (6 * 24 * 3600000) // expires in 6 days
    }));

    globalThis.chrome = {
      storage: {
        local: {
          get: async () => ({
            asmp_license: {
              licenseId: 'ASMP-VALID-1',
              signedLease: validLease,
              lastVerifiedAt: now - 3600000
            }
          })
        }
      }
    };

    const validRes = await client._verifyOfflineLease({ licenseId: 'ASMP-VALID-1', plan: 'pro_yearly' }, installId);
    assert.strictEqual(validRes.valid, true, 'Valid lease within 7 days should grant grace');
    assert.strictEqual(validRes.offline, true);

    // 2. Mismatched installation ID
    const wrongDeviceRes = await client._verifyOfflineLease({ licenseId: 'ASMP-VALID-1', plan: 'pro_yearly' }, 'different_device_uuid');
    assert.strictEqual(wrongDeviceRes.valid, false, 'Lease on wrong device must fail');
    assert.match(wrongDeviceRes.error, /does not match this installation/i);

    // 3. Expired lease (> 7 days)
    const expiredLease = btoa(JSON.stringify({
      licenseId: 'ASMP-VALID-1',
      installHash,
      plan: 'pro_yearly',
      issuedAt: now - (8 * 24 * 3600000),
      expiresAt: now - 1000 // expired 1s ago
    }));
    globalThis.chrome.storage.local.get = async () => ({
      asmp_license: { licenseId: 'ASMP-VALID-1', signedLease: expiredLease, lastVerifiedAt: now - 1000 }
    });

    const expiredRes = await client._verifyOfflineLease({ licenseId: 'ASMP-VALID-1', plan: 'pro_yearly' }, installId);
    assert.strictEqual(expiredRes.valid, false, 'Expired lease must fail');
    assert.match(expiredRes.error, /expired/i);

    // 4. Clock rollback detection: current time is before lastVerifiedAt
    globalThis.chrome.storage.local.get = async () => ({
      asmp_license: {
        licenseId: 'ASMP-VALID-1',
        signedLease: validLease,
        lastVerifiedAt: now + 86400000 // future timestamp indicates clock rolled back
      }
    });

    const rollbackRes = await client._verifyOfflineLease({ licenseId: 'ASMP-VALID-1', plan: 'pro_yearly' }, installId);
    assert.strictEqual(rollbackRes.valid, false, 'Clock rollback must be rejected');
    assert.match(rollbackRes.error, /clock rollback/i);
  });
});
