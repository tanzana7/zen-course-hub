// Shared simulator rules keep UI actions and Node tests on the same placement policy.
(function initializeSimulatorRules(root, factory) {
  const rules = factory();
  if (typeof module === 'object' && module.exports) module.exports = rules;
  if (root) root.SimulatorRules = rules;
})(typeof globalThis === 'undefined' ? this : globalThis, () => {
  const getQuarterInfo = (course) => {
    const label = String(course?.quarter || 'Q未定');
    if (label.includes('通期')) {
      return {
        label,
        quarters: [1, 2, 3, 4],
        options: [{ start: 1, end: 4, label: '1-4Q', contiguous: true }],
        start: 1,
        end: 4,
        contiguous: true
      };
    }

    const segments = label.split(/[,、]/).map((segment) => segment.trim()).filter(Boolean);
    const quarters = [...new Set((label.match(/[1-4]/g) || []).map(Number))].sort((a, b) => a - b);
    if (!quarters.length) return { label, quarters: [], options: [], start: null, end: null, contiguous: false };

    const options = [];
    segments.forEach((segment) => {
      const segmentQuarters = [...new Set((segment.match(/[1-4]/g) || []).map(Number))].sort((a, b) => a - b);
      if (!segmentQuarters.length) return;
      const isContiguous = segmentQuarters.every((quarter, index) => index === 0 || quarter === segmentQuarters[index - 1] + 1);
      if (isContiguous) {
        options.push({
          start: segmentQuarters[0],
          end: segmentQuarters[segmentQuarters.length - 1],
          label: segmentQuarters.length > 1
            ? `${segmentQuarters[0]}-${segmentQuarters[segmentQuarters.length - 1]}Q`
            : `${segmentQuarters[0]}Q`,
          contiguous: true
        });
      } else {
        segmentQuarters.forEach((quarter) => options.push({
          start: quarter,
          end: quarter,
          label: `${quarter}Q`,
          contiguous: false
        }));
      }
    });

    const uniqueOptions = options.filter((option, index, list) => list.findIndex((candidate) => candidate.start === option.start) === index);
    const firstOption = uniqueOptions[0];
    return {
      label,
      quarters,
      options: uniqueOptions,
      start: firstOption?.start || null,
      end: firstOption?.end || null,
      contiguous: uniqueOptions.length === 1
    };
  };

  const canPlaceCourseAt = (course, year, quarter) => {
    const q = Number(quarter);
    return Boolean(
      course
      && Number.isInteger(year) && year >= 1 && year <= 4
      && Number.isInteger(q)
      && getQuarterInfo(course).options.some((option) => option.start === q)
    );
  };

  const getRecommendedYear = (course) => {
    const match = String(course?.year || '').match(/^\s*([1-4])年次\s*$/);
    return match ? Number(match[1]) : null;
  };

  const getPlacementIssues = (course, placement) => {
    if (!course || !placement) return [];
    const issues = [];
    if (!getQuarterInfo(course).options.some((option) => option.start === Number(placement.selectedQuarter))) {
      const q = Number(placement.selectedQuarter);
      issues.push({
        type: 'quarter',
        message: Number.isInteger(q) && q >= 1 && q <= 4
          ? `この科目はQ${q}には開講されません。配置を修正してください。`
          : '配置Qを確認できません。開講Qへの配置に修正してください。'
      });
    }

    const recommendedYear = getRecommendedYear(course);
    if (recommendedYear && placement.year !== recommendedYear) {
      issues.push({
        type: 'year',
        recommendedYear,
        message: `${recommendedYear}年次推奨（現在は${placement.year}年）`
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

  const resetPlanStorage = (storage, key) => {
    const plan = createEmptyPlan();
    storage.setItem(key, JSON.stringify(plan));
    return plan;
  };

  return Object.freeze({
    getQuarterInfo,
    canPlaceCourseAt,
    getRecommendedYear,
    getPlacementIssues,
    applyPlacement,
    createEmptyPlan,
    resetPlanStorage
  });
});
