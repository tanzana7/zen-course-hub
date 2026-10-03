const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));

test('curriculum tree source data keeps the expected course and relation counts', () => {
  const courses = readJson('courses.json');
  const relations = readJson('course-relations.json');
  const difficulty = readJson('difficulty.json');

  assert.equal(courses.length, 275);
  assert.equal(relations.length, 335);
  assert.equal(relations.filter((entry) => entry.strength === 'strongly_recommended').length, 21);
  assert.equal(relations.filter((entry) => entry.strength === 'recommended').length, 314);
  assert.equal(difficulty.length, 104);
});

test('curriculum relation direction is prerequisite to successor and has no invalid pairs', () => {
  const courses = readJson('courses.json');
  const relations = readJson('course-relations.json');
  const courseIds = new Set(courses.map((course) => course.id));
  const pairKeys = new Set();

  relations.forEach((relation) => {
    assert.ok(courseIds.has(relation.prerequisiteId));
    assert.ok(courseIds.has(relation.successorId));
    assert.notEqual(relation.prerequisiteId, relation.successorId);
    assert.ok(['strongly_recommended', 'recommended'].includes(relation.strength));

    const pairKey = `${relation.prerequisiteId}>${relation.successorId}`;
    assert.equal(pairKeys.has(pairKey), false);
    pairKeys.add(pairKey);
  });
});

test('curriculum relations preserve strong and normal recommendation distinctions', () => {
  const relations = readJson('course-relations.json');
  const strengths = new Set(relations.map((relation) => relation.strength));

  assert.deepEqual([...strengths].sort(), ['recommended', 'strongly_recommended']);
  assert.equal(relations.filter((relation) => relation.strength === 'strongly_recommended').length, 21);
  assert.equal(relations.filter((relation) => relation.strength === 'recommended').length, 314);
});

test('curriculum tree is wired to the existing planned-state storage and accessible actions', () => {
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

  assert.match(index, /id="curriculum-tree-view"/);
  assert.match(index, /id="curriculum-drop-zone"/);
  assert.match(index, /id="curriculum-tree-search"/);
  assert.match(index, /aria-label="マイ履修に追加"/);
  assert.match(app, /REGISTERED: 'myClasses'/);
  assert.match(app, /COMPLETED: 'completedClasses'/);
  assert.match(app, /dataTransfer\?\.setData\('application\/x-zen-course-id'/);
  assert.match(app, /commitStateChange\(course\.id, 'REGISTER'\)/);
  assert.match(app, /curriculum-detail-btn/);
  assert.match(app, /該当する科目はありません。条件を解除してください。/);
  assert.match(app, /clearCurriculumFocus/);
  assert.match(app, /is-filter-dimmed/);
  assert.match(app, /is-focused/);
});
