/** 科目探索・詳細表示・絞り込み。カタログIDは変更しない。
 * contextは共有状態と明示的なコールバックだけを受け取る。
 * コールバックは初期化完了後に呼び、コントローラー間でDOMや保存処理を複製しない。
 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const clearCourseFilters = () => {
    context.state.filterYear = 'すべて表示';
    context.state.filterQuarter = 'すべて表示';
    context.state.filterCategory = '分野';
    context.state.filterRequirement = 'すべて表示';
    context.state.filterIntro = 'すべて表示';
    context.state.filterSearch = '';
    context.state.difficultySort = 'default';
    context.state.excludePixiv = false;
    context.saveFilterPreferences({ excludePixiv: false });

    const values = {
      'year-filter': context.state.filterYear,
      'quarter-filter': context.state.filterQuarter,
      'category-filter': context.state.filterCategory,
      'requirement-filter': context.state.filterRequirement,
      'intro-filter': context.state.filterIntro,
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = '';
    const excludePixiv = document.getElementById('exclude-pixiv-filter');
    if (excludePixiv) excludePixiv.checked = false;
    context.syncCourseSortOptions();
    renderPredefinedList();
  };

  let relatedDetailReturnFocus = null;

  const renderRelationLinks = (relationItems) =>
    (relationItems || [])
      .map((relation) => {
        const relatedId = typeof relation === 'string' ? relation : relation.id;
        const strength = typeof relation === 'string' ? 'recommended' : relation.strength;
        const relatedCourse = context.state.coursesMap.get(relatedId);
        if (!relatedCourse) return '';
        const strengthLabel = strength === 'strongly_recommended' ? '強く推奨' : '推奨';
        const strengthClass = strength === 'strongly_recommended' ? 'strong' : 'recommended';
        return `<li><a href="#course-${context.escapeHTML(relatedCourse.id)}" class="related-course-link" data-course-id="${context.escapeHTML(relatedCourse.id)}">${context.escapeHTML(relatedCourse.subject)}</a> <span class="relation-strength ${strengthClass}">${strengthLabel}</span></li>`;
      })
      .join('');

  const renderCourseDetailMarkup = (data) => {
    if (!data || typeof data.id !== 'string' || !data.id) return '';

    const difficulty = context.state.difficultyMap.get(data.id);
    const safeSyllabusUrl = context.sanitizeExternalUrl(data.url);
    const teacher = String(data.teacher || '');
    const teacherParts = teacher.split(', ');
    const displayTeacher =
      teacherParts.length > 1 ? `${teacherParts[0]} 他${teacherParts.length - 1}名` : teacher;
    const difficultyHtml = difficulty
      ? `
      <section class="difficulty-section" aria-label="授業難易度">
        <h5 class="difficulty-title">📊 授業難易度</h5>
        <p><strong>難易度目安：</strong>${difficulty.average.toFixed(2)} / 10.0</p>
        <p><strong>投票数：</strong>${difficulty.votes}票</p>
        <p class="difficulty-source-row">
          <strong>出典：</strong><a href="${context.escapeHTML(difficulty.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="difficulty-source">${context.escapeHTML(difficulty.sourceLabel)}</a>
        </p>
      </section>
    `
      : '';

    const relations = context.state.relationsMap.get(data.id);
    const prerequisiteLinks = renderRelationLinks(relations?.prerequisites);
    const successorLinks = renderRelationLinks(relations?.successors);
    const relationsHtml =
      prerequisiteLinks || successorLinks
        ? `
      <section class="course-relations" aria-label="関連科目">
        <h5 class="course-relations-title">関連科目</h5>
        ${prerequisiteLinks ? `<div class="course-relation-group"><strong>前提科目</strong><ul>${prerequisiteLinks}</ul></div>` : ''}
        ${successorLinks ? `<div class="course-relation-group"><strong>後継科目</strong><ul>${successorLinks}</ul></div>` : ''}
      </section>
    `
        : '';

    return `
      <h4 class="detail-subject" tabindex="-1">${context.escapeHTML(data.subject)}</h4>
      <div class="detail-badges">
        <span class="badge-cat ${data.category === '必修' || data.category === '選択必修' ? 'important' : ''}">${context.escapeHTML(data.category)}</span>
        <span class="badge-item">${context.escapeHTML(data.credits)}単位</span>
        <span class="badge-item">${context.escapeHTML(data.year)}</span>
        <span class="badge-item">${context.escapeHTML(data.quarter)}</span>
      </div>
      <div class="detail-sections">
        <p><strong>科目区分:</strong> ${context.escapeHTML(data.method || '-')} ${data.remarks ? `(${context.escapeHTML(data.remarks)})` : ''}</p>
        <p><strong>タグ:</strong> ${data.tag ? `#${context.escapeHTML(data.tag)}` : '-'}</p>
        <p><strong>教員情報:</strong> ${context.escapeHTML(displayTeacher)}</p>
        <p class="evaluation"><strong>評価方法:</strong> ${context.escapeHTML(data.evaluation)}</p>
        ${safeSyllabusUrl ? `<p><a href="${context.escapeHTML(safeSyllabusUrl)}" target="_blank" rel="noopener noreferrer" class="syllabus-link" title="ZEN大学シラバスサイトの該当ページを開きます">ZEN大学シラバスで詳細を確認</a></p>` : ''}
        <p class="description"><strong>授業概要:</strong> ${context.escapeHTML(data.description)}</p>
        ${window.ZenExam.detail(data)}
        ${difficultyHtml}
        ${relationsHtml}
      </div>
    `;
  };

  const bindRelatedCourseLinks = (container) => {
    container.querySelectorAll('.related-course-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const courseId = link.dataset.courseId;
        if (typeof courseId !== 'string' || !context.state.coursesMap.has(courseId)) return;

        if (context.relatedCourseDetailHost && context.relatedCourseDetailHost.hidden) {
          const sourceItem = link.closest('.predefined-item');
          relatedDetailReturnFocus = sourceItem?.querySelector('.detail-btn') || document.activeElement;
        }

        openCourseDetail(courseId);
      });
    });
  };

  const closeRelatedCourseDetail = (returnFocus = true) => {
    if (!context.relatedCourseDetailHost) return;
    context.relatedCourseDetailHost.hidden = true;
    context.relatedCourseDetailHost.replaceChildren();
    if (returnFocus && relatedDetailReturnFocus?.isConnected) relatedDetailReturnFocus.focus();
    relatedDetailReturnFocus = null;
  };

  const openCourseDetail = (courseId) => {
    const course = context.state.coursesMap.get(courseId);
    if (!course || !context.relatedCourseDetailHost) return;

    // 関連詳細は探索リスト外の独立領域で描画し、現在の検索・フィルター結果を変更しない。
    context.predefinedList.querySelectorAll('.class-detail.open').forEach((detail) => {
      detail.classList.remove('open');
      detail
        .closest('.predefined-item')
        ?.querySelector('.detail-btn')
        ?.setAttribute('aria-expanded', 'false');
    });

    context.relatedCourseDetailHost.innerHTML = `
      <div class="related-course-detail-shell">
        <button class="related-detail-close" type="button" aria-label="関連科目の詳細を閉じる">×</button>
        <div class="class-detail open">${renderCourseDetailMarkup(course)}</div>
      </div>
    `;
    context.relatedCourseDetailHost.hidden = false;
    context.relatedCourseDetailHost
      .querySelector('.related-detail-close')
      ?.addEventListener('click', () => closeRelatedCourseDetail());
    bindRelatedCourseLinks(context.relatedCourseDetailHost);
    context.relatedCourseDetailHost.querySelector('.detail-subject')?.focus({ preventScroll: true });
    context.relatedCourseDetailHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      context.relatedCourseDetailHost &&
      !context.relatedCourseDetailHost.hidden
    ) {
      closeRelatedCourseDetail();
    }
  });

  /**
   * 既定の授業リスト（左カラム）を画面に描画する関数
   * renderAll() 内で呼び出されるため、初期化エラー（ReferenceError）を避けるために
   * renderAll や fetch 処理よりも前に定義する必要があります。
   */
  const renderPredefinedList = () => {
    context.predefinedList.innerHTML = '';

    const filtered = context.state.predefinedData.filter((item) => {
      const matchYear = context.state.filterYear === 'すべて表示' || item.year === context.state.filterYear;

      // 学期（Quarter）判定：範囲指定(1Q〜2Q)や複数指定(1Q・2Q)に対応した正規化判定
      const matchQuarter = (function () {
        const f = context.state.filterQuarter;
        const q = item.quarter || '';
        if (f === 'すべて表示') return true;

        const filterNum = parseInt(f.replace(/[^0-9]/g, ''));
        // 1. 範囲記号（〜やハイフン）の前後のスペースを消し、記号を半角ハイフンに統一
        // 2. 区切り記号（・やカンマ、残ったスペース）を半角カンマに統一
        const standardized = q.replace(/\s*[〜～ー－–—-]\s*/g, '-').replace(/[・,、，\s]+/g, ',');

        return standardized
          .split(',')
          .filter(Boolean)
          .some((part) => {
            if (part.includes('-')) {
              const nums = part.split('-').map((s) => parseInt(s.replace(/[^0-9]/g, '')));
              if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
                return filterNum >= nums[0] && filterNum <= nums[1];
              }
            }
            return part.trim() === f || parseInt(part.replace(/[^0-9]/g, '')) === filterNum;
          });
      })();

      const matchRequirement =
        context.state.filterRequirement === 'すべて表示' || item.category === context.state.filterRequirement;

      // 導入科目フィルタは外部化された卒業要件定義を参照する。
      const introductionCourseIds =
        context.state.graduationDefinition?.requirements?.introduction?.courseIds || [];
      const matchIntro =
        context.state.filterIntro === 'すべて表示' ||
        (context.state.filterIntro === '該当'
          ? introductionCourseIds.includes(item.id)
          : !introductionCourseIds.includes(item.id));

      let matchCategory = context.state.filterCategory === '分野';
      if (!matchCategory) {
        if (context.state.filterCategory === '多言語情報理解') {
          matchCategory =
            item.multilingualRequirement === true ||
            item.foundationRequirement === '多言語情報理解' ||
            item.tag === '多言語' ||
            item.subject === '多言語ITコミュニケーション';
        } else if (context.state.filterCategory === '自由科目') {
          matchCategory = item.category === '自由' || item.tag === '自由科目';
        } else {
          matchCategory = item.tag === context.state.filterCategory;
        }
      }

      const searchLower = context.state.filterSearch.toLowerCase();

      const matchSearch =
        item.subject.toLowerCase().includes(searchLower) ||
        item.teacher.toLowerCase().includes(searchLower) ||
        (item.tag && item.tag.toLowerCase().includes(searchLower.replace('#', '')));

      const matchProvider = !context.state.excludePixiv || item.provider !== 'pixiv';

      return (
        matchYear &&
        matchQuarter &&
        matchRequirement &&
        matchIntro &&
        matchCategory &&
        matchSearch &&
        matchProvider
      );
    });

    const sorted = context.sortCourses(filtered, context.state.difficultySort, context.state.difficultyMap);

    const hasActiveFilters = Boolean(
      context.state.filterSearch.trim() ||
      context.state.filterYear !== 'すべて表示' ||
      context.state.filterQuarter !== 'すべて表示' ||
      context.state.filterCategory !== '分野' ||
      context.state.filterRequirement !== 'すべて表示' ||
      context.state.filterIntro !== 'すべて表示' ||
      context.state.difficultySort !== 'default' ||
      context.state.excludePixiv,
    );

    const activeConditionCount = [
      context.state.filterYear !== 'すべて表示',
      context.state.filterQuarter !== 'すべて表示',
      context.state.filterCategory !== '分野',
      context.state.filterRequirement !== 'すべて表示',
      context.state.excludePixiv,
      context.state.difficultySort !== 'default',
    ].filter(Boolean).length;

    const activeCountElement = document.getElementById('filter-active-count');
    if (activeCountElement) {
      activeCountElement.hidden = activeConditionCount === 0;
      activeCountElement.textContent = activeConditionCount > 0 ? String(activeConditionCount) : '';
    }

    // 検索結果件数と条件解除ボタンを同期する。
    const searchCountEl = document.getElementById('search-count');
    if (searchCountEl) {
      searchCountEl.textContent = `表示中：${sorted.length}科目`;
    }
    const clearFiltersButton = document.getElementById('clear-course-filters');
    if (clearFiltersButton) clearFiltersButton.hidden = !hasActiveFilters;

    if (!sorted.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'course-empty-state';
      emptyItem.innerHTML = `
        <p>該当する科目がありません。</p>
        ${hasActiveFilters ? '<button type="button" class="empty-reset-btn">条件をすべて解除</button>' : ''}
      `;
      emptyItem.querySelector('.empty-reset-btn')?.addEventListener('click', clearCourseFilters);
      context.predefinedList.appendChild(emptyItem);
      return;
    }

    sorted.forEach((data) => {
      const isRegistered = context.state.registeredClasses.has(data.id);
      const isCompleted = context.state.completedClasses.has(data.id);
      // UI上の背景色などは「どちらかに入っている」場合に適用
      const isHandled = isRegistered || isCompleted;

      // 難易度データが登録されている科目に限り、詳細欄へ表示する
      const difficulty = context.state.difficultyMap.get(data.id);
      const li = document.createElement('li');

      const addButton = isRegistered
        ? '<button class="add-predefined current-state" disabled>履修予定 ✓</button>'
        : isCompleted
          ? '<button class="add-predefined">履修予定に戻す</button>'
          : '<button class="add-predefined">追加</button>';
      const completeButton = isCompleted
        ? '<button class="complete-predefined current-state" disabled>履修済み ✓</button>'
        : isRegistered
          ? '<button class="complete-predefined">履修済みにする</button>'
          : '<button class="complete-predefined">履修済み</button>';

      li.className = 'predefined-item';
      li.id = `course-${data.id}`;
      li.dataset.courseId = data.id;
      li.innerHTML = `
        <div class="class-item ${isHandled ? 'added' : ''}">


          <div class="class-info">
            <strong>${context.escapeHTML(data.subject)}</strong>
            <div class="class-meta">
              ${data.category === '必修' || data.category === '選択必修' ? `<span class="badge required">${context.escapeHTML(data.category)}</span>` : ''}
              ${data.year ? `<span class="badge">${context.escapeHTML(data.year)}</span>` : ''}
              ${
                data.quarter
                  ? data.quarter
                      .replace(/\s*([〜～ー－–—-])\s*/g, '$1')
                      .split(/[・,、，\s]+/)
                      .filter(Boolean)
                      .map((q) => `<span class="badge">${context.escapeHTML(q)}</span>`)
                      .join('')
                  : ''
              }
              ${difficulty ? `<span class="badge difficulty-badge">難易度 ${difficulty.average.toFixed(1)}</span>` : ''}
            </div>
          </div>
          <div class="actions">
            <button class="detail-btn" type="button" aria-expanded="false">詳細</button>
            ${addButton}
            ${completeButton}
          </div>
        </div>
        <div class="class-detail">${renderCourseDetailMarkup(data)}</div>
      `;

      const detailBtn = li.querySelector('.detail-btn');
      const detailDiv = li.querySelector('.class-detail');
      detailBtn.onclick = () => {
        const isOpen = detailDiv.classList.toggle('open');
        detailBtn.setAttribute('aria-expanded', String(isOpen));
      };
      bindRelatedCourseLinks(li);

      li.querySelector('.add-predefined').onclick = () => {
        // 排他的な追加（登録予定へ）
        context.commitStateChange(data.id, 'REGISTER');
      };

      li.querySelector('.complete-predefined').onclick = () => {
        // 排他的な追加（履修済みへ）
        context.commitStateChange(data.id, 'COMPLETE');
      };

      context.predefinedList.appendChild(li);
    });
  };
  return { clearCourseFilters, renderCourseDetailMarkup, renderPredefinedList };
});
