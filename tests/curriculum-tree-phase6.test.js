const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));

test('phase 6 records every catalog course with a visually verified placement', () => {
  const ids = new Set(courses.map((course) => course.id));
  const placements = layout.coursePlacements;
  assert.equal(courses.length, 275);
  assert.equal(placements.length, 275);
  assert.equal(new Set(placements.map((entry) => entry.courseId)).size, placements.length);
  assert.ok(placements.every((entry) => ids.has(entry.courseId)));
  assert.ok(placements.every((entry) => entry.confidence === 'confirmed'));
  assert.equal(placements.filter((entry) => entry.verificationDpi === 200 && entry.verificationNote === 'Phase 6 direct regional render').length, 145);
});

test('phase 6 placement geometry is normalized and complete', () => {
  for (const placement of layout.coursePlacements) {
    for (const key of ['x', 'y', 'width', 'height']) assert.equal(typeof placement[key], 'number');
    assert.ok(placement.x >= 0 && placement.x <= 1);
    assert.ok(placement.y >= 0 && placement.y <= 1);
    assert.ok(placement.width > 0 && placement.width <= 1);
    assert.ok(placement.height > 0 && placement.height <= 1);
  }
  assert.equal(layout.pdfPage.phase6Inspection.renderDpi, 200);
  assert.equal(layout.pdfPage.phase6Inspection.regions, 6);
});

test('phase 6 keeps PDF-only labels separate from catalog IDs', () => {
  assert.deepEqual(layout.pdfOnlySubjects, ['日本文学Ⅱ', '文化人類学Ⅱ', '人生設計とお金の管理']);
  const ids = new Set(courses.map((course) => course.id));
  assert.ok(layout.pdfOnlySubjects.every((subject) => !layout.coursePlacements.some((entry) => entry.courseId === subject)));
  assert.ok(layout.coursePlacements.every((entry) => ids.has(entry.courseId)));
});
