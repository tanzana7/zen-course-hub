/*
 * 卒業要件の定義検証と計算をMain Hub / Simulatorから共有できる小さな境界層。
 * DOMやlocalStorageには依存せず、入力データが壊れている場合は達成結果を返さない。
 */
(function exposeGraduationRequirements(root) {
  'use strict';

  const VALID_BOOLEAN_FIELDS = [
    'advancedRequirement',
    'literacyRequirement',
    'multilingualRequirement',
    'globalStudiesRequirement',
    'digitalIndustryHistoryRequirement',
    'graduationRequirement',
    'projectPracticeRequirement'
  ];

  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isPositiveFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

  const invalid = (message, details = []) => ({ valid: false, message, details });

  const validateIdArray = (value, label, { allowEmpty = false } = {}) => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      return invalid(`${label} must be a non-empty array.`);
    }
    if (value.some((id) => !isNonEmptyString(id))) {
      return invalid(`${label} contains an invalid ID.`);
    }
    if (new Set(value).size !== value.length) {
      return invalid(`${label} contains duplicate IDs.`);
    }
    return { valid: true };
  };

  const validateRequirementsDefinition = (definition) => {
    if (!isPlainObject(definition) || definition.schemaVersion !== 1 || !isNonEmptyString(definition.version)) {
      return invalid('卒業要件定義のschemaVersionまたはversionが不正です。');
    }

    const requirements = definition.requirements;
    if (!isPlainObject(requirements)) return invalid('卒業要件定義がありません。');

    const numericPaths = [
      ['totalCredits', 'targetCredits'],
      ['introduction', 'targetCredits'],
      ['foundation', 'targetCredits'],
      ['advanced', 'targetCredits'],
      ['literacy', 'targetCredits'],
      ['multilingualInformation', 'targetCredits'],
      ['worldUnderstanding', 'targetCredits'],
      ['industryHistory', 'targetCredits'],
      ['socialConnection', 'capCredits'],
      ['projectPractice', 'targetCredits'],
      ['foundation', 'multilingualIT', 'targetCredits']
    ];
    for (const path of numericPaths) {
      let current = requirements;
      for (const key of path) current = current?.[key];
      if (!isPositiveFiniteNumber(current)) return invalid(`卒業要件の数値が不正です: ${path.join('.')}`);
    }

    const idArrayPaths = [
      ['introduction', 'courseIds'],
      ['foundation', 'multilingualIT', 'courseIds'],
      ['industryHistory', 'courseIds'],
      ['projectPractice', 'courseIds']
    ];
    for (const path of idArrayPaths) {
      let current = requirements;
      for (const key of path) current = current?.[key];
      const result = validateIdArray(current, path.join('.'));
      if (!result.valid) return result;
    }

    const foundationGroups = requirements.foundation.groups;
    if (!Array.isArray(foundationGroups) || foundationGroups.length !== 5) {
      return invalid('基礎5分野の定義が5件ではありません。');
    }
    const groupKeys = foundationGroups.map((group) => group?.key);
    const groupValues = foundationGroups.map((group) => group?.metadataValue);
    if (groupKeys.some((value) => !isNonEmptyString(value)) || new Set(groupKeys).size !== groupKeys.length) {
      return invalid('基礎分野のkeyが不正または重複しています。');
    }
    if (groupValues.some((value) => !isNonEmptyString(value)) || new Set(groupValues).size !== groupValues.length) {
      return invalid('基礎分野のmetadataValueが不正または重複しています。');
    }
    if (foundationGroups.some((group) => !isNonEmptyString(group.label) || !isPositiveFiniteNumber(group.targetCredits))) {
      return invalid('基礎分野のlabelまたはtargetCreditsが不正です。');
    }

    if (!isNonEmptyString(requirements.advanced.metadataFlag)) {
      return invalid('advanced.metadataFlagがありません。');
    }
    if (!isNonEmptyString(requirements.industryHistory.metadataFlag) || requirements.industryHistory.within !== 'worldUnderstanding') {
      return invalid('industryHistoryのmetadataFlagまたはwithinが不正です。');
    }
    for (const field of ['literacy', 'multilingualInformation', 'worldUnderstanding']) {
      if (!isNonEmptyString(requirements[field].metadataFlag)) {
        return invalid(`${field}.metadataFlagがありません。`);
      }
      const foundationValues = requirements[field].foundationMetadataValues;
      // 基礎科目からの重複充当はこの対応表に依存する。空や重複は設定ミスとして判定を止める。
      if (!Array.isArray(foundationValues) || foundationValues.length === 0 ||
          foundationValues.some((value) => !isNonEmptyString(value)) ||
          new Set(foundationValues).size !== foundationValues.length) {
        return invalid(`${field}.foundationMetadataValuesが不正です。`);
      }
    }
    if (!isNonEmptyString(requirements.socialConnection.tag)) return invalid('社会接続のtagがありません。');
    for (const field of ['totalCredits']) {
      if (!Array.isArray(requirements[field].nonCountingCategories) ||
          requirements[field].nonCountingCategories.some((value) => !isNonEmptyString(value))) {
        return invalid(`${field}.nonCountingCategoriesが不正です。`);
      }
      if (!Array.isArray(requirements[field].nonCountingTags) ||
          requirements[field].nonCountingTags.some((value) => !isNonEmptyString(value))) {
        return invalid(`${field}.nonCountingTagsが不正です。`);
      }
    }
    return { valid: true };
  };

  const validateCourses = (courses) => {
    if (!Array.isArray(courses)) return invalid('科目データが配列ではありません。');
    const ids = new Set();
    for (let index = 0; index < courses.length; index += 1) {
      const course = courses[index];
      if (!isPlainObject(course)) return invalid(`科目データが不正です（${index + 1}件目）。`);
      if (!isNonEmptyString(course.id)) return invalid(`科目IDが空です（${index + 1}件目）。`);
      if (ids.has(course.id)) return invalid(`科目IDが重複しています: ${course.id}`);
      ids.add(course.id);
      if (!isNonEmptyString(course.subject)) return invalid(`科目名が空です: ${course.id}`);
      if (typeof course.credits !== 'number' || !Number.isFinite(course.credits) || course.credits <= 0) {
        return invalid(`単位数が不正です: ${course.id}`);
      }
      if (!isNonEmptyString(course.category) || !isNonEmptyString(course.tag)) {
        return invalid(`科目のcategoryまたはtagが不正です: ${course.id}`);
      }
      for (const field of VALID_BOOLEAN_FIELDS) {
        if (course[field] !== undefined && typeof course[field] !== 'boolean') {
          return invalid(`${field}の型が不正です: ${course.id}`);
        }
      }
      if (course.foundationRequirement !== undefined && !isNonEmptyString(course.foundationRequirement)) {
        return invalid(`foundationRequirementの型が不正です: ${course.id}`);
      }
    }
    return { valid: true };
  };

  const validateRequirementsAgainstCourses = (definition, courses) => {
    const definitionResult = validateRequirementsDefinition(definition);
    if (!definitionResult.valid) return definitionResult;
    const coursesResult = validateCourses(courses);
    if (!coursesResult.valid) return coursesResult;
    const courseIds = new Set(courses.map((course) => course.id));
    const definitionIds = [
      ...definition.requirements.introduction.courseIds,
      ...definition.requirements.foundation.multilingualIT.courseIds,
      ...definition.requirements.industryHistory.courseIds,
      ...definition.requirements.projectPractice.courseIds
    ];
    const missingDefinitionIds = [...new Set(definitionIds)].filter((id) => !courseIds.has(id));
    if (missingDefinitionIds.length) {
      return invalid(`卒業要件定義に存在しない科目ID: ${missingDefinitionIds.join(', ')}`);
    }
    return { valid: true };
  };

  const sum = (courses) => courses.reduce((total, course) => total + course.credits, 0);

  const analyzeGraduationRequirements = (courseIds, courses, definition) => {
    // 呼び出し元に事前検証を要求しない。将来Simulatorから直接使っても、
    // 定義が参照する未登録IDを見逃して卒業達成を返さないための入口検証。
    const mappingResult = validateRequirementsAgainstCourses(definition, courses);
    if (!mappingResult.valid) return invalid('科目データを確認できないため、卒業要件を判定できません。', [mappingResult.message]);
    if (!Array.isArray(courseIds) || courseIds.some((id) => !isNonEmptyString(id))) {
      return invalid('選択科目IDが不正なため、卒業要件を判定できません。');
    }

    const courseMap = new Map(courses.map((course) => [course.id, course]));
    const uniqueIds = [...new Set(courseIds)];
    const unknownIds = uniqueIds.filter((id) => !courseMap.has(id));
    if (unknownIds.length) return invalid('科目データを確認できないため、卒業要件を判定できません。', [`未知の科目ID: ${unknownIds.join(', ')}`]);

    const selected = uniqueIds.map((id) => courseMap.get(id));
    const req = definition.requirements;
    const isNonCounting = (course) => req.totalCredits.nonCountingCategories.includes(course.category) ||
      req.totalCredits.nonCountingTags.includes(course.tag);
    const countable = selected.filter((course) => !isNonCounting(course));
    const actualTotalCredits = sum(selected);
    const socialCourses = countable.filter((course) => course.tag === req.socialConnection.tag);
    const socialActualCredits = sum(socialCourses);
    const socialCountedCredits = Math.min(socialActualCredits, req.socialConnection.capCredits);
    const nonSocialCredits = sum(countable.filter((course) => course.tag !== req.socialConnection.tag));
    const countedTotalCredits = nonSocialCredits + socialCountedCredits;
    const byIds = (ids) => countable.filter((course) => ids.includes(course.id));
    const byFlagOrFoundation = (metadataFlag, foundationValues) => countable.filter((course) =>
      course[metadataFlag] === true || foundationValues.includes(course.foundationRequirement)
    );
    const meets = (credits, target) => credits >= target;

    const introductionCredits = sum(byIds(req.introduction.courseIds));
    const foundationGroups = req.foundation.groups.map((group) => {
      const credits = sum(countable.filter((course) => course.foundationRequirement === group.metadataValue));
      return { key: group.key, label: group.label, credits, targetCredits: group.targetCredits, satisfied: meets(credits, group.targetCredits) };
    });
    const foundationCredits = sum(countable.filter((course) =>
      req.foundation.groups.some((group) => course.foundationRequirement === group.metadataValue)
    ));
    const multilingualITCredits = sum(byIds(req.foundation.multilingualIT.courseIds));
    const advancedCredits = sum(countable.filter((course) => course[req.advanced.metadataFlag] === true));
    const literacyCredits = sum(byFlagOrFoundation(req.literacy.metadataFlag, req.literacy.foundationMetadataValues));
    const multilingualInformationCredits = sum(byFlagOrFoundation(req.multilingualInformation.metadataFlag, req.multilingualInformation.foundationMetadataValues));
    const worldUnderstandingCredits = sum(byFlagOrFoundation(req.worldUnderstanding.metadataFlag, req.worldUnderstanding.foundationMetadataValues));
    const industryHistoryCredits = sum(countable.filter((course) => req.industryHistory.courseIds.includes(course.id)));
    const projectCredits = sum(byIds(req.projectPractice.courseIds));

    const result = {
      valid: true,
      selectedCourseIds: uniqueIds,
      actualTotalCredits,
      totalCredits: {
        countedCredits: countedTotalCredits,
        actualCredits: actualTotalCredits,
        targetCredits: req.totalCredits.targetCredits,
        satisfied: meets(countedTotalCredits, req.totalCredits.targetCredits),
        socialActualCredits,
        socialCountedCredits,
        socialCapCredits: req.socialConnection.capCredits
      },
      introduction: { credits: introductionCredits, targetCredits: req.introduction.targetCredits, satisfied: meets(introductionCredits, req.introduction.targetCredits) },
      foundation: {
        credits: foundationCredits,
        targetCredits: req.foundation.targetCredits,
        satisfied: meets(foundationCredits, req.foundation.targetCredits) && foundationGroups.every((group) => group.satisfied),
        groups: foundationGroups,
        multilingualIT: {
          credits: multilingualITCredits,
          targetCredits: req.foundation.multilingualIT.targetCredits,
          satisfied: meets(multilingualITCredits, req.foundation.multilingualIT.targetCredits)
        }
      },
      advanced: { credits: advancedCredits, targetCredits: req.advanced.targetCredits, satisfied: meets(advancedCredits, req.advanced.targetCredits) },
      literacy: { credits: literacyCredits, targetCredits: req.literacy.targetCredits, satisfied: meets(literacyCredits, req.literacy.targetCredits) },
      multilingualInformation: { credits: multilingualInformationCredits, targetCredits: req.multilingualInformation.targetCredits, satisfied: meets(multilingualInformationCredits, req.multilingualInformation.targetCredits) },
      worldUnderstanding: {
        credits: worldUnderstandingCredits,
        targetCredits: req.worldUnderstanding.targetCredits,
        satisfied: meets(worldUnderstandingCredits, req.worldUnderstanding.targetCredits) && meets(industryHistoryCredits, req.industryHistory.targetCredits),
        industryHistory: { credits: industryHistoryCredits, targetCredits: req.industryHistory.targetCredits, satisfied: meets(industryHistoryCredits, req.industryHistory.targetCredits) }
      },
      socialConnection: { actualCredits: socialActualCredits, countedCredits: socialCountedCredits, capCredits: req.socialConnection.capCredits },
      projectPractice: { credits: projectCredits, targetCredits: req.projectPractice.targetCredits, satisfied: meets(projectCredits, req.projectPractice.targetCredits) }
    };
    result.satisfied = [
      result.totalCredits.satisfied,
      result.introduction.satisfied,
      result.foundation.satisfied,
      result.foundation.multilingualIT.satisfied,
      result.advanced.satisfied,
      result.literacy.satisfied,
      result.multilingualInformation.satisfied,
      result.worldUnderstanding.satisfied,
      result.projectPractice.satisfied
    ].every(Boolean);
    return result;
  };

  const api = { validateRequirementsDefinition, validateCourses, validateRequirementsAgainstCourses, analyzeGraduationRequirements };
  root.GraduationRequirementsEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
