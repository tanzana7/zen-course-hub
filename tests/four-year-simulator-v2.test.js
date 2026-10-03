const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const simulatorRules = require('../simulator-rules.js');

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

test('palette exposes separate detail and placement controls while retaining drag', () => {
  assert.match(app, /data-sim-detail-course/);
  assert.match(app, /openSimulatorCourseDetail\(detailButton\.dataset\.simDetailCourse\)/);
  assert.match(app, /data-sim-placement-course/);
  assert.match(app, /openSimulatorPlacementPicker\(placementButton\.dataset\.simPlacementCourse, placementButton\)/);
  assert.match(app, /item\.dataset\.simSkipClick = 'true'/);
  assert.match(app, /card\?\.dataset\.simDragging === 'true'/);
  assert.doesNotMatch(app, /sim-mobile-place-button/);
});

test('placement destinations are created on demand in an accessible native dialog', () => {
  assert.match(index, /<dialog id="simulator-placement-dialog"/);
  assert.match(index, /aria-labelledby="simulator-placement-title"/);
  assert.match(app, /optionsContainer\.innerHTML = \[1, 2, 3, 4\]/);
  assert.match(app, /dialog\.showModal\(\)/);
  assert.match(app, /addEventListener\('cancel'/);
  assert.match(app, /closeSimulatorPlacementPicker\(\{ courseId \}\)/);
});

test('simulator and course detail expose dialog semantics and focus restoration', () => {
  assert.match(index, /id="simulator-modal"[^>]*role="dialog" aria-modal="true"/);
  assert.match(index, /id="simulator-course-detail"[^>]*role="dialog" aria-modal="true"/);
  assert.match(app, /simulatorTriggerElement = button/);
  assert.match(app, /title\?\.focus\(\)/);
  assert.match(app, /focusElement\(simulatorTriggerElement \|\| button\)/);
  assert.match(app, /trapDialogTab\(event/);
});

test('course Q is a hard placement constraint while a different recommended year stays allowed', () => {
  const qOneAndThree = courses.find((course) => course.id === 'academic_literacy');
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 1, 1), true);
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 3, 3), true);
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 1, 2), false);
  assert.equal(simulatorRules.applyPlacement([], qOneAndThree, 3, 3).allowed, true);
  assert.deepEqual(simulatorRules.getPlacementIssues(qOneAndThree, { year: 3, selectedQuarter: 3 }), [
    { type: 'year', recommendedYear: 1, message: '1年次推奨（現在は3年）' }
  ]);
});

test('multiple-Q, span alternatives, and full-year courses use only their actual start Q', () => {
  const multiple = courses.find((course) => course.id === 'academic_literacy');
  const alternatives = courses.find((course) => course.id === 'ai_practical_usage');
  const fullYear = courses.find((course) => course.quarter === '通期');
  assert.deepEqual(simulatorRules.getQuarterInfo(multiple).options.map((option) => option.start), [1, 3]);
  assert.deepEqual(simulatorRules.getQuarterInfo(alternatives).options.map((option) => option.start), [1, 3]);
  assert.equal(simulatorRules.canPlaceCourseAt(alternatives, 2, 1), true);
  assert.equal(simulatorRules.canPlaceCourseAt(alternatives, 2, 2), false);
  assert.deepEqual(simulatorRules.getQuarterInfo(fullYear).options.map(({ start, end }) => ({ start, end })), [{ start: 1, end: 4 }]);
  assert.equal(simulatorRules.canPlaceCourseAt(fullYear, 4, 2), false);
});

test('placement rejects an invalid move without changing legacy data and prevents duplicate rows', () => {
  const course = courses.find((item) => item.id === 'academic_literacy');
  const legacyPlan = [{ courseId: course.id, year: 2, selectedQuarter: 2 }];
  const rejected = simulatorRules.applyPlacement(legacyPlan, course, 2, 2);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.placements, legacyPlan);
  assert.deepEqual(simulatorRules.getPlacementIssues(course, legacyPlan[0]).map((issue) => issue.type), ['quarter', 'year']);

  const moved = simulatorRules.applyPlacement(legacyPlan, course, 3, 3);
  assert.equal(moved.allowed, true);
  assert.equal(moved.placements.length, 1);
  assert.deepEqual(moved.placements[0], { courseId: course.id, year: 3, selectedQuarter: 3 });
  assert.match(app, /return placement;/);
});

test('reset writes only the simulator storage key and keeps the v1 schema', () => {
  const values = new Map([
    ['fourYearSimulatorPlanV1', JSON.stringify({ version: 1, placements: [{ courseId: 'academic_literacy', year: 1, selectedQuarter: 1 }] })],
    ['myClasses', '["it_literacy"]'],
    ['completedClasses', '["economics_intro"]'],
    ['courseFilterPreferences', '{"excludePixiv":true}']
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
  const unaffected = ['myClasses', 'completedClasses', 'courseFilterPreferences'].map((key) => storage.getItem(key));
  const emptyPlan = simulatorRules.resetPlanStorage(storage, 'fourYearSimulatorPlanV1');
  assert.deepEqual(emptyPlan, { version: 1, placements: [] });
  assert.deepEqual(JSON.parse(storage.getItem('fourYearSimulatorPlanV1')), emptyPlan);
  assert.deepEqual(['myClasses', 'completedClasses', 'courseFilterPreferences'].map((key) => storage.getItem(key)), unaffected);
  assert.match(index, /id="simulator-reset-dialog"/);
  assert.match(index, /4年間の計画をすべて削除します/);
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
