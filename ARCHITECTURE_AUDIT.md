# ARCHITECTURE AUDIT
## Adobe Stock Metadata Generator (Gemini AI) — Pre-Transformation Audit

**Audit Date:** 2026-10-06  
**Auditor:** Antigravity AI  
**Purpose:** Document current architecture before transforming into commercial product.

---

## 1. PROJECT OVERVIEW

| Property | Value |
|---|---|
| Extension Name | Adobe Stock Metadata Generator (Gemini AI) |
| Version | 1.0.0 |
| Manifest Version | V3 (correct for Chrome Web Store) |
| Framework | Vanilla JS — No build system, no bundler, no NPM |
| Package Manager | None currently |
| Build System | None (raw unpacked extension) |

---

## 2. FILE STRUCTURE (CURRENT)

```
image metadata ex/
├── manifest.json              # MV3 manifest
├── background.js              # Service worker (background)
├── content_adobe.js           # Adobe Stock content script (19.8 KB)
├── content_adobe.css          # Adobe Stock floating UI styles
├── content_gemini.js          # Gemini automation content script (18.7 KB)
├── content_magnific.js        # Magnific/Freepik content script (27.4 KB)
├── content_magnific.css       # Magnific floating UI styles
├── generate_icons.js          # Icon generation utility
├── README.md                  # Basic README
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── popup/
    ├── popup.html             # Extension popup (3.3 KB)
    ├── popup.css              # Popup styles (3.4 KB)
    └── popup.js              # Popup logic (4.9 KB)
```

---

## 3. MANIFEST ANALYSIS

### Permissions
```json
["tabs", "scripting", "activeTab", "storage"]
```

### Host Permissions
```json
[
  "https://contributor.stock.adobe.com/*",
  "https://contributor.magnific.com/*",
  "https://contributor.freepik.com/*",
  "https://img-contributor.magnific.com/*",
  "https://img-contributor.freepik.com/*",
  "https://*.magnific.com/*",
  "https://*.freepik.com/*",
  "https://gemini.google.com/*"
]
```

### Content Scripts

