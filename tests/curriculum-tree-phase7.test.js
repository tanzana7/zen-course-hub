const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = require('./helpers/hub-source.cjs').readHubSource();
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const audit = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/curriculum-tree-phase7-course-audit.json'), 'utf8'),
);
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));
const relations = JSON.parse(fs.readFileSync(path.join(root, 'course-relations.json'), 'utf8'));

test('phase 7 audit covers every catalog course and classifies exact collisions', () => {
  assert.equal(audit.catalogCourseCount, 275);
  assert.equal(audit.placementCount, 275);
  assert.equal(audit.entries.length, 275);
  assert.equal(new Set(audit.entries.map((entry) => entry.courseId)).size, 275);
  assert.equal(audit.exactDuplicateSlotCount, 18);
  assert.equal(audit.exactDuplicateEntryCount, 36);
  assert.equal(audit.entries.filter((entry) => !entry.coordinateVerified).length, 36);
  assert.ok(audit.entries.every((entry) => courses.some((course) => course.id === entry.courseId)));
});

test('phase 7 preserves the 335 advisory relations and valid IDs', () => {
  const ids = new Set(courses.map((course) => course.id));
  assert.equal(relations.length, 335);
  assert.ok(relations.every((relation) => ids.has(relation.prerequisiteId) && ids.has(relation.successorId)));
  assert.ok(relations.every((relation) => relation.prerequisiteId !== relation.successorId));
  assert.equal(
    new Set(relations.map((relation) => `${relation.prerequisiteId}|${relation.successorId}`)).size,
    relations.length,
  );
});

test('phase 7 relation line modes default to OFF and support selected/all', () => {
  assert.match(index, /id="curriculum-relation-mode"/);
  assert.match(index, /<option value="off" selected>OFF<\/option>/);
  assert.match(index, /<option value="selected">SELECTED<\/option>/);
  assert.match(index, /<option value="all">ALL<\/option>/);
  assert.match(index, /公式の前提条件ではありません/);
  assert.match(app, /relationMode: 'off'/);
  assert.match(app, /relationMode === 'selected'/);
  assert.match(app, /relationMode === 'all'/);
  assert.match(app, /if \(!showAllRelations && !showSelectedRelations\) return/);
  assert.match(style, /curriculum-edge\.is-reference[^}]*stroke-dasharray/);
  assert.match(style, /curriculum-edges[^}]*pointer-events: none/);
});

test('phase 7 collision cards retain an explicit accessible stack', () => {
  assert.match(app, /collisionSize/);
  assert.match(app, /同一座標の科目/);
  assert.match(style, /curriculum-node\.is-collision/);
});
