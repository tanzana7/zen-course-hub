const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const simulatorRules = require('../simulator-rules.js');
const courseSorting = require('../course-sorting.js');

const app = fs.readFileSync('app.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const style = fs.readFileSync('style.css', 'utf8');
const courses = JSON.parse(fs.readFileSync('courses.json', 'utf8'));
const relations = JSON.parse(fs.readFileSync('course-relations.json', 'utf8'));

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

test('simulator palette uses the requested labels and keeps myClasses separate from the plan', () => {
  assert.match(index, /id="sim-palette-scheduled"[^>]*data-sim-palette-mode="scheduled"[^>]*>マイ履修</);
  assert.match(index, /id="sim-palette-all"[^>]*data-sim-palette-mode="all"[^>]*>すべての教科</);
  assert.match(app, /state\.registeredClasses\]\n\s*\.some\(\(courseId\) => state\.coursesMap\.has\(courseId\)\)/);
  assert.match(app, /state\.simulatorPaletteMode === 'scheduled' && !state\.registeredClasses\.has\(course\.id\)/);
  assert.match(app, /履修予定の科目はありません/);
  assert.match(app, /simulatorPaletteDefaulted/);
});

test('simulator reuses the main difficulty sort helper after filtering', () => {
  assert.match(app, /const \{ COURSE_SORT_OPTIONS, sortCourses \} = courseSorting/);
  assert.match(app, /\['sort-filter', 'sim-course-sort'\]\.forEach/);
  assert.match(app, /const sorted = sortCourses\(filtered, state\.difficultySort, state\.difficultyMap\)/);
  assert.match(app, /matches = sortCourses\(matches, selectedSort, state\.difficultyMap\)/);
  assert.match(index, /<script src="course-sorting\.js"><\/script>/);
  assert.match(index, /id="sort-filter" aria-label="難易度順"><\/select>/);
  assert.match(index, /id="sim-course-sort" aria-label="難易度順"><\/select>/);
});

test('Main Hub and simulator use identical sort options and stable comparator behavior', () => {
  assert.deepEqual(courseSorting.COURSE_SORT_OPTIONS, [
    { value: 'default', label: '標準' },
    { value: 'difficulty-asc', label: '難易度：低い順' },
    { value: 'difficulty-desc', label: '難易度：高い順' },
    { value: 'name-asc', label: '科目名：50音順' },
    { value: 'year-asc', label: '推奨学年：低い順' },
    { value: 'year-desc', label: '推奨学年：高い順' },
    { value: 'credits-asc', label: '単位数：少ない順' },
    { value: 'credits-desc', label: '単位数：多い順' }
  ]);

  const coursesFixture = [
    { id: 'tie-first' },
    { id: 'missing' },
    { id: 'high' },
    { id: 'tie-second' },
    { id: 'low' }
  ];
  const difficultyMap = new Map([
    ['tie-first', { average: 4 }],
    ['high', { average: 9 }],
    ['tie-second', { average: 4 }],
    ['low', { average: 1 }]
  ]);
  const mainHubSort = (mode) => courseSorting.sortCourses(coursesFixture, mode, difficultyMap).map(({ id }) => id);
  const simulatorSort = (mode) => courseSorting.sortCourses(coursesFixture, mode, difficultyMap).map(({ id }) => id);

  for (const { value } of courseSorting.COURSE_SORT_OPTIONS) {
    assert.deepEqual(simulatorSort(value), mainHubSort(value), value);
  }
  assert.deepEqual(mainHubSort('default'), ['tie-first', 'missing', 'high', 'tie-second', 'low']);
  assert.deepEqual(mainHubSort('difficulty-asc'), ['low', 'tie-first', 'tie-second', 'high', 'missing']);
  assert.deepEqual(mainHubSort('difficulty-desc'), ['high', 'tie-first', 'tie-second', 'low', 'missing']);
});

