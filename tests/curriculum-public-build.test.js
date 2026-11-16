const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, output, publicFiles } = require('../scripts/build-public.cjs');

test('Netlify publishes only the reviewed runtime asset allowlist', () => {
  const root = path.resolve(__dirname, '..');
  const config = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(config, /base\s*=\s*"\."/);
  assert.match(config, /command\s*=\s*"node scripts\/build-public\.cjs"/);
  assert.match(config, /publish\s*=\s*"netlify-dist"/);
  assert.equal(new Set(publicFiles).size, publicFiles.length);
  for (const file of [
    'index.html',
    'curriculum.html',
    'app.js',
    'curriculum-map.js',
    'curriculum-config.js',
    'courses.json',
    'curriculum-tree-layout.json',
    '_redirects',
  ]) {
    assert.ok(publicFiles.includes(file), file);
  }
  assert.ok(publicFiles.every((file) => !/\.pdf$|\.png$|\.md$|\.cjs$|wrangler/i.test(file)));
  build();
  assert.deepEqual(require('../scripts/build-public.cjs').listFiles(output).sort(), [...publicFiles].sort());
  for (const file of publicFiles) {
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(root, file)), file);
  }
});

test('repeated builds do not rewrite an unchanged generated stylesheet', () => {
  const file = path.join(__dirname, '..', 'style.css');
  const previous = fs.statSync(file);
  const timestamp = new Date('2020-01-01T00:00:00Z');
  try {
    fs.utimesSync(file, timestamp, timestamp);
    build();
    assert.equal(fs.statSync(file).mtimeMs, timestamp.getTime());
  } finally {
    fs.utimesSync(file, previous.atime, previous.mtime);
  }
});
