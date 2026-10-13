const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

test('phase 5 high-resolution audit records additional individual placements', () => {
  assert.equal(layout.pdfPage.inspection.highResolution.renderDpi, 150);
  assert.equal(layout.pdfPage.inspection.highResolution.regions, 16);
  assert.ok(layout.coursePlacements.length >= 120);
  assert.equal(layout.coursePlacements.filter((entry) => entry.confidence === 'confirmed').length, layout.coursePlacements.length);
  assert.equal(layout.coursePlacements.filter((entry) => entry.verificationMethod === 'visual-tile-150dpi').length, 38);
});

test('phase 5 placement IDs remain a complete subset of the catalog', () => {
  const ids = new Set(courses.map((course) => course.id));
  const placements = layout.coursePlacements;
  assert.equal(new Set(placements.map((entry) => entry.courseId)).size, placements.length);
  assert.ok(placements.every((entry) => ids.has(entry.courseId)));
  assert.ok(layout.pdfOnlySubjects.includes('人生設計とお金の管理'));
});

test('phase 5 exposes a full-canvas enrollment drawer and drag lifecycle', () => {
  assert.match(index, /curriculum-enrollment-drawer-toggle/);
  assert.match(app, /setCurriculumEnrollmentOpen/);
  assert.match(app, /enrollmentAutoOpened/);
  assert.match(app, /curriculumState\.enrollmentManualOpen/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /curriculum-enrollment-open \.right-column/);
  assert.match(css, /transform: translateX\(102%\) !important/);
  assert.match(css, /visibility: hidden/);
  assert.match(css, /env\(safe-area-inset/);
});

test('phase 5 keeps map interactions and privacy gate wired', () => {
  assert.match(app, /requestAnimationFrame\(\(\) => \{\s*fitCurriculumToViewport/);
  assert.match(app, /event\.preventDefault\(\);\s*updateZoom/);
  assert.match(app, /application\/x-zen-course-id/);
  assert.match(app, /curriculumPreview.*=== '1'/s);
  assert.match(css, /body\.curriculum-tree-mode \.curriculum-tree-view/);
});