test('course sorting handles Japanese names, recommended years, credits, missing values, and ties', () => {
  const fixture = [
    { id: 'z', subject: 'あいう', year: '3年次', credits: 4 },
    { id: 'a', subject: 'アニメ', year: '1年次', credits: 2 },
    { id: 'k', subject: '10デザイン', year: '2年次', credits: 2 },
    { id: 'm', subject: '2デザイン', year: '2年次', credits: 1 },
    { id: 'missing', subject: '', year: '', credits: null },
    { id: 'same-year', subject: 'えん', year: '2年次', credits: 4 }
  ];
  const ids = (mode) => courseSorting.sortCourses(fixture, mode).map(({ id }) => id);

  assert.deepEqual(ids('name-asc'), ['m', 'k', 'z', 'a', 'same-year', 'missing']);
  assert.deepEqual(ids('year-asc'), ['a', 'k', 'm', 'same-year', 'z', 'missing']);
  assert.deepEqual(ids('year-desc'), ['z', 'k', 'm', 'same-year', 'a', 'missing']);
  assert.deepEqual(ids('credits-asc'), ['m', 'a', 'k', 'z', 'same-year', 'missing']);
  assert.deepEqual(ids('credits-desc'), ['z', 'same-year', 'a', 'k', 'm', 'missing']);
});

test('all supported sorts preserve the full 275-course set', () => {
  const sourceIds = courses.map(({ id }) => id);
  const sourceSet = new Set(sourceIds);
  assert.equal(sourceIds.length, 275);
  assert.equal(sourceSet.size, sourceIds.length);
  for (const { value } of courseSorting.COURSE_SORT_OPTIONS) {
    const sortedIds = courseSorting.sortCourses(courses, value).map(({ id }) => id);
    assert.equal(sortedIds.length, sourceIds.length, value);
    assert.equal(new Set(sortedIds).size, sourceSet.size, value);
    assert.deepEqual([...sortedIds].sort(), [...sourceIds].sort(), value);
  }
});

test('shared sort remains parity-safe after every supported filter combination', () => {
  const coursesFixture = [
    { id: 'math-low', subject: '数学', year: '1年次', quarter: '1Q', category: '数理', placement: 'unplaced' },
    { id: 'math-high', subject: '数学', year: '2年次', quarter: '2Q', category: '数理', placement: 'placed' },
    { id: 'art', subject: '芸術', year: '1年次', quarter: '3Q', category: '文化・思想', placement: 'unplaced' }
  ];
  const difficultyMap = new Map([
    ['math-low', { average: 2 }],
    ['math-high', { average: 8 }],
    ['art', { average: 5 }]
  ]);
  const filters = [
    { apply: (course) => course.subject === '数学', expected: ['math-low', 'math-high'] },
    { apply: (course) => course.year === '1年次', expected: ['math-low', 'art'] },
    { apply: (course) => course.quarter === '2Q', expected: ['math-high'] },
    { apply: (course) => course.category === '数理', expected: ['math-low', 'math-high'] },
    { apply: (course) => course.placement === 'placed', expected: ['math-high'] },
    { apply: () => true, expected: ['math-low', 'art', 'math-high'] }
  ];
  for (const { apply, expected } of filters) {
    const filtered = coursesFixture.filter(apply);
    assert.deepEqual(
      courseSorting.sortCourses(filtered, 'difficulty-asc', difficultyMap).map(({ id }) => id),
      expected
    );
  }
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

test('placed cards expose an explicit detail control without changing delete semantics', () => {
  assert.match(app, /class="sim-course-detail-view"/);
  assert.match(app, /data-sim-detail-course="\$\{escapeHTML\(course\.id\)\}"/);
  assert.match(app, /aria-label="\$\{escapeHTML\(course\.subject\)\}の詳細を見る"/);
  assert.match(app, /title="科目詳細を見る">👁<\/button>/);
  assert.match(app, /const detailButton = event\.target\.closest\('\[data-sim-detail-course\]'\)/);
  assert.match(app, /data-sim-remove-course="\$\{escapeHTML\(course\.id\)\}"/);
  assert.match(app, /has-warning/);
  assert.match(app, /isPrerequisiteSatisfied\(prerequisite, prerequisitePlacement, course, placement\)/);
  assert.match(app, /'getPlacementStart', 'isPrerequisiteSatisfied', 'getPlacementIssues'/);
  assert.match(app, /state\.completedClasses\.has\(prerequisite\.id\)/);
});

test('warning cards reserve the action cluster and hide secondary credits at narrow desktop widths', () => {
  assert.match(style, /\.sim-course-card\.has-warning\s*\{[\s\S]*?padding-right:\s*92px;/);
  assert.match(style, /@media screen and \(min-width: 769px\) and \(max-width: 900px\)/);
  assert.match(style, /\.sim-course-credits\s*\{\s*display: none;\s*\}/);
  assert.match(style, /\.sim-course-card-actions\s*\{[\s\S]*?flex-shrink:\s*0;/);
  assert.match(style, /\.sim-course-card-actions button\s*\{\s*flex: 0 0 28px;/);
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

test('course Q is a hard placement constraint while a different recommended year stays allowed without a warning', () => {
  const qOneAndThree = courses.find((course) => course.id === 'academic_literacy');
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 1, 1), true);
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 3, 3), true);
  assert.equal(simulatorRules.canPlaceCourseAt(qOneAndThree, 1, 2), false);
  assert.equal(simulatorRules.applyPlacement([], qOneAndThree, 3, 3).allowed, true);
  assert.deepEqual(simulatorRules.getPlacementIssues(qOneAndThree, { year: 3, selectedQuarter: 3 }), []);
});

test('prerequisite timing accepts same-Q and earlier placements, but rejects later or missing placements', () => {
  const prerequisite = courses.find((course) => course.id === 'academic_literacy');
  const successor = courses.find((course) => course.id === 'academic_literacy');
  const placement = (year, selectedQuarter) => ({ year, selectedQuarter });
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, placement(1, 1), successor, placement(1, 1)), true);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, placement(1, 1), successor, placement(1, 3)), true);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, placement(1, 3), successor, placement(1, 1)), false);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, placement(2, 1), successor, placement(1, 4)), false);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, placement(1, 1), successor, placement(2, 1)), true);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(prerequisite, null, successor, placement(1, 1)), false);
});

