# Adobe Stock Metadata Pro
## Feature & Claim Verification Matrix

This matrix documents all product features, comparing historical or advertised marketing claims against technical realities found in source code, the engineering repairs applied, verification levels achieved, and current production status.

---

### Verification Level Definitions:
- **Source-Verified:** Inspected directly in the codebase and confirmed through architecture review.
- **Mock-Tested:** Validated through deterministic automated unit and regression test fixtures without live network or external DOM dependencies.
- **Integration-Tested:** Validated across interconnected subsystems (e.g. state machine + queue persistence + storage + export sanitization + cryptographic signing).
- **Live-Tested:** Validated against active live third-party web sessions (Adobe Stock Contributor, Gemini web UI, Supabase hosted project).

---

| Feature / Claim | Historical / Advertised Claim | Actual Code Reality (Audited) | Repaired Implementation | Verification Level | Production Status |
|---|---|---|---|---|---|
| **Single-Asset Adobe Stock Metadata** | User selects image on Adobe Contributor, Gemini generates title & keywords, writes directly to asset. | Content script picked first image on page if none selected; generic input fallback risked writing to wrong forms. | Removed all first-image fallbacks. Scoped strictly to `.asset-preview-selected`. Re-verifies selected asset identity immediately prior to write. Non-submission guaranteed. | Mock-tested & Source-verified | **Production-Ready** (Requires owner live-site sign-off) |
| **Asset Submission for Publication** | Auto-submission claimed in older drafts. | Dangerous risk of accidental asset publication violating stock guidelines. | Strictly prohibited. Extension never clicks "Submit for Review". User retains 100% submission control. | Source-verified | **Enforced Principle** |
| **Batch Processing** | "One-click batch processing for 100+ stock assets." | Unbounded loop; no rate limiting; wiped on service worker restart; no per-asset failure isolation. | Serialized queue in `chrome.storage.local`. Correlation via `taskId` and `attemptId`. Bounded storage with automatic blob cleanup. Pauses on failure. Pro plan gated. | Integration-tested & Mock-tested | **Production-Ready** (Pro entitlement gated) |
| **Gemini AI Automation** | Seamless background generation via user's Gemini session. | Shared active tab draft collision; unverified file upload; prompt sent before image upload completed; BUSY treated as failure; model hallucinations unhandled. | Dedicated extension-owned tab; verifies upload chip confirmation before typing prompt; detects turn completion from baseline; handles BUSY with exponential backoff; normalized parsing. | Integration-tested & Source-verified | **Production-Ready** (Live-site DOM session check required) |
| **Metadata Quality / Relevance Score** | "Proprietary AI quality and relevance scoring 0-100%." | Random number or hardcoded value fabricated in popup UI. No algorithmic scoring existed. | Stripped dishonest fake scores completely from all UI views and exports. Replaced with honest Adobe guideline compliance metrics (character count, keyword count, buzzword check). | Mock-tested & Source-verified | **Honest & Repaired** |
| **Ed25519 Cryptographic Licensing** | "Piracy-proof offline license verification." | Client fell open on 404/network errors; public table REST bypass; unverified offline grace; schema mismatch in backend. | Fail-closed verification. Web Crypto Ed25519 signature checks. 7-day signed offline lease tokens bound to pseudonymous installation hash. Rollback detection. Public table RLS blocked. | Integration-tested & Mock-tested | **Production-Ready** |
| **Device Limit Enforcement** | "Strict multi-device licensing limits." | Non-atomic check in edge function allowing concurrent activation race conditions; fuzzy matching in admin. | SQL RPC `activate_license_transaction` with row-level locking (`FOR UPDATE`) and partial unique index on active installations. Idempotent re-activations. | Mock-tested & Source-verified | **Production-Ready** |
| **Private Admin Tool** | "Secure administration suite." | Unauthenticated UI listening on `0.0.0.0`; unescaped `innerHTML` XSS; missing setup/test scripts; fuzzy search revoking unintended keys. | Local loopback `127.0.0.1` binding; token authentication; safe `textContent` rendering; exact `license_id` matching; backend synchronization; automated test suite. | Integration-tested & Mock-tested | **Production-Ready** |
| **CSV & JSON Export** | "One-click export to CSV and JSON." | CSV susceptible to spreadsheet formula execution injection (`=`, `+`, `-`, `@`); JSON export unmaintained. | Formula injection sanitization prefixing dangerous characters with `'`; UTF-8 BOM for Excel; official Adobe platform CSV format; validated JSON export. | Mock-tested | **Production-Ready** |
| **Freepik & Magnific Integration** | "Full support for Freepik and Magnific." | Magnific script fragile; Freepik unsupported; broad host permissions requested across all users. | Isolated Magnific to `optional_host_permissions`; stripped Freepik host permissions; disabled from main launch UI; not advertised as supported until verified. | Source-verified | **Gated / Excluded from Launch** |
| **Payment & Billing** | "Instant Bitcoin QR and automated recurring card billing." | Fake Bitcoin canvas drawing pseudo-QR; fake recurring billing promises for fixed-duration prepaid keys. | Truthful manual payment flow with verified address copy, explicit order reference, manual activation issuance, and transparent pricing. | Mock-tested & Source-verified | **Honest & Functional** |
| **Privacy & Telemetry** | "100% anonymous device tracking, zero data sharing." | Pseudonymous installation hashes linked to customer emails and IP logs; image blobs sent to Google Gemini under user account. | Transparent first-use consent modal disclosing Gemini data flow and pseudonymous licensing tracking; updated privacy policy correcting anonymous claims. | Source-verified | **Production-Ready** |

---

### Unresolved Blockers & Live Testing Requirements:
1. **Live Adobe Stock Contributor Verification:** Must be verified on live Adobe Contributor upload session with test assets by account owner (cannot automate credentialed stock sessions in sandbox).
2. **Live Gemini Web UI Interaction Verification:** Must be verified on live Gemini session with test account to ensure Google's latest DOM selectors and CSP headers match content script expectations.
3. **Hosted Supabase Deployment Verification:** Must be linked and deployed to live Supabase project using `backend/README.md` instructions with production Ed25519 private key and service role secrets.
