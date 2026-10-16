# Adobe Stock Metadata Pro
## Manual Live-Site Verification Checklist

This checklist is for the product owner and QA engineers to execute in real browser environments using approved test accounts and test image assets. Because live production sessions involve Adobe Stock contributor credentials and Google accounts, these manual verification steps must be performed prior to store submission.

---

### Prerequisites

1. Google Chrome (v115+).
2. Unpacked customer extension from `dist/customer-extension/` loaded via `chrome://extensions/` (Developer Mode enabled).
3. Active Adobe Stock Contributor test account with 2–3 sample test images uploaded to the "New" uploads dashboard (`contributor.stock.adobe.com/en/uploads`).
4. Active Google Gemini account logged in at `gemini.google.com`.
5. Deployed Supabase backend or local Supabase instance configured with `schema.sql` and Edge Functions.

---

### Step 1: Clean Extension Installation & First-Use Consent

- [ ] Load `dist/customer-extension/` as an unpacked extension in `chrome://extensions/`.
- [ ] Verify that no background service worker errors or manifest warnings appear in the Extensions management page.
- [ ] Click the extension action icon in the toolbar. The compact launcher popup opens.
- [ ] Click **"Open Full Workspace"**. A new workspace tab (`ui/app.html`) opens.
- [ ] **First-Use Disclosure Verification:**
  - Verify that the First-Use Consent modal appears immediately.
  - Verify disclosures: Data sent to Google Gemini under user session; pseudonymous installation hash and license status sent to licensing backend.
  - Verify that clicking "Decline & Exit" blocks automated processing.
  - Reopen and click "I Understand & Accept". The modal dismisses and preference is persisted (`asmp_onboarding_done = true`).

---

### Step 2: Adobe Stock Single Image Selection Scoping

- [ ] Navigate to `https://contributor.stock.adobe.com/en/uploads`.
- [ ] **Zero Selection Test:**
  - Ensure NO image is selected in the contributor grid.
  - Open the extension workspace / popup and click "Generate Metadata".
  - **Expected:** Extension refuses with an explicit error: `"No asset selected. Please click an asset on Adobe Stock first."`
  - **Crucial:** Confirm the extension does NOT pick or write to the first image in the grid.
- [ ] **Multi-Selection Test:**
  - Hold `Ctrl`/`Cmd` and select multiple images on Adobe Stock.
  - Attempt single-image generation.
  - **Expected:** Extension informs the user to select exactly one image, or switch to the Batch Queue view for multi-asset processing.
- [ ] **Single Selection Verification:**
  - Click exactly one image. Verify the thumbnail and asset ID are detected accurately in the extension Overview and Generate views.

---

### Step 3: Gemini Web Automation Isolation

- [ ] With one image selected on Adobe Stock, click **"Generate Metadata"**.
- [ ] **Tab Isolation Verification:**
  - Verify that the extension opens or navigates to a dedicated Gemini tab (`gemini.google.com/app`).
  - Verify that any existing chats or drafts in other Gemini tabs are unaffected.
- [ ] **Sequential Attachment Verification:**
  - Observe the Gemini file attachment area.
  - Verify that the image is attached first via the file input or drag-and-drop mechanism.
  - Verify that the extension waits until the image preview chip is rendered before typing the prompt text into the contenteditable editor.
  - Verify that if the image upload fails, execution stops immediately and does not send a text-only prompt.
- [ ] **Response & BUSY Handling:**
  - Verify that the extension monitors the response container until generation completes (send button changes back from stop to send).
  - If Gemini displays a temporary "I'm busy" or capacity notice, verify that the extension initiates exponential backoff retry rather than failing immediately.

---

### Step 4: Metadata Review & Pre-Write Re-Verification

- [ ] Return to the extension workspace **"Generate & Review"** tab.
- [ ] **Title & Keywords Display:**
  - Verify generated title is displayed in the editable input (stripped of buzzwords and trailing punctuation).
  - Verify keywords are displayed as individual tag chips (deduplicated, with meaningful multi-word concepts preserved).
  - Verify character count and keyword count indicators reflect Adobe Stock limits (5–200 characters, 5–49 keywords).
- [ ] **Edit & Reset Verification:**
  - Edit the title and add/remove keywords in the UI.
  - Click "Restore Original" to verify revert functionality.
- [ ] **Apply Metadata to Adobe Stock:**
  - Click **"Apply to Adobe Stock"**.
  - Switch to the Adobe Stock tab.
  - Verify that the selected asset's Title input and Keywords field now contain the reviewed metadata.
  - Verify that the extension does NOT click "Submit for Review". The asset remains in draft mode for manual review.

---

### Step 5: Batch Processing (Pro Gated)

- [ ] Ensure extension is activated with a Pro license.
- [ ] On Adobe Stock, select multiple uploaded assets.
- [ ] Switch to the **"Batch Queue"** tab in the extension.
- [ ] Verify total queued assets count matches selection.
- [ ] Click **"Start Batch Processing"**.
- [ ] Verify each asset is processed sequentially with configurable delay (default 3s).
- [ ] Click **"Stop Batch"** mid-processing. Verify that processing pauses cleanly without corrupting the active asset or proceeding to subsequent items.

---

### Step 6: Licensing & Device Enforcement

- [ ] In **"License & Settings"**, enter a test license key issued by `license-admin`.
- [ ] Click **"Activate License"**. Verify status transitions to `PRO` with valid expiry date.
- [ ] **Offline Grace Test:**
  - Disconnect network (or simulate offline via DevTools Network tab).
  - Restart the browser / reload extension.
  - Verify the extension remains in Pro status under the 7-day signed offline lease.
- [ ] **Device Limit Test:**
  - Attempt activation on devices exceeding the licensed `activationLimit`.
  - Verify the server returns: `"Device limit reached for this license."`
- [ ] **Deactivation Test:**
  - Click "Deactivate License".
  - Verify license status resets to Free tier and slot is freed on the backend.

---

### Step 7: History & Export Security

- [ ] Navigate to **"History & Export"**.
- [ ] Verify past processed assets appear in chronological order.
- [ ] Click **"Export Adobe Stock CSV"**.
  - Open generated CSV in a text editor.
  - Verify columns match Adobe Stock standard: `Filename,Title,Keywords,Category,Releases`.
  - Verify formulas (`=cmd|' /C ...'!A0`) are neutralized with prepended `'`.
  - Verify UTF-8 BOM (`\uFEFF`) is present for correct Excel character rendering.
- [ ] Click **"Export JSON"**. Verify clean structured JSON schema output.