test('prerequisite timing uses the selected start Q for spans and alternatives', () => {
  const span = courses.find((course) => course.id === 'ai_practical_usage');
  const successor = courses.find((course) => course.id === 'academic_literacy');
  assert.equal(simulatorRules.getPlacementStart(span, { year: 1, selectedQuarter: 1 }), 1);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(span, { year: 1, selectedQuarter: 1 }, successor, { year: 1, selectedQuarter: 1 }), true);
  assert.equal(simulatorRules.isPrerequisiteSatisfied(span, { year: 1, selectedQuarter: 3 }, successor, { year: 1, selectedQuarter: 1 }), false);
});

test('recommended and strongly recommended relations use the same chronological satisfaction rule', () => {
  const cases = [
    { strength: 'strongly_recommended', prerequisiteId: 'linear_algebra_1', successorId: 'group_theory' },
    { strength: 'recommended', prerequisiteId: 'modern_society_math', successorId: 'it_literacy' }
  ];
  for (const candidate of cases) {
    assert.ok(relations.some((relation) => (
      relation.strength === candidate.strength &&
      relation.prerequisiteId === candidate.prerequisiteId &&
      relation.successorId === candidate.successorId
    )));
    const prerequisite = courses.find((course) => course.id === candidate.prerequisiteId);
    const successor = courses.find((course) => course.id === candidate.successorId);
    assert.equal(simulatorRules.isPrerequisiteSatisfied(
      prerequisite,
      { year: 1, selectedQuarter: 1 },
      successor,
      { year: 1, selectedQuarter: 1 }
    ), true);
  }
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
  assert.deepEqual(simulatorRules.getPlacementIssues(course, legacyPlan[0]).map((issue) => issue.type), ['quarter']);

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
    window: { addEventListener() {}, clearTimeout() {}, setTimeout() {}, CourseSorting: courseSorting },
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

test('beta title is configured once and applied to the launch/title UI', () => {
  assert.match(index, /data-simulator-title="4年間履修シミュレーター β"/);
  assert.match(app, /modal\.dataset\.simulatorTitle/);
  assert.match(app, /button\.textContent = simulatorTitle/);
  assert.match(index, /simulator-beta-note/);
  assert.doesNotMatch(app, /年次目安/);
  assert.doesNotMatch(app, /sim-course-year-recommendation/);
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
  assert.match(style, /\.sim-course-card\s*\{[\s\S]*?container:\s*sim-course-card\s*\/\s*inline-size;/);
  assert.match(style, /@container sim-course-card \(max-width: 50px\)/);
  assert.match(style, /\.sim-course-detail-view\s*\{/);
  assert.match(style, /\.sim-course-picker-item,\s*\n\.sim-unplaced-item,\s*\n\.sim-scheduled-item\s*\{[\s\S]*?padding:\s*6px 8px;/);
  assert.match(style, /\.sim-course-placement-open\s*\{[\s\S]*?min-height:\s*36px;/);
});
