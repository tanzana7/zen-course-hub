const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const index = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

test('primary views share one navigation group and the simulator has no floating toolbar entry', () => {
  const navigation = index.match(/<nav class="primary-view-navigation"[\s\S]*?<\/nav>/)?.[0] || '';
  assert.match(navigation, /id="course-list-nav"[^>]*data-view="list"/);
  assert.match(navigation, /id="curriculum-tree-nav"[^>]*data-view="tree"/);
  assert.match(navigation, /id="simulator-btn"[^>]*data-view="simulator"/);
  assert.match(navigation, /4年計画<\/span><span class="view-beta-badge"/);
  assert.equal((index.match(/id="simulator-btn"/g) || []).length, 1);
  assert.doesNotMatch(index, /course-list-toolbar[\s\S]*?id="simulator-btn"/);
  assert.match(app, /syncPrimaryViewNavigation/);
  assert.match(app, /course-list-nav.*?setMode\(false\)/s);
});
