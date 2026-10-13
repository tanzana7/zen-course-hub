const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const layout = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));
const evidence = JSON.parse(fs.readFileSync(path.join(root, 'docs/curriculum-tree-phase9-duplicate-evidence.json'), 'utf8'));

test('phase 9 evidence covers all 18 duplicate pairs and catalog IDs', () => {
  assert.equal(evidence.pairs.length, 18);
  const courseIds = new Set(courses.map((course) => course.id));
  const pairIds = evidence.pairs.flatMap((pair) => [pair.courseIdA, pair.courseIdB]);
  assert.equal(new Set(pairIds).size, 36);
  assert.ok(pairIds.every((id) => courseIds.has(id)));
  assert.ok(evidence.pairs.every((pair) => pair.positionVerdict === 'DIFFERENT_POSITION'));
  assert.ok(evidence.pairs.every((pair) => pair.pdfFoundA && pair.pdfFoundB && pair.nameMatchA && pair.nameMatchB));
});

test('phase 9 evidence records direct PDF geometry and correction provenance', () => {
  assert.deepEqual(evidence.source.mediaBoxPt, { x: 0, y: 0, width: 7594, height: 7557 });
  assert.deepEqual(evidence.source.cropBoxPt, evidence.source.mediaBoxPt);
  assert.equal(evidence.source.renderDpi, 200);
  assert.equal(evidence.source.rotation, 0);
  assert.equal(evidence.source.webCanvas.width, 2400);
  assert.equal(evidence.source.webCanvas.height, 2388);
  for (const pair of evidence.pairs) {
    assert.ok(pair.pdfRectA && pair.pdfRectB);
    assert.equal(pair.pdfRectA.unit, 'pt');
    assert.equal(pair.pdfRectA.renderDpi, 200);
    assert.equal(pair.correctionApplied, true);
    assert.equal(pair.rootCause, 'A');
    assert.equal(pair.confidenceA, 'confirmed');
    assert.equal(pair.confidenceB, 'confirmed');
    assert.match(pair.evidenceNotes, /directly at 200 DPI/);
  }
});

test('phase 9 removes exact duplicate source rectangles without deleting placements', () => {
  assert.equal(layout.coursePlacements.length, 275);
  const keys = layout.coursePlacements.map((entry) => [entry.x, entry.y, entry.width, entry.height].join('|'));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(evidence.summary.remainingDuplicateSlots, 0);
  assert.equal(evidence.summary.correctedPairs, 18);
  assert.equal(evidence.summary.confirmedBefore, 275);
  assert.equal(evidence.summary.confirmedAfter, 275);
});

test('phase 9 adds a minimal multiple-match search candidate control', () => {
  assert.match(index, /id="curriculum-tree-search-results"/);
  assert.match(index, /aria-label="検索候補"/);
  assert.match(app, /getSearchMatches/);
  assert.match(app, /searchCandidateId/);
  assert.match(app, /searchResults\?\.addEventListener\('change'/);
  assert.match(app, /focusSearchCourse/);
});

test('phase 9 preserves preview, relation modes, enrollment, and rollback boundaries', () => {
  assert.match(app, /curriculumPreview/);
  assert.match(app, /relationMode/);
  assert.match(app, /myClasses/);
  assert.match(app, /completedClasses/);
  assert.match(app, /rollback|ロールバック/);
  assert.match(app, /fourYearSimulatorPlanV1|FOUR_YEAR_SIMULATOR_PLAN/);
});
