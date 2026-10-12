const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const definition = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));
const courses = JSON.parse(fs.readFileSync(path.join(root, 'courses.json'), 'utf8'));
const courseIds = new Set(courses.map((course) => course.id));

test('phase 4 records the PDF rendering and visual inspection contract', () => {
  assert.equal(definition.version, 2);
  assert.equal(definition.sourceConfidence, 'mixed');
  assert.equal(definition.pdfPage.pageCount, 1);
  assert.equal(definition.pdfPage.renderDpi, 72);
  assert.deepEqual(definition.pdfPage.inspection, {
    tileColumns: 5,
    tileRows: 5,
    tileSizePx: 1950,
    stepPx: 1800,
    overlapPx: 150,
    method: 'visual tile inspection',
    highResolution: {
      renderDpi: 150,
      regions: 16,
      method: 'direct PDF regional render, visual inspection'
    }
  });
  assert.deepEqual(definition.canvas, { width: 2400, height: 2388 });
  assert.deepEqual(definition.legend.creditColors.map((entry) => entry.credits), [1, 2, 4]);
});

test('phase 4 placements are unique, normalized, and mapped to existing courses', () => {
  assert.ok(definition.coursePlacements.length >= 80);
  const seen = new Set();
  for (const placement of definition.coursePlacements) {
    assert.ok(!seen.has(placement.courseId), `duplicate placement: ${placement.courseId}`);
    seen.add(placement.courseId);
    assert.ok(courseIds.has(placement.courseId), `unknown course: ${placement.courseId}`);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Number.isFinite(placement[key]) && placement[key] >= 0 && placement[key] <= 1,
        `${placement.courseId}.${key} must be normalized`);
    }
    assert.equal(placement.confidence, 'confirmed');
    assert.match(placement.verificationMethod, /^visual-tile-(72|150)dpi$/);
  }
});

test('phase 4 keeps PDF-only subjects explicit instead of inventing IDs', () => {
  assert.ok(definition.pdfOnlySubjects.includes('日本文学Ⅱ'));
  for (const subject of definition.pdfOnlySubjects) assert.equal(typeof subject, 'string');
});

test('phase 4 implementation consumes placement confidence and the PDF legend', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  assert.match(app, /coursePlacements/);
  assert.match(app, /officialConfidence/);
  assert.match(app, /visual-tile-72dpi|structure-fallback/);
  assert.match(index, /curriculum-map-legend/);
  assert.match(css, /curriculum-credit-key/);
  assert.match(css, /is-provisional/);
});
