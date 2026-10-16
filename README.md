# Adobe Stock Metadata Pro v2.0.0

A hardened, commercially releasable Chrome extension that automates metadata generation for Adobe Stock Contributor assets using Google Gemini AI, featuring asymmetric Ed25519 licensing, serialized task queues, strict selection scoping, and zero automatic stock submissions.

---

## 🏗️ Architecture & Deliverables

The project is structured into three strictly isolated deliverables to prevent credential and database leaks:

1. **Customer Extension (`dist/customer-extension/` & `dist/customer-extension.zip`):**
   - Strictly allowlisted runtime package.
   - Zero secrets, zero `.env` files, zero SQLite databases, zero Git history.
   - Clean Manifest V3 declaration with narrow permissions (`contributor.stock.adobe.com`, `gemini.google.com`, and licensing origin).
   - Dual interface: compact quick launcher (`popup/popup.html`) and 5-view workspace (`ui/app.html`).

2. **Private License Admin Tool (`dist/license-admin/`):**
   - Local administrative tool bound strictly to `127.0.0.1:3456`.
   - Token-authenticated session control, input sanitization, and XSS defense.
   - Ed25519 cryptographic license key generator and local SQLite registry.
   - Synchronized online revocation and restoration with the Supabase backend.

3. **Licensing Backend (`dist/backend/`):**
   - Supabase PostgreSQL schema (`backend/supabase/schema.sql`) with strict Row Level Security.
   - Atomic stored procedure `activate_license_transaction` with row-level locking (`FOR UPDATE`) for race-free device limit enforcement.
   - Five deployed Supabase Edge Functions (`license-activate`, `license-validate`, `admin-register`, `admin-revoke`, `admin-restore`).
   - Cryptographic 7-day signed offline lease tokens bound to pseudonymous installation hashes.

---

## 🚀 Build, Test & Packaging Commands

All commands are runnable from the repository root:

```bash
# 1. Run Core Automated Test Suite (33 tests across 7 suites)
npm test

# 2. Run Private License Admin Test Suite (4 tests)
npm run test:admin

# 3. Perform Zero-Secret Scan Across Repository
npm run scan:secrets

# 4. Build Clean Customer Extension, Admin Tool, and Backend Deliverables
npm run build

# 5. Build for Production (fails if required production variables are unconfigured)
npm run build:prod
```

---

## 📁 Source Code Organization

```
├── manifest.json              ← Manifest V3 specification
├── background.js              ← Resilient service worker & alarm manager
├── content_adobe.js           ← Strictly scoped Adobe Stock Contributor adapter
├── content_gemini.js          ← Dedicated Gemini web session automation
├── content_magnific.js        ← Isolated optional Magnific adapter
├── popup/                     ← Compact popup launcher
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── ui/                        ← 5-View Workspace / Side Panel
│   ├── app.html
│   ├── app.css
│   └── app.js
├── src/
│   ├── config/
│   │   └── product.config.js  ← Client configuration & public verification key
│   └── lib/
│       ├── task-state.js      ← State machine & image fingerprinting
│       ├── task-manager.js    ← Serialized queue & storage persistence
│       ├── metadata-validator.js ← Adobe Stock title/keyword rules & buzzword filter
│       ├── export.js          ← Formula injection defense & Adobe import CSV
│       ├── messages.js        ← Typed message schema & authorization checks
│       ├── license-client.js  ← Ed25519 Web Crypto & 7-day signed lease validation
│       ├── entitlements.js    ← Plan gating & free plan isolation
│       └── storage.js         ← Chrome storage abstractions
├── license-admin/             ← 🔒 PRIVATE seller tool (CLI + UI)
├── backend/                   ← Supabase SQL migrations & Edge Functions
├── tests/                     ← Automated test suites (100% passing)
├── scripts/
│   ├── build.js               ← Allowlist builder producing release ZIP
│   └── secret-scan.js         ← Leak prevention scanner
└── docs/                      ← Public legal disclosures (privacy, terms, refund)
```

---

## 🔒 Security & Safety Principles

1. **Contributor Asset Protection:** The extension **never** automatically clicks "Submit for Review". The user retains 100% control over publication.
2. **Strict Selection Scoping:** Eliminated arbitrary first-image and generic form fallbacks. Metadata is written strictly to the actively selected asset after pre-write re-verification.
3. **Fail-Closed Licensing:** First activation requires server approval. Network errors, 404s, or invalid signatures reject activation immediately. Direct public REST table inserts are blocked by RLS.
4. **Formula Injection Defense:** Spreadsheets exported from the extension sanitize leading `=`, `+`, `-`, and `@` characters to neutralize CSV injection attacks.
5. **Pseudonymous Privacy:** Installation hashes are pseudonymous; images and prompts are sent to Google under the user's active Gemini web session. Mandatory first-use consent is required before processing.

---

## 📖 Key Documentation & Handover Logs

- **Engineering Audit & Remediation Log:** [`FINDINGS_AND_REPAIRS_LOG.md`](./FINDINGS_AND_REPAIRS_LOG.md)
- **Feature & Claim Verification Matrix:** [`FEATURE_CLAIM_MATRIX.md`](./FEATURE_CLAIM_MATRIX.md)
- **Manual Live-Site Verification Checklist:** [`LIVE_SITE_CHECKLIST.md`](./LIVE_SITE_CHECKLIST.md)
- **Commercial Release Notes:** [`RELEASE_NOTES.md`](./RELEASE_NOTES.md)
- **Backend Deployment Guide:** [`backend/README.md`](./backend/README.md)
