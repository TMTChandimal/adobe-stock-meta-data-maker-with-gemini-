import fs from 'fs';
import path from 'path';

const licenseAdminDir = 'C:/Users/thari/Music/sample project/lison  making for image metadate gen/license-admin';

// 1. Patch issue.js
const issuePath = path.join(licenseAdminDir, 'src/commands/issue.js');
let issueCode = fs.readFileSync(issuePath, 'utf8');

issueCode = issueCode.replace(
  ".option('--register', 'Register license with backend API (requires .env)', false)",
  ".option('--register', 'Register license with backend API (requires .env)', true)"
);

const oldIssueBlock = `      const apiUrl = rawApiUrl.replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${apiUrl}/admin-register\`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
          },`;

const newIssueBlock = `      const baseUrl = rawApiUrl.replace(/\\/admin-[a-z]+\\/?$/i, '').replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${baseUrl}/admin-register\`;
        const anonKey = process.env.SUPABASE_ANON_KEY;
        const headers = {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
        };
        if (anonKey) {
          headers['Authorization'] = \`Bearer \${anonKey.trim()}\`;
          headers['apikey'] = anonKey.trim();
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,`;

if (issueCode.includes('const apiUrl = rawApiUrl.replace')) {
  issueCode = issueCode.replace(oldIssueBlock, newIssueBlock);
  fs.writeFileSync(issuePath, issueCode, 'utf8');
  console.log('✅ Patched issue.js');
} else {
  console.log('⚠️ issue.js block not found or already patched');
}

// 2. Patch admin-ui.js
const adminUiPath = path.join(licenseAdminDir, 'src/commands/admin-ui.js');
let adminUiCode = fs.readFileSync(adminUiPath, 'utf8');

const oldAdminBlock = `    // Register with backend if configured (redacting secrets from logs)
    const rawApiUrl = process.env.LICENSE_API_URL;
    const adminSecret = process.env.LICENSE_ADMIN_SECRET;

    if (rawApiUrl && adminSecret) {
      try {
        const { default: fetch } = await import('node-fetch');
        const apiUrl = rawApiUrl.replace(/\\/+$/, '');
        const endpoint = \`\${apiUrl}/admin-register\`;

        console.log(\`[AdminUI] Registering license \${result.licenseId} with backend...\`);
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': adminSecret.replace(/^"|"$/g, ''),
          },
          body: JSON.stringify({
            licenseId:       result.licenseId,
            licenseCode:     result.licenseCode,
            customerEmail:   email.trim(),
            plan:            planKey,
            expiresAt:       result.expiresAt,
            activationLimit,
            orderReference:  ref || '',
          }),
        });

        if (response.ok) {
          console.log('[AdminUI] Successfully registered license on backend.');
        } else {
          console.warn(\`[AdminUI] Backend registration returned status \${response.status}\`);
        }
      } catch (err) {
        console.warn(\`[AdminUI] Backend registration network error: \${err.message}\`);
      }
    }

    res.json({ success: true, result });`;

const newAdminBlock = `    // Register with backend if configured (redacting secrets from logs)
    const rawApiUrl = process.env.LICENSE_API_URL;
    const adminSecret = process.env.LICENSE_ADMIN_SECRET;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    let backendSynced = false;
    let backendError = null;

    if (rawApiUrl && adminSecret) {
      try {
        const { default: fetch } = await import('node-fetch');
        const baseUrl = rawApiUrl.replace(/\\/admin-[a-z]+\\/?$/i, '').replace(/\\/+$/, '');
        const endpoint = \`\${baseUrl}/admin-register\`;

        console.log(\`[AdminUI] Registering license \${result.licenseId} with backend at \${endpoint}...\`);
        const headers = {
          'Content-Type': 'application/json',
          'X-Admin-Secret': adminSecret.replace(/^"|"$/g, ''),
        };
        if (anonKey) {
          headers['Authorization'] = \`Bearer \${anonKey.trim()}\`;
          headers['apikey'] = anonKey.trim();
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            licenseId:       result.licenseId,
            licenseCode:     result.licenseCode,
            customerEmail:   email.trim(),
            customerName:    name || '',
            plan:            planKey,
            expiresAt:       result.expiresAt,
            activationLimit,
            orderReference:  ref || '',
          }),
        });

        if (response.ok) {
          console.log('[AdminUI] Successfully registered license on backend.');
          backendSynced = true;
        } else {
          const body = await response.json().catch(() => ({}));
          backendError = body.error || \`Status \${response.status}\`;
          console.warn(\`[AdminUI] Backend registration returned status \${response.status}: \${backendError}\`);
        }
      } catch (err) {
        backendError = err.message;
        console.warn(\`[AdminUI] Backend registration network error: \${err.message}\`);
      }
    }

    res.json({ success: true, result, backendSynced, backendError });`;

