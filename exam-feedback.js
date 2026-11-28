(function exposeExamUI(root) {
  'use strict';
  const { MESSAGES, createCatalog, getEnrollmentRows, reportUrl } = root.ZenExamSchedule;
  const { escapeHTML } = root.ZenQualityUtils;
  let catalog = new Map();
  let failed = false;
  let enrolledIds = [];
  let completedIds = [];

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

  function updateSummaryCount({ plannedCourses, plannedSlots, completedCourses, completedSlots }) {
    const summary = root.document.querySelector('#exam-schedule > summary');
    if (!summary) return;
    // 閉じた状態でも中身の規模が分かるように、科目数と試験枠数を両方添える。
    // 「件」は枠数で、1科目あたり複数枠あるため科目数だけだと誤解を招く。
    // 列挙・重なり判定は従来どおり。
    summary.textContent =
      completedSlots > 0
        ? `試験日程（予定 ${plannedCourses}科目・${plannedSlots}枠／履修済み ${completedCourses}科目・${completedSlots}枠）`
        : plannedSlots > 0
          ? `試験日程（予定 ${plannedCourses}科目・${plannedSlots}枠）`
          : '試験日程';
  }

  function renderEnrollment(ids = enrolledIds, completed = completedIds) {
    enrolledIds = [...new Set(ids)];
    completedIds = [...new Set(completed)];
    const host = root.document.getElementById('exam-list');
    if (!host) return;
    if (failed) {
      host.textContent = MESSAGES.error;
      updateSummaryCount(0);
      return;
    }
    const query = root.document.getElementById('exam-search')?.value || '';
    // 一覧は履修予定・履修済み両方（重複排除）。見出しの件数は検索で絞る前の実件数。
    const listIds = [...new Set([...enrolledIds, ...completedIds])];
    const allRows = getEnrollmentRows(catalog, listIds, '', completedIds);
    const plannedRows = allRows.filter((row) => !row.completed);
    const completedRows = allRows.filter((row) => row.completed);
    updateSummaryCount({
      plannedCourses: new Set(plannedRows.map((row) => row.courseId)).size,
      plannedSlots: plannedRows.length,
      completedCourses: new Set(completedRows.map((row) => row.courseId)).size,
      completedSlots: completedRows.length,
    });
    // 重なり警告は履修予定同士のみ。履修済みの行はバッジで区別して列挙は残す。
    const rows = getEnrollmentRows(catalog, listIds, query, completedIds);
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
      line.textContent = `${row.period}限 ${row.courseName}`;
      if (row.completed) {
        const badge = host.ownerDocument.createElement('span');
        badge.className = 'exam-completed-badge';
        badge.textContent = '履修済み';
        line.append(badge);
      }
      if (row.collision) {
        // 履修予定同士が同じ日付・時限に重なっていることの機械的な表示。
        // 日程の意味づけはしない。
        line.classList.add('exam-collision');
        line.textContent += MESSAGES.collision;
      }
      fragment.append(line);
    }
    host.append(fragment);
  }

  root.ZenExam = { ready, detail, renderEnrollment, appendDetail };
  root.document.addEventListener('DOMContentLoaded', () => {
    root.document.getElementById('exam-search')?.addEventListener('input', () => renderEnrollment());
  });
})(window);
