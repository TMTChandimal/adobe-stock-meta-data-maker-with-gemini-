/**
 * TESTS: CSV & JSON Export, Formula Injection Prevention
 * ======================================================
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import '../src/lib/export.js';
const {
  sanitizeForSpreadsheet,
  generateGenericCSV,
  generateAdobeStockImportCSV,
  generateJSONExport
} = globalThis;

describe('Export Module & Formula Injection Defense', () => {

  test('sanitizeForSpreadsheet neutralizes formula execution characters', () => {
    // Dangerous DDE formula attack vectors
    assert.strictEqual(sanitizeForSpreadsheet('=1+1'), "'=1+1");
    assert.strictEqual(sanitizeForSpreadsheet('+cmd|\' /C calc\'!A0'), "'+cmd|\' /C calc\'!A0");
    assert.strictEqual(sanitizeForSpreadsheet('-5+2'), "'-5+2");
    assert.strictEqual(sanitizeForSpreadsheet('@SUM(A1:A10)'), "'@SUM(A1:A10)");
    assert.strictEqual(sanitizeForSpreadsheet('\tTabMalicious'), "'\tTabMalicious");

    // Standard strings without formula prefixes are untouched
    assert.strictEqual(sanitizeForSpreadsheet('Mountain landscape at sunrise'), 'Mountain landscape at sunrise');

    // Values with commas, quotes, or newlines are safely quoted
    assert.strictEqual(sanitizeForSpreadsheet('Hello, world'), '"Hello, world"');
    assert.strictEqual(sanitizeForSpreadsheet('Say "Hello"'), '"Say ""Hello"""');
  });

  test('generateGenericCSV outputs spreadsheet-safe rows with UTF-8 BOM', () => {
    const items = [
      {
        assetId: 'asset_001',
        title: '=HYPERLINK("http://attacker.com", "Click")',
        keywords: ['nature', 'forest', '+malicious_tag'],
        status: 'APPLIED',
        timestamp: '2026-10-14T10:00:00.000Z'
      },
      {
        assetId: 'asset_002',
        title: 'Normal title with "quotes" and, commas',
        keywords: ['sun', 'beach'],
        status: 'APPLIED',
        timestamp: '2026-10-14T11:00:00.000Z'
      }
    ];

    const csv = generateGenericCSV(items);

    // Must start with UTF-8 BOM
    assert.strictEqual(csv.charCodeAt(0), 0xFEFF, 'CSV must start with UTF-8 BOM for Excel compatibility');

    // Formula must be neutralized
    assert.ok(csv.includes("''=HYPERLINK") || csv.includes("'=HYPERLINK"), 'Formula must have leading quote');

    // Check row structure
    const lines = csv.split('\r\n');
    assert.ok(lines.length >= 3);
    assert.ok(lines[0].includes('Asset ID / Filename'));
  });

  test('generateAdobeStockImportCSV produces official platform format', () => {
    const items = [
      {
        filename: 'sunset_photo.jpg',
        title: 'Golden sunset over ocean waves',
        keywords: ['sunset', 'ocean', 'waves', 'sun'],
        category: 'Travel',
        releases: ''
      }
    ];

    const csv = generateAdobeStockImportCSV(items);
    assert.strictEqual(csv.charCodeAt(0), 0xFEFF);

    const contentWithoutBom = csv.replace(/^\uFEFF/, '');
    const lines = contentWithoutBom.split('\r\n');
    assert.strictEqual(lines[0], 'Filename,Title,Keywords,Category,Releases');
    assert.ok(lines[1].includes('"sunset_photo.jpg"'));
    assert.ok(lines[1].includes('"Golden sunset over ocean waves"'));
    assert.ok(lines[1].includes('"sunset, ocean, waves, sun"'));
  });

  test('generateJSONExport produces valid schema payload', () => {
    const items = [
      {
        id: 'task_001',
        assetId: 'img_123',
        title: 'Modern laptop on wooden desk',
        keywords: ['laptop', 'desk', 'technology']
      }
    ];

    const jsonStr = generateJSONExport(items);
    const parsed = JSON.parse(jsonStr);

    assert.strictEqual(parsed.version, '2.0.0');
    assert.strictEqual(parsed.itemCount, 1);
    assert.strictEqual(parsed.items[0].assetId, 'img_123');
    assert.strictEqual(parsed.items[0].title, 'Modern laptop on wooden desk');
    assert.strictEqual(parsed.items[0].keywords.length, 3);
  });
});
