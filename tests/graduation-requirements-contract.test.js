import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import engine from '../graduation-requirements.js';

const readJson = (name) => JSON.parse(fs.readFileSync(new URL(`../${name}`, import.meta.url), 'utf8'));
const definition = readJson('graduation-requirements.json');
const courses = readJson('courses.json');
const requirements = definition.requirements;

const courseById = (id) => courses.find((course) => course.id === id);
const cloneDefinition = () => JSON.parse(JSON.stringify(definition));

test('正式卒業要件の数値を実際のdefinitionで固定する', () => {
  assert.equal(requirements.totalCredits.targetCredits, 124);
  assert.equal(requirements.introduction.targetCredits, 14);
  assert.equal(requirements.foundation.targetCredits, 12);
  assert.equal(requirements.foundation.multilingualIT.targetCredits, 2);
  assert.equal(requirements.advanced.targetCredits, 74);
  assert.equal(requirements.literacy.targetCredits, 8);
  assert.equal(requirements.multilingualInformation.targetCredits, 8);
  assert.equal(requirements.worldUnderstanding.targetCredits, 26);
  assert.equal(requirements.industryHistory.targetCredits, 2);
  assert.equal(requirements.socialConnection.capCredits, 10);
  assert.equal(requirements.projectPractice.targetCredits, 4);
});

test('基礎5分野は公式の各2単位要件である', () => {
  const expectedGroups = [
    { label: '数理', key: 'math', metadataValue: '数理', targetCredits: 2 },
    { label: '情報', key: 'information', metadataValue: '情報', targetCredits: 2 },
    { label: '文化・思想', key: 'cultureThought', metadataValue: '文化思想', targetCredits: 2 },
    { label: '社会・ネットワーク', key: 'societyNetwork', metadataValue: '社会ネットワーク', targetCredits: 2 },
    { label: '経済・マーケット', key: 'economyMarket', metadataValue: '経済マーケット', targetCredits: 2 }
  ];

  const actualGroups = requirements.foundation.groups
    .map(({ label, key, metadataValue, targetCredits }) => ({ label, key, metadataValue, targetCredits }))
    .sort((left, right) => left.key.localeCompare(right.key));
  assert.deepEqual(actualGroups, [...expectedGroups].sort((left, right) => left.key.localeCompare(right.key)));
  for (const group of expectedGroups) {
    assert.ok(
      courses.some((course) => course.foundationRequirement === group.metadataValue),
      `${group.label} metadataValue resolves to explicit courses.json foundationRequirement metadata`
    );
  }
});

test('多言語ITコミュニケーションは正確な指定ID・名称・単位数へ解決する', () => {
  const courseIds = requirements.foundation.multilingualIT.courseIds;
  assert.deepEqual([...courseIds].sort(), ['multilingual_it_comm']);

  const resolvedCourses = courseIds.map((id) => {
    const course = courseById(id);
    assert.ok(course, `multilingual IT course ID exists: ${id}`);
    return { id: course.id, name: course.subject, credits: course.credits };
  });
  assert.deepEqual(resolvedCourses, [
    { id: 'multilingual_it_comm', name: '多言語ITコミュニケーション', credits: 2 }
  ]);
});

test('産業史2単位は世界理解26単位のsub-requirementである', () => {
  assert.equal(requirements.industryHistory.within, 'worldUnderstanding');
  assert.equal(requirements.worldUnderstanding.targetCredits, 26);
  assert.equal(requirements.industryHistory.targetCredits, 2);

  const industryCourse = courseById('it_industry_history');
  assert.ok(industryCourse);
  const otherWorldCredits = {
    id: 'contract-world-understanding',
    subject: 'contract fixture',
    credits: 24,
    category: '展開',
    tag: '世界理解',
    globalStudiesRequirement: true
  };
  const analysis = engine.analyzeGraduationRequirements(
    [otherWorldCredits.id, industryCourse.id],
    [...courses, otherWorldCredits],
    definition
  );

  assert.equal(analysis.valid, true);
  assert.equal(analysis.worldUnderstanding.credits, 26);
  assert.equal(analysis.worldUnderstanding.industryHistory.credits, 2);
  assert.equal(analysis.worldUnderstanding.satisfied, true);
});

test('産業史対象4件はcourses.jsonの正式な4科目へ解決する', () => {
  const mapped = requirements.industryHistory.courseIds.map((id) => {
    const course = courseById(id);
    assert.ok(course, `industry history ID exists: ${id}`);
    return { id, subject: course.subject, credits: course.credits };
  });
  assert.deepEqual(mapped, [
    { id: 'it_industry_history', subject: 'IT産業史', credits: 2 },
    { id: 'manga_industry_history', subject: 'マンガ産業史', credits: 2 },
    { id: 'anime_industry_history', subject: 'アニメ産業史', credits: 2 },
    { id: 'japanese_game_industry_history', subject: '日本のゲーム産業史', credits: 2 }
  ]);
});

test('プロジェクト実践4単位は指定IDから実科目へ解決する', () => {
  assert.deepEqual(requirements.projectPractice.courseIds, ['project_practice']);
  const project = courseById(requirements.projectPractice.courseIds[0]);
  assert.ok(project);
  assert.equal(project.subject, 'プロジェクト実践');
  assert.equal(project.credits, 4);
});

test('総単位から除外する公式カテゴリとタグを固定する', () => {
  assert.deepEqual(requirements.totalCredits.nonCountingCategories, ['自由']);
  assert.deepEqual(requirements.totalCredits.nonCountingTags, ['自由科目']);
});

test('総単位の除外配列は空・重複・空白値をdefinitionとして拒否する', () => {
  for (const [arrayName, invalidValues] of [
    ['nonCountingCategories', [[], ['自由', '自由'], ['  自由'], ['']]],
    ['nonCountingTags', [[], ['自由科目', '自由科目'], [' 自由科目 '], ['']]]
  ]) {
    for (const values of invalidValues) {
      const invalidDefinition = cloneDefinition();
      invalidDefinition.requirements.totalCredits[arrayName] = values;
      assert.equal(engine.validateRequirementsDefinition(invalidDefinition).valid, false, `${arrayName}: ${JSON.stringify(values)}`);
    }
  }
});
