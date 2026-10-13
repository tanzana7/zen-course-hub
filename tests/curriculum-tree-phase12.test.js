const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const quality = require('../quality-utils.js');

test('curriculum fit uses both viewport dimensions and can fit below manual zoom floor', () => {
  const fit = quality.calculateCurriculumFit({
    viewportWidth: 390,
    viewportHeight: 447,
    contentWidth: 2400,
    contentHeight: 2388,
    padding: 28
  });
  assert.ok(fit.scale < 0.25);
  assert.ok(fit.scale > 0);
  assert.ok(fit.panX >= 0);
  assert.ok(fit.panY >= 0);
  assert.ok(2400 * fit.scale <= 390 + 1);
  assert.ok(2388 * fit.scale <= 447 + 1);
});

test('curriculum fit centers desktop and mobile canvases', () => {
  const desktop = quality.calculateCurriculumFit({ viewportWidth: 1280, viewportHeight: 650, contentWidth: 2400, contentHeight: 2388 });
  const mobile = quality.calculateCurriculumFit({ viewportWidth: 375, viewportHeight: 440, contentWidth: 2400, contentHeight: 2388 });
  assert.ok(desktop.scale > mobile.scale);
  assert.ok(Math.abs(desktop.panX - (1280 - 2400 * desktop.scale) / 2) < 0.05);
  assert.ok(Math.abs(mobile.panY - (440 - 2388 * mobile.scale) / 2) < 0.05);
});

test('curriculum fit rejects invalid dimensions without throwing', () => {
  assert.deepEqual(quality.calculateCurriculumFit({ viewportWidth: 0, viewportHeight: 400, contentWidth: 100, contentHeight: 100 }), {
    scale: 1, panX: 0, panY: 0, availableWidth: 0, availableHeight: 0
  });
});

test('mobile curriculum toolbar keeps search compact and controls available', () => {
  const css = read('style.css');
  assert.match(css, /body\.curriculum-tree-mode \.curriculum-tree-toolbar \{ flex-direction: row; align-items: center; flex-wrap: wrap; \}/);
  assert.match(css, /body\.curriculum-tree-mode \.curriculum-tree-toolbar input \{[^}]*height: 42px;[^}]*min-height: 40px;[^}]*max-height: 48px;/s);
  assert.match(css, /body\.curriculum-tree-mode \.curriculum-tree-toolbar > label:not\(\.curriculum-search-label\) \{[^}]*min-width: 0;/s);
  assert.match(css, /curriculum-tree-controls[^}]*overflow-x: auto/s);
});

test('fit button delegates to dimension-aware helper and preview remains gated', () => {
  const app = read('app.js');
  const index = read('index.html');
  assert.match(app, /qualityUtils\.calculateCurriculumFit\(/);
  assert.match(app, /get\('curriculumPreview'\) === '1'/);
  assert.match(index, /id="curriculum-zoom-fit"/);
});

test('root-publish deny rules keep development material out of Netlify assets', () => {
  const redirects = read('_redirects');
  for (const rule of ['/docs/*', '/tests/*', '/tmp/*', '/*.pdf', '/**/*.pdf']) assert.match(redirects, new RegExp(rule.replace('*', '\\*')));
});

test('phase 12 data baselines remain intact', () => {
  const courses = JSON.parse(read('courses.json'));
  const layout = JSON.parse(read('curriculum-tree-layout.json'));
  const relations = JSON.parse(read('course-relations.json'));
  const ids = new Set(courses.map((course) => course.id));
  assert.equal(courses.length, 275);
  assert.equal(ids.size, 275);
  assert.equal(layout.coursePlacements.length, 275);
  assert.equal(relations.length, 335);
  assert.equal(new Set(relations.map((r) => `${r.prerequisiteId}:${r.successorId}`)).size, 335);
  assert.equal(relations.filter((r) => r.prerequisiteId === r.successorId).length, 0);
  assert.equal(relations.filter((r) => !ids.has(r.prerequisiteId) || !ids.has(r.successorId)).length, 0);
});
