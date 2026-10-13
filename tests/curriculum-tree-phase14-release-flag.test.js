const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('release flag exists once and is committed disabled', () => {
  const app = read('app.js');
  assert.equal((app.match(/CURRICULUM_TREE_PUBLIC_ENABLED/g) || []).length, 2);
  assert.match(app, /const CURRICULUM_TREE_PUBLIC_ENABLED = false;/);
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
  const app = read('app.js');
  const enabled = app.replace(
    'const CURRICULUM_TREE_PUBLIC_ENABLED = false;',
    'const CURRICULUM_TREE_PUBLIC_ENABLED = true;'
  );
  assert.notEqual(enabled, app);
  assert.match(enabled, /const CURRICULUM_TREE_PUBLIC_ENABLED = true;/);
  assert.match(enabled, /const curriculumTreeEnabled = CURRICULUM_TREE_PUBLIC_ENABLED \|\| curriculumTreePreviewEnabled;/);
  assert.match(enabled, /loadCurriculumLayoutDefinition\(\)/);
});

test('navigation still uses the existing list and tree mode transitions', () => {
  const app = read('app.js');
  assert.match(app, /syncPrimaryViewNavigation\(enabled \? 'tree' : 'list'\)/);
  assert.match(app, /course-list-nav'\)\?\.addEventListener\('click', \(\) => setMode\(false\)/);
  assert.match(app, /nav\.addEventListener\('click', \(\) => setMode\(!document\.body\.classList\.contains\('curriculum-tree-mode'\)\)/);
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
