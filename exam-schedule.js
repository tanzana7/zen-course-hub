/* Pure schedule queries are shared by both detail renderers and the enrollment list. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenExamSchedule = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const MESSAGES = Object.freeze({
    title: '試験日程（2027年2月・4Q）',
    notice: '日程は変更される可能性があります。',
    error: '試験日程を読み込めません。再読み込みしてください。',
    empty: '該当する試験日程はありません。',
    collision: ' — 同じ日時に複数科目の候補があります'
  });

  function createCatalog(data) {
    if (!Array.isArray(data?.matched)) throw new TypeError('Invalid exam catalog');
    const catalog = new Map();
    for (const record of data.matched) {
      if (!record || typeof record.courseId !== 'string' || !record.courseId ||
          typeof record.courseName !== 'string' || catalog.has(record.courseId) ||
          !Array.isArray(record.examSlots) || record.examSlots.some(slot =>
            !slot || !/^2027-02-\d{2}$/.test(slot.date) ||
            !Number.isInteger(slot.period) || slot.period < 1 || slot.period > 7)) {
        throw new TypeError('Invalid exam record');
      }
      catalog.set(record.courseId, record);
    }
    return catalog;
  }

  function getEnrollmentRows(catalog, enrolledIds, query = '') {
    const rows = [];
    const groups = new Map();
    // Count distinct courses before search so filtering cannot hide a real conflict.
    // Source columns are candidates; no official role or duration is inferred.
    for (const id of new Set(enrolledIds)) {
      const course = catalog.get(id);
      if (!course) continue;
      for (const slot of course.examSlots) {
        const key = `${slot.date}:${slot.period}`;
        if (!groups.has(key)) groups.set(key, new Set());
        groups.get(key).add(id);
        rows.push({ ...slot, courseId: id, courseName: course.courseName, key });
      }
    }
    return rows.filter(row => row.courseName.includes(query.trim()))
      .map(({ key, ...row }) => ({ ...row, collision: groups.get(key).size > 1 }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.period - b.period ||
        a.courseName.localeCompare(b.courseName, 'ja'));
  }

  function reportUrl(course, category) {
    return `feedback.html?${new URLSearchParams({ courseId: course.id, courseName: course.subject, category })}`;
  }

  return { MESSAGES, createCatalog, getEnrollmentRows, reportUrl };
}));
