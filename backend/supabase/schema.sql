-- SUPABASE POSTGRESQL SCHEMA — Adobe Stock Metadata Pro
-- ========================================================
-- Production-ready schema with transactional locking,
-- unique active installation constraints, and RLS.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════
-- LICENSES TABLE
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS licenses (
  id               SERIAL PRIMARY KEY,
  license_id       TEXT    NOT NULL UNIQUE,
  license_code     TEXT,
  customer_email   TEXT    NOT NULL,
  customer_name    TEXT    DEFAULT '',
  plan             TEXT    NOT NULL,
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at       TIMESTAMPTZ,
  activation_limit INTEGER NOT NULL DEFAULT 1 CHECK (activation_limit > 0),
  status           TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'suspended')),
  order_reference  TEXT    DEFAULT '',
  notes            TEXT    DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_email  ON licenses(customer_email);
CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
CREATE INDEX IF NOT EXISTS idx_licenses_id     ON licenses(license_id);
CREATE INDEX IF NOT EXISTS idx_licenses_code   ON licenses(license_code);

-- ═══════════════════════════════════════════════════════════════
-- ACTIVATIONS TABLE
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activations (
  id                  SERIAL PRIMARY KEY,
  license_id          TEXT    NOT NULL REFERENCES licenses(license_id) ON DELETE CASCADE,
  installation_hash   TEXT    NOT NULL,
  activated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at      TIMESTAMPTZ,
  status              TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated'))
);

CREATE INDEX IF NOT EXISTS idx_activations_license ON activations(license_id);
CREATE INDEX IF NOT EXISTS idx_activations_hash    ON activations(installation_hash);
CREATE INDEX IF NOT EXISTS idx_activations_status  ON activations(status);

-- Unique constraint ensuring an installation cannot be activated twice concurrently
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_activation 
  ON activations(license_id, installation_hash) 
  WHERE status = 'active';

-- ═══════════════════════════════════════════════════════════════
-- EVENTS TABLE (Audit Trail)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS events (
  id          SERIAL PRIMARY KEY,
  license_id  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata    JSONB   DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_events_license ON events(license_id);
CREATE INDEX IF NOT EXISTS idx_events_type    ON events(event_type);

-- ═══════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- Strictly disabled for public / anon; only service_role permitted
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE licenses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE events      ENABLE ROW LEVEL SECURITY;

-- Note: No PUBLIC policies are created. All client interactions MUST go
-- through Supabase Edge Functions authenticated via service role.

-- ═══════════════════════════════════════════════════════════════
-- TRANSACTIONAL ACTIVATION PROCEDURE
-- Prevents race conditions during concurrent device activations
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION activate_license_transaction(
  p_license_id TEXT,
  p_installation_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_license licenses%ROWTYPE;
  v_existing_activation activations%ROWTYPE;
  v_active_count INTEGER;
BEGIN
  -- Lock license row for update to serialize concurrent activations
  SELECT * INTO v_license
  FROM licenses
  WHERE license_id = p_license_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_found', 'message', 'License not found.');
  END IF;

  IF v_license.status = 'revoked' THEN
    RETURN jsonb_build_object('success', false, 'code', 'revoked', 'message', 'License has been revoked.');
  END IF;

  IF v_license.status = 'suspended' THEN
    RETURN jsonb_build_object('success', false, 'code', 'suspended', 'message', 'License is suspended.');
  END IF;

  IF v_license.expires_at IS NOT NULL AND v_license.expires_at < NOW() THEN
    RETURN jsonb_build_object('success', false, 'code', 'expired', 'message', 'License has expired.');
  END IF;

  -- Check if already active on this exact installation
  SELECT * INTO v_existing_activation
  FROM activations
  WHERE license_id = p_license_id 
    AND installation_hash = p_installation_hash 
    AND status = 'active'
  LIMIT 1;

  IF FOUND THEN
    UPDATE activations 
    SET last_seen_at = NOW() 
    WHERE id = v_existing_activation.id;

    SELECT COUNT(*) INTO v_active_count 
    FROM activations 
    WHERE license_id = p_license_id AND status = 'active';

    RETURN jsonb_build_object(
      'success', true,
      'code', 'already_active',
      'licenseId', v_license.license_id,
      'plan', v_license.plan,
      'expiresAt', v_license.expires_at,
      'activationLimit', v_license.activation_limit,
      'activatedDevices', v_active_count
    );
  END IF;

  -- Count currently active activations
  SELECT COUNT(*) INTO v_active_count 
  FROM activations 
  WHERE license_id = p_license_id AND status = 'active';

  IF v_active_count >= v_license.activation_limit THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'activation_limit',
      'message', 'Activation limit reached. Please deactivate another device first.',
      'activatedDevices', v_active_count,
      'activationLimit', v_license.activation_limit
    );
  END IF;

  -- Record new activation
  INSERT INTO activations (license_id, installation_hash, activated_at, last_seen_at, status)
  VALUES (p_license_id, p_installation_hash, NOW(), NOW(), 'active');

  -- Record audit event
  INSERT INTO events (license_id, event_type, timestamp, metadata)
  VALUES (p_license_id, 'activated', NOW(), jsonb_build_object('installation_hash_prefix', SUBSTRING(p_installation_hash, 1, 8)));

  RETURN jsonb_build_object(
    'success', true,
    'code', 'activated',
    'licenseId', v_license.license_id,
    'plan', v_license.plan,
    'expiresAt', v_license.expires_at,
    'activationLimit', v_license.activation_limit,
    'activatedDevices', v_active_count + 1
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGER
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_licenses_updated_at ON licenses;
CREATE TRIGGER update_licenses_updated_at
  BEFORE UPDATE ON licenses
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at();
