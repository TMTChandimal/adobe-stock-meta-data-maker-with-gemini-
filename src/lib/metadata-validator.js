/**
 * METADATA VALIDATOR & PARSER
 * ===========================
 * Sanitizes and validates untrusted Gemini model outputs according to
 * official Adobe Stock Contributor rules:
 * - Title: 5 to 200 chars, factual, descriptive, no ending period, no subjective buzzwords.
 * - Keywords: 5 to 49 keywords, prioritized relevance, singular forms preferred,
 *   preserves meaningful multi-word concepts, case-insensitively deduplicated.
 */

(function () {
  'use strict';

  // Prohibited subjective buzzwords and technical camera metadata on Adobe Stock
  const PROHIBITED_BUZZWORDS = new Set([
  'best', 'amazing', 'stunning', 'beautiful', 'cute', 'perfect', 'gorgeous',
  'magnificent', 'awesome', 'masterpiece', 'high quality', 'top quality',
  'photorealistic', 'hyperrealistic', 'ultra realistic', 'trending', 'viral',
  '4k', '8k', 'uhd', 'hd', 'iso', 'f/1.8', 'f/2.8', '50mm', 'canon', 'nikon',
  'sony', 'fujifilm', 'leica', 'hasselblad', 'raw', 'jpg', 'jpeg', 'png'
]);

/**
 * Normalizes title string according to Adobe Stock guidelines.
 */
function normalizeTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') return '';

  let title = rawTitle.trim();

  // Strip leading JSON key markers, markdown headers, and colon separators (e.g. "title":, Title:, **Title**:, : or ": ")
  title = title.replace(/^["'`#*\s]*(?:title)?["'`#*\s]*[:=\-–]\s*/i, '').trim();

  // Strip leading wrapping quotes, colons, brackets, backticks, asterisks, etc.
  title = title.replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '').trim();

  // Strip trailing JSON syntax artifacts like quotes, commas, brackets, braces
  title = title.replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '').trim();

  // Collapse multiple spaces
  title = title.replace(/\s+/g, ' ');

  // Remove trailing periods
  title = title.replace(/\.+$/, '').trim();

  // Remove obvious standalone buzzwords from title
  for (const word of ['best', 'amazing', 'stunning', 'beautiful']) {
    const rx = new RegExp(`\\b${word}\\b`, 'gi');
    title = title.replace(rx, '').replace(/\s{2,}/g, ' ').trim();
  }

  // Enforce max length of 200 characters (Adobe limit)
  if (title.length > 200) {
    title = title.substring(0, 197).trim() + '...';
  }

  return title;
}

/**
 * Normalizes and deduplicates an array of keywords according to Adobe Stock guidelines.
 */
function normalizeKeywords(rawKeywords, options = {}) {
  const { maxKeywords = 40, minKeywords = 5 } = options;

  let list = [];
  if (Array.isArray(rawKeywords)) {
    list = rawKeywords;
  } else if (typeof rawKeywords === 'string') {
    let rawStr = rawKeywords.trim();
    // Strip leading JSON key prefixes if string was unparsed JSON (e.g. '": [', '"keywords": [')
    rawStr = rawStr.replace(/^["'`#*\s]*(?:keywords)?["'`#*\s]*[:=\-–]\s*(?:\[)?\s*/i, '');
    rawStr = rawStr.replace(/(?:\]|\})?\s*,?\s*$/, '');
    list = rawStr.split(/[,;\n\r]+/);
  }

  const seen = new Set();
  const result = [];

  for (let rawKw of list) {
    if (rawKw === null || rawKw === undefined) continue;
    let kw = typeof rawKw === 'number' ? String(rawKw) : String(rawKw);

    // Strip JSON key prefix if present on item (e.g. 'keywords:', '": [', ': [')
    kw = kw.replace(/^["'`#*\s]*(?:keywords)?["'`#*\s]*[:=\-–]\s*(?:\[)?\s*/i, '');

    // Strip leading/trailing quotes, markdown symbols, brackets, colons, commas, whitespace
    let cleaned = kw
      .replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '')
      .replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '')
      .trim();

    // Strip list numbering prefix if present (e.g. "1. ", "1) ", "01: ")
    cleaned = cleaned.replace(/^\d+[\.\)\:\-\s]+\s*/, '');

    // Strip any lingering wrapping quotes or trailing periods/commas/brackets
    cleaned = cleaned
      .replace(/^[:=\-–\s"'`*_#\[\]{}]+/, '')
      .replace(/[:=\-–\s"'`*_#\[\]{},]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned || cleaned.length < 2) continue;

    // Check prohibited keywords
    const lower = cleaned.toLowerCase();
    if (PROHIBITED_BUZZWORDS.has(lower)) continue;

    // Remove if it's a prompt label or bracket residual
    if (lower.startsWith('keywords:') || lower.startsWith('title:') || lower === 'keywords' || lower === 'title') continue;

    // Case-insensitive deduplication while preserving rank order
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(cleaned);
    }

    if (result.length >= maxKeywords) break;
  }

  return result;
}

/**
 * Parses Gemini response text into structured title and keywords.
 * Supports structured text, JSON blocks, bare JSON, unbraced JSON, and regex fallback.
 */
function parseGeminiResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') {
    return { title: '', keywords: [], valid: false, error: 'Empty response received from Gemini.' };
  }

  let title = '';
  let rawKeywords = [];

  // Strategy 1: Attempt JSON block parsing (fenced code block, bare JSON object, or unbraced JSON)
  let jsonCandidate = null;
  const jsonBlockMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    jsonCandidate = jsonBlockMatch[1].trim();
  } else {
    // Look for bare JSON object with title and keywords
    const bareMatch = responseText.match(/(\{[\s\S]*?"title"[\s\S]*?"keywords"[\s\S]*?\})/i)
      || responseText.match(/(\{[\s\S]*?"keywords"[\s\S]*?"title"[\s\S]*?\})/i)
      || responseText.match(/(\{[\s\S]*"title"[\s\S]*"keywords"[\s\S]*\})/i);
    if (bareMatch) {
      jsonCandidate = bareMatch[1].trim();
    } else {
      // Look for unbraced JSON output: "title": "..." and "keywords": [...]
      const unbracedMatch = responseText.match(/("title"\s*:\s*[\s\S]*?"keywords"\s*:\s*\[[\s\S]*?\]|"keywords"\s*:\s*\[[\s\S]*?\][\s\S]*?"title"\s*:\s*["'][^"'\n\r]+["'])/i);
      if (unbracedMatch) {
        jsonCandidate = '{' + unbracedMatch[1].trim() + '}';
      }
    }
  }

  if (jsonCandidate) {
    try {
      // Clean trailing commas before closing braces/brackets (common in LLM output)
      const sanitized = jsonCandidate.replace(/,\s*([}\]])/g, '$1');
      const parsed = JSON.parse(sanitized);
      if (parsed.title) title = String(parsed.title);
      if (Array.isArray(parsed.keywords)) {
        rawKeywords = parsed.keywords.map(k => (typeof k === 'number' ? String(k) : k));
      } else if (typeof parsed.keywords === 'string') {
        rawKeywords = parsed.keywords.split(',');
      }
    } catch (e) {
      // Fall through to regex extraction
    }
  }

  // Strategy 2: Direct "Title:" regex extraction (same-line, multiline, or heading)
  if (!title) {
    const titleMatch = responseText.match(/(?:["'`#*\s]|\b)Title(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]\s*([^\n\r]+)/i);
    if (titleMatch && titleMatch[1] && titleMatch[1].trim()) {
      title = titleMatch[1].trim();
    } else {
      // Support "Title:" header on its own line with text immediately on the following line
      const multilineTitle = responseText.match(/(?:["'`#*\s]|\b)Title(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]?\s*\n+([^\n\r]+)/i);
      if (multilineTitle && multilineTitle[1]) {
        title = multilineTitle[1].trim();
      }
    }
  }

  // Strategy 3: Keywords extraction
  if (rawKeywords.length === 0) {
    // Check for "Keywords (Top 10):" or "Priority Keywords:"
    const priorityMatch = responseText.match(/(?:["'`#*\s]|\b)(?:Keywords\s*\([^)]+\)|First\s*10\s*Keywords|Priority\s*Keywords)(?:["'`#*\s]|\b)?\s*[:\-–=]\s*([\s\S]+?)(?=\n\s*(?:["'`#*\s]|\b)?Additional\s*Keywords|\n\n|$)/i);
    const additionalMatch = responseText.match(/(?:["'`#*\s]|\b)Additional\s*Keywords(?:["'`#*\s]|\b)?\s*[:\-–=]\s*([\s\S]+?)(?=$|\n\n|\n[A-Z][a-z]+:)/i);

    if (priorityMatch && priorityMatch[1]) {
      rawKeywords = rawKeywords.concat(priorityMatch[1].split(/[,;\n\r]+/));
    }
    if (additionalMatch && additionalMatch[1]) {
      rawKeywords = rawKeywords.concat(additionalMatch[1].split(/[,;\n\r]+/));
    }

    // Standard single "Keywords:" block fallback
    if (rawKeywords.length === 0) {
      const kwMatch = responseText.match(/(?:["'`#*\s]|\b)Keywords(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]\s*([\s\S]+?)(?=$|\n\s*(?:#+|\*\*|\b)(?:Additional|Note|Description|Explanation|Rules)|\n\s*\n\s*[A-Z]|\n[A-Z][a-z]+:|```)/i)
        || responseText.match(/(?:["'`#*\s]|\b)Keywords(?:["'`#*\s]|\b)?(?:\s*\([^)]*\))?\s*[:\-–=]\s*([\s\S]+)/i);
      if (kwMatch && kwMatch[1]) {
        let kwText = kwMatch[1].trim();
        kwText = kwText.replace(/^\[\s*/, '').replace(/\s*\]$/, '');
        rawKeywords = kwText.split(/[,;\n\r]+/);
      }
    }
  }

  // Normalize and validate
  const cleanTitle = normalizeTitle(title);
  const cleanKeywords = normalizeKeywords(rawKeywords);

  const isValid = cleanTitle.length >= 5 && cleanKeywords.length >= 5;

  return {
    title: cleanTitle,
    keywords: cleanKeywords,
    valid: isValid,
    error: isValid ? null : 'Failed to parse valid Title (min 5 chars) or Keywords (min 5 tags) from Gemini response.'
  };
}

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.normalizeTitle = normalizeTitle;
  root.normalizeKeywords = normalizeKeywords;
  root.parseGeminiResponse = parseGeminiResponse;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizeTitle, normalizeKeywords, parseGeminiResponse };
  }
})();
