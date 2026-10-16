# ════════════════════════════════════════════════════════════════
# CHROME WEB STORE SUBMISSION CHECKLIST
# ════════════════════════════════════════════════════════════════

When you are ready to publish, follow these steps to ensure a smooth review process.

## 1. Prepare the Extension
- [ ] Open `manifest.json` and ensure the `version` is incremented (e.g., `"2.0.0"`).
- [ ] Ensure all debug logging (`console.log`) is removed or minimized in production.
- [ ] Verify that `src/config/product.config.js` has your correct Public Key and payment info.
- [ ] **Delete** the `license-admin` and `backend` folders from the zip file you upload! Only the files needed for the extension should be zipped.

## 2. Create the ZIP File
Select the following files/folders and compress them into a `.zip`:
- `manifest.json`
- `background.js`
- `content_adobe.js`
- `content_magnific.js`
- `content_gemini.js`
- `content_adobe.css`
- `content_magnific.css`
- `popup/`
- `src/`
- `icons/`

**DO NOT INCLUDE:** `license-admin/`, `backend/`, `docs/`, `.git/`, `.gitignore`, `README.md`, etc.

## 3. Chrome Web Store Developer Dashboard
Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole/).

### Privacy Tab
- **Single Purpose:** "Adobe Stock Metadata Pro automates the generation of metadata (titles and keywords) for Adobe Stock and Magnific contributors using Gemini AI."
- **Permissions Justification:**
  - `activeTab` / `tabs`: Required to detect if the user is on a contributor page and open Gemini tabs for processing.
  - `scripting`: Required to inject automation scripts into the contributor pages and Gemini.
  - `storage`: Required to save user settings and license activation state locally.
  - `clipboardRead/Write`: Required for the user to easily copy payment addresses and paste license codes.
  - `Host Permissions`: Required to interact with the DOM of Adobe Stock, Magnific, and Gemini to read images and insert metadata.
- **Data Usage:**
  - Do you collect personal information? **No**. (You collect anonymous installation IDs, not PII).
  - Do you sell data? **No**.
- **Privacy Policy URL:** Link to the GitHub Pages URL where you hosted `docs/privacy-policy.html`.

### Store Listing Tab
- **Title:** Adobe Stock Metadata Pro
- **Summary:** AI-powered metadata generator for Adobe Stock and Magnific contributors using Gemini AI.
- **Description:** Clearly state that this is a "Freemium" extension. Note that basic features are free, and Pro features require a license purchased directly from the developer.
- **Screenshots:** Upload high-quality screenshots of the new multi-tab popup UI.

## 4. Single-Purpose Policy Note
Google is strict about the "Single Purpose" policy. Ensure your description makes it clear that everything the extension does revolves around ONE purpose: **Assisting contributors with metadata generation via AI.** Do not add unrelated features.
