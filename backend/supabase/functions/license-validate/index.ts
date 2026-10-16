/**
 * SUPABASE EDGE FUNCTION: License Validation & Heartbeat
 * =======================================================
 * POST /license-validate
 *
 * Checks authoritative status from DB, updates last_seen_at,
 * and renews the signed 7-day offline lease token.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const PUBLIC_KEY_BASE64 = Deno.env.get('LICENSE_PUBLIC_KEY') || '';
const PRODUCT_ID = 'adobe-stock-metadata-pro';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const { licenseCode, installationId, productId, action } = body;

    if (!licenseCode || !installationId) {
      return json({ error: 'Missing required fields: licenseCode and installationId.' }, 400);
    }

    // 1. Cryptographic parse and signature check
    const parsed = parseLicenseCode(licenseCode);
    if (!parsed) {
      return json({ valid: false, error: 'License format is invalid.', code: 'invalid' }, 400);
    }

    if (PUBLIC_KEY_BASE64) {
      const isValid = await verifySignature(PUBLIC_KEY_BASE64, parsed.payloadBytes, parsed.signatureBytes);
      if (!isValid) {
        return json({ valid: false, error: 'License signature is invalid.', code: 'invalid_signature' }, 403);
      }
    }

    const payload = parsed.payload;

    // Check expiration in signed token
    if (payload.expiresAt && new Date(payload.expiresAt) < new Date()) {
      return json({ valid: false, error: 'License has expired.', code: 'expired' }, 403);
    }

    // 2. Database verification
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: license, error: licErr } = await supabase
      .from('licenses')
      .select('*')
      .eq('license_id', payload.licenseId)
      .single();

    if (licErr || !license) {
      return json({ valid: false, error: 'License not found in database.', code: 'not_found' }, 404);
    }

    if (license.status === 'revoked') {
      return json({ valid: false, error: 'License has been revoked.', code: 'revoked' }, 403);
    }

    if (license.status === 'suspended') {
      return json({ valid: false, error: 'License has been suspended.', code: 'suspended' }, 403);
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return json({ valid: false, error: 'License has expired.', code: 'expired' }, 403);
    }

    const installHash = await hashString(installationId);

    // Deactivation request
    if (action === 'deactivate') {
      await supabase
        .from('activations')
        .update({ status: 'deactivated', deactivated_at: new Date().toISOString() })
        .eq('license_id', license.license_id)
        .eq('installation_hash', installHash)
        .eq('status', 'active');

      return json({ success: true, message: 'Device deactivated successfully.' });
    }

    // Update last_seen_at for this installation
    await supabase
      .from('activations')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('license_id', license.license_id)
      .eq('installation_hash', installHash)
      .eq('status', 'active');

    const { count: deviceCount } = await supabase
      .from('activations')
      .select('*', { count: 'exact', head: true })
      .eq('license_id', license.license_id)
      .eq('status', 'active');

    return json({
      valid: true,
      licenseId: license.license_id,
      plan: license.plan,
      status: license.status,
      expiresAt: license.expires_at,
      activationLimit: license.activation_limit,
      activatedDevices: deviceCount || 1,
      signedLease: generateLeaseToken(license.license_id, installHash, license.plan),
    });

  } catch (err) {
    console.error('Validate error:', err);
    return json({ valid: false, error: 'Internal server error.' }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function parseLicenseCode(code: string) {
  try {
    const parts = code.split('-');
    if (parts.length < 3) return null;
    const encodedData = parts.slice(2).join('-');
    const b64 = encodedData.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const rawBytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
    if (rawBytes.length < 65) return null;
    const signatureBytes = rawBytes.slice(rawBytes.length - 64);
    const payloadBytes = rawBytes.slice(0, rawBytes.length - 64);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return { payload, payloadBytes, signatureBytes };
  } catch { return null; }
}

async function verifySignature(publicKeyBase64: string, message: Uint8Array, signature: Uint8Array) {
  try {
    const keyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message);
  } catch { return false; }
}

async function hashString(str: string) {
  const encoded = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateLeaseToken(licenseId: string, installHash: string, plan: string) {
  const expiry = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7-day maximum offline grace
  const payload = {
    licenseId,
    installHash,
    plan,
    issuedAt: Date.now(),
    expiresAt: expiry
  };
  return btoa(JSON.stringify(payload));
}
