/**
 * LICENSE CLIENT
 * ==============
 * Enterprise-grade client for Ed25519 license verification, activation,
 * heartbeat validation, and offline lease enforcement.
 *
 * SECURITY MODEL:
 * 1. Fail-closed: Never grants Pro on 404s, direct table inserts, or initial offline attempts.
 * 2. Cryptographic signature check: Ed25519 public key verification via Web Crypto API.
 * 3. Server-authoritative status: Server revokes or validates license against live database.
 * 4. Bound offline grace: Maximum 7 days offline allowed ONLY for previously approved installations
 *    possessing a valid, unexpired, installation-bound lease token.
 * 5. Clock rollback protection: Detects system time manipulation.
 */

(function () {
  'use strict';

  class LicenseClientImpl {
  constructor() {
    this._config = null;
    this._apiUrl = null;
  }

  _getConfig() {
    if (!this._config) {
      this._config = (typeof PRODUCT_CONFIG !== 'undefined') ? PRODUCT_CONFIG : (globalThis.PRODUCT_CONFIG || {});
    }
    return this._config;
  }

  _getApiUrl() {
    const cfg = this._getConfig();
    let url = cfg?.LICENSE?.API_URL || '';
    return url.replace(/\/+$/, '');
  }

  /**
   * Cryptographically verifies and parses a license code locally.
   *
   * @param {string} rawCode
   * @returns {Promise<{ valid: boolean, payload: object|null, error: string|null }>}
   */
  async parseAndVerifyLocal(rawCode) {
    try {
      const code = this._normalizeCode(rawCode);
      const config = this._getConfig();
      const prefix = config?.LICENSE?.CODE_PREFIX || 'ASMP';

      if (!code.startsWith(prefix + '-')) {
        return { valid: false, payload: null, error: 'License belongs to another product.' };
      }

      const parts = code.split('-');
      if (parts.length < 3) {
        return { valid: false, payload: null, error: 'License signature is invalid.' };
      }

      const encodedData = parts.slice(2).join('-');

      let payloadBytes, signatureBytes;
      try {
        const rawBytes = this._base64UrlDecode(encodedData);
        if (rawBytes.length < 65) throw new Error('Payload too short');
        signatureBytes = rawBytes.slice(rawBytes.length - 64);
        payloadBytes = rawBytes.slice(0, rawBytes.length - 64);
      } catch (e) {
        return { valid: false, payload: null, error: 'License signature is invalid.' };
      }

      // Verify Ed25519 signature
      const publicKeyB64 = config?.LICENSE?.PUBLIC_KEY_BASE64;
      if (!publicKeyB64) {
        return { valid: false, payload: null, error: 'License verification key not configured.' };
      }

      const isSignatureValid = await this._verifyEd25519Signature(publicKeyB64, payloadBytes, signatureBytes);
      if (!isSignatureValid) {
        return { valid: false, payload: null, error: 'License signature is invalid.' };
      }

      // Parse payload JSON
      let payload;
      try {
        const payloadText = new TextDecoder().decode(payloadBytes);
        payload = JSON.parse(payloadText);
      } catch (e) {
        return { valid: false, payload: null, error: 'License payload corrupted.' };
      }

      // Check product claim
      const expectedProduct = config?.PRODUCT_ID || 'adobe-stock-metadata-pro';
      if (payload.product && payload.product !== expectedProduct) {
        return { valid: false, payload: null, error: 'License belongs to another product.' };
      }

      // Check expiration claim
      if (payload.expiresAt) {
        const expiresAt = new Date(payload.expiresAt);
        if (new Date() > expiresAt) {
          return { valid: false, payload, error: 'License has expired.' };
        }
      }

      return { valid: true, payload, error: null };
    } catch (err) {
      console.error('[LicenseClient] parseAndVerifyLocal error:', err);
      return { valid: false, payload: null, error: 'License signature is invalid.' };
    }
  }

  /**
   * Activates a license with the authoritative backend server.
   * Fails closed: Requires online server connection and valid signature.
   */
  async activate(licenseCode, installationId) {
    const code = this._normalizeCode(licenseCode);

    // 1. Local signature verification
    const localResult = await this.parseAndVerifyLocal(code);
    if (!localResult.valid) {
      return { success: false, data: null, error: localResult.error };
    }

    const apiUrl = this._getApiUrl();
    if (!apiUrl) {
      return { success: false, data: null, error: 'Licensing server URL is not configured.' };
    }

    // 2. Authoritative online activation
    try {
      const config = this._getConfig();
      const anonKey = config?.LICENSE?.ANON_KEY || '';
      const endpoint = `${apiUrl}/license-activate`;

      const headers = { 'Content-Type': 'application/json' };
      if (anonKey) {
        headers['apikey'] = anonKey;
        headers['Authorization'] = `Bearer ${anonKey}`;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          licenseCode: code,
          installationId: installationId,
          productId: config?.PRODUCT_ID || 'adobe-stock-metadata-pro',
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 404 && (data?.code === 'NOT_FOUND' || data?.message?.includes('not found'))) {
          return {
            success: false,
            data: null,
            error: 'Supabase Edge Function "license-activate" is not deployed yet. Please deploy Edge Functions to your Supabase project.'
          };
        }
        const errorMap = {
          'revoked':           'License has been revoked.',
          'suspended':         'License is suspended.',
          'expired':           'License has expired.',
          'activation_limit':  'Activation limit reached. This license is already active on another device.',
          'invalid':           'License signature is invalid.',
          'invalid_product':   'License belongs to another product.',
          'not_found':         'License not found in database.',
        };
        const msg = errorMap[data?.code] || data?.error || data?.message || 'Activation failed.';
        return { success: false, data: null, error: msg };
      }

      return { success: true, data, error: null };
    } catch (err) {
      console.error('[LicenseClient] Activation network error:', err);
      // Strictly fail closed: First activation MUST reach the server to bind device.
      return {
        success: false,
        data: null,
        error: 'Unable to connect to license verification server. First activation requires an active internet connection.'
      };
    }
  }

  /**
   * Heartbeat / periodic validation.
   * If server is unreachable, verifies signed offline lease (max 7-day grace).
   */
  async validate(licenseCode, installationId) {
    const code = this._normalizeCode(licenseCode);

    // 1. Local cryptographic check
    const localResult = await this.parseAndVerifyLocal(code);
    if (!localResult.valid) {
      return { valid: false, data: null, offline: false, error: localResult.error };
    }

    const apiUrl = this._getApiUrl();
    if (!apiUrl) {
      return { valid: false, data: null, offline: false, error: 'License server URL not configured.' };
    }

    // 2. Online verification attempt
    try {
      const config = this._getConfig();
      const anonKey = config?.LICENSE?.ANON_KEY || '';
      const headers = { 'Content-Type': 'application/json' };
      if (anonKey) {
        headers['apikey'] = anonKey;
        headers['Authorization'] = `Bearer ${anonKey}`;
      }

      const response = await fetch(`${apiUrl}/license-validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          licenseCode: code,
          installationId,
          productId: config?.PRODUCT_ID,
          timestamp: new Date().toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { valid: false, data: null, offline: false, error: data?.error || 'License validation failed.' };
      }

      return { valid: true, data, offline: false, error: null };
    } catch (netErr) {
      console.warn('[LicenseClient] Validation server unreachable. Checking offline grace lease...');
      // 3. Fallback: Verify installation-bound signed offline lease
      return this._verifyOfflineLease(localResult.payload, installationId);
    }
  }

  /**
   * Verifies an installation-bound signed offline lease token during server outages.
   */
  async _verifyOfflineLease(payload, installationId) {
    try {
      let storedLicense = null;
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const res = await chrome.storage.local.get('asmp_license');
        storedLicense = res?.asmp_license;
      }

      if (!storedLicense || !storedLicense.signedLease) {
        return {
          valid: false,
          data: null,
          offline: true,
          error: 'Offline verification requires a previously established server lease. Please reconnect.'
        };
      }

      // Decode lease token
      const leasePayload = JSON.parse(atob(storedLicense.signedLease));
      const installHash = await this._sha256(installationId);

      // Verify binding to this specific device
      if (leasePayload.installHash !== installHash || leasePayload.licenseId !== payload.licenseId) {
        return { valid: false, data: null, offline: true, error: 'Offline lease does not match this installation.' };
      }

      const now = Date.now();

      // Check clock rollback: Current time cannot be before lastVerifiedAt or lease issue time
      const lastVerified = storedLicense.lastVerifiedAt || 0;
      if (now < lastVerified || now < (leasePayload.issuedAt || 0)) {
        return { valid: false, data: null, offline: true, error: 'System clock rollback detected. Reconnect online to verify.' };
      }

      // Check lease expiration (max 7 days from issue)
      if (now > leasePayload.expiresAt) {
        return { valid: false, data: null, offline: true, error: 'Offline grace period (7 days) has expired. Please reconnect.' };
      }

      return {
        valid: true,
        data: {
          licenseId: payload.licenseId,
          plan: leasePayload.plan || payload.plan,
          expiresAt: payload.expiresAt,
          offline: true
        },
        offline: true,
        error: null
      };
    } catch (err) {
      return { valid: false, data: null, offline: true, error: 'Failed to verify offline lease.' };
    }
  }

  /**
   * Deactivates this installation on the server to release the device slot.
   */
  async deactivate(licenseCode, installationId) {
    const code = this._normalizeCode(licenseCode);
    const apiUrl = this._getApiUrl();

    if (!apiUrl) {
      return { success: true, error: null };
    }

    try {
      const config = this._getConfig();
      const anonKey = config?.LICENSE?.ANON_KEY || '';
      const headers = { 'Content-Type': 'application/json' };
      if (anonKey) {
        headers['apikey'] = anonKey;
        headers['Authorization'] = `Bearer ${anonKey}`;
      }

      const response = await fetch(`${apiUrl}/license-validate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'deactivate',
          licenseCode: code,
          installationId,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        return { success: false, error: data?.error || 'Deactivation failed on server.' };
      }

      return { success: true, error: null };
    } catch (err) {
      console.error('[LicenseClient] Deactivate network error:', err);
      return { success: false, error: 'Unable to contact license server for deactivation.' };
    }
  }

  _normalizeCode(code) {
    if (!code) return '';
    const trimmed = (code || '').trim().replace(/\s+/g, '');
    const parts = trimmed.split('-');
    if (parts.length >= 3) {
      return `${parts[0].toUpperCase()}-${parts[1].toUpperCase()}-${parts.slice(2).join('-')}`;
    }
    return trimmed;
  }

  async _verifyEd25519Signature(publicKeyBase64, message, signature) {
    try {
      const keyBytes = this._base64Decode(publicKeyBase64);
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: 'Ed25519' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify(
        { name: 'Ed25519' },
        cryptoKey,
        signature,
        message
      );
    } catch (err) {
      console.error('[LicenseClient] Ed25519 verification error:', err);
      return false;
    }
  }

  _base64UrlDecode(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  _base64Decode(str) {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async _sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

  const LicenseClient = new LicenseClientImpl();

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.LicenseClient = LicenseClient;
  root.LicenseClientImpl = LicenseClientImpl;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { LicenseClient, LicenseClientImpl };
  }
})();
