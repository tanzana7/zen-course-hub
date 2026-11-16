(function exposeExamUI(root) {
  'use strict';
  const { MESSAGES, createCatalog, getEnrollmentRows, reportUrl } = root.ZenExamSchedule;
  const { escapeHTML } = root.ZenQualityUtils;
  let catalog = new Map();
  let failed = false;
  let enrolledIds = [];

  const ready = fetch('exam-schedule-catalog.json')
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((data) => {
      catalog = createCatalog(data);
    })
    .catch((error) => {
      failed = true;
      console.error('試験日程を読み込めません:', error);
    });

  // Both HTML-based Hub details and DOM-based map details use the same content model.
  function getDetail(course) {
    return {
      entry: catalog.get(course.id),
      reports: [
        ...(catalog.has(course.id) ? [{ label: '試験日程の誤りを報告', category: '試験日程の誤り' }] : []),
        { label: 'この科目の情報を報告', category: '科目情報の誤り' },
      ].map((report) => ({ ...report, url: reportUrl(course, report.category) })),
    };
  }

  function detail(course) {
    const { entry, reports } = getDetail(course);
    const schedule = entry
      ? `<section><h5>${MESSAGES.title}</h5><p>${MESSAGES.notice}</p><ul>${entry.examSlots
          .map((slot) => `<li>${escapeHTML(slot.date)} ${slot.period}限</li>`)
          .join('')}</ul></section>`
      : failed
        ? `<p>${MESSAGES.error}</p>`
        : '';
    return (
      schedule +
      reports.map((report) => `<p><a href="${escapeHTML(report.url)}">${report.label}</a></p>`).join('')
    );
  }

  function appendDetail(host, course) {
    const doc = host.ownerDocument;
    const add = (tag, text) => {
      const node = doc.createElement(tag);
      node.textContent = text;
      host.append(node);
      return node;
    };
    const { entry, reports } = getDetail(course);
    if (entry) {
      add('h4', MESSAGES.title);
      add('p', MESSAGES.notice);
      for (const slot of entry.examSlots) add('p', `${slot.date} ${slot.period}限`);
    } else if (failed) {
      add('p', MESSAGES.error);
    }
    for (const report of reports) {
      const paragraph = add('p', '');
      const link = doc.createElement('a');
      link.textContent = report.label;
      link.href = report.url;
      paragraph.append(link);
    }
  }

  function renderEnrollment(ids = enrolledIds) {
    enrolledIds = [...new Set(ids)];
    const host = root.document.getElementById('exam-list');
    if (!host) return;
    if (failed) {
      host.textContent = MESSAGES.error;
      return;
    }
    const query = root.document.getElementById('exam-search')?.value || '';
    const rows = getEnrollmentRows(catalog, enrolledIds, query);
    host.replaceChildren();
    if (!rows.length) {
      host.textContent = MESSAGES.empty;
      return;
    }
    const fragment = host.ownerDocument.createDocumentFragment();
    let previousDate;
    for (const row of rows) {
      if (previousDate !== row.date) {
        previousDate = row.date;
        const heading = host.ownerDocument.createElement('h4');
        heading.textContent = row.date;
        fragment.append(heading);
      }
      const line = host.ownerDocument.createElement('p');
      line.textContent = `${row.period}限 ${row.courseName}${row.collision ? MESSAGES.collision : ''}`;
      fragment.append(line);
    }
    host.append(fragment);
  }

  root.ZenExam = { ready, detail, renderEnrollment, appendDetail };
  root.document.addEventListener('DOMContentLoaded', () => {
    root.document.getElementById('exam-search')?.addEventListener('input', () => renderEnrollment());
  });
})(window);
