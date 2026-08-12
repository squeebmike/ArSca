const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const htmlFiles = ['dashboard.html', 'sca.html', 'buylist.html'];
let failed = false;

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  scripts.forEach((code, index) => {
    try {
      new Function(code);
    } catch (error) {
      failed = true;
      console.error(`${file} script ${index + 1}: ${error.message}`);
    }
  });
}

const worker = fs.readFileSync(path.join(root, 'cloudflare-worker-full.js'), 'utf8')
  .replace(/^import\s*\{[^}]*\}\s*from\s*'[^']*';?$/m, '')
  .replace(/^export default/m, 'const __worker =');
try {
  new Function(worker);
} catch (error) {
  failed = true;
  console.error(`cloudflare-worker-full.js: ${error.message}`);
}

if (failed) process.exit(1);
console.log('JS parse checks passed');
