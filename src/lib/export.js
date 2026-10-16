/**
 * EXPORT MODULE
 * =============
 * Generates spreadsheet-safe generic CSV, Adobe Stock platform-import CSV,
 * and structured JSON export with formula-injection protection.
 */

(function () {
  'use strict';

  /**
   * Escapes a cell value to prevent CSV formula injection (DDE attacks)
   * when opened in Microsoft Excel, LibreOffice, or Google Sheets.
   */
  function sanitizeForSpreadsheet(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // If the string starts with dangerous formula execution characters, prepend single quote
  if (/^[\=\+\-\@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If string contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats a generic CSV file safe for opening in Excel or Google Sheets.
 */
function generateGenericCSV(items) {
  const headers = ['Asset ID / Filename', 'Title', 'Keywords', 'Status', 'Timestamp', 'Platform'];
  const rows = [headers.map(sanitizeForSpreadsheet).join(',')];

  for (const item of items) {
    const filename = item.assetId || item.filename || 'asset';
    const title = item.title || '';
    const keywords = Array.isArray(item.keywords) ? item.keywords.join(', ') : (item.keywords || '');
    const status = item.status || 'APPLIED';
    const timestamp = item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString();
    const platform = item.platform || 'adobe';

    rows.push([
      sanitizeForSpreadsheet(filename),
      sanitizeForSpreadsheet(title),
      sanitizeForSpreadsheet(keywords),
      sanitizeForSpreadsheet(status),
      sanitizeForSpreadsheet(timestamp),
      sanitizeForSpreadsheet(platform),
    ].join(','));
  }

  // Prepend UTF-8 BOM so Excel opens Unicode properly
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Generates an Adobe Stock platform-compatible CSV for bulk metadata upload.
 * Adobe Stock Contributor CSV Schema:
 * Filename, Title, Keywords, Category, Releases
 */
function generateAdobeStockImportCSV(items) {
  const headers = ['Filename', 'Title', 'Keywords', 'Category', 'Releases'];
  const rows = [headers.join(',')];

  for (const item of items) {
    let filename = item.filename || item.assetId || 'image.jpg';
    // Ensure filename ends with a valid image extension if not already present
    if (!/\.(jpg|jpeg|png|svg|ai)$/i.test(filename)) {
      filename = `${filename}.jpg`;
    }

    const title = (item.title || '').replace(/"/g, '""');
    const keywordsList = Array.isArray(item.keywords) ? item.keywords : (item.keywords || '').split(',');
    const keywords = keywordsList.map(k => k.trim()).filter(Boolean).join(', ').replace(/"/g, '""');
    const category = item.category || '';
    const releases = item.releases || '';

    rows.push(`"${filename}","${title}","${keywords}","${category}","${releases}"`);
  }

  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Generates structured JSON export.
 */
function generateJSONExport(items) {
  const payload = {
    version: '2.0.0',
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    items: items.map(item => ({
      id: item.id || item.taskId,
      assetId: item.assetId || null,
      filename: item.filename || null,
      title: item.title || '',
      keywords: Array.isArray(item.keywords) ? item.keywords : [],
      status: item.status || 'COMPLETED',
      timestamp: item.timestamp || new Date().toISOString(),
      platform: item.platform || 'adobe',
    }))
  };

  return JSON.stringify(payload, null, 2);
}

  const root = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : this);
  root.sanitizeForSpreadsheet = sanitizeForSpreadsheet;
  root.generateGenericCSV = generateGenericCSV;
  root.generateAdobeStockImportCSV = generateAdobeStockImportCSV;
  root.generateJSONExport = generateJSONExport;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { sanitizeForSpreadsheet, generateGenericCSV, generateAdobeStockImportCSV, generateJSONExport };
  }
})();
