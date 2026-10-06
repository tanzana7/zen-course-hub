// Shared simulator rules keep UI actions and Node tests on the same placement policy.
(function initializeSimulatorRules(root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  if (root) root.SimulatorRules = rules;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const getQuarterInfo = (course) => {
    const label = typeof course?.quarter === 'string' ? course.quarter.trim() : '';
    if (label === '通期') {
      return {
        label,
        quarters: [1, 2, 3, 4],
        options: [{ start: 1, end: 4, label: '1-4Q', contiguous: true }],
        allowedStarts: [1],
        start: 1,
        end: 4,
        contiguous: true
      };
    }

    // Parse only the catalog's explicit Q tokens. Harvesting digits from an entire label
    // would turn a year such as "2027年度 1Q" into an invented 1-2Q placement.
    const segments = label.split(/\s*[,、]\s*/);
    const options = segments.map((segment) => {
      const single = /^([1-4])Q$/.exec(segment);
      if (single) {
        const quarter = Number(single[1]);
        return { start: quarter, end: quarter, label: `${quarter}Q`, contiguous: true };
      }
      const span = /^(1-2|3-4)Q$/.exec(segment);
      if (!span) return null;
      const [start, end] = span[1].split('-').map(Number);
      return { start, end, label: `${start}-${end}Q`, contiguous: true };
    });
    if (!label || options.some((option) => !option || !Number.isInteger(option.start))) {
      return { label: label || 'Q未定', quarters: [], options: [], allowedStarts: [], start: null, end: null, contiguous: false };
    }

    const uniqueOptions = options.filter((option, index, list) => list.findIndex((candidate) => candidate.start === option.start) === index);
    const quarters = [...new Set(uniqueOptions.flatMap((option) => Array.from(
      { length: option.end - option.start + 1 }, (_, index) => option.start + index
    )))].sort((a, b) => a - b);
    // A range is an opening window. Keep its first start as the legacy span,
    // while exposing later listed quarters as single-Q starts so a course can
    // be placed in every explicitly advertised opening quarter.
    const allowedStarts = [...new Set(options.flatMap((option) => Array.from(
      { length: option.end - option.start + 1 }, (_, index) => option.start + index
    )))].sort((a, b) => a - b);
    const firstOption = uniqueOptions[0];
    return {
      label,
      quarters,
      options: uniqueOptions,
      allowedStarts,
      start: firstOption?.start || null,
      end: firstOption?.end || null,
      contiguous: uniqueOptions.length === 1 && firstOption.contiguous
    };
  };

  const canPlaceCourseAt = (course, year, quarter) => {
    const q = Number(quarter);
    return Boolean(
      course
      && Number.isInteger(year) && year >= 1 && year <= 4
      && Number.isInteger(q)
      && getQuarterInfo(course).allowedStarts.includes(q)
    );
  };

  // Compare the actual placement start selected by the student. Span and
  // full-year courses use their start Q, matching credit accounting.
  const getPlacementStart = (course, placement) => {
    const year = Number(placement?.year);
    const quarter = Number(placement?.selectedQuarter);
    if (!Number.isInteger(year) || year < 1 || year > 4) return null;
    const option = getPlacementOptions(course).find((candidate) => candidate.start === quarter);
    return option ? ((year - 1) * 4) + option.start : null;
  };

  const isPrerequisiteSatisfied = (prerequisiteCourse, prerequisitePlacement, successorCourse, successorPlacement) => {
    const prerequisiteStart = getPlacementStart(prerequisiteCourse, prerequisitePlacement);
    const successorStart = getPlacementStart(successorCourse, successorPlacement);
    return prerequisiteStart !== null && successorStart !== null && prerequisiteStart <= successorStart;
  };

  const getPlacementIssues = (course, placement) => {
    if (!course || !placement) return [];
    const issues = [];
    if (!getQuarterInfo(course).allowedStarts.includes(Number(placement.selectedQuarter))) {
      const q = Number(placement.selectedQuarter);
      issues.push({
        type: 'quarter',
        message: Number.isInteger(q) && q >= 1 && q <= 4
          ? `この科目はQ${q}には開講されません。配置を修正してください。`
          : '配置Qを確認できません。開講Qへの配置に修正してください。'
      });
    }

    return issues;
  };

  const applyPlacement = (placements, course, year, quarter) => {
    const current = Array.isArray(placements) ? placements : [];
    if (!course) return { allowed: false, reason: 'unknown-course', placements: current };
    if (!Number.isInteger(year) || year < 1 || year > 4) {
      return { allowed: false, reason: 'invalid-year', placements: current };
    }
    if (!canPlaceCourseAt(course, year, quarter)) {
      return { allowed: false, reason: 'not-offered', placements: current };
    }

    // A move replaces the course's single existing row, so repeated placement cannot duplicate it.
    return {
      allowed: true,
      reason: null,
      placements: [
        ...current.filter((placement) => placement.courseId !== course.id),
        { courseId: course.id, year, selectedQuarter: Number(quarter) }
      ]
    };
  };

  const createEmptyPlan = () => ({ version: 1, placements: [] });

  // Persist before replacing in-memory state, so quota/privacy failures leave both UI
  // and the last saved plan unchanged. The caller owns user-facing feedback/logging.
  const savePlanChange = (storage, key, nextPlan) => {
    try {
      storage.setItem(key, JSON.stringify(nextPlan));
      return { saved: true, error: null };
    } catch (error) {
      return { saved: false, error };
    }
  };

  const resetPlanStorage = (storage, key) => {
    const plan = createEmptyPlan();
    storage.setItem(key, JSON.stringify(plan));
    return plan;
  };

  const getPlacementOptions = (course) => {
    const info = getQuarterInfo(course);
    return info.allowedStarts.map((start) => info.options.find((option) => option.start === start) || {
      start,
      end: start,
      label: `${start}Q`,
      contiguous: true
    });
  };

  // Graduation projection is intentionally limited to IDs that still exist in
  // the current catalog. Unknown saved placements remain in the plan for
  // explicit user removal, but must never reach the shared analyzer because it
  // correctly fails closed on unknown IDs.
  const getKnownSimulatorCourseIds = (placements, knownCourseIds) => {
    const known = knownCourseIds instanceof Set ? knownCourseIds : new Set(knownCourseIds || []);
    return [...new Set((Array.isArray(placements) ? placements : [])
      .map((placement) => placement?.courseId)
      .filter((courseId) => typeof courseId === 'string' && known.has(courseId)))];
  };

  const getUnknownSimulatorCourseIds = (placements, knownCourseIds) => {
    const known = knownCourseIds instanceof Set ? knownCourseIds : new Set(knownCourseIds || []);
    return [...new Set((Array.isArray(placements) ? placements : [])
      .map((placement) => placement?.courseId)
      .filter((courseId) => typeof courseId === 'string' && courseId && !known.has(courseId)))];
  };

  const buildGraduationProjectionCourseIds = (completedCourseIds, placements, knownCourseIds) => [
    ...new Set([
      ...(Array.isArray(completedCourseIds) ? completedCourseIds : []),
      ...getKnownSimulatorCourseIds(placements, knownCourseIds)
    ])
  ];

  return Object.freeze({
    getQuarterInfo,
    getPlacementOptions,
    canPlaceCourseAt,
    getPlacementStart,
    isPrerequisiteSatisfied,
    getPlacementIssues,
    applyPlacement,
    createEmptyPlan,
    savePlanChange,
    resetPlanStorage,
    getKnownSimulatorCourseIds,
    getUnknownSimulatorCourseIds,
    buildGraduationProjectionCourseIds
  });
});
