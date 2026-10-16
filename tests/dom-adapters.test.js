/**
 * TESTS: DOM Adapters, Selection Scoping & Metadata Sanitization
 * ==============================================================
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import '../src/lib/metadata-validator.js';
const { normalizeTitle, normalizeKeywords, parseGeminiResponse } = globalThis;

describe('Metadata Sanitization & Adobe Stock Rules', () => {

  test('normalizeTitle strips ending periods, quotes, markdown, and buzzwords', () => {
    // Trailing period removal
    assert.strictEqual(
      normalizeTitle('Stunning Sunset over the ocean.'),
      'Sunset over the ocean'
    );

    // Markdown bold & prefix removal
    assert.strictEqual(
      normalizeTitle('**Title:** "A modern office workspace with computers."'),
      'A modern office workspace with computers'
    );

    // Length boundary enforcement (max 200 chars)
    const longTitle = 'A'.repeat(250);
    const normalized = normalizeTitle(longTitle);
    assert.ok(normalized.length <= 200);
    assert.ok(normalized.endsWith('...'));

    // JSON syntax and artifact stripping (raw quotes, colons, commas)
    assert.strictEqual(
      normalizeTitle('": "Minimalist wooden wall plaque with dark grey felt panel","'),
      'Minimalist wooden wall plaque with dark grey felt panel'
    );
    assert.strictEqual(
      normalizeTitle('"title": "Minimalist wooden wall plaque with dark grey felt panel"'),
      'Minimalist wooden wall plaque with dark grey felt panel'
    );
  });

  test('normalizeKeywords filters buzzwords, removes markdown, and deduplicates case-insensitively', () => {
    const raw = [
      'Sunset',
      'sunset', // duplicate
      'SUNSET', // duplicate
      'best',   // prohibited buzzword
      'amazing',// prohibited buzzword
      '4k',     // prohibited camera spec
      'ocean',
      'water',
      'beach',
      'artificial intelligence', // meaningful multiword concept preserved
      'sky',
      'dusk',
      'Keywords: evening' // prefix stripped
    ];

    const cleaned = normalizeKeywords(raw);

    // Duplicates removed while preserving first occurrence
    assert.strictEqual(cleaned.filter(k => k.toLowerCase() === 'sunset').length, 1);
    // Buzzwords removed
    assert.strictEqual(cleaned.includes('best'), false);
    assert.strictEqual(cleaned.includes('amazing'), false);
    assert.strictEqual(cleaned.includes('4k'), false);
    // Multiword concept preserved
    assert.strictEqual(cleaned.includes('artificial intelligence'), true);
    // Clean list order preserved
    assert.strictEqual(cleaned[0], 'Sunset');
    assert.strictEqual(cleaned[1], 'ocean');

    // JSON syntax artifacts stripping
    const rawArtifacts = [
      '": [',
      'plaque',
      'wood',
      'felt',
      'wall hanging',
      'sign',
      'panel',
      'decor',
      'interior',
      'minimalist"'
    ];
    const cleanedArtifacts = normalizeKeywords(rawArtifacts);
    assert.strictEqual(cleanedArtifacts[0], 'plaque');
    assert.strictEqual(cleanedArtifacts.includes('": ['), false);
    assert.strictEqual(cleanedArtifacts[cleanedArtifacts.length - 1], 'minimalist');

    const rawStringArtifacts = '": [, plaque, wood, felt, wall hanging, sign, panel, decor, interior, minimalist"';
    const cleanedStringArtifacts = normalizeKeywords(rawStringArtifacts);
    assert.strictEqual(cleanedStringArtifacts[0], 'plaque');
    assert.strictEqual(cleanedStringArtifacts.includes('": ['), false);
  });

  test('parseGeminiResponse handles standard Title and Keywords format', () => {
    const text = `
Title: Solar panels on modern house roof against blue sky
Keywords: solar panel, renewable energy, rooftop, ecology, electricity, green power, clean energy, sun, sustainable
    `;

    const res = parseGeminiResponse(text);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.title, 'Solar panels on modern house roof against blue sky');
    assert.ok(res.keywords.length >= 8);
    assert.strictEqual(res.keywords[0], 'solar panel');
  });

  test('parseGeminiResponse handles Markdown bold format and priority sections', () => {
    const text = `
Here is the requested metadata:

**Title:** Young woman working on laptop in bright living room.

**Priority Keywords:** woman, laptop, work, computer, living room, home office, freelancer, remote work, typing, technology
**Additional Keywords:** indoor, casual, daylight, modern, lifestyle, portrait
    `;

    const res = parseGeminiResponse(text);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.title, 'Young woman working on laptop in bright living room');
    assert.strictEqual(res.keywords[0], 'woman');
    assert.strictEqual(res.keywords[4], 'living room');
    assert.ok(res.keywords.length >= 15);
  });

  test('parseGeminiResponse handles JSON block format if returned by model', () => {
    const text = `
\`\`\`json
{
  "title": "Chef plating gourmet dish in restaurant kitchen",
  "keywords": ["chef", "kitchen", "cooking", "restaurant", "food preparation", "plating", "culinary", "apron"]
}
\`\`\`
    `;

    const res = parseGeminiResponse(text);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.title, 'Chef plating gourmet dish in restaurant kitchen');
    assert.strictEqual(res.keywords[0], 'chef');
    assert.strictEqual(res.keywords.length, 8);
  });

  test('parseGeminiResponse handles unbraced JSON output without outer braces', () => {
    const text = `
"title": "Minimalist wooden wall plaque with dark grey felt panel",
"keywords": [
  "plaque", "wood", "felt", "wall hanging", "sign", "panel", "decor", "interior", "minimalist", "blank", "brown", "grey"
]
    `;

    const res = parseGeminiResponse(text);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.title, 'Minimalist wooden wall plaque with dark grey felt panel');
    assert.strictEqual(res.keywords[0], 'plaque');
    assert.strictEqual(res.keywords[1], 'wood');
    assert.ok(res.keywords.length >= 10);
  });

  test('parseGeminiResponse rejects empty or completely unparseable text', () => {
    const res = parseGeminiResponse('I am unable to generate metadata for this image due to safety guidelines.');
    assert.strictEqual(res.valid, false);
    assert.ok(res.error);
  });

  test('dataURL decoding and File reconstruction converts image/jpeg correctly', () => {
    // 1x1 transparent/black JPEG dummy base64
    const dummyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
    const arr = dummyJpeg.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = Buffer.from(arr[1], 'base64').toString('binary');
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    const file = new File([u8arr], 'test.jpg', { type: mime });

    assert.strictEqual(file.name, 'test.jpg');
    assert.strictEqual(file.type, 'image/jpeg');
    assert.ok(file.size > 0);
  });
});

