const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const map = require('../curriculum-map.js');
const access = require('../curriculum-config.js');
const definition = require('../curriculum-tree-layout.json');
const courses = require('../courses.json');

test('independent map release gate is enabled on public hosts', () => {
  assert.equal(access.publicEnabled, true);
  for (const hostname of ['example.com', 'zencoursehub.netlify.app', 'foo.localhost']) {
    assert.equal(access.canAccess({ hostname, search: '', hash: '' }), true);
  }
  assert.equal(access.canAccess({ hostname: '127.0.0.1', search: '?curriculumPreview=1' }), true);
  assert.equal(access.canAccess({ hostname: 'localhost', search: '' }), true);
});

test('display layout contains all 275 courses, eliminates partial overlap and preserves source coordinates', () => {
  const before = JSON.stringify(definition);
  const layout = map.buildLayout(definition, courses);
  assert.equal(layout.positions.length, 275);
  assert.equal(new Set(layout.positions.map((box) => box.id)).size, 275);
  const prominent = layout.positions.filter((box) => box.prominence === 'prominent');
  assert.ok(prominent.length > 0);
  assert.ok(prominent.every((box) => box.width > 224 && box.height > 128));
  assert.ok(
    prominent.every((box) => {
      const course = courses.find((item) => item.id === box.id);
      const placement = definition.coursePlacements.find((item) => item.courseId === box.id);
      return course.category === '必修' || placement.category === '卒業プロジェクト';
    }),
  );
  for (let i = 0; i < layout.positions.length; i++) {
    const box = layout.positions[i];
    assert.ok(box.width >= 200 && box.height >= 120);
    assert.ok(
      box.x >= 0 && box.y >= 0 && box.x + box.width <= layout.width && box.y + box.height <= layout.height,
    );
    for (let j = i + 1; j < layout.positions.length; j++)
      assert.equal(map.intersects(box, layout.positions[j]), false, `${box.id}/${layout.positions[j].id}`);
  }
  assert.equal(JSON.stringify(definition), before);
});

test('every course in all four years can be centered at readable 100 percent', () => {
  const layout = map.buildLayout(definition, courses);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    for (const box of layout.positions) {
      const camera = map.centerOn(box, viewport);
      assert.equal(camera.scale, 1);
      assert.ok(camera.x + box.x >= 0 && camera.x + box.x + box.width <= viewport.width);
      assert.ok(camera.y + box.y >= 0 && camera.y + box.y + box.height <= viewport.height);
    }
  }
});

test('initial camera starts at the leftmost field of the first year at 100 percent', () => {
  const layout = map.buildLayout(definition, courses);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const camera = map.initialCamera(layout, viewport);
    const centerX = (viewport.width / 2 - camera.x) / camera.scale;
    const centerY = (viewport.height / 2 - camera.y) / camera.scale;
    assert.equal(camera.scale, 1);
    // マップの起点（1年次側の先頭＝左端の列）が中央に来る。左端は切り取られない。
    const startField = layout.fields[0];
    assert.ok(centerX >= startField.x && centerX < startField.x + startField.width);
    assert.ok(centerY >= layout.years[0].y && centerY < layout.years[0].y + layout.years[0].height);
    assert.ok(
      layout.positions.some(
        (box) =>
          box.region === 'year-1' &&
          box.x <= centerX + viewport.width / 2 &&
          box.x + box.width >= centerX - viewport.width / 2 &&
          box.y <= centerY + viewport.height / 2 &&
          box.y + box.height >= centerY - viewport.height / 2,
      ),
    );
  }
});

test('cursor anchored zoom preserves its world point and clamps extremes', () => {
  const camera = { scale: 1, x: -2100, y: -3400 },
    anchor = { x: 200, y: 300 };
  for (const scale of [0.05, 0.7, 1.6, 2.4]) {
    const next = map.zoomAt(camera, scale, anchor);
    assert.ok(Math.abs((anchor.x - next.x) / next.scale - (anchor.x - camera.x)) < 0.00001);
    assert.ok(Math.abs((anchor.y - next.y) / next.scale - (anchor.y - camera.y)) < 0.00001);
  }
  assert.equal(map.zoomAt(camera, 10, anchor).scale, 2.4);
});

test('explicit fit includes the complete map at desktop and phone sizes', () => {
  const layout = map.buildLayout(definition, courses);
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const camera = map.fitMap(layout, viewport);
    assert.ok(camera.x >= 0 && camera.y >= 0);
    assert.ok(camera.x + layout.width * camera.scale <= viewport.width);
    assert.ok(camera.y + layout.height * camera.scale <= viewport.height);
  }
});

test('map rejects a missing placement instead of inventing course coordinates', () => {
  assert.throws(() =>
    map.buildLayout({ ...definition, coursePlacements: definition.coursePlacements.slice(1) }, courses),
  );
});

test('standalone runtime uses shared enrollment rollback and safe text/link rendering', () => {
  const source = fs.readFileSync('curriculum-map.js', 'utf8');
  assert.match(source, /utils.saveEnrollmentState/);
  assert.doesNotMatch(source, /innerHTML|localStorage\.clear|fourYearSimulatorPlanV1/);
  assert.match(source, /utils.sanitizeExternalUrl/);
  assert.match(source, /textContent = text/);
});

test('standalone map exposes separate planned and completed enrollment actions', () => {
  const html = fs.readFileSync('curriculum.html', 'utf8');
  const source = fs.readFileSync('curriculum-map.js', 'utf8');
  assert.match(html, /ホームに戻る/);
  assert.match(html, /履修予定に追加/);
  assert.match(source, /履修予定に追加/);
  assert.match(source, /履修済みに追加/);
  assert.match(source, /changeEnrollment/);
  assert.match(source, /utils\.saveEnrollmentState\(storage, keys, nextRegistered, nextCompleted\)/);
  assert.doesNotMatch(source, /fourYearSimulatorPlanV1/);
});

test('map drag offers both planned and completed drop zones', () => {
  const html = fs.readFileSync('curriculum.html', 'utf8').replace(/\s+/g, ' ');
  const css = fs.readFileSync('curriculum-map.css', 'utf8');
  const source = fs.readFileSync('curriculum-map.js', 'utf8');
  // Both zones exist with distinct targets and labels.
  assert.match(
    html,
    /<div id="map-drop-target" class="map-drop-target" hidden role="region" aria-label="履修予定に追加" data-enrollment-target="registered" > 履修予定に追加 <\/div>/,
  );
  assert.match(
    html,
    /<div id="map-drop-completed" class="map-drop-target" hidden role="region" aria-label="履修済みに追加" data-enrollment-target="completed" > 履修済みに追加 <\/div>/,
  );
  assert.match(css, /#map-drop-target[\s\S]*?#map-drop-completed/);
  assert.match(css, /#map-drop-completed[\s\S]*?#5362ac/);
  // Drag lifecycle shows and hides every zone, and each zone's drop follows
  // its own enrollment target through the existing toggle.
  assert.match(source, /querySelectorAll\('\[data-enrollment-target\]'\)/);
  assert.match(source, /setDropTargetsHidden\(false\)/);
  assert.match(source, /changeEnrollment\(id, dropTarget\.dataset\.enrollmentTarget\)/);
});
