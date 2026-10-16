import fs from 'fs';
const file = 'C:/Users/thari/Music/sample project/lison  making for image metadate gen/license-admin/src/commands/sync-all.js';
let content = fs.readFileSync(file, 'utf8');

const target = `      } else {
        const body = await res.json().catch(() => ({}));
        console.log(\`❌ FAILED (\${res.status}): \${body.error || 'Server error'}\`);
        failCount++;
      }`;

const replacement = `      } else {
        const body = await res.json().catch(() => ({}));
        if (body.error && body.error.includes('duplicate key value')) {
          console.log('✅ ALREADY IN SUPABASE');
          successCount++;
        } else {
          console.log(\`❌ FAILED (\${res.status}): \${body.error || 'Server error'}\`);
          failCount++;
        }
      }`;

if (content.includes(target)) {
  content = content.replace(target, replacement);
  fs.writeFileSync(file, content, 'utf8');
  console.log('✅ Updated sync-all.js');
} else {
  console.log('⚠️ Target block not found');
}
