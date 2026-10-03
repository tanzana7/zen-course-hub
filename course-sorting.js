// Main Hub and simulator share this catalog sort contract.
(function initializeCourseSorting(root, factory) {
  const sorting = factory();
  if (typeof module === 'object' && module.exports) module.exports = sorting;
  if (root) root.CourseSorting = sorting;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const COURSE_SORT_OPTIONS = Object.freeze([
    Object.freeze({ value: 'default', label: '標準' }),
    Object.freeze({ value: 'difficulty-asc', label: '難易度：低い順' }),
    Object.freeze({ value: 'difficulty-desc', label: '難易度：高い順' })
  ]);
  const SORT_VALUES = new Set(COURSE_SORT_OPTIONS.map(({ value }) => value));

  const getDifficultyAverage = (difficultyMap, courseId) => {
    const entry = difficultyMap instanceof Map
      ? difficultyMap.get(courseId)
      : difficultyMap?.[courseId];
    return Number.isFinite(entry?.average) ? entry.average : null;
  };

  const sortCourses = (courses, sortMode, difficultyMap) => {
    if (!Array.isArray(courses)) return [];
    if (!SORT_VALUES.has(sortMode) || sortMode === 'default') return [...courses];

    return courses
      .map((item, index) => ({
        item,
        index,
        average: getDifficultyAverage(difficultyMap, item?.id)
      }))
      .sort((a, b) => {
        const aMissing = a.average === null;
        const bMissing = b.average === null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing) return a.index - b.index;

        const difference = sortMode === 'difficulty-asc'
          ? a.average - b.average
          : b.average - a.average;
        return difference || (a.index - b.index);
      })
      .map(({ item }) => item);
  };

  return Object.freeze({ COURSE_SORT_OPTIONS, sortCourses });
});
