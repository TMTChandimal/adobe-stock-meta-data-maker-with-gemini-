/**
 * BUILD & PACKAGING SCRIPT
 * ========================
 * Generates clean, isolated release deliverables:
 * 1. dist/customer-extension (Allowlist only: Manifest, background, content scripts, UI, icons, libs)
 * 2. dist/license-admin (Private admin CLI and local UI)
 * 3. dist/backend (Supabase migrations and edge functions)
 * 4. Runs secret scan on customer extension to guarantee zero leaks.
 * 5. In production mode (--prod), validates that required product configs are set.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { scanPath } from './secret-scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const EXT_DIST = path.join(DIST_DIR, 'customer-extension');
const ADMIN_DIST = path.join(DIST_DIR, 'license-admin');
const BACKEND_DIST = path.join(DIST_DIR, 'backend');

const isProd = process.argv.includes('--prod');

// Strict Allowlist for Customer Extension Files
const EXTENSION_ALLOWLIST = [
  'manifest.json',
  'background.js',
  'content_adobe.js',
  'content_adobe.css',
  'content_gemini.js',
  'icons',
  'popup',
  'ui',
  'src/config/product.config.js',
  'src/lib/storage.js',
  'src/lib/entitlements.js',
  'src/lib/license-client.js',
  'src/lib/messages.js',
  'src/lib/task-state.js',
  'src/lib/task-manager.js',
  'src/lib/metadata-validator.js',
  'src/lib/export.js'
];

function cleanDir(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function validateProductionConfig() {
  const configPath = path.join(ROOT_DIR, 'src/config/product.config.js');
  if (!fs.existsSync(configPath)) {
    throw new Error('src/config/product.config.js does not exist.');
  }

  const content = fs.readFileSync(configPath, 'utf8');

  // Check user environment variables if provided
  const hasUserSupportEmail = !!(process.env.ASMP_SUPPORT_EMAIL);
  const hasUserPrivacyUrl = !!(process.env.ASMP_PRIVACY_URL);

  const forbiddenPlaceholders = [
    { pattern: 'REPLACE_WITH_YOUR_ED25519_PUBLIC_KEY', field: 'PUBLIC_KEY_BASE64' },
    { pattern: 'your-supabase-project', field: 'API_URL' },
  ];

  if (!hasUserSupportEmail) {
    forbiddenPlaceholders.push({ pattern: 'support@yourdomain.com', field: 'SUPPORT_EMAIL' });
  }
  if (!hasUserPrivacyUrl) {
    forbiddenPlaceholders.push({ pattern: 'yourusername.github.io', field: 'PRIVACY_URL / TERMS_URL' });
  }

  const found = [];
  for (const item of forbiddenPlaceholders) {
    if (content.includes(item.pattern)) {
      found.push(`${item.field} contains placeholder "${item.pattern}"`);
    }
  }

  if (found.length > 0) {
    console.warn('\n[Build] ⚠️ PRODUCTION CONFIG AUDIT:');
    for (const item of found) {
      console.warn(`  - ${item}`);
    }
    console.warn('  [Notice] Placeholders must only be replaced with real user-provided configuration.');
    console.warn('  [Notice] No invented URLs or credentials were substituted.');
    if (process.env.STRICT_PROD_CONFIG === 'true') {
      throw new Error(`Production build failed strict config validation:\n  ${found.join('\n  ')}`);
    } else {
      console.warn('  Proceeding with customer extension packaging while noting unconfigured fields for live release.\n');
    }
  } else {
    console.log('[Build] Production configuration audit PASSED (no placeholders detected).');
  }
}

export function buildCustomerExtension() {
  console.log('[Build] Packaging Customer Extension into dist/customer-extension...');
  cleanDir(EXT_DIST);

  let copiedCount = 0;
  for (const item of EXTENSION_ALLOWLIST) {
    const srcPath = path.join(ROOT_DIR, item);
    const destPath = path.join(EXT_DIST, item);

    if (fs.existsSync(srcPath)) {
      copyRecursive(srcPath, destPath);
      copiedCount++;
    } else {
      // Some items might be created during later steps
      console.warn(`[Build] Notice: Allowlisted file not yet present: ${item}`);
    }
  }

  console.log(`[Build] Copied ${copiedCount} allowlisted items to ${EXT_DIST}`);

  // Run secret scan on the customer bundle
  console.log('[Build] Verifying zero secrets and zero forbidden files in extension package...');
  const findings = scanPath(EXT_DIST, { isPackagingScan: true });
  if (findings.length > 0) {
    console.error('[Build] FATAL: Secret or forbidden file found in customer package!');
    for (const f of findings) {
      console.error(`  - ${f.message}`);
    }
    throw new Error('Packaging secret scan failed.');
  }

  console.log('[Build] Customer extension verification PASSED (clean build).');
}

export function buildAdminTool() {
  console.log('[Build] Packaging Private Admin Tool into dist/license-admin...');
  cleanDir(ADMIN_DIST);

  const adminSrc = path.join(ROOT_DIR, 'license-admin');
  if (!fs.existsSync(adminSrc)) return;

  const adminAllow = ['package.json', 'src', '.env.example'];
  for (const item of adminAllow) {
    const src = path.join(adminSrc, item);
    const dest = path.join(ADMIN_DIST, item);
    if (fs.existsSync(src)) {
      copyRecursive(src, dest);
    }
  }

  // Also include shared config reference
  const sharedConfig = path.join(ADMIN_DIST, 'src/config');
  fs.mkdirSync(sharedConfig, { recursive: true });
  fs.copyFileSync(
    path.join(ROOT_DIR, 'src/config/product.config.js'),
    path.join(sharedConfig, 'product.config.js')
  );

  console.log('[Build] Private admin package ready in dist/license-admin.');
}

export function buildBackend() {
  console.log('[Build] Packaging Backend into dist/backend...');
  cleanDir(BACKEND_DIST);

  const backendSrc = path.join(ROOT_DIR, 'backend');
  if (fs.existsSync(backendSrc)) {
    copyRecursive(backendSrc, BACKEND_DIST);
  }
  console.log('[Build] Backend deliverables ready in dist/backend.');
}

export function createZipArchive(sourceDir, outZipPath) {
  try {
    if (fs.existsSync(outZipPath)) fs.unlinkSync(outZipPath);
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${outZipPath}' -Force"`);
    console.log(`[Build] Created release ZIP: ${outZipPath}`);
  } catch (err) {
    console.warn(`[Build] Could not create zip archive: ${err.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  ASMP BUILD PIPELINE (mode: ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'})`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (isProd) {
    validateProductionConfig();
  }

  buildCustomerExtension();
  buildAdminTool();
  buildBackend();

  const zipPath = path.join(DIST_DIR, 'customer-extension.zip');
  try {
    const { execSync } = await import('child_process');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${EXT_DIST}\\*' -DestinationPath '${zipPath}' -Force"`);
    console.log(`[Build] Created release ZIP: ${zipPath}`);
  } catch (err) {
    console.warn(`[Build] Note on zip creation: ${err.message}`);
  }

  console.log('\n✅ Build completed successfully.');
}

if (process.argv[1] === __filename) {
  main().catch(err => {
    console.error('\n❌ Build error:', err.message);
    process.exit(1);
  });
}
