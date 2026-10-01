const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const app = fs.readFileSync('app.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const courses = JSON.parse(fs.readFileSync('courses.json', 'utf8'));

test('v1 simulator storage and placement logic remain available', () => {
  assert.match(app, /fourYearSimulatorPlanV1/);
  assert.match(app, /state\.simulatorPlan\.placements/);
  assert.match(app, /const placeSimulatorCourse/);
  assert.match(app, /const removeSimulatorCourse/);
});

test('palette has independent placement-state filtering', () => {
  assert.match(index, /id="sim-course-placement-filter"/);
  assert.match(index, /value="unplaced">未配置/);
  assert.match(index, /value="placed">配置済み/);
  assert.match(app, /simulatorPlacementFilter/);
  assert.match(app, /selectedPlacement === 'placed'/);
  assert.match(app, /selectedPlacement === 'unplaced'/);
});

test('palette cards open details while drag end suppresses the click', () => {
  assert.match(app, /data-sim-detail-course/);
  assert.match(app, /openSimulatorCourseDetail\(item\.dataset\.simDetailCourse\)/);
  assert.match(app, /item\.dataset\.simSkipClick = 'true'/);
  assert.match(app, /item\.dataset\.simDragging === 'true'/);
});

test('detail deletion only calls simulator placement removal', () => {
  assert.match(app, /data-sim-detail-remove/);
  assert.match(app, /removeSimulatorCourse\(course\.id\)/);
  assert.match(app, /closeSimulatorCourseDetail\(\)/);
  assert.doesNotMatch(app, /data-sim-detail-remove[\s\S]{0,500}commitStateChange/);
});

test('live course data is not given invented weekday or period fields', () => {
  const liveCourses = courses.filter((course) => course.method === 'ライブ映像科目');
  assert.equal(liveCourses.length, 14);
  for (const course of liveCourses) {
    assert.equal(Object.hasOwn(course, 'weekday'), false);
    assert.equal(Object.hasOwn(course, 'dayOfWeek'), false);
    assert.equal(Object.hasOwn(course, 'period'), false);
  }
});

test('v2 title is configured once and applied to the launch/title UI', () => {
  assert.match(index, /data-simulator-title="4年間履修シミュレーター v2"/);
  assert.match(app, /modal\.dataset\.simulatorTitle/);
  assert.match(app, /button\.textContent = simulatorTitle/);
});
