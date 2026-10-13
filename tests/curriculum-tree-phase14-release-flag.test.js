const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('release flag exists once and is committed disabled', () => {
  const app = read('app.js');
  assert.equal((app.match(/CURRICULUM_TREE_PUBLIC_ENABLED/g) || []).length, 2);
  assert.match(read('curriculum-config.js'), /const CURRICULUM_TREE_PUBLIC_ENABLED = false;/);
  assert.match(app, /window.CurriculumAccess\?\.publicEnabled === true/);
});

test('public access and localhost preview share one curriculum gate', () => {
  const app = read('app.js');
  assert.match(app, /const curriculumTreePreviewEnabled = \['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(app, /const curriculumTreeEnabled = CURRICULUM_TREE_PUBLIC_ENABLED \|\| curriculumTreePreviewEnabled;/);
  assert.match(app, /const previewEnabled = curriculumTreeEnabled;/);
  assert.match(app, /nav\.hidden = !previewEnabled;/);
  assert.match(app, /if \(previewEnabled\) \{/);
});

test('public flag is not controlled by storage or query input', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /CURRICULUM_TREE_PUBLIC_ENABLED\s*=\s*[^;]*(?:localStorage|URLSearchParams)/);
  assert.doesNotMatch(app, /localStorage\s*\.getItem\([^)]*CURRICULUM_TREE_PUBLIC_ENABLED/);
  assert.doesNotMatch(app, /URLSearchParams\([^)]*CURRICULUM_TREE_PUBLIC_ENABLED/);
});

test('public-off navigation keeps the tree button hidden in the HTML baseline', () => {
  const index = read('index.html');
  assert.match(index, /id="course-list-nav"/);
  assert.match(index, /id="simulator-btn"/);
  assert.match(index, /id="analysis-btn"/);
  assert.match(index, /id="curriculum-tree-nav"[^>]*hidden/);
});

test('public-on test injection changes only the explicit release flag', () => {
  const config = read('curriculum-config.js');
  const enabled = config.replace(
    'const CURRICULUM_TREE_PUBLIC_ENABLED = false;',
    'const CURRICULUM_TREE_PUBLIC_ENABLED = true;'
  );
  assert.notEqual(enabled, config);
  assert.match(enabled, /const CURRICULUM_TREE_PUBLIC_ENABLED = true;/);
  const vm = require('node:vm');
  const context = { URLSearchParams };
  vm.runInNewContext(enabled, context);
  assert.equal(context.CurriculumAccess.canAccess({ hostname: 'example.com', search: '' }), true);
});

test('navigation opens the standalone map and retains list mode transitions', () => {
  const app = read('app.js');
  assert.match(app, /syncPrimaryViewNavigation\(enabled \? 'tree' : 'list'\)/);
  assert.match(app, /course-list-nav'\)\?\.addEventListener\('click', \(\) => setMode\(false\)/);
  assert.match(app, /window.location.assign\(`curriculum.html/);
  assert.match(read('curriculum.html'), /id="map-back" href="index.html"/);
});

test('release flag does not alter enrollment storage keys', () => {
  const app = read('app.js');
  for (const key of ['myClasses', 'completedClasses', 'fourYearSimulatorPlanV1']) {
    assert.match(app, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(app, /CURRICULUM_TREE_PUBLIC_ENABLED\s*:\s*['"](?:myClasses|completedClasses|fourYearSimulatorPlanV1)['"]/);
});

test('curriculum data baselines remain unchanged for phase 14', () => {
  const courses = JSON.parse(read('courses.json'));
  const layout = JSON.parse(read('curriculum-tree-layout.json'));
  const relations = JSON.parse(read('course-relations.json'));
  const ids = new Set(courses.map((course) => course.id));
  assert.equal(courses.length, 275);
  assert.equal(ids.size, 275);
  assert.equal(layout.coursePlacements.length, 275);
  assert.equal(new Set(layout.coursePlacements.map((item) => `${item.courseId}:${item.x}:${item.y}:${item.width}:${item.height}`)).size, 275);
  assert.equal(relations.length, 335);
  assert.equal(relations.filter((item) => item.prerequisiteId === item.successorId).length, 0);
  assert.equal(relations.filter((item) => !ids.has(item.prerequisiteId) || !ids.has(item.successorId)).length, 0);
});
