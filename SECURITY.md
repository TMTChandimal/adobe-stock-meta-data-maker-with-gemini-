# ════════════════════════════════════════════════════════════════
# SECURITY AUDIT & CHECKLIST
# ════════════════════════════════════════════════════════════════

Before publishing the extension or sharing the code, you MUST complete this checklist.

## 🔴 CRITICAL - DO THIS NOW

- [ ] **Check `.gitignore`**: Ensure `license-admin/keys/` and `.env` files are ignored.
- [ ] **Check git history**: Did you ever accidentally commit `private-key.b64`? If yes, you must clear your git history or generate new keys and consider the old ones compromised.
- [ ] **Check `product.config.js`**: Verify that ONLY the **Public Key** (`PUBLIC_KEY_BASE64`) is in this file. The private key must NEVER be in the extension source code.
- [ ] **Check `backend/supabase/functions/`**: Ensure your `SUPABASE_SERVICE_ROLE_KEY` is not hardcoded anywhere in the Edge Functions. They should use `Deno.env.get()`.

## 🟡 WARNINGS - Best Practices

- **Supabase RLS**: Ensure Row Level Security (RLS) is enabled on all tables (`licenses`, `activations`, `events`) and that there are NO public access policies. Only the Edge Functions (using the service role key) should be able to read/write.
- **Obfuscation**: Chrome Web Store does not allow heavy code obfuscation. Do not attempt to pack or obfuscate the extension code beyond standard minification.
- **Admin API Secret**: In `license-admin/.env`, the `LICENSE_ADMIN_SECRET` must be a strong, random string. This prevents unauthorized people from telling your backend to revoke licenses.

## 🟢 EXTENSION SECURITY

- **Content Security Policy (CSP)**: The manifest defines a strict CSP: `"script-src 'self'; object-src 'self'"`. This prevents XSS and remote code execution. Do not relax this.
- **No eval()**: Do not use `eval()` or `new Function()` anywhere in the extension.
- **Safe HTML**: When inserting data into the DOM (e.g., history items), always use `textContent` or a sanitization function (`escapeHtml`) to prevent injection attacks.