if (adminUiCode.includes('// Register with backend if configured (redacting secrets from logs)')) {
  adminUiCode = adminUiCode.replace(oldAdminBlock, newAdminBlock);
  fs.writeFileSync(adminUiPath, adminUiCode, 'utf8');
  console.log('✅ Patched admin-ui.js');
} else {
  console.log('⚠️ admin-ui.js block not found or already patched');
}

// 3. Patch revoke.js
const revokePath = path.join(licenseAdminDir, 'src/commands/revoke.js');
let revokeCode = fs.readFileSync(revokePath, 'utf8');

const oldRevokeBlock = `      const apiUrl = rawApiUrl.replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${apiUrl}/admin-revoke\`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
          },`;

const newRevokeBlock = `      const baseUrl = rawApiUrl.replace(/\\/admin-[a-z]+\\/?$/i, '').replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${baseUrl}/admin-revoke\`;
        const anonKey = process.env.SUPABASE_ANON_KEY;
        const headers = {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
        };
        if (anonKey) {
          headers['Authorization'] = \`Bearer \${anonKey.trim()}\`;
          headers['apikey'] = anonKey.trim();
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,`;

if (revokeCode.includes('const apiUrl = rawApiUrl.replace')) {
  revokeCode = revokeCode.replace(oldRevokeBlock, newRevokeBlock);
  fs.writeFileSync(revokePath, revokeCode, 'utf8');
  console.log('✅ Patched revoke.js');
} else {
  console.log('⚠️ revoke.js block not found or already patched');
}

// 4. Patch restore.js
const restorePath = path.join(licenseAdminDir, 'src/commands/restore.js');
let restoreCode = fs.readFileSync(restorePath, 'utf8');

const oldRestoreBlock = `      const apiUrl = rawApiUrl.replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${apiUrl}/admin-restore\`;

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
          },`;

const newRestoreBlock = `      const baseUrl = rawApiUrl.replace(/\\/admin-[a-z]+\\/?$/i, '').replace(/\\/+$/, '');
      try {
        const { default: fetch } = await import('node-fetch');
        const endpoint = \`\${baseUrl}/admin-restore\`;
        const anonKey = process.env.SUPABASE_ANON_KEY;
        const headers = {
          'Content-Type': 'application/json',
          'X-Admin-Secret': secret.replace(/^"|"$/g, ''),
        };
        if (anonKey) {
          headers['Authorization'] = \`Bearer \${anonKey.trim()}\`;
          headers['apikey'] = anonKey.trim();
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers,`;

if (restoreCode.includes('const apiUrl = rawApiUrl.replace')) {
  restoreCode = restoreCode.replace(oldRestoreBlock, newRestoreBlock);
  fs.writeFileSync(restorePath, restoreCode, 'utf8');
  console.log('✅ Patched restore.js');
} else {
  console.log('⚠️ restore.js block not found or already patched');
}

// 5. Update package.json to include "sync" script
const pkgPath = path.join(licenseAdminDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts.sync = 'node src/commands/sync-all.js';
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
console.log('✅ Added "sync" script to package.json');
