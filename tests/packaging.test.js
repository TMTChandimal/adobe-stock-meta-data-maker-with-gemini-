/**
 * TESTS: Packaging Allowlist & Zero-Leak Secret Scanner
 * =====================================================
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { buildCustomerExtension } from '../scripts/build.js';
import { scanPath } from '../scripts/secret-scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const EXT_DIST = path.join(ROOT_DIR, 'dist/customer-extension');

describe('Packaging & Secret Protection', () => {

  test('Build produces complete customer extension with strictly allowlisted runtime files', () => {
    // Run customer extension packaging
    buildCustomerExtension();

    // Verify critical runtime files are present
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'manifest.json')), true, 'manifest.json must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'background.js')), true, 'background.js must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'content_adobe.js')), true, 'content_adobe.js must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'content_gemini.js')), true, 'content_gemini.js must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'ui/app.html')), true, 'ui/app.html must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'popup/popup.html')), true, 'popup/popup.html must exist');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'src/config/product.config.js')), true, 'product.config.js must exist');
  });

  test('Customer extension contains zero forbidden files or administrative secrets', () => {
    // Explicit forbidden checks
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, '.env')), false, '.env must NEVER be in customer package');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, '.git')), false, '.git must NEVER be in customer package');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'license-admin')), false, 'license-admin must NEVER be in customer package');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'backend')), false, 'backend must NEVER be in customer package');
    assert.strictEqual(fs.existsSync(path.join(EXT_DIST, 'tests')), false, 'tests must NEVER be in customer package');

    // Run automated secret scanner in packaging mode
    const findings = scanPath(EXT_DIST, { isPackagingScan: true });
    assert.strictEqual(findings.length, 0, `Secret scanner found unexpected issues: ${JSON.stringify(findings)}`);
  });
});
