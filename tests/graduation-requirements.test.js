import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const courses = readJson('courses.json');
const definition = readJson('graduation-requirements.json');
import engine from '../graduation-requirements.js';

test('産業史要件は明示された科目IDの単位数で判定する', () => {
  const history = courses.filter((course) => definition.requirements.industryHistory.courseIds.includes(course.id));
  assert.equal(history.length, 4);
  assert.equal(history.find((course) => course.subject === 'IT産業史')?.credits, 2);
  const analysis = engine.analyzeGraduationRequirements(history.map((course) => course.id), courses, definition);
  assert.equal(analysis.worldUnderstanding.industryHistory.credits, 8);
  assert.equal(analysis.worldUnderstanding.industryHistory.satisfied, true);
});

test('重複した選択IDは単位へ一度だけ加算する', () => {
  const history = courses.find((course) => course.subject === 'IT産業史');
  const once = engine.analyzeGraduationRequirements([history.id], courses, definition);
  const duplicated = engine.analyzeGraduationRequirements([history.id, history.id], courses, definition);
  assert.equal(once.totalCredits.actualCredits, duplicated.totalCredits.actualCredits);
  assert.equal(once.worldUnderstanding.industryHistory.credits, duplicated.worldUnderstanding.industryHistory.credits);
});

test('プロジェクト実践は定義ファイルの指定IDと単位数で判定する', () => {
  const project = courses.find((course) => course.subject === 'プロジェクト実践');
  assert.ok(project);
  assert.deepEqual(definition.requirements.projectPractice.courseIds, [project.id]);
  assert.equal(project.credits, 4);
  const analysis = engine.analyzeGraduationRequirements([project.id], courses, definition);
  assert.equal(analysis.projectPractice.credits, 4);
  assert.equal(analysis.projectPractice.satisfied, true);
});
