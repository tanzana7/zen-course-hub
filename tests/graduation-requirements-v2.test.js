import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import graduationRequirementsEngine from '../graduation-requirements.js';

const { analyzeGraduationRequirements: analyzeDirect, validateCourses, validateRequirementsDefinition, validateRequirementsAgainstCourses } = graduationRequirementsEngine;

const definition = JSON.parse(fs.readFileSync(new URL('../graduation-requirements.json', import.meta.url), 'utf8'));
const officialCourses = JSON.parse(fs.readFileSync(new URL('../courses.json', import.meta.url), 'utf8'));

const course = (id, credits = 2, metadata = {}) => ({
  id,
  subject: id,
  credits,
  category: '選択',
  tag: 'その他',
  ...metadata
});

// 個別要件のテストでも、未選択の必修科目は科目カタログに存在する状態を再現する。
// analyzerの入口が全参照IDを検証しても、選択した科目だけの集計を検証できる。
const withDefinitionCourses = (courses, currentDefinition) => {
  const requirements = currentDefinition.requirements;
  const referencedIds = [
    ...requirements.introduction.courseIds,
    ...requirements.foundation.multilingualIT.courseIds,
    ...requirements.industryHistory.courseIds,
    ...requirements.projectPractice.courseIds
  ];
  const existingIds = new Set(courses.map((item) => item.id));
  return [...courses, ...[...new Set(referencedIds)].filter((id) => !existingIds.has(id)).map((id) => course(id))];
};

const analyzeGraduationRequirements = (courseIds, courses, currentDefinition) =>
  analyzeDirect(courseIds, withDefinitionCourses(courses, currentDefinition), currentDefinition);

const minimalCourses = () => [
  ...definition.requirements.introduction.courseIds.map((id) => course(id)),
  ...definition.requirements.foundation.groups.map((group) => course(`foundation_${group.key}`, 2, { foundationRequirement: group.metadataValue })),
  course('multilingual_it_comm', 2, { foundationRequirement: '多言語情報理解' }),
  course('advanced', 2, { advancedRequirement: true }),
  course('literacy', 2, { literacyRequirement: true }),
  course('multilingual', 2, { multilingualRequirement: true }),
  course('world', 2, { globalStudiesRequirement: true }),
  course('industry', 2, { globalStudiesRequirement: true, advancedRequirement: true, digitalIndustryHistoryRequirement: true }),
  course('project_practice', 4, { category: '必修', tag: '卒業プロジェクト', graduationRequirement: true })
];

const cloneDefinition = () => JSON.parse(JSON.stringify(definition));

// 実在する科目だけで、導入・基礎5分野・展開・各領域・卒業プロジェクトを満たす計画。
// 産業史と基礎の重複充当を含むが、総単位は科目IDごとに一度だけ数える。
const graduationReadyIds = [
  ...definition.requirements.introduction.courseIds,
  'mathematical_thinking', 'math_history', 'info_security_intro',
  'japanese_literature_1', 'sociology_1', 'business_mgmt',
  'multilingual_it_comm', 'project_practice',
  'machine_translation_english', 'machine_translation_law', 'machine_translation_it',
  'elementary_algebra', 'it_industry_history',
  'ai_society_walk', 'regional_studies', 'decision_making_dev', 'co_creation_earth',
  'info_society_security', 'economics_history', 'marxian_economics',
  'business_mgmt_accounting', 'internet_copyright', 'methods_of_math',
  'reverse_science_history', 'linear_algebra_1', 'calculus_1', 'linear_algebra_2',
  'calculus_2', 'set_theory_logic', 'symbolic_logic', 'graph_theory',
  'gender_studies', 'media_studies', 'science_tech_society', 'postwar_japan_history_1',
  'cross_cultural_understanding', 'university_media_anthropology', 'sociology_2',
  'sociology_3', 'modern_sports_analysis', 'sf_future_vision',
  'modern_social_theory', 'future_society_design', 'music_society',
  'children_regional_creation', 'collaboration_creative',
  'japan_politics_diplomacy_history', 'math_structure_discovery',
  'complex_analysis', 'calculus_3', 'metric_spaces', 'group_theory',
  'topological_spaces', 'manifolds'
];

