# 📸 Adobe Stock Contributor Metadata Generator (Gemini AI Chrome Extension)

An automated Chrome Extension (Manifest V3) that extracts selected images on Adobe Stock Contributor portal, sends them to an open Gemini tab (`gemini.google.com`), requests SEO stock titles and 30-40 keywords, and auto-fills the Adobe Stock input fields.

---

## 🌟 Key Features

1. **One-Click Automation**: Click **"✨ Auto Gemini Metadata"** directly on Adobe Stock page or extension popup.
2. **Smart Image Extraction**: Grabs selected or active thumbnail data URL automatically.
3. **Seamless Inter-Tab Orchestration**: Switches to Gemini tab, attaches/pastes image, submits prompt, parses Title & Keywords, and switches back to Adobe Stock.
4. **Auto-Fill Inputs**: Intelligently updates both Title and Keyword fields (including single text area & chip tag components).
5. **Modern Glassmorphic UI**: Sleek floating control widget and popup interface.

---

## 🚀 How to Install in Google Chrome

1. Open **Google Chrome** and navigate to `chrome://extensions`.
2. Turn ON **Developer mode** (toggle in the top-right corner).
3. Click the **"Load unpacked"** button.
4. Select the extension directory:
   `C:\Users\thari\Music\sample project\image metadata ex`
5. The extension **"Adobe Stock Metadata Generator (Gemini AI)"** is now installed and active!

---

## 📖 How to Use

1. **Step 1**: Open [Gemini](https://gemini.google.com/app) in one of your browser tabs and make sure you are logged in.
2. **Step 2**: Open [Adobe Stock Contributor](https://contributor.stock.adobe.com/) in another tab and navigate to your uploaded image/asset page.
3. **Step 3**: Click the floating button **"✨ Auto Gemini Metadata"** at the bottom-right corner of the Adobe Stock page (or click the extension icon in the toolbar and press "Generate Active Image Metadata").
4. **Step 4**: Watch the automated pipeline work:
   - Image data is extracted.
   - Extension switches to Gemini tab and submits image + metadata prompt.
   - Title and 30-40 keywords are parsed from Gemini's response.
   - Extension switches back to Adobe Stock tab and automatically populates the Title and Keyword input fields.

---

## 📁 Extension File Overview

- `manifest.json`: Extension manifest (V3) with tab & host permissions.
- `background.js`: Service worker managing background state and tab switching.
- `content_adobe.js` & `content_adobe.css`: Floating widget on Adobe Stock & input filler.
- `content_gemini.js`: Gemini automation script (image attachment, prompt submission & text parsing).
- `popup/`: Popup user interface (`popup.html`, `popup.css`, `popup.js`).
- `icons/`: Extension toolbar icons.
