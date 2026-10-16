# ASMP Licensing Backend (Supabase)

This directory contains the database schema migrations, transactional stored procedures, and Edge Functions that power the Adobe Stock Metadata Pro licensing and device limit enforcement.

---

## 1. Architecture Overview

- **Database:** Supabase PostgreSQL with strict Row Level Security (RLS) enabled on all tables.
- **Tables:**
  - `licenses`: Authoritative license registry storing license codes, plans, active/suspended/revoked status, customer metadata, and device limits.
  - `activations`: Active and historical installation bindings identified by pseudonymous SHA-256 installation hashes.
  - `audit_logs`: Immutable security audit log tracking all activations, deactivations, administrative revocations, and restorations.
- **Edge Functions:**
  - `license-activate`: Publicly exposed endpoint for activating a license on a device. Executes the `activate_license_transaction` RPC with row locking (`FOR UPDATE`) to enforce device limits idempotently. Issues a cryptographically signed, installation-bound 7-day offline lease token.
  - `license-validate`: Heartbeat endpoint checking license status and refreshing offline lease tokens, supporting graceful deactivation.
  - `admin-register`: Admin-secret protected endpoint for registering new licenses issued by the private admin CLI/UI.
  - `admin-revoke`: Admin-secret protected endpoint for revoking customer licenses.
  - `admin-restore`: Admin-secret protected endpoint for restoring previously revoked/suspended licenses.

---

## 2. Prerequisites

1. [Supabase CLI](https://supabase.com/docs/guides/cli) installed (`npm install -g supabase` or via Scoop/Homebrew).
2. A Supabase project created in the Supabase Dashboard.
3. Node.js >= 18.0.0.

---

## 3. Database Migration Deployment

To deploy from a clean database:

1. **Link your Supabase Project:**
   ```bash
   supabase login
   supabase link --project-ref <your-supabase-project-id>
   ```

2. **Apply the Schema & Stored Procedures:**
   Execute `backend/supabase/schema.sql` in the Supabase SQL Editor, or apply via the CLI:
   ```bash
   supabase db push
   # Or run direct query:
   supabase db execute -f supabase/schema.sql
   ```

3. **Verify Tables and RLS:**
   Confirm in the Supabase Dashboard:
   - `licenses` table has RLS enabled with 0 public policies (all public access denied).
   - `activations` table has RLS enabled with 0 public policies (all public access denied).
   - `audit_logs` table has RLS enabled with 0 public policies.
   - Unique partial index `idx_unique_active_activation` is active on `(license_id, installation_hash) WHERE status = 'active'`.
   - Function `activate_license_transaction` is created.

---

## 4. Edge Functions Configuration & Secrets

Edge Functions require administrative and cryptographic secrets to operate. Set these using `supabase secrets set`:

```bash
# 1. Supabase Service Role Key (used internally by functions to bypass RLS safely)
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="<your-service-role-key>"

# 2. Private Signing Key (Ed25519 base64 private key from license-admin/keys/private-key.b64)
# Used to sign 7-day offline lease tokens in license-activate and license-validate
supabase secrets set ASMP_PRIVATE_KEY_B64="<your-base64-ed25519-private-key>"

# 3. Admin API Secret (shared between license-admin tool and Supabase backend)
# Protects admin-register, admin-revoke, and admin-restore
supabase secrets set ASMP_ADMIN_SECRET="<generate-high-entropy-64-char-random-string>"
```

---

## 5. Edge Functions Deployment

Deploy each function to your linked Supabase project:

```bash
supabase functions deploy license-activate --no-verify-jwt
supabase functions deploy license-validate --no-verify-jwt
supabase functions deploy admin-register --no-verify-jwt
supabase functions deploy admin-revoke --no-verify-jwt
supabase functions deploy admin-restore --no-verify-jwt
```

> **Note on `--no-verify-jwt`:**
> - `license-activate` and `license-validate` must be callable by the extension using the public Supabase Anon key and signature verification.
> - `admin-register`, `admin-revoke`, and `admin-restore` verify authorization via the internal `X-Admin-Secret` header against `ASMP_ADMIN_SECRET`.

---

## 6. End-to-End Verification Test

To verify deployment against a clean database without modifying production data:

1. **Register a Test License via Admin Endpoint:**
   ```bash
   curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/admin-register" \
     -H "Content-Type: application/json" \
     -H "X-Admin-Secret: <your-asmp-admin-secret>" \
     -d '{"license":{"id":"lic_test_deploy_001","licenseCode":"ASMP-TEST-0001","customerEmail":"test@example.com","plan":"pro_monthly","activationLimit":2,"status":"active"}}'
   ```
   **Expected Response:** `{"success": true, "licenseId": "lic_test_deploy_001"}`

2. **Verify Public RLS Denial:**
   ```bash
   curl -X GET "https://<your-project-ref>.supabase.co/rest/v1/licenses" \
     -H "apikey: <your-anon-key>" \
     -H "Authorization: Bearer <your-anon-key>"
   ```
   **Expected Response:** `[]` (Empty array - public read completely blocked by RLS).

3. **Verify First Activation Fails on Invalid Signature:**
   ```bash
   curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/license-activate" \
     -H "Content-Type: application/json" \
     -d '{"licenseKey":"INVALID_TOKEN","installationHash":"testhash123"}'
   ```
   **Expected Response:** `{"success": false, "error": "Invalid signature or malformed license key."}` (HTTP 401).

4. **Verify Revocation:**
   ```bash
   curl -X POST "https://<your-project-ref>.supabase.co/functions/v1/admin-revoke" \
     -H "Content-Type: application/json" \
     -H "X-Admin-Secret: <your-asmp-admin-secret>" \
     -d '{"licenseId":"lic_test_deploy_001","reason":"Deployment verification test cleanup"}'
   ```
   **Expected Response:** `{"success": true, "status": "revoked"}`