const replaceSelected = (ids, removed, added) => [
  ...ids.filter((id) => !removed.includes(id)),
  ...added
];

const assertAllRequirementsExcept = (result, unmet = []) => {
  assert.equal(result.valid, true);
  const checks = {
    total: result.totalCredits.satisfied,
    introduction: result.introduction.satisfied,
    foundation: result.foundation.satisfied,
    multilingualIT: result.foundation.multilingualIT.satisfied,
    advanced: result.advanced.satisfied,
    literacy: result.literacy.satisfied,
    multilingualInformation: result.multilingualInformation.satisfied,
    worldUnderstanding: result.worldUnderstanding.satisfied,
    projectPractice: result.projectPractice.satisfied
  };
  for (const [name, satisfied] of Object.entries(checks)) {
    assert.equal(satisfied, !unmet.includes(name), `${name} の判定`);
  }
  assert.equal(result.satisfied, unmet.length === 0);
};

test('公式courses.jsonの定義と科目データは検証に合格する', () => {
  assert.deepEqual(validateRequirementsDefinition(definition), { valid: true });
  assert.deepEqual(validateCourses(officialCourses), { valid: true });
  assert.deepEqual(validateRequirementsAgainstCourses(definition, officialCourses), { valid: true });
  assert.equal(officialCourses.length, 275);
});

test('定義に存在しないcourse IDはmapping検証で拒否する', () => {
  const broken = cloneDefinition();
  broken.requirements.projectPractice.courseIds = ['missing-course'];
  assert.equal(validateRequirementsAgainstCourses(broken, officialCourses).valid, false);
});

test('総卒業算入単位は123/124/125の境界を判定する', () => {
  const courses = Array.from({ length: 125 }, (_, index) => course(`total-${index}`, 1));
  for (const [count, expected] of [[123, false], [124, true], [125, true]]) {
    const result = analyzeGraduationRequirements(courses.slice(0, count).map((item) => item.id), courses, definition);
    assert.equal(result.totalCredits.countedCredits, count);
    assert.equal(result.totalCredits.satisfied, expected);
  }
});

test('導入科目は12単位で未達、14単位で達成する', () => {
  const courses = definition.requirements.introduction.courseIds.map((id) => course(id));
  const twelve = analyzeGraduationRequirements(courses.slice(0, 6).map((item) => item.id), courses, definition);
  const fourteen = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(twelve.introduction.credits, 12);
  assert.equal(twelve.introduction.satisfied, false);
  assert.equal(fourteen.introduction.credits, 14);
  assert.equal(fourteen.introduction.satisfied, true);
});

test('展開・基盤リテラシー・多言語情報理解・世界理解の境界を判定する', () => {
  const courses = [
    course('advanced-72', 72, { advancedRequirement: true }),
    course('advanced-74', 2, { advancedRequirement: true }),
    course('literacy-6', 6, { literacyRequirement: true }),
    course('literacy-8', 2, { literacyRequirement: true }),
    course('multi-6', 6, { multilingualRequirement: true }),
    course('multi-8', 2, { multilingualRequirement: true }),
    course('world-24', 24, { globalStudiesRequirement: true }),
    course('world-26', 2, { globalStudiesRequirement: true }),
    course('industry', 2, { globalStudiesRequirement: true, digitalIndustryHistoryRequirement: true })
  ];
  const advanced72 = analyzeGraduationRequirements(['advanced-72'], courses, definition);
  const advanced74 = analyzeGraduationRequirements(['advanced-72', 'advanced-74'], courses, definition);
  assert.equal(advanced72.advanced.credits, 72);
  assert.equal(advanced72.advanced.satisfied, false);
  assert.equal(advanced74.advanced.credits, 74);
  assert.equal(advanced74.advanced.satisfied, true);
  const literacy6 = analyzeGraduationRequirements(['literacy-6'], courses, definition);
  const literacy8 = analyzeGraduationRequirements(['literacy-6', 'literacy-8'], courses, definition);
  assert.equal(literacy6.literacy.satisfied, false);
  assert.equal(literacy8.literacy.satisfied, true);
  const multi6 = analyzeGraduationRequirements(['multi-6'], courses, definition);
  const multi8 = analyzeGraduationRequirements(['multi-6', 'multi-8'], courses, definition);
  assert.equal(multi6.multilingualInformation.satisfied, false);
  assert.equal(multi8.multilingualInformation.satisfied, true);
  const customDefinition = cloneDefinition();
  customDefinition.requirements.industryHistory.courseIds = ['industry'];
  const world24 = analyzeGraduationRequirements(['world-24'], courses, customDefinition);
  const world26 = analyzeGraduationRequirements(['world-24', 'industry'], courses, customDefinition);
  assert.equal(world24.worldUnderstanding.credits, 24);
  assert.equal(world24.worldUnderstanding.satisfied, false);
  assert.equal(world26.worldUnderstanding.credits, 26);
  assert.equal(world26.worldUnderstanding.satisfied, true);
});

