import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import simulatorRules from '../simulator-rules.js';
import graduationEngine from '../graduation-requirements.js';

const courses = JSON.parse(fs.readFileSync(new URL('../courses.json', import.meta.url), 'utf8'));
const definition = JSON.parse(fs.readFileSync(new URL('../graduation-requirements.json', import.meta.url), 'utf8'));
const courseIds = new Set(courses.map((course) => course.id));

test('Simulator projection keeps unknown saved IDs visible but excludes them from analyzer input', () => {
  const placements = [
    { courseId: 'academic_literacy', year: 1, selectedQuarter: 1 },
    { courseId: 'unknown-legacy-course', year: 2, selectedQuarter: 1 },
    { courseId: 'unknown-legacy-course', year: 2, selectedQuarter: 1 }
  ];
  assert.deepEqual(simulatorRules.getKnownSimulatorCourseIds(placements, courseIds), ['academic_literacy']);
  assert.deepEqual(simulatorRules.getUnknownSimulatorCourseIds(placements, courseIds), ['unknown-legacy-course']);
});

test('Simulator projection deduplicates completed and placed course IDs', () => {
  const ids = simulatorRules.buildGraduationProjectionCourseIds(
    ['academic_literacy'],
    [{ courseId: 'academic_literacy', year: 1, selectedQuarter: 1 }, { courseId: 'it_literacy', year: 1, selectedQuarter: 1 }],
    courseIds
  );
  assert.deepEqual(ids, ['academic_literacy', 'it_literacy']);
});

test('Normal Hub planned courses are not included in Simulator projection input', () => {
  const completed = ['academic_literacy'];
  const simulatorPlan = [{ courseId: 'it_literacy', year: 1, selectedQuarter: 1 }];
  const normalHubPlanned = 'economics_intro';
  const projected = simulatorRules.buildGraduationProjectionCourseIds(completed, simulatorPlan, courseIds);
  assert.deepEqual(projected, ['academic_literacy', 'it_literacy']);
  assert.equal(projected.includes(normalHubPlanned), false);
});

test('Completed-only analysis and Simulator projection use the shared analyzer', () => {
  const current = graduationEngine.analyzeGraduationRequirements(['academic_literacy'], courses, definition);
  const projectedIds = simulatorRules.buildGraduationProjectionCourseIds(
    ['academic_literacy'],
    [{ courseId: 'it_literacy', year: 1, selectedQuarter: 1 }],
    courseIds
  );
  const projected = graduationEngine.analyzeGraduationRequirements(projectedIds, courses, definition);
  assert.equal(current.valid, true);
  assert.equal(projected.valid, true);
  assert.equal(current.totalCredits.countedCredits, 2);
  assert.equal(projected.totalCredits.countedCredits, 4);
  assert.equal(projected.introduction.credits, 4);
});

test('Unknown Simulator IDs never make an otherwise valid projection fail closed', () => {
  const projectedIds = simulatorRules.buildGraduationProjectionCourseIds(
    [],
    [{ courseId: 'academic_literacy', year: 1, selectedQuarter: 1 }, { courseId: 'unknown-legacy-course', year: 2, selectedQuarter: 1 }],
    courseIds
  );
  const result = graduationEngine.analyzeGraduationRequirements(projectedIds, courses, definition);
  assert.deepEqual(projectedIds, ['academic_literacy']);
  assert.equal(result.valid, true);
});

test('Social connection projection preserves actual credits and applies the shared cap', () => {
  const socialIds = courses.filter((course) => course.tag === '社会接続').slice(0, 12).map((course) => course.id);
  const result = graduationEngine.analyzeGraduationRequirements(socialIds, courses, definition);
  assert.equal(result.valid, true);
  assert.equal(result.socialConnection.actualCredits >= result.socialConnection.countedCredits, true);
  assert.equal(result.socialConnection.countedCredits <= 10, true);
});

test('Industry history remains a world-understanding sub-requirement', () => {
  const result = graduationEngine.analyzeGraduationRequirements(['it_industry_history'], courses, definition);
  assert.equal(result.valid, true);
  assert.equal(result.worldUnderstanding.industryHistory.credits, 2);
  assert.equal(result.worldUnderstanding.industryHistory.targetCredits, 2);
  assert.equal(result.worldUnderstanding.targetCredits, 26);
});

test('Project practice is evaluated by the shared explicit course mapping', () => {
  const result = graduationEngine.analyzeGraduationRequirements(['project_practice'], courses, definition);
  assert.equal(result.valid, true);
  assert.equal(result.projectPractice.credits, 4);
  assert.equal(result.projectPractice.targetCredits, 4);
});

test('Invalid graduation definition disables projection without changing placement data', () => {
  const broken = structuredClone(definition);
  broken.requirements.totalCredits.targetCredits = -1;
  const placement = { courseId: 'academic_literacy', year: 1, selectedQuarter: 1 };
  const ids = simulatorRules.buildGraduationProjectionCourseIds([], [placement], courseIds);
  const validation = graduationEngine.validateRequirementsDefinition(broken);
  const result = graduationEngine.analyzeGraduationRequirements(ids, courses, broken);
  assert.equal(validation.valid, false);
  assert.equal(result.valid, false);
  assert.deepEqual(placement, { courseId: 'academic_literacy', year: 1, selectedQuarter: 1 });
});

test('App uses the shared projection helper and separates current and four-year labels', () => {
  const app = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(app, /buildGraduationProjectionCourseIds/);
  assert.match(app, /getUnknownSimulatorCourseIds/);
  assert.match(app, /plannedLabel: '4年計画完了時'/);
  assert.match(app, /履修済み＋シミュレーター計画/);
  assert.match(index, /id="simulator-graduation-summary"/);
  assert.match(index, /id="simulator-graduation-details-content"/);
  assert.match(index, /卒業見込み/);
});
