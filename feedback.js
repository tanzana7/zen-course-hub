(function initializeFeedback(root) {
  'use strict';
  const form = root.document.forms.feedback;
  if (!form) return;
  const status = root.document.getElementById('feedback-status');
  const params = new URLSearchParams(root.location.search);

  function prefillCategory() {
    const category = params.get('category');
    if ([...form.elements.category.options].some((option) => option.value === category)) {
      form.elements.category.value = category;
    }
  }

  // URLSearchParams already decodes percent-encoded Japanese; fill the visible
  // fields from the query first so a report always carries its source course,
  // then let the catalog confirm or correct the display name when possible.
  function prefillCourseFromQuery() {
    const courseId = params.get('courseId');
    const courseName = params.get('courseName');
    if (courseId != null) form.elements.courseId.value = courseId;
    if (courseName != null) form.elements.courseName.value = courseName;
  }

  async function confirmCourseWithCatalog() {
    const courseId = params.get('courseId');
    if (!courseId) return;
    try {
      const response = await root.fetch('courses.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const courses = await response.json();
      if (!Array.isArray(courses)) throw new TypeError('Invalid course catalog');
      const course = courses.find((item) => item.id === courseId);
      if (!course) throw new Error('Course not found in catalog');
      form.elements.courseId.value = course.id;
      form.elements.courseName.value = course.subject;
    } catch (error) {
      console.error('報告対象の科目をカタログで確認できませんでした。URLの値を表示します:', error);
    }
  }

  prefillCategory();
  prefillCourseFromQuery();
  confirmCourseWithCatalog();
  // Native POST delegates acceptance and the result page to Netlify.
  // A local preview must never claim that the service accepted a submission.
  form.addEventListener('submit', (event) => {
    if (['localhost', '127.0.0.1'].includes(root.location.hostname) || root.location.protocol === 'file:') {
      event.preventDefault();
      status.textContent = 'この環境では送信できません。公開サイトから送信してください。';
    }
  });
})(window);