test('修得済みと予定込みは同じエンジンへ別ID集合として渡せる', () => {
  const courses = definition.requirements.introduction.courseIds.map((id) => course(id));
  const completed = analyzeGraduationRequirements(courses.slice(0, 6).map((item) => item.id), courses, definition);
  const planned = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(completed.introduction.credits, 12);
  assert.equal(planned.introduction.credits, 14);
  assert.equal(completed.introduction.satisfied, false);
  assert.equal(planned.introduction.satisfied, true);
});

test('基礎5分野は各2単位かつ合計12単位を別々に判定する', () => {
  const courses = minimalCourses();
  const result = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(result.foundation.credits, 10);
  assert.equal(result.foundation.satisfied, false);
  assert.ok(result.foundation.groups.every((group) => group.satisfied));

  courses.push(course('foundation_extra', 2, { foundationRequirement: '数理' }));
  const withExtra = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(withExtra.foundation.credits, 12);
  assert.equal(withExtra.foundation.satisfied, true);
});

test('多言語ITコミュニケーションは独立した2単位要件として判定する', () => {
  const courses = minimalCourses();
  const without = analyzeGraduationRequirements(courses.filter((item) => item.id !== 'multilingual_it_comm').map((item) => item.id), courses, definition);
  assert.equal(without.foundation.multilingualIT.satisfied, false);
  const withCourse = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(withCourse.foundation.multilingualIT.credits, 2);
  assert.equal(withCourse.foundation.multilingualIT.satisfied, true);
});

test('基礎科目は基盤リテラシー・世界理解などへ重複充当できる', () => {
  const courses = [
    course('math-foundation', 2, { foundationRequirement: '数理', literacyRequirement: true }),
    course('culture-foundation', 2, { foundationRequirement: '文化思想', globalStudiesRequirement: true }),
    course('world-advanced', 2, { globalStudiesRequirement: true }),
    course('literacy-advanced', 2, { literacyRequirement: true })
  ];
  const custom = cloneDefinition();
  custom.requirements.foundation.targetCredits = 2;
  custom.requirements.foundation.groups = custom.requirements.foundation.groups.map((group, index) => ({ ...group, targetCredits: index < 2 ? 2 : 1 }));
  custom.requirements.foundation.multilingualIT.courseIds = ['math-foundation'];
  custom.requirements.foundation.multilingualIT.targetCredits = 2;
  custom.requirements.literacy.targetCredits = 4;
  custom.requirements.multilingualInformation.targetCredits = 1;
  custom.requirements.worldUnderstanding.targetCredits = 2;
  custom.requirements.industryHistory.targetCredits = 1;
  custom.requirements.industryHistory.courseIds = ['world-advanced'];
  const result = analyzeGraduationRequirements(courses.map((item) => item.id), courses, custom);
  assert.equal(result.literacy.credits, 4);
  assert.equal(result.worldUnderstanding.credits, 4);
  assert.equal(result.totalCredits.countedCredits, 8);
});

