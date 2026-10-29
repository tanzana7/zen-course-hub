const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

test('root publish candidate contains every runtime asset referenced by the app', () => {
  const required = [
    'index.html',
    'style.css',
    'app.js',
    'quality-utils.js',
    'course-sorting.js',
    'simulator-rules.js',
    'graduation-requirements.js',
    'graduation-requirements.json',
    'courses.json',
    'difficulty.json',
    'course-relations.json',
    'curriculum-tree-layout.json',
    'curriculum.html',
    'curriculum-map.css',
    'curriculum-map.js',
    'curriculum-config.js',
    'tutorial.json',
    '_redirects',
  ];
  for (const file of required) assert.equal(exists(file), true, file);
  const index = read('index.html');
  for (const file of [
    'style.css',
    'quality-utils.js',
    'course-sorting.js',
    'simulator-rules.js',
    'graduation-requirements.js',
    'app.js',
  ]) {
    assert.match(index, new RegExp(`(?:src|href)=["']${file.replace('.', '\\.')}`));
  }
});

test('development evidence is outside the root runtime asset set', () => {
  assert.equal(fs.existsSync(path.join(root, 'docs')), true);
  assert.equal(fs.existsSync(path.join(root, 'tests')), true);
  // Git does not preserve empty directories; create the QA workspace on fresh clones.
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  assert.equal(fs.statSync(path.join(root, 'tmp')).isDirectory(), true);
  assert.match(read('.gitignore'), /^tmp\/$/m);
  assert.ok(!require('../scripts/build-public.cjs').publicFiles.some((file) => file.startsWith('tmp/')));
  assert.equal(
    fs.readdirSync(path.join(root, 'docs', 'qa')).some((name) => name.includes('phase13')),
    true,
  );
  assert.equal(
    fs
      .readdirSync(root, { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')),
    false,
  );
});

test('redirect deny rules use valid Netlify splat paths for development directories', () => {
  const redirects = read('_redirects')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'));
  for (const prefix of ['/docs/*', '/tests/*', '/tmp/*', '/scripts/*']) {
    assert.ok(
      redirects.some((line) => new RegExp(`^${prefix.replace('*', '\\*')}\\s+/404\\s+404!$`).test(line)),
      prefix,
    );
  }
  assert.ok(redirects.every((line) => line.trim().split(/\s+/).length >= 3));
});

test('preview gate is local-only and public navigation remains hidden by default', () => {
  const app = require('./helpers/hub-source.cjs').readHubSource();
  const index = read('index.html');
  assert.match(app, /\['localhost', '127\.0\.0\.1'\]\.includes\(window\.location\.hostname\)/);
  assert.match(app, /get\('curriculumPreview'\) === '1'/);
  assert.match(index, /id="curriculum-tree-nav"[^>]*hidden/);
});

test('existing storage boundaries remain unchanged', () => {
  const app = require('./helpers/hub-source.cjs').readHubSource();
  assert.match(app, /myClasses/);
  assert.match(app, /completedClasses/);
  assert.match(app, /fourYearSimulatorPlanV1/);
});

test('catalog and curriculum relation baselines remain intact', () => {
  const courses = JSON.parse(read('courses.json'));
  const layout = JSON.parse(read('curriculum-tree-layout.json'));
  const relations = JSON.parse(read('course-relations.json'));
  const ids = new Set(courses.map((course) => course.id));
  assert.equal(courses.length, 275);
  assert.equal(ids.size, 275);
  assert.equal(layout.coursePlacements.length, 275);
  assert.equal(relations.length, 335);
  assert.equal(new Set(relations.map((item) => `${item.prerequisiteId}:${item.successorId}`)).size, 335);
  assert.equal(relations.filter((item) => item.prerequisiteId === item.successorId).length, 0);
  assert.equal(
    relations.filter((item) => !ids.has(item.prerequisiteId) || !ids.has(item.successorId)).length,
    0,
  );
});
