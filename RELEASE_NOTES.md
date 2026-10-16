# Adobe Stock Metadata Pro v2.0.0
## Commercial Release Notes

**Release Version:** 2.0.0  
**Release Date:** October 2026  
**Architecture Status:** Production Baseline Certified  

---

### 1. Release Overview

Adobe Stock Metadata Pro v2.0.0 represents a complete architectural transformation from an experimental script prototype into a hardened, commercially releasable Chrome extension and licensing platform. 

This release resolves all critical security vulnerabilities, unhandled race conditions, data leakage risks, and dishonest UI features identified during the senior engineering audit.

---

### 2. Major Enhancements by Subsystem

#### A. Security & Package Distribution (Phase 1)
- **Zero-Secret Distribution Packaging:** Implemented an allowlist-only build pipeline (`scripts/build.js`) and automated secret scanner (`scripts/secret-scan.js`). The packaged ZIP (`dist/customer-extension.zip`) is strictly audited to contain zero `.env` files, zero private signing keys, zero local SQLite databases, zero Git history, and zero administrative or backend code.
- **Manifest V3 Hardening:** Added the required `"alarms"` permission for resilient background wakeups. Scoped host permissions strictly to `contributor.stock.adobe.com`, `gemini.google.com`, and the exact Supabase licensing origin. Removed dangerous `<all_urls>` web-accessible resource exposure. Isolated optional third-party integrations (Magnific) into `optional_host_permissions`.

#### B. Safe, Recoverable Task Execution (Phase 2)
- **Persistent State Machine & Serialized Queue:** Replaced the fragile in-memory global `currentTask` with an event-driven state machine (`src/lib/task-state.js`) and serialized queue (`src/lib/task-manager.js`) persisted in `chrome.storage.local`. Service worker suspensions and browser restarts recover seamlessly.
- **Attempt & Tab Correlation:** Every processing job carries a unique `taskId`, `attemptId`, asset identity, image fingerprint, and settings snapshot. Foreign, stale, duplicate, or wrong-tab Gemini responses are rejected.
- **Gemini Automation Reliability:** Automated uploads operate in a dedicated extension-owned tab. Images are sequentially verified before prompts are dispatched. Gemini BUSY states trigger exponential backoff retries instead of failing. Timeouts and cancellation cleanly invalidate active tasks and purge temporary image blobs.
- **Strict Adobe Stock Content Scoping:** Eliminated dangerous "first-image" and generic form fallbacks. The content script operates strictly on the explicitly selected asset, re-verifies selection immediately before applying metadata, and enforces zero automatic submissions to preserve contributor publication safety.
- **Adobe Metadata Guidelines Compliance:** Implemented `src/lib/metadata-validator.js` to normalize titles (50–70 chars optimal, max 200, stripped of trailing punctuation and buzzwords) and keywords (ordered by relevance, deduplicated case-insensitively, multi-word concepts preserved, camera tech specs filtered).

#### C. Honest & Functional Product Controls (Phase 3)
- **Streamlined 5-View Workspace:** Consolidated cluttered popup tabs into 5 coherent, fully functional views:
  1. *Overview:* Quick status, active asset preview, daily quota tracker.
  2. *Generate & Review:* Live generation progress, editable metadata review with diff and restore capability.
  3. *Batch Queue:* Serialized multi-image queue with delay controls and pause/stop actions (Pro gated).
  4. *History & Export:* Chronological audit history with formula-injection-safe CSV and JSON exports.
  5. *License & Settings:* Cryptographic license activation, offline grace status, deactivation, and manual purchase guides.
- **Formula Injection Defense:** Spreadsheets exported via the extension sanitize leading formula trigger characters (`=`, `+`, `-`, `@`) to prevent CSV injection attacks. Includes UTF-8 BOM for Microsoft Excel compatibility.
- **Removal of Dishonest Claims:** Removed fake 0-100% quality scores, fake workflows, and fake priority-processing guarantees.

#### D. Licensing Backend & Private Admin Tool (Phase 4)
- **Ed25519 Cryptographic Licensing:** Implemented asymmetric signature verification using the Web Crypto API. Removed 404 fail-open bypasses and unauthorized direct REST table writes.
- **Transactional Device Limit Enforcement:** Backend Supabase edge function executes atomic stored procedure `activate_license_transaction` with row-level locking (`FOR UPDATE`) and unique partial indexing to prevent concurrent activation race conditions.
- **Cryptographic 7-Day Offline Grace:** Pro licenses receive a signed, installation-bound lease token with explicit expiry. Detects local clock rollbacks and enforces strict fail-closed security.
- **Secured Admin Tool:** The private administration tool (`license-admin`) binds strictly to `127.0.0.1`, enforces session token authentication, renders text safely (`textContent`), requires exact license IDs for revocations, and synchronizes with the Supabase backend.

#### E. Privacy & Consent (Phase 5)
- **First-Use Disclosure:** Added mandatory onboarding modal informing users of image and prompt data transmission to Google under their account, and pseudonymous installation hashing for licensing.
- **Truthful Payment Guidance:** Replaced pseudo-QR canvas drawings with verified copyable wallet interfaces and transparent manual order instructions.

---

### 3. Deliverables Summary

1. **Customer Extension:**
   - Package Directory: `dist/customer-extension/`
   - Release ZIP: `dist/customer-extension.zip`
2. **Private License Admin Tool:**
   - Directory: `dist/license-admin/` (CLI commands + local web UI on `127.0.0.1:3456`)
3. **Licensing Backend:**
   - Directory: `dist/backend/` (`schema.sql` + Supabase Edge Functions + deployment guide)
4. **Verification & Audit Documentation:**
   - `FINDINGS_AND_REPAIRS_LOG.md`: Detailed engineering audit record and remediation matrix.
   - `FEATURE_CLAIM_MATRIX.md`: Comprehensive claim vs. reality technical matrix.
   - `LIVE_SITE_CHECKLIST.md`: Step-by-step manual test checklist for owner live-site sign-off.

---

### 4. Remaining Action Items Prior to Store Submission

1. **Owner Live-Site Verification:** Execute `LIVE_SITE_CHECKLIST.md` against live Adobe Stock Contributor and Google Gemini accounts.
2. **Backend Production Deployment:** Link and deploy Supabase schema and Edge Functions using production secrets as outlined in `backend/README.md`.
3. **Chrome Web Store Assets:** Prepare final store screenshots and store promotional tiles without third-party trademark infringement.