test('世界理解の産業史は世界理解要件内のsub-requirementである', () => {
  const courses = [course('world', 26, { globalStudiesRequirement: true }), course('it-history', 2, { globalStudiesRequirement: true, digitalIndustryHistoryRequirement: true })];
  const custom = cloneDefinition();
  custom.requirements.worldUnderstanding.targetCredits = 26;
  custom.requirements.industryHistory.targetCredits = 2;
  custom.requirements.industryHistory.courseIds = ['it-history'];
  const result = analyzeGraduationRequirements(courses.map((item) => item.id), courses, custom);
  assert.equal(result.worldUnderstanding.credits, 28);
  assert.equal(result.worldUnderstanding.industryHistory.credits, 2);
  assert.equal(result.worldUnderstanding.satisfied, true);
});

test('産業史はIT産業史2単位で満たし、対象外科目では満たさない', () => {
  const courses = [course('it', 2, { digitalIndustryHistoryRequirement: true }), course('other', 2, { globalStudiesRequirement: true })];
  const custom = cloneDefinition();
  custom.requirements.worldUnderstanding.targetCredits = 1;
  custom.requirements.industryHistory.courseIds = ['it'];
  const pass = analyzeGraduationRequirements(['it', 'other'], courses, custom);
  assert.equal(pass.worldUnderstanding.industryHistory.satisfied, true);
  const fail = analyzeGraduationRequirements(['other'], courses, custom);
  assert.equal(fail.worldUnderstanding.industryHistory.satisfied, false);
});

test('社会接続は実取得単位を保持しつつ算入単位を10で上限化する', () => {
  for (const actual of [0, 2, 8, 10, 12, 20]) {
    const courses = actual ? [course(`social-${actual}`, actual, { tag: '社会接続' })] : [];
    const result = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
    assert.equal(result.totalCredits.socialActualCredits, actual);
    assert.equal(result.totalCredits.socialCountedCredits, Math.min(actual, 10));
  }
});

test('自由科目と自由科目タグは総卒業算入単位から除外する', () => {
  const courses = [course('counted', 2), course('free-category', 4, { category: '自由', tag: 'その他' }), course('free-tag', 3, { tag: '自由科目' })];
  const result = analyzeGraduationRequirements(courses.map((item) => item.id), courses, definition);
  assert.equal(result.totalCredits.actualCredits, 9);
  assert.equal(result.totalCredits.countedCredits, 2);
});

test('プロジェクト実践は4単位の指定ID要件である', () => {
  const courses = [course('project_practice', 4, { graduationRequirement: true, category: '必修', tag: '卒業プロジェクト' })];
  const result = analyzeGraduationRequirements(['project_practice'], courses, definition);
  assert.equal(result.projectPractice.credits, 4);
  assert.equal(result.projectPractice.satisfied, true);
});

test('同一IDは総単位へ1回だけ加算される', () => {
  const courses = [course('same', 2)];
  const result = analyzeGraduationRequirements(['same', 'same'], courses, definition);
  assert.equal(result.totalCredits.actualCredits, 2);
});

test('未知IDは達成結果を返さずfail-closedになる', () => {
  const result = analyzeGraduationRequirements(['missing'], officialCourses, definition);
  assert.equal(result.valid, false);
  assert.match(result.message, /判定できません/);
});

test('重複ID・空ID・不正単位・不正flagは検証で拒否する', () => {
  assert.equal(validateCourses([course('x'), course('x')]).valid, false);
  assert.equal(validateCourses([course('')]).valid, false);
  assert.equal(validateCourses([course('x', 0)]).valid, false);
  assert.equal(validateCourses([course('x', 2, { advancedRequirement: 'yes' })]).valid, false);
  assert.equal(validateCourses([course('x', '2')]).valid, false);
});

