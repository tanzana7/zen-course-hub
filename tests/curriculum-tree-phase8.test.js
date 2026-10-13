const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const audit = JSON.parse(fs.readFileSync(path.join(root, 'docs/curriculum-tree-phase8-course-audit.json'), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));

test('phase 8 audit covers all catalog courses and every exact duplicate slot', () => {
  assert.equal(audit.catalogCourseCount, 275);
  assert.equal(audit.placementCount, 275);
  assert.equal(audit.entries.length, 275);
  assert.equal(audit.exactDuplicateSlotCount, 18);
  assert.equal(audit.exactDuplicateEntryCount, 36);
  assert.equal(audit.coordinateCorrections, 0);
  assert.equal(audit.demotedEntries, 0);
  assert.equal(audit.duplicateGroups.length, 18);
  assert.ok(audit.duplicateGroups.every((group) => group.status === 'unresolved' && group.coordinateAction === 'preserved'));
  assert.equal(new Set(audit.entries.map((entry) => entry.courseId)).size, 275);
  assert.ok(audit.entries.every((entry) => courses.some((course) => course.id === entry.courseId)));
});

test('phase 8 preserves source coordinates and the accessible collision stack', () => {
  const byId = new Map(layout.coursePlacements.map((entry) => [entry.courseId, entry]));
  for (const group of audit.duplicateGroups) {
    const source = byId.get(group.courseIds[0]);
    assert.deepEqual(group.rectangle, [source.x, source.y, source.width, source.height]);
    assert.equal(group.courseIds.length, 2);
  }
  assert.match(app, /collisionSize/);
  assert.match(app, /同一座標の科目/);
  assert.match(style, /curriculum-node\.is-collision/);
});

test('phase 8 search navigation auto-zooms only on Enter and adds a transient highlight', () => {
  assert.match(app, /searchHighlightId/);
  assert.match(app, /triggerCurriculumSearchHighlight/);
  assert.match(app, /readableScale/);
  assert.match(app, /Math\.min\(1\.5, Math\.max\(1,/);
  assert.match(app, /search\.addEventListener\('keydown'/);
  assert.match(style, /curriculum-node\.is-search-highlight/);
  assert.match(style, /prefers-reduced-motion/);
});

test('phase 8 keeps selected relation readability and relation modes explicit', () => {
  assert.match(app, /curriculumState\.relationMode === 'selected' && focusIds\.size > 0/);
  assert.match(index, /id="curriculum-relation-mode"/);
  assert.match(index, /公式の前提条件ではありません/);
  assert.match(style, /curriculum-node\.is-out-of-focus \{ opacity: 0\.78; \}/);
  assert.match(style, /curriculum-edge\.is-out-of-focus \{ opacity: 0\.12; \}/);
});

test('phase 8 keeps the preview gate and existing storage boundaries', () => {
  assert.match(app, /curriculumPreview/);
  assert.match(app, /nav\.hidden = !previewEnabled/);
  assert.match(app, /fourYearSimulatorPlanV1|FOUR_YEAR_SIMULATOR_PLAN/);
  assert.match(app, /completedClasses/);
  assert.match(app, /myClasses/);
});
