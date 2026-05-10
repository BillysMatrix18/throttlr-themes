// build-index.js — runs on every Netlify deploy
//
// Scans the themes/ folder for manifest JSON files, reads each one, and
// writes themes/_index.json — a single file the website fetches on page load.
//
// This replaces the old GitHub API approach. Everything is now same-origin
// and works regardless of repo visibility, rate limits, browser caching,
// or any other GitHub-side issue.
//
// Run: node build-index.js

const fs = require('fs');
const path = require('path');

const THEMES_DIR  = path.join(__dirname, 'themes');
const INDEX_FILE  = path.join(THEMES_DIR, '_index.json');

if (!fs.existsSync(THEMES_DIR)) {
  console.error(`themes/ folder doesn't exist at ${THEMES_DIR}`);
  process.exit(1);
}

const allFiles = fs.readdirSync(THEMES_DIR);

// Find theme manifests — every .json file except the index itself
const manifestFiles = allFiles.filter(f =>
  f.endsWith('.json') && f !== '_index.json' && !f.startsWith('.')
);

const themes = [];
const skipped = [];

for (const filename of manifestFiles) {
  const fullPath = path.join(THEMES_DIR, filename);
  try {
    const raw = fs.readFileSync(fullPath, 'utf8');
    const manifest = JSON.parse(raw);

    // Validate required fields
    if (!manifest.id || !manifest.name) {
      skipped.push(`${filename} — missing required fields (id/name)`);
      continue;
    }

    // Check companion CSS file exists
    const cssFilename = manifest.css_file || `${manifest.id}.css`;
    const cssExists = fs.existsSync(path.join(THEMES_DIR, cssFilename));

    // Embed metadata the gallery uses
    manifest._filename     = filename;
    manifest._css_filename = cssFilename;
    manifest._css_exists   = cssExists;

    themes.push(manifest);
  } catch (e) {
    skipped.push(`${filename} — ${e.message}`);
  }
}

// Sort alphabetically by name so the gallery order is predictable
themes.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

// Write the index
fs.writeFileSync(INDEX_FILE, JSON.stringify(themes, null, 2));

console.log(`\n✓ Generated themes/_index.json`);
console.log(`  Themes:  ${themes.length}`);
themes.forEach(t => {
  const cssMark = t._css_exists ? '✓' : '⚠ missing CSS';
  console.log(`    • ${t.id.padEnd(20)} ${cssMark}`);
});
if (skipped.length) {
  console.log(`  Skipped: ${skipped.length}`);
  skipped.forEach(s => console.log(`    • ${s}`));
}
console.log('');