| Script | Matches | Run At |
|---|---|---|
| content_adobe.js + content_adobe.css | contributor.stock.adobe.com/* | document_idle |
| content_magnific.js + content_magnific.css | magnific.com/*, freepik.com/* | document_idle |
| content_gemini.js | gemini.google.com/* | document_idle |

### Background
- Service Worker: background.js (MV3 compliant)
- No persistent background page (correct for MV3)

---

## 4. POPUP ARCHITECTURE

- Simple single-page HTML popup (340px wide)
- Dark glassmorphic theme (CSS variables)
- No tabs or navigation — single view only
- Vanilla JS: queries active tab, detects platform, sends messages

---

## 5. DATA FLOW (EXISTING)

```
User on Adobe Stock / Magnific
  → Clicks "Process Selected" button
  → content_adobe.js captures image as DataURL
  → Sends START_METADATA_FLOW to background.js

background.js
  → Stores currentTask in memory
  → Opens/activates Gemini tab
  → Sends PROCESS_IMAGE_IN_GEMINI to content_gemini.js

content_gemini.js on gemini.google.com
  → Attaches image (FileInput / DragDrop / Paste strategies)
  → Types platform-specific prompt
  → Clicks Send button
  → Polls for new response turn
  → Parses Title + Keywords
  → Sends GEMINI_METADATA_RESULT to background.js

background.js
  → Switches back to contributor tab
  → Sends APPLY_ADOBE_METADATA to content_adobe.js

content_adobe.js
  → Fills Title field (React-compatible setNativeInputValue)
  → Fills Keywords (comma-separated or chip-by-chip)
  → Shows success toast
```

---

## 6. GEMINI IMPLEMENTATION

- Uses UI automation on gemini.google.com (no direct API)
- Three image attachment strategies: FileInput, DragDrop, Clipboard
- Two different prompts: Adobe Stock (25-35 keywords) and Magnific (25-30 keywords)
- 55 second response timeout with retry on interrupted responses
- Parses Title: and Keywords: from response text with regex

---

## 7. ADOBE STOCK INTEGRATION

- Multiple selector strategies for robustness across DOM changes
- setNativeInputValue() triggers React/Angular prototype setters
- addChipKeywordsSequentially() for chip-based tag inputs
- Clicks "Paste Keywords" expander buttons if present
- Batch: getAllAssetCards() + loop + 60s timeout per image + stop control

---

## 8. CURRENT STORAGE

- chrome.storage in permissions but NOT used anywhere yet
- background.js uses in-memory only (currentTask variable)
- Task state is LOST if service worker restarts
- No stored: API keys, settings, history, preferences, license data

---

## 9. EXISTING FUNCTIONALITY (PRESERVED)

- Single image metadata (Adobe Stock) — WORKING
- Batch metadata loop (Adobe Stock) — WORKING
- Single image metadata (Magnific/Freepik) — WORKING
- Batch metadata loop (Magnific/Freepik) — WORKING
- Gemini tab automation and session reuse — WORKING
- Smart field detection and filling — WORKING
- React/Angular-compatible input value setting — WORKING
- Tag chip keyword entry — WORKING
- Status toasts on contributor pages — WORKING
- Stop batch control — WORKING

---

## 10. DEPENDENCIES

| Item | Notes |
|---|---|
| Chrome Extension APIs (MV3) | Runtime dependency |
| gemini.google.com | External service via UI automation |
| No NPM packages | Pure vanilla JS |
| No external CDNs | All assets bundled |

---

## 11. RISKS

| Risk | Severity | Notes |
|---|---|---|
| Service worker memory | High | currentTask lost on SW restart |
| No persistent storage | High | No settings or API key storage |
| Gemini UI changes | Medium | DOM selectors brittle against updates |
| No error recovery | Medium | No retry for failed batch items |
| No tests | Medium | Zero test coverage |

### Security
- No private keys or credentials present in codebase (GOOD)
- No remote code loading (GOOD)
- No eval() usage (GOOD)
- CSP-compliant (GOOD)

---

## 12. RECOMMENDED CHANGES FOR COMMERCIAL PRODUCT

### New Extension Files
```
src/
  config/
    product.config.js     ← centralized product/pricing/payment config
  lib/
    entitlements.js       ← feature gating service
    license-client.js     ← license validation and activation
    storage.js            ← chrome.storage abstraction
popup/
  views/
    dashboard.js          ← dashboard tab
    generate.js           ← generate tab (existing functionality)
    batch.js              ← batch processing tab
    history.js            ← metadata history
    quality.js            ← quality checker (Pro)
    prompts.js            ← prompt profiles (Pro)
    license.js            ← license entry and activation
    settings.js           ← settings
    upgrade.js            ← payment/upgrade screen
```

### New External Tools
```
/license-admin/           ← Private CLI (NEVER bundled into extension)
/backend/                 ← Supabase Edge Functions for activation API
/docs/                    ← Privacy policy, terms for GitHub Pages
```

### Preserved Without Major Changes
- content_adobe.js — keep working, minor entitlement additions
- content_gemini.js — keep intact
- content_magnific.js — keep intact
- background.js — keep, add storage + license messages
- manifest.json — keep MV3, update name, add license server host

---

## 13. FEATURE GATING PLAN

### Free Features
- basicMetadata (single image, 20/day limit)
- platformDetection
- geminiIntegration (basic prompts only)

### Pro Features
- advancedMetadata
- batchProcessing (unlimited)
- metadataHistory
- promptProfiles
- qualityChecker
- advancedKeywordEngine
- csvExport
- jsonExport
- retryFailedItems
- savedWorkflows
- priorityProcessing

---

## 14. SUMMARY

The existing extension is a well-structured, working MV3 Chrome extension with no build system,
no NPM, no package.json, and no tests. The Gemini -> Adobe Stock metadata pipeline works correctly.

STRATEGY: Preserve all existing functionality. Add professional multi-tab popup UI, centralized
config system, license/activation system, entitlement gating, and separate private admin tools.
Do NOT rewrite what works.
