# ════════════════════════════════════════════════════════════════
# SETUP GUIDE — Adobe Stock Metadata Pro
# ════════════════════════════════════════════════════════════════

This guide explains how to set up the extension for testing and prepare the license server.

## 1. Extension Setup (Local)
1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select the root directory of this project.
4. The extension should now be installed.

## 2. License Admin Setup (Private)
You need to generate the cryptographic keys that will secure your license system.

```bash
cd license-admin
npm install
npm run keygen
```

This generates two files in `license-admin/keys/`:
- `private-key.b64` (Keep this secret! Never commit it.)
- `public-key.b64` (This goes in the extension.)

## 3. Extension Configuration
Open `src/config/product.config.js` and set your values:
- Set `PUBLIC_KEY_BASE64` to the contents of `public-key.b64`.
- Configure your PayPal and Bitcoin addresses.
- Update prices and support contact info.

## 4. Backend Setup (Supabase)
To use the activation server, you need a Supabase project:
1. Create a project on [Supabase](https://supabase.com/).
2. Run the SQL in `backend/supabase/schema.sql` in the Supabase SQL editor.
3. Get your project URL and Service Role Key from Project Settings > API.
4. Copy `license-admin/.env.example` to `license-admin/.env` and fill in the Supabase details.
5. Deploy the edge functions (requires Supabase CLI):
   ```bash
   cd backend
   supabase init
   supabase functions deploy license-activate
   supabase functions deploy license-validate
   ```
6. Set the `LICENSE_PUBLIC_KEY` secret in Supabase:
   ```bash
   supabase secrets set LICENSE_PUBLIC_KEY="<your_public_key_here>"
   ```

## 5. Testing
1. Reload the extension in `chrome://extensions`.
2. Generate a test license:
   ```bash
   cd license-admin
   npm run license -- --email test@example.com --plan pro
   ```
3. Copy the generated license code.
4. Open the extension popup, go to the License tab, and paste the code.
5. Click Activate.

You are now ready to publish!
