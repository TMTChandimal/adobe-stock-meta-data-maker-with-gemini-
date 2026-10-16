# Adobe Stock Metadata Pro (Gemini AI)
## Engineering Audit, Findings, Repairs & Verification Record

**Date:** October 2026  
**Auditor / Senior Engineer:** Antigravity AI  
**Scope:** Browser Extension, Licensing Backend (Supabase), Private License Admin Tool (CLI & Local UI), Content Automation (Adobe Stock & Gemini).

---

### Executive Summary

An exhaustive audit of the actual repository code (disregarding stale pre-transformation audit assertions) confirmed critical security, architectural, and operational vulnerabilities across all five product subsystems:
1. **Packaging & Secret Exposure:** Development `.env` files, an unencrypted Ed25519 private signing key, and a local SQLite database containing issued customer licenses were present in the source tree with no automated runtime allowlist packaging, risking catastrophic credential leakage in customer distribution archives.
2. **Extension Runtime Failures:** Manifest V3 was missing the mandatory `"alarms"` permission, causing service worker license heartbeat registration to fail. Broad host permissions (`*://*.adobe.com/*`, `*://*.ftcdn.net/*`, `*://*.freepikcompany.com/*`) violated the principle of least privilege, while `web_accessible_resources` exposed internal configuration across all websites (`<all_urls>`).
3. **Task Execution & Concurrency Fragility:** Background service worker relied on a single in-memory global `currentTask` variable, which is destroyed upon service worker suspension or browser restart. Multiple concurrent requests from different tabs silently collided or overrode state. Stale Gemini responses were accepted without attempt or tab correlation.
4. **Content Script & Stock Risk:** Adobe Stock adapter used fragile first-image fallbacks that could overwrite arbitrary images if no image was selected. In Gemini automation, UI attachment failures did not abort execution, and model responses were parsed without strict validation against current Adobe Stock guidelines (e.g. prohibited buzzwords, character counts).
5. **Licensing & Backend Security Bypasses:** The client fell open upon 404s and network errors, attempted unauthorized direct REST table inserts bypassing Edge Functions, and lacked installation-bound signed lease tokens for offline grace. The backend schema omitted the `license_code` column referenced by edge functions and lacked transactional locking for device limits. The private admin tool lacked authentication, CSRF protection, and loopback binding, and performed destructive actions (revocation) using ambiguous fuzzy searches.

---

### Matrix of Confirmed Findings, Status, and Remediation

| Area / Phase | Vulnerability / Defect Confirmed | Severity | Remediation Strategy | Test Coverage |
|---|---|---|---|---|
| **Phase 1: Security & Packaging** | Missing `alarms` permission in `manifest.json`. Worker crashes or fails on alarm creation. | Critical | Add `alarms` to permissions; register alarms with try/catch resilience; ensure message listeners register regardless of alarm status. | `tests/worker-startup.test.js` |
| **Phase 1: Security & Packaging** | Overly broad host permissions and `<all_urls>` web accessible resource leak. | High | Scope host permissions to `contributor.stock.adobe.com`, `gemini.google.com`, and exact Supabase origin. Remove `<all_urls>` config exposure. | `tests/packaging.test.js` |
| **Phase 1: Security & Packaging** | Packaging risk: `.env`, private keys, local SQLite databases, git history in source. | Critical | Implement allowlist-based build pipeline (`scripts/build.js`) and automated zero-leak secret scanner (`scripts/secret-scan.js`). | `tests/packaging.test.js` |
| **Phase 1: Tooling** | Missing `setup.js` and `run-tests.js` in `license-admin`. | Medium | Implement missing admin CLI setup and comprehensive test runner. | `npm test --prefix license-admin` |
| **Phase 2: Task Execution** | Single in-memory `currentTask` wiped on service worker suspension. No correlation of responses. | Critical | Implement persistent state machine (`src/lib/task-state.js`) & serialized task manager (`src/lib/task-manager.js`) in `chrome.storage.local`. Correlation via `taskId` and `attemptId`. | `tests/task-state-machine.test.js` |
| **Phase 2: Task Execution** | Gemini BUSY status treated as failure or accepted incorrectly; timeouts unhandled; no cancellation. | High | Add explicit BUSY detection with exponential backoff; per-step timeouts; transactional stop/cancellation that invalidates pending writes. | `tests/task-state-machine.test.js` |
| **Phase 2: Adapters** | Adobe adapter selects arbitrary first visible image on page if none selected; generic input fallback. | High | Enforce strict asset selection scoping; stable asset identity verification; reverify selected asset immediately before applying metadata. | `tests/dom-adapters.test.js` |
| **Phase 2: Gemini Automation** | Inactive background tab throttling causing failed focus/paste/drag events; rigid chip check blocking prompt send; base64 freeze. | High | (1) Activate Gemini tab (`active: true`) during execution so Chrome permits focus and clipboard/drop handlers; (2) switch active tab back to Adobe Contributor upon result or error; (3) optimize base64 conversion with 32KB chunking; (4) if chip is not explicitly matched by selector within 5s, proceed with 2.5s settlement delay rather than hard-failing before prompt submission; (5) include `metadata-validator.js` in Gemini content script for reliable parsing. | `tests/dom-adapters.test.js` |
| **Phase 2: Metadata Rules** | Model output untrusted; no buzzword filtering; improper keyword deduplication; hallucinations. | Medium | Enforce strict Adobe title (50-70 chars, max 200) and keyword (25-35, top 10 core) validation, casing deduplication, buzzword removal (`src/lib/metadata-validator.js`). | `tests/dom-adapters.test.js` |
| **Phase 3: Product Controls** | Fake quality scores, fake workflows, fake priority processing advertised in popup. | High | Remove fake scores and unverified claims; provide 5 coherent, fully functional views (Overview, Generate & Review, Batch Queue, History & Export, License & Settings). | UI & manual audit |
| **Phase 3: Export Security** | CSV export susceptible to formula injection (`=`, `+`, `-`, `@`); JSON export unmaintained. | High | Implement formula-safe CSV sanitizer (`src/lib/export.js`) escaping dangerous leading characters; implement standard Adobe import CSV and JSON. | `tests/csv-export.test.js` |
| **Phase 3: Usage Accounting** | Client-side only usage counters vulnerable to race conditions; failed tasks consuming quota. | Medium | Centralize usage accounting in background worker; decrement quota only upon verified metadata generation. Document local counter resets. | `tests/task-state-machine.test.js` |
| **Phase 4: Licensing** | Schema mismatch (`license_code` missing in `schema.sql`), 404 fail-open fallback, direct REST bypass. | Critical | Align Supabase migrations; remove 404 fail-open and REST table fallback; enforce strict fail-closed signature and server validation. | `tests/licensing.test.js` |
| **Phase 4: Offline Grace** | Unbounded offline grace without cryptographic binding; clock rollback unhandled. | High | Issue signed, installation-bound lease token with explicit expiry (max 7 days); detect clock rollback; verify lease cryptographically. | `tests/licensing.test.js` |
| **Phase 4: Device Limits** | Race condition in concurrent activations allowing device limit bypass. | High | Implement atomic SQL verification with row-level locking / active activation count checks in Supabase function. | `tests/device-limits.test.js` |
| **Phase 4: Admin Security** | Admin UI listens on 0.0.0.0, lacks auth/CSRF, unescaped HTML XSS (`innerHTML`), fuzzy-search revocation. | Critical | Bind to `127.0.0.1`, require admin secret token, escape all DOM outputs (`textContent`), require exact `license_id` for revocation/restoration. | Admin tests & audit |
| **Phase 5: Release Readiness** | Fake Bitcoin canvas QR code drawing text pretending to be QR; placeholder business credentials. | Medium | Replace fake QR with clean, verified copyable wallet UI and strict configuration validation failing production build on missing details. | `tests/packaging.test.js` |
| **Phase 5: Privacy & Consent** | Claims anonymous device tracking when hashes link to customer emails; no first-use consent. | Medium | Add first-use consent modal disclosing Gemini and licensing data transmission; correct privacy policy to state pseudonymous tracking. | UI & documentation |

