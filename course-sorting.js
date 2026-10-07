// Main Hub and simulator share this catalog sort contract.
(function initializeCourseSorting(root, factory) {
  const sorting = factory();
  if (typeof module === 'object' && module.exports) module.exports = sorting;
  if (root) root.CourseSorting = sorting;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const COURSE_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'default', label: '標準' }),
    Object.freeze({ value: 'difficulty-asc', label: '難易度：低い順' }),
    Object.freeze({ value: 'difficulty-desc', label: '難易度：高い順' }),
    Object.freeze({ value: 'name-asc', label: '科目名：50音順' }),
    Object.freeze({ value: 'year-asc', label: '推奨学年：低い順' }),
    Object.freeze({ value: 'year-desc', label: '推奨学年：高い順' }),
    Object.freeze({ value: 'credits-asc', label: '単位数：少ない順' }),
    Object.freeze({ value: 'credits-desc', label: '単位数：多い順' })
  ]);
  const SORT_VALUES = new Set(COURSE_SORT_OPTIONS.map(({ value }) => value));
  const SUBJECT_COLLATOR = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' });

  const getDifficultyAverage = (difficultyMap, courseId) => {
    const entry = difficultyMap instanceof Map
      ? difficultyMap.get(courseId)
      : difficultyMap?.[courseId];
    return Number.isFinite(entry?.average) ? entry.average : null;
  };

  const getSubjectName = (course) => {
    const subject = typeof course?.subject === 'string' ? course.subject.trim() : '';
    return subject || null;
  };

  const getRecommendedYear = (course) => {
    const match = typeof course?.year === 'string' ? /([1-4])\s*年/.exec(course.year) : null;
    return match ? Number(match[1]) : null;
  };

  const getCredits = (course) => {
    const rawCredits = course?.credits;
    if (rawCredits === null || rawCredits === undefined || rawCredits === '') return null;
    const credits = Number(rawCredits);
    return Number.isFinite(credits) && credits >= 0 ? credits : null;
  };

  const compareSortableValues = (aValue, bValue, direction, compare) => {
    const aMissing = aValue === null;
    const bMissing = bValue === null;
    if (aMissing !== bMissing) return aMissing ? 1 : -1;
    if (aMissing) return 0;
    const difference = compare(aValue, bValue);
    return direction === 'desc' ? -difference : difference;
  };

  const sortCourses = (courses, sortMode, difficultyMap) => {
    if (!Array.isArray(courses)) return [];
    if (!SORT_VALUES.has(sortMode) || sortMode === 'default') return [...courses];

    const sortDefinition = {
      'difficulty-asc': {
        value: (course) => getDifficultyAverage(difficultyMap, course?.id),
        direction: 'asc',
        compare: (a, b) => a - b
      },
      'difficulty-desc': {
        value: (course) => getDifficultyAverage(difficultyMap, course?.id),
        direction: 'desc',
        compare: (a, b) => a - b
      },
      'name-asc': {
        value: getSubjectName,
        direction: 'asc',
        compare: (a, b) => SUBJECT_COLLATOR.compare(a, b)
      },
      'year-asc': {
        value: getRecommendedYear,
        direction: 'asc',
        compare: (a, b) => a - b
      },
      'year-desc': {
        value: getRecommendedYear,
        direction: 'desc',
        compare: (a, b) => a - b
      },
      'credits-asc': {
        value: getCredits,
        direction: 'asc',
        compare: (a, b) => a - b
      },
      'credits-desc': {
        value: getCredits,
        direction: 'desc',
        compare: (a, b) => a - b
      }
    }[sortMode];

    if (!sortDefinition) return [...courses];

    return courses
      .map((item, index) => ({ item, index, value: sortDefinition.value(item) }))
      .sort((a, b) => compareSortableValues(
        a.value,
        b.value,
        sortDefinition.direction,
        sortDefinition.compare
      ) || (a.index - b.index))
      .map(({ item }) => item);
  };

  return Object.freeze({ COURSE_SORT_OPTIONS, sortCourses });
});
