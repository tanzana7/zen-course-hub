const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));

test('curriculum redesign keeps the public navigation hidden and exposes a local preview gate', () => {
  assert.match(index, /id="curriculum-tree-nav"[^>]*hidden/);
  assert.match(app, /curriculumPreview/);
  assert.match(app, /127\.0\.0\.1/);
});

test('curriculum redesign exposes stage, zoom, search, and registration controls', () => {
  for (const id of ['curriculum-stage-axis', 'curriculum-zoom-in', 'curriculum-zoom-out', 'curriculum-zoom-fit', 'curriculum-tree-search', 'curriculum-drop-zone']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(app, /curriculum-enrollment-action/);
  assert.match(app, /pointerdown/);
  assert.match(app, /curriculumState\.zoom/);
  assert.match(style, /curriculum-stage-band/);
});

test('curriculum redesign uses the existing 275 course catalog without inventing IDs', () => {
  assert.equal(courses.length, 275);
  assert.equal(new Set(courses.map(course => course.id)).size, 275);
  assert.match(app, /getCurriculumStage/);
  assert.match(app, /getCurriculumTrack/);
});

test('curriculum preview retains the three independent storage concerns', () => {
  assert.match(app, /myClasses/);
  assert.match(app, /completedClasses/);
  assert.match(app, /fourYearSimulatorPlanV1/);
  assert.match(app, /commitStateChange\(courseId, isRegistered \? 'DELETE' : 'REGISTER'\)/);
});