---

---

### Record of Verification & Tests

#### Automated Test Suite Metrics (`npm test`):
- **Total Test Suites:** 7
- **Total Tests Passed:** 34 / 34 (100% pass rate, 0 failures, 0 skipped)
- **Execution Time:** ~220ms

| Test Suite File | Scope & Invariants Tested | Tests | Result |
|---|---|---|---|
| `tests/worker-startup.test.js` | Service worker initialization; `licenseHeartbeat` alarm creation idempotency; message listener registration resilience when alarm APIs throw. | 2 | **PASS** |
| `tests/licensing.test.js` | Ed25519 cryptographic signature verification; tampered payload rejection; expired license rejection; product ID mismatch rejection; active free plan entitlement isolation; Pro monthly entitlement grant; fail-closed network 404/down error handling; 7-day signed offline lease enforcement; installation hash binding; clock rollback detection. | 9 | **PASS** |
| `tests/device-limits.test.js` | Activation slot enforcement up to `activationLimit`; idempotent re-activations on the same device; deactivation freeing active slots; atomic locking under simulated concurrent race conditions. | 4 | **PASS** |
| `tests/task-state-machine.test.js` | State machine transition legality (`canTransition`); complete task record generation; multi-tab queue serialization; stale attempt and foreign task rejection; cancellation state transition and image blob purge; worker suspension recovery to `PAUSED_FOR_REVIEW`. | 6 | **PASS** |
| `tests/dom-adapters.test.js` | Title normalization, buzzword stripping, trailing punctuation removal; keyword deduplication, casing normalization, multi-word concept preservation; Gemini response turn parsing; Markdown bold parsing; JSON fallback parsing; unparseable refusal rejection; dataURL decoding and File object reconstruction. | 7 | **PASS** |
| `tests/csv-export.test.js` | Formula injection defense (`=`, `+`, `-`, `@`); UTF-8 BOM injection for Excel; official Adobe platform import CSV generation; structured JSON export schema. | 4 | **PASS** |
| `tests/packaging.test.js` | Runtime allowlist build execution; zero-secrets scanner validation; detection of forbidden files (`.env`, `private-key.b64`, `*.db`, `.git`, backend, admin). | 2 | **PASS** |

#### Admin Tool Test Suite (`npm run test:admin`):
- **Total Tests Passed:** 4 / 4 (100% pass rate)
  - `PASS`: Ed25519 Key Generation and Signature Verification
  - `PASS`: LicenseGenerator generates validly signed code
  - `PASS`: LicenseGenerator rejects unknown plans
  - `PASS`: LicenseStore CRUD and exact match operations

#### Packaging & Secret Scan Verification:
- `node scripts/secret-scan.js --packaging dist/customer-extension`: **PASSED (0 forbidden files, 0 secrets detected)**.
- Release archive `dist/customer-extension.zip` verified clean.

---

### Unresolved Blockers & Handover Notes:
1. **Live Stock Session Testing:** Live testing against `contributor.stock.adobe.com` requires an active Adobe Contributor login and manual asset interaction per `LIVE_SITE_CHECKLIST.md`.
2. **Live Gemini Session Testing:** Gemini web UI DOM structure must be verified live with an active Google account session.
3. **Supabase Production Deployment:** Secrets (`ASMP_PRIVATE_KEY_B64`, `ASMP_ADMIN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) must be set on the target project before live edge functions can verify customer licenses.