test('壊れた卒業要件定義は検証で拒否する', () => {
  const broken = cloneDefinition();
  broken.requirements.foundation.groups.pop();
  assert.equal(validateRequirementsDefinition(broken).valid, false);
  broken.requirements.foundation.groups = cloneDefinition().requirements.foundation.groups;
  broken.requirements.totalCredits.targetCredits = Number.NaN;
  assert.equal(validateRequirementsDefinition(broken).valid, false);
});

test('公式データの産業史flagはIT・マンガ・アニメ・日本のゲームの4科目に対応する', () => {
  const history = officialCourses.filter((course) => course.digitalIndustryHistoryRequirement === true);
  assert.deepEqual(history.map((course) => course.id).sort(), [
    'anime_industry_history',
    'it_industry_history',
    'japanese_game_industry_history',
    'manga_industry_history'
  ]);
  assert.ok(!officialCourses.some((course) => course.subject === 'デジタル産業史'));
});

test('analyzer直接呼び出しでも定義内の未知IDを判定不能にする', () => {
  const valid = analyzeDirect([], officialCourses, definition);
  assert.equal(valid.valid, true);
  assert.equal(valid.satisfied, false);

  for (const [label, change] of [
    ['導入', (broken) => { broken.requirements.introduction.courseIds = ['unknown-intro']; }],
    ['多言語IT', (broken) => { broken.requirements.foundation.multilingualIT.courseIds = ['unknown-multilingual']; }],
    ['産業史', (broken) => { broken.requirements.industryHistory.courseIds = ['unknown-industry']; }],
    ['プロジェクト', (broken) => { broken.requirements.projectPractice.courseIds = ['unknown-project']; }]
  ]) {
    const broken = cloneDefinition();
    change(broken);
    const result = analyzeDirect([], officialCourses, broken);
    assert.equal(result.valid, false, label);
    assert.match(result.message, /判定できません/);
    assert.match(result.details[0], /存在しない科目ID/);
    assert.equal('satisfied' in result, false);
  }
});

test('analyzer直接呼び出しは不正な科目・選択IDと正常な未達を区別する', () => {
  const catalog = withDefinitionCourses(
    Array.from({ length: 123 }, (_, index) => course(`boundary-${index}`, 1)),
    definition
  );
  const ids = catalog.filter((item) => item.id.startsWith('boundary-')).map((item) => item.id);
  const unmet = analyzeDirect(ids, catalog, definition);
  assert.equal(unmet.valid, true);
  assert.equal(unmet.totalCredits.countedCredits, 123);
  assert.equal(unmet.totalCredits.satisfied, false);
  assert.equal(unmet.satisfied, false);

  const invalidCases = [
    ['未知の選択ID', [...ids, 'unknown-selected'], catalog, definition],
    ['不正な単位数', ids, [...catalog, course('bad-credits', '2')], definition],
    ['重複した科目ID', ids, [...catalog, catalog[0]], definition],
    ['不正な要件metadata', ids, [...catalog, course('bad-flag', 2, { advancedRequirement: 'yes' })], definition]
  ];
  for (const [label, selectedIds, courses, currentDefinition] of invalidCases) {
    const result = analyzeDirect(selectedIds, courses, currentDefinition);
    assert.equal(result.valid, false, label);
    assert.equal('totalCredits' in result, false, label);
    assert.equal('satisfied' in result, false, label);
  }
});

test('基礎科目からの重複充当を消す空・重複mappingは定義として拒否する', () => {
  for (const field of ['literacy', 'multilingualInformation', 'worldUnderstanding']) {
    for (const values of [[], ['数理', '数理'], ['']]) {
      const broken = cloneDefinition();
      broken.requirements[field].foundationMetadataValues = values;
      assert.equal(validateRequirementsDefinition(broken).valid, false, `${field}: ${JSON.stringify(values)}`);
      assert.equal(analyzeDirect([], officialCourses, broken).valid, false);
    }
  }
});

