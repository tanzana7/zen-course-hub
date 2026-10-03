const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
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
  assert.doesNotMatch(app, /cleanupSimulatorPlan\(\)/);
});

test('every catalog Q value parses, while unrelated numbers and unknown labels fail closed', () => {
  const values = [...new Set(courses.map((course) => course.quarter))];
  assert.equal(courses.length, 275);
  assert.equal(values.length, 9);
  for (const course of courses) {
    assert.ok(simulatorRules.getQuarterInfo(course).options.length, `${course.id}: ${course.quarter}`);
  }
  assert.deepEqual(simulatorRules.getQuarterInfo({ quarter: '1Q, 3Q' }).options.map((option) => option.start), [1, 3]);
  assert.deepEqual(simulatorRules.getQuarterInfo({ quarter: '1-2Q, 3-4Q' }).options.map(({ start, end }) => [start, end]), [[1, 2], [3, 4]]);
  assert.deepEqual(simulatorRules.getQuarterInfo({ quarter: '通期' }).options.map(({ start, end }) => [start, end]), [[1, 4]]);
  for (const quarter of ['2027年度 1Q', '2単位 1Q', 'Q1', '1-3Q', '1Q, 不明', '', null]) {
    const course = { quarter };
    assert.deepEqual(simulatorRules.getQuarterInfo(course).options, [], String(quarter));
    assert.equal(simulatorRules.canPlaceCourseAt(course, 1, 1), false);
  }
});

test('failed add, move, delete, and reset saves preserve the previous plan', () => {
  const course = courses.find((item) => item.id === 'academic_literacy');
  const key = 'fourYearSimulatorPlanV1';
  const initial = { version: 1, placements: [{ courseId: course.id, year: 1, selectedQuarter: 1 }] };
  let saved = JSON.stringify(initial);
  const storage = {
    getItem: () => saved,
    setItem: () => { throw new Error('QuotaExceededError'); }
  };
  const add = { version: 1, placements: [...initial.placements, { courseId: 'old_course_123', year: 2, selectedQuarter: 1 }] };
  const move = { version: 1, placements: simulatorRules.applyPlacement(initial.placements, course, 2, 3).placements };
  const remove = { version: 1, placements: [] };
  const reset = simulatorRules.createEmptyPlan();
  for (const candidate of [add, move, remove, reset]) {
    let current = initial;
    const result = simulatorRules.savePlanChange(storage, key, candidate);
    if (result.saved) current = candidate;
    assert.equal(result.saved, false);
    assert.match(result.error.message, /QuotaExceededError/);
    assert.equal(current, initial);
    assert.equal(storage.getItem(key), saved);
  }
  assert.match(app, /if \(!saveSimulatorPlan\(nextPlan\)\)/);
  assert.match(app, /state\.simulatorPlan = nextPlan;/);
  assert.match(app, /return commitSimulatorPlan\(\{ \.\.\.state\.simulatorPlan, placements: result\.placements \}\)/);
  assert.match(app, /return commitSimulatorPlan\(\{ \.\.\.state\.simulatorPlan, placements \}\)/);
  assert.match(app, /commitSimulatorPlan\(simulatorRules\.createEmptyPlan\(\)\)/);
});

test('unknown saved IDs are retained for explicit removal, not silently cleaned up', () => {
  const key = 'fourYearSimulatorPlanV1';
  const initial = { version: 1, placements: [
    { courseId: 'academic_literacy', year: 1, selectedQuarter: 1 },
    { courseId: 'old_course_123', year: 2, selectedQuarter: 1 }
  ] };
  let saved = JSON.stringify(initial);
  const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
  assert.equal(JSON.parse(storage.getItem(key)).placements.length, 2);
  assert.doesNotMatch(app, /cleanupSimulatorPlan\(\)/);
  assert.match(app, /!getCourse\(placement\.courseId\)/);
  assert.match(app, /info\.textContent = `科目ID:/);
  assert.match(app, /removeSimulatorCourse\(removeButton\.dataset\.simRemoveCourse\)/);
  const withoutUnknown = { ...initial, placements: initial.placements.filter((item) => item.courseId !== 'old_course_123') };
  assert.equal(simulatorRules.savePlanChange(storage, key, withoutUnknown).saved, true);
  assert.deepEqual(JSON.parse(saved).placements, withoutUnknown.placements);
  assert.equal(simulatorRules.savePlanChange(storage, key, simulatorRules.createEmptyPlan()).saved, true);
  assert.deepEqual(JSON.parse(saved).placements, []);
});

test('missing rules disables only simulator entry while main Hub bootstrap remains reachable', () => {
  let onReady;
  let fetchCount = 0;
  const document = {
    addEventListener: (name, callback) => { if (name === 'DOMContentLoaded') onReady = callback; },
    getElementById: () => null,
    querySelectorAll: () => []
  };
  vm.runInNewContext(app, {
    document,
    window: { addEventListener() {}, clearTimeout() {}, setTimeout() {} },
    localStorage: { getItem: () => null },
    fetch: () => { fetchCount += 1; return new Promise(() => {}); },
    console, URL, Map, Set
  });
  assert.doesNotThrow(() => onReady());
  assert.equal(fetchCount, 3); // courses, optional difficulty, optional relations
  assert.match(app, /const simulatorAvailable = Boolean\(simulatorRules/);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /if \(simulatorAvailable\) renderSimulator\(\)/);
  assert.match(index, /id="simulator-unavailable"[^>]*role="alert"/);
  assert.match(index, /id="simulator-unknown-courses"/);
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

test('quarter card layer keeps the header drop target separate and resolves card drops to its parent quarter', () => {
  assert.match(app, /const resolveSimulatorDropCell = \(target\) =>/);
  assert.match(app, /const directCell = target\.closest\('\[data-sim-drop-quarter\]'\)/);
  assert.match(app, /const card = target\.closest\('\[data-sim-drag-course\]'\)/);
  assert.match(app, /card\.dataset\.simCardYear = String\(year\)/);
  assert.match(app, /card\.dataset\.simCardQuarter = String\(assignment\.start\)/);
  assert.equal((app.match(/resolveSimulatorDropCell\(event\.target\)/g) || []).length, 4);
  assert.match(app, /class="simulator-quarter-card-layer"/);
});

test('simulator polish keeps dynamic rows, compact cards, and usable palette controls', () => {
  const style = fs.readFileSync('style.css', 'utf8');
  assert.match(app, /repeat\(\$\{laneCount\}, minmax\(34px, auto\)\)/);
  assert.match(app, /24px repeat\(\$\{laneCount\}/);
  assert.match(app, /has-inline-issue/);
  assert.match(style, /\.simulator-quarter-card-layer\s*\{/);
  assert.match(style, /\.simulator-quarter-header\s*\{[\s\S]*?height:\s*24px;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(style, /\.sim-course-card\s*\{[\s\S]*?min-height:\s*34px;[\s\S]*?max-height:\s*48px;/);
  assert.match(style, /\.sim-course-card\s*\{[\s\S]*?height:\s*36px;/);
  assert.match(style, /\.sim-course-card-title\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
  assert.match(style, /\.sim-course-picker-item,\s*\n\.sim-unplaced-item,\s*\n\.sim-scheduled-item\s*\{[\s\S]*?padding:\s*6px 8px;/);
  assert.match(style, /\.sim-course-placement-open\s*\{[\s\S]*?min-height:\s*36px;/);
});
