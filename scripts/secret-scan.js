/**
 * SECRET SCANNER
 * ==============
 * Scans directories and files for:
 * 1. Forbidden files (.env, private keys, databases, git history, admin source)
 * 2. Sensitive token patterns (Supabase service role keys, private keys, admin secrets)
 *
 * NOTE: Never prints or logs actual secret values.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Secret patterns (name and regex matcher)
const SECRET_PATTERNS = [
  {
    name: 'Ed25519 Private Key in Base64 (private-key.b64)',
    regex: /private-key\.b64$/i,
    isFileMatch: true,
  },
  {
    name: 'Environment File (.env)',
    regex: /^\.env(\.(local|production|development|test))?$/i,
    isFileMatch: true,
  },
  {
    name: 'SQLite Database File',
    regex: /\.(db|sqlite|sqlite3)$/i,
    isFileMatch: true,
  },
  {
    name: 'Git Repository Directory',
    regex: /[\\/]\.git([\\/]|$)/i,
    isFileMatch: true,
  },
  {
    name: 'PEM Private Key Content',
    regex: /-----BEGIN\s+(EC|RSA|OPENSSH|DSA|PRIVATE)?\s*KEY-----/i,
    isContentMatch: true,
  },
  {
    name: 'Generic API Secret Assignment',
    regex: /(?:LICENSE_ADMIN_SECRET|SERVICE_ROLE_KEY|ADMIN_SECRET|PRIVATE_KEY)\s*[:=]\s*['"][a-zA-Z0-9_\-\.]{12,}['"]/i,
    isContentMatch: true,
  },
];

// File extensions to inspect contents of
const CONTENT_EXTENSIONS = new Set([
  '.js', '.mjs', '.ts', '.json', '.html', '.css', '.txt', '.md', '.sql'
]);

export function scanPath(targetPath, options = {}) {
  const {
    isPackagingScan = false,
    ignorePaths = ['node_modules', '.git', 'dist'],
  } = options;

  const findings = [];

  function traverse(currentPath) {
    const relToRoot = path.relative(ROOT_DIR, currentPath);
    const baseName = path.basename(currentPath);

    // Skip ignored paths unless we are specifically checking them
    if (!isPackagingScan) {
      for (const ign of ignorePaths) {
        if (relToRoot.split(path.sep).includes(ign)) {
          return;
        }
      }
    }

    const stat = fs.statSync(currentPath);

    if (stat.isDirectory()) {
      // In customer packaging mode, admin tools, backend, and git must never exist
      if (isPackagingScan) {
        if (['license-admin', 'backend', '.git'].includes(baseName)) {
          findings.push({
            type: 'FORBIDDEN_DIRECTORY',
            path: relToRoot,
            message: `Forbidden directory in extension package: ${baseName}`,
          });
          return;
        }
      }

      const entries = fs.readdirSync(currentPath);
      for (const entry of entries) {
        traverse(path.join(currentPath, entry));
      }
      return;
    }

    // Check filename patterns
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.isFileMatch && pattern.regex.test(baseName)) {
        // If scanning source root, some files are known dev-only files (e.g. license-admin/.env)
        // but in packaging scan, any such file is a critical failure.
        findings.push({
          type: 'FORBIDDEN_FILE',
          rule: pattern.name,
          path: relToRoot,
          message: `Forbidden file detected: ${relToRoot}`,
        });
      }
    }

    // Check content patterns for code/text files
    const ext = path.extname(baseName).toLowerCase();
    if (CONTENT_EXTENSIONS.has(ext)) {
      try {
        const content = fs.readFileSync(currentPath, 'utf8');
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.isContentMatch && pattern.regex.test(content)) {
            // Check if this is a template/example file
            if (baseName.includes('.example') || relToRoot.includes('secret-scan.js')) {
              continue;
            }
            findings.push({
              type: 'SECRET_IN_CONTENT',
              rule: pattern.name,
              path: relToRoot,
              message: `Potential secret pattern matched (${pattern.name}) in ${relToRoot}`,
            });
          }
        }
      } catch (err) {
        // Ignore read errors on binary or unreadable files
      }
    }
  }

  if (fs.existsSync(targetPath)) {
    traverse(targetPath);
  }

  return findings;
}

// CLI Execution
if (process.argv[1] === __filename) {
  const args = process.argv.slice(2);
  const isPkg = args.includes('--packaging');
  const dirArg = args.find(a => !a.startsWith('--'));
  const target = dirArg ? path.resolve(dirArg) : ROOT_DIR;

  console.log(`[SecretScan] Scanning path: ${target} (packagingMode=${isPkg})`);
  const findings = scanPath(target, { isPackagingScan: isPkg });

  if (findings.length === 0) {
    console.log('[SecretScan] Clean! No secrets or forbidden files found.');
    process.exit(0);
  } else {
    console.error(`[SecretScan] Found ${findings.length} issue(s):`);
    for (const f of findings) {
      console.error(`  - [${f.type}] ${f.message}`);
    }
    process.exit(1);
  }
}