test('実在科目の複合計画は全要件を満たし、総単位に重複充当を二重加算しない', () => {
  assert.equal(new Set(graduationReadyIds).size, graduationReadyIds.length);
  const result = analyzeDirect(graduationReadyIds, officialCourses, definition);
  assertAllRequirementsExcept(result);
  assert.equal(result.totalCredits.actualCredits, 124);
  assert.equal(result.totalCredits.countedCredits, 124);
  assert.equal(result.introduction.credits, 14);
  assert.equal(result.foundation.credits, 12);
  assert.ok(result.foundation.groups.every((group) => group.credits >= 2));
  assert.equal(result.foundation.multilingualIT.credits, 2);
  assert.ok(result.advanced.credits >= 74);
  assert.ok(result.literacy.credits >= 8);
  assert.ok(result.multilingualInformation.credits >= 8);
  assert.ok(result.worldUnderstanding.credits >= 26);
  assert.equal(result.worldUnderstanding.industryHistory.credits, 2);
  assert.equal(result.projectPractice.credits, 4);
  const duplicated = analyzeDirect([...graduationReadyIds, 'it_industry_history'], officialCourses, definition);
  assert.equal(duplicated.totalCredits.countedCredits, 124);
  assert.equal(duplicated.worldUnderstanding.industryHistory.credits, 2);
});

test('124単位以上でも基礎の一分野が0なら卒業要件は未達', () => {
  const ids = replaceSelected(graduationReadyIds, ['business_mgmt'], ['info_ethics_law']);
  const result = analyzeDirect(ids, officialCourses, definition);
  assertAllRequirementsExcept(result, ['foundation']);
  assert.equal(result.totalCredits.countedCredits, 124);
  assert.equal(result.foundation.credits, 12);
  assert.equal(result.foundation.groups.find((group) => group.key === 'economyMarket').credits, 0);
});

const socialIds = [
  'career_design_1', 'interpersonal_comm_theory', 'english_comm_1',
  'english_comm_2', 'creative_workplace_theory', 'social_innovation_intro'
];
const replaceableAdvancedIds = [
  'graph_theory', 'ai_society_walk', 'regional_studies',
  'decision_making_dev', 'co_creation_earth', 'info_society_security'
];

test('社会接続12単位を取得しても算入上限により総単位122で未達', () => {
  const ids = replaceSelected(graduationReadyIds, replaceableAdvancedIds, socialIds);
  const result = analyzeDirect(ids, officialCourses, definition);
  assertAllRequirementsExcept(result, ['total']);
  assert.equal(result.totalCredits.actualCredits, 124);
  assert.equal(result.socialConnection.actualCredits, 12);
  assert.equal(result.socialConnection.countedCredits, 10);
  assert.equal(result.totalCredits.countedCredits, 122);
});

test('社会接続12単位のうち10単位を算入し、総単位124なら達成', () => {
  const ids = replaceSelected(graduationReadyIds, replaceableAdvancedIds.slice(0, 5), socialIds);
  const result = analyzeDirect(ids, officialCourses, definition);
  assertAllRequirementsExcept(result);
  assert.equal(result.totalCredits.actualCredits, 126);
  assert.equal(result.socialConnection.actualCredits, 12);
  assert.equal(result.socialConnection.countedCredits, 10);
  assert.equal(result.totalCredits.countedCredits, 124);
});

test('124単位と世界理解26単位を満たしても産業史がなければ未達', () => {
  const ids = replaceSelected(graduationReadyIds, ['it_industry_history'], ['macroeconomics']);
  const result = analyzeDirect(ids, officialCourses, definition);
  assertAllRequirementsExcept(result, ['worldUnderstanding']);
  assert.equal(result.totalCredits.countedCredits, 124);
  assert.ok(result.worldUnderstanding.credits >= 26);
  assert.equal(result.worldUnderstanding.industryHistory.credits, 0);
});

test('124単位と他要件を満たしてもプロジェクト実践がなければ未達', () => {
  const ids = replaceSelected(graduationReadyIds, ['project_practice'], ['category_theory', 'mechanics']);
  const result = analyzeDirect(ids, officialCourses, definition);
  assertAllRequirementsExcept(result, ['projectPractice']);
  assert.equal(result.totalCredits.countedCredits, 124);
  assert.equal(result.projectPractice.credits, 0);
});
