(function initializeFeedback(root) {
  'use strict';
  const form = root.document.forms.feedback;
  if (!form) return;
  const status = root.document.getElementById('feedback-status');
  const params = new URLSearchParams(root.location.search);

  function prefillCategory() {
    const category = params.get('category');
    if ([...form.elements.category.options].some(option => option.value === category)) {
      form.elements.category.value = category;
    }
  }

  async function prefillCourse() {
    if (!params.has('courseId')) return;
    try {
      const response = await root.fetch('courses.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const courses = await response.json();
      if (!Array.isArray(courses)) throw new TypeError('Invalid course catalog');
      // Never trust the subject supplied by a URL; derive it from the existing catalog ID.
      const course = courses.find(item => item.id === params.get('courseId'));
      if (course) {
        form.elements.courseId.value = course.id;
        form.elements.courseName.value = course.subject;
      }
    } catch (error) {
      console.error('報告対象の科目を確認できません:', error);
      status.textContent = '科目情報を確認できません。必要な内容を本文に記入してください。';
    }
  }

  prefillCategory();
  prefillCourse();
  // Native POST delegates acceptance and the result page to Netlify.
  // A local preview must never claim that the service accepted a submission.
  form.addEventListener('submit', event => {
    if (['localhost', '127.0.0.1'].includes(root.location.hostname) || root.location.protocol === 'file:') {
      event.preventDefault();
      status.textContent = 'この環境では送信できません。公開サイトから送信してください。';
    }
  });
})(window);
