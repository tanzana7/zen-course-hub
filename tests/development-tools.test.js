const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStaticServer } = require('../scripts/lib/static-server.cjs');
const { validateAssetPath } = require('../scripts/build-public.cjs');
const { compileStyles, styleSources } = require('../scripts/styles.cjs');

test('local server exposes only allowlisted assets, supports HEAD, and rejects submissions and malformed paths', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-server-test-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hub</h1>');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'private');
  const server = createStaticServer({ root, assets: ['index.html'] });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('zen-server-test-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>Hub</h1>');
  assert.equal((await fetch(url + '/secret.txt')).status, 404);
  assert.equal((await fetch(url + '/%2e%2e/secret.txt')).status, 404);
  assert.equal((await fetch(url + '/%ZZ')).status, 400);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const head = await fetch(url, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('nested public assets are explicit and traversal, hidden directories and Windows absolute paths are rejected', () => {
  assert.doesNotThrow(() => validateAssetPath('src/features/catalog/controller.js'));
  for (const file of [
    '/etc/passwd',
    '../app.js',
    'src/../app.js',
    'src//app.js',
    '.git/config',
    'C:/secret',
    'src\\app.js',
    '',
  ])
    assert.throws(() => validateAssetPath(file));
});

test('the generated stylesheet matches ordered, parseable source without runtime imports', () => {
  assert.ok(styleSources.length > 1);
  assert.equal(new Set(styleSources).size, styleSources.length);
  assert.equal(fs.readFileSync('style.css', 'utf8'), compileStyles());
  assert.doesNotMatch(compileStyles(), /@import\s/);
});

test('all page scripts are public assets and local scripts preserve deferred dependency order', () => {
  const { publicFiles } = require('../scripts/build-public.cjs');
  for (const page of ['index.html', 'curriculum.html', 'feedback.html']) {
    const html = fs.readFileSync(page, 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*?)\bsrc="([^"]+)"[^>]*>/g)].filter(
      (match) => !/^https?:/.test(match[2]),
    );
    assert.ok(scripts.length > 0);
    for (const [, attributes, file] of scripts) {
      assert.ok(publicFiles.includes(file), file);
      assert.match(attributes, /\bdefer\b/, file);
    }
    if (page === 'index.html') assert.equal(scripts.at(-1)[2], 'app.js');
  }
});
