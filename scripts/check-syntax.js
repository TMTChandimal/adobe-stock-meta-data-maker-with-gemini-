// scripts/check-syntax.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function checkDir(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += checkDir(fullPath);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
      try {
        execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
        count++;
      } catch (err) {
        console.error(`Syntax check FAILED for: ${fullPath}`);
        console.error(err.stderr ? err.stderr.toString() : err.message);
        process.exit(1);
      }
    }
  }
  return count;
}

const total = checkDir(ROOT_DIR);
console.log(`Runtime syntax validation PASSED: ${total} files checked.`);
