const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
const definition = JSON.parse(fs.readFileSync(path.join(root, 'curriculum-tree-layout.json'), 'utf8'));

test('phase 3 stores an official-map coordinate definition without shipping the PDF', () => {
  assert.equal(definition.source, 'curriculumtree2025_260310.pdf');
  assert.ok(definition.canvas.width >= 2000);
  assert.ok(definition.canvas.height >= 1500);
  assert.ok(definition.bands.some((band) => band.id === 'introduction'));
  assert.ok(definition.bands.some((band) => band.id === 'project'));
  assert.ok(definition.columns.length >= 6);
  assert.equal(fs.existsSync(path.join(root, 'curriculumtree2025_260310.pdf')), false);
});

test('phase 3 exposes stable pan, zoom, fit, fullscreen, and touch behaviours', () => {
  for (const id of ['curriculum-zoom-fit', 'curriculum-zoom-reset', 'curriculum-fullscreen', 'curriculum-graph-viewport']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(app, /curriculumState\.panX/);
  assert.match(app, /curriculumState\.panY/);
  assert.match(app, /fitCurriculumToViewport/);
  assert.match(app, /pinchState/);
  assert.match(app, /is-reference/);
  assert.match(style, /curriculum-tree-explorer-mode/);
  assert.match(style, /curriculum-official-band/);
});

test('phase 3 keeps the local preview gate and existing enrollment storage path', () => {
  assert.match(app, /curriculumPreview/);
  assert.match(app, /commitStateChange\(courseId, isRegistered \? 'DELETE' : 'REGISTER'\)/);
  assert.match(app, /fourYearSimulatorPlanV1/);
});
