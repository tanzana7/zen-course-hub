/** 4年計画のダイアログ、配置先選択とフォーカスの往復。保存と判定はコールバックへ委譲する。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenSimulatorDialogs = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  let simulatorTriggerElement = null;

  let simulatorDetailTriggerElement = null;

  let simulatorPlacementTriggerElement = null;

  const focusElement = (element) => {
    if (element?.isConnected && typeof element.focus === 'function') element.focus();
  };

  const focusPalettePlacementButton = (courseId) => {
    const button = [...document.querySelectorAll('[data-sim-placement-course]')].find(
      (item) => item.dataset.simPlacementCourse === courseId,
    );
    focusElement(button || document.getElementById('sim-course-search'));
  };

  const closeSimulatorPlacementPicker = ({ restoreFocus = true, courseId = null } = {}) => {
    const dialog = document.getElementById('simulator-placement-dialog');
    if (dialog?.open) dialog.close();
    const trigger = simulatorPlacementTriggerElement;
    simulatorPlacementTriggerElement = null;
    if (restoreFocus) {
      if (trigger?.isConnected) focusElement(trigger);
      else if (courseId) focusPalettePlacementButton(courseId);
    }
  };

  const openSimulatorPlacementPicker = (courseId, trigger) => {
    const course = context.state.coursesMap.get(courseId);
    const dialog = document.getElementById('simulator-placement-dialog');
    const info = document.getElementById('simulator-placement-course-info');
    const optionsContainer = document.getElementById('simulator-placement-options');
    if (!course || !dialog || !info || !optionsContainer) return;

    const existingPlacement = context.getSimulatorPlacement(courseId);
    const quarterOptions = context.simulatorRules.getPlacementOptions(course);
    info.textContent = `${course.subject} · 開講Q: ${course.quarter || '未定'} · ${course.credits || 0}単位${existingPlacement ? ` · 現在: ${context.formatSimulatorPlacement(course, existingPlacement)}` : ''}`;
    // Materialize destinations only for the selected course; keeping choices out
    // of every palette card avoids multiplying the 275-course view by year/Q slots.
    optionsContainer.innerHTML = [1, 2, 3, 4]
      .map(
        (year) => `
      <section class="simulator-placement-year" aria-label="${year}年">
        <h3>${year}年</h3>
        <div>${quarterOptions
          .map(
            (option) => `
          <button type="button" class="simulator-placement-option" data-sim-place-year="${year}" data-sim-place-quarter="${option.start}">
            ${year}年 ${context.escapeHTML(option.label)}
          </button>
        `,
          )
          .join('')}</div>
      </section>
    `,
      )
      .join('');
    simulatorPlacementTriggerElement = trigger;
    try {
      dialog.showModal();
      optionsContainer.querySelector('button')?.focus();
    } catch (error) {
      simulatorPlacementTriggerElement = null;
      console.error('シミュレーターの配置先選択を開けませんでした。', error);
      focusElement(trigger);
    }
  };

  const trapDialogTab = (event, dialog) => {
    if (event.key !== 'Tab' || !dialog) return;
    const items = [
      ...dialog.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((item) => !item.hidden && item.getClientRects().length > 0);
    if (!items.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !dialog.contains(document.activeElement))
    ) {
      event.preventDefault();
      first.focus();
    }
  };

  const closeSimulatorCourseDetail = ({ restoreFocus = true } = {}) => {
    const modal = document.getElementById('simulator-course-detail');
    if (!modal) return;
    modal.classList.remove('is-active');
    modal.hidden = true;
    const trigger = simulatorDetailTriggerElement;
    simulatorDetailTriggerElement = null;
    if (restoreFocus) {
      if (trigger?.isConnected) focusElement(trigger);
      else if (trigger?.dataset?.simDetailCourse)
        focusPalettePlacementButton(trigger.dataset.simDetailCourse);
      else focusElement(document.getElementById('simulator-modal-title'));
    }
  };

  const openSimulatorCourseDetail = (courseId) => {
    const course = context.state.coursesMap.get(courseId);
    const placement = context.getSimulatorPlacement(courseId);
    const modal = document.getElementById('simulator-course-detail');
    const content = document.getElementById('simulator-course-detail-content');
    const title = document.getElementById('simulator-course-detail-title');
    if (!course || !modal || !content || !title) return;

    if (!modal.classList.contains('is-active')) simulatorDetailTriggerElement = document.activeElement;

    const warnings = placement ? context.getSimulatorWarnings(course, placement) : [];
    const placementIssues = placement ? context.simulatorRules.getPlacementIssues(course, placement) : [];
    const difficulty = context.state.difficultyMap.get(course.id);
    const relations = context.state.relationsMap.get(course.id);
    const renderRelationList = (items) =>
      (items || [])
        .map((relation) => {
          const relatedCourse = context.state.coursesMap.get(relation.id);
          if (!relatedCourse) return '';
          const strengthLabel = relation.strength === 'strongly_recommended' ? '強く推奨' : '推奨';
          const strengthClass = relation.strength === 'strongly_recommended' ? 'strong' : 'recommended';
          return `<li><button type="button" class="simulator-related-course" data-sim-related-course="${context.escapeHTML(relatedCourse.id)}">${context.escapeHTML(relatedCourse.subject)}</button> <span class="relation-strength ${strengthClass}">${strengthLabel}</span></li>`;
        })
        .join('');
    const prerequisiteList = renderRelationList(relations?.prerequisites);
    const successorList = renderRelationList(relations?.successors);
    const relationHtml =
      prerequisiteList || successorList
        ? `<section class="simulator-course-detail-relations" aria-label="関連科目">
          <h3>関連科目</h3>
          ${prerequisiteList ? `<div><strong>前提科目</strong><ul>${prerequisiteList}</ul></div>` : ''}
          ${successorList ? `<div><strong>後継科目</strong><ul>${successorList}</ul></div>` : ''}
        </section>`
        : '';
    const placementIssueHtml = placementIssues.length
      ? `<section class="simulator-course-detail-warnings" aria-label="配置の確認">
          <h3>配置の確認</h3>
          <ul>${placementIssues.map((issue) => `<li class="simulator-warning ${issue.type === 'quarter' ? 'strong' : ''}">${context.escapeHTML(issue.message)}</li>`).join('')}</ul>
        </section>`
      : '';
    title.textContent = course.subject;
    content.innerHTML = `
      <dl class="simulator-course-detail-list">
        <div><dt>開講Q</dt><dd>${context.escapeHTML(course.quarter || 'Q未定')}</dd></div>
        ${placement ? `<div><dt>選択Q</dt><dd>${context.escapeHTML(context.formatSimulatorPlacement(course, placement))}</dd></div>` : ''}
        <div><dt>単位</dt><dd>${context.escapeHTML(String(course.credits || 0))}単位</dd></div>
        ${course.tag ? `<div><dt>分野</dt><dd>${context.escapeHTML(course.tag)}</dd></div>` : ''}
        ${course.method ? `<div><dt>授業方法</dt><dd>${context.escapeHTML(course.method)}</dd></div>` : ''}
        ${course.teacher ? `<div><dt>担当</dt><dd>${context.escapeHTML(course.teacher)}</dd></div>` : ''}
        ${difficulty ? `<div><dt>難易度</dt><dd>${difficulty.average.toFixed(2)} / 10.0（${difficulty.votes}票）<br><a href="${context.escapeHTML(difficulty.sourceUrl)}" target="_blank" rel="noopener noreferrer">${context.escapeHTML(difficulty.sourceLabel)}</a></dd></div>` : ''}
      </dl>
      ${window.ZenExam.detail(course)}
      ${course.description ? `<section class="simulator-course-detail-description"><h3>概要</h3><p>${context.escapeHTML(course.description)}</p></section>` : ''}
      <section class="simulator-course-detail-warnings" aria-labelledby="simulator-course-detail-warning-title">
        <h3 id="simulator-course-detail-warning-title">前提科目</h3>
        ${
          warnings.length
            ? `<ul>${warnings.map((warning) => `<li class="simulator-warning ${warning.strengthClass === 'strong' ? 'strong' : ''}">${context.escapeHTML(warning.message)}（${context.escapeHTML(warning.strengthLabel)}）</li>`).join('')}</ul>`
            : `<p>${placement ? '前提科目に関する注意はありません' : '配置後に計画上の前提科目を確認できます'}</p>`
        }
      </section>
      ${placementIssueHtml}
      ${relationHtml}
      ${placement ? `<button type="button" class="simulator-course-detail-remove" data-sim-detail-remove="${context.escapeHTML(course.id)}">4年計画から削除</button>` : ''}
    `;
    modal.hidden = false;
    modal.classList.add('is-active');
    content.querySelector('[data-sim-detail-remove]')?.addEventListener('click', () => {
      context.removeSimulatorCourse(course.id);
      closeSimulatorCourseDetail();
    });
    content.querySelectorAll('[data-sim-related-course]').forEach((button) => {
      button.addEventListener('click', () => openSimulatorCourseDetail(button.dataset.simRelatedCourse));
    });
    title.focus();
  };

  const setupSimulatorModal = () => {
    const modal = document.getElementById('simulator-modal');
    const detailModal = document.getElementById('simulator-course-detail');
    const detailCloseButton = document.getElementById('close-simulator-course-detail');
    const placementDialog = document.getElementById('simulator-placement-dialog');
    const resetDialog = document.getElementById('simulator-reset-dialog');
    const placementOptions = document.getElementById('simulator-placement-options');
    const openResetButton = document.getElementById('open-simulator-reset');
    const cancelResetButton = document.getElementById('cancel-simulator-reset');
    const confirmResetButton = document.getElementById('confirm-simulator-reset');
    const closePlacementButton = document.getElementById('close-simulator-placement');
    const paletteResults = document.getElementById('sim-course-results');
    const yearGrid = document.getElementById('simulator-year-grid');
    const graduationDetails = document.getElementById('simulator-graduation-details-content');
    const graduationCourseDetail = document.getElementById('simulator-graduation-course-detail');
    const button = document.getElementById('simulator-btn');
    const closeButton = document.getElementById('close-simulator');
    const searchInput = document.getElementById('sim-course-search');
    if (!modal || !button) return;
    const simulatorTitle = modal.dataset.simulatorTitle || '4年間履修シミュレーター';
    // Keep the compact navigation label and beta badge authored in HTML; the
    // fallback preserves the existing title wiring for minimal test hosts.
    if (!button.querySelector('.view-beta-badge')) button.textContent = simulatorTitle;
    const title = document.getElementById('simulator-modal-title');
    let simulatorResetTriggerElement = null;
    if (title) title.textContent = simulatorTitle;
    if (!context.simulatorAvailable) {
      // A broken optional rules script must never prevent the ordinary Hub from loading.
      // Disabling the entry point is safer than allowing placements without Q validation.
      console.error('シミュレーターのルールを読み込めませんでした。');
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
      const notice = document.getElementById('simulator-unavailable');
      if (notice) notice.hidden = false;
      return;
    }

    const closeSimulator = () => {
      closeSimulatorPlacementPicker({ restoreFocus: false });
      closeSimulatorCourseDetail({ restoreFocus: false });
      modal.classList.remove('is-active');
      modal.hidden = true;
      document.body.classList.remove('simulator-view-active');
      context.syncPrimaryViewNavigation('list');
      focusElement(simulatorTriggerElement || button);
      simulatorTriggerElement = null;
    };

    button.onclick = () => {
      simulatorTriggerElement = button;
      // The three entries are peers, so opening the simulator always leaves
      // the tree mode before the fullscreen view is shown.
      document.body.classList.remove('curriculum-tree-mode');
      document.getElementById('curriculum-tree-view')?.setAttribute('hidden', '');
      document.getElementById('curriculum-drop-zone')?.setAttribute('hidden', '');
      modal.hidden = false;
      modal.classList.add('is-active');
      document.body.classList.add('simulator-view-active');
      context.syncPrimaryViewNavigation('simulator');
      context.renderSimulator();
      title?.focus();
    };
    if (closeButton) {
      closeButton.onclick = closeSimulator;
    }
    if (detailCloseButton) {
      detailCloseButton.onclick = closeSimulatorCourseDetail;
    }
    if (detailModal) {
      detailModal.addEventListener('click', (event) => {
        if (event.target === detailModal) closeSimulatorCourseDetail();
      });
    }
    openResetButton?.addEventListener('click', () => {
      if (!resetDialog) return;
      simulatorResetTriggerElement = openResetButton;
      resetDialog.showModal();
      cancelResetButton?.focus();
    });
    cancelResetButton?.addEventListener('click', () => resetDialog?.close());
    resetDialog?.addEventListener('close', () => {
      focusElement(simulatorResetTriggerElement);
      simulatorResetTriggerElement = null;
    });
    confirmResetButton?.addEventListener('click', () => {
      if (context.commitSimulatorPlan(context.simulatorRules.createEmptyPlan())) {
        context.showSimulatorFeedback('計画をリセットしました。');
      }
      resetDialog?.close();
    });
    closePlacementButton?.addEventListener('click', () => closeSimulatorPlacementPicker());
    placementDialog?.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeSimulatorPlacementPicker();
    });
    placementOptions?.addEventListener('click', (event) => {
      const optionButton = event.target.closest('[data-sim-place-year][data-sim-place-quarter]');
      const courseId = simulatorPlacementTriggerElement?.dataset.simPlacementCourse;
      if (!optionButton || !courseId) return;
      context.placeSimulatorCourse(
        courseId,
        Number(optionButton.dataset.simPlaceYear),
        Number(optionButton.dataset.simPlaceQuarter),
      );
      closeSimulatorPlacementPicker({ courseId });
    });
    // Search/filter/sort replaces palette children; delegated handlers keep listener
    // count independent of course count instead of binding to every card and button.
    paletteResults?.addEventListener('click', (event) => {
      const placementButton = event.target.closest('[data-sim-placement-course]');
      if (placementButton) {
        openSimulatorPlacementPicker(placementButton.dataset.simPlacementCourse, placementButton);
        return;
      }
      const detailButton = event.target.closest('[data-sim-detail-course]');
      if (!detailButton) return;
      const card = detailButton.closest('[data-sim-drag-course]');
      if (card?.dataset.simSkipClick === 'true' || card?.dataset.simDragging === 'true') return;
      openSimulatorCourseDetail(detailButton.dataset.simDetailCourse);
    });
    graduationDetails?.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-sim-graduation-detail]');
      if (trigger) context.renderSimulatorGraduationCourseDetail(trigger.dataset.simGraduationDetail);
    });
    graduationDetails?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const trigger = event.target.closest('[data-sim-graduation-detail]');
      if (!trigger) return;
      event.preventDefault();
      context.renderSimulatorGraduationCourseDetail(trigger.dataset.simGraduationDetail);
    });
    graduationCourseDetail?.addEventListener('click', (event) => {
      const courseButton = event.target.closest('[data-sim-detail-course]');
      if (!courseButton) return;
      openSimulatorCourseDetail(courseButton.dataset.simDetailCourse);
    });
    paletteResults?.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      item.dataset.simDragging = 'true';
      if (item.classList.contains('is-placed')) {
        event.preventDefault();
        return;
      }
      event.dataTransfer?.setData('text/plain', item.dataset.simDragCourse);
      context.highlightSimulatorDropCells(item.dataset.simDragCourse);
    });
    paletteResults?.addEventListener('dragend', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      delete item.dataset.simDragging;
      item.dataset.simSkipClick = 'true';
      window.setTimeout(() => delete item.dataset.simSkipClick, 0);
      context.clearSimulatorDropHighlights();
    });
    yearGrid?.addEventListener('dragenter', (event) => {
      const target = context.resolveSimulatorDropCell(event.target);
      const courseId = event.dataTransfer?.getData('text/plain');
      if (target && courseId && target.classList.contains('is-drop-allowed'))
        target.classList.add('is-drop-active');
    });
    yearGrid?.addEventListener('dragover', (event) => {
      const target = context.resolveSimulatorDropCell(event.target);
      if (!target) return;
      // Accept the drop event on invalid cells only to give feedback; shared validation still rejects it.
      event.preventDefault();
      if (target.classList.contains('is-drop-allowed')) target.classList.add('is-drop-active');
    });
    yearGrid?.addEventListener('dragleave', (event) => {
      const target = context.resolveSimulatorDropCell(event.target);
      const relatedTarget = context.resolveSimulatorDropCell(event.relatedTarget);
      if (target && relatedTarget !== target) target.classList.remove('is-drop-active');
    });
    yearGrid?.addEventListener('drop', (event) => {
      const target = context.resolveSimulatorDropCell(event.target);
      if (!target) return;
      event.preventDefault();
      context.clearSimulatorDropHighlights();
      const courseId = event.dataTransfer?.getData('text/plain');
      if (courseId)
        context.placeSimulatorCourse(
          courseId,
          Number(target.dataset.simDropYear),
          Number(target.dataset.simDropQuarter),
        );
    });
    yearGrid?.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      item.dataset.simDragging = 'true';
      event.dataTransfer?.setData('text/plain', item.dataset.simDragCourse);
      context.highlightSimulatorDropCells(item.dataset.simDragCourse);
    });
    yearGrid?.addEventListener('dragend', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      delete item.dataset.simDragging;
      item.dataset.simSkipClick = 'true';
      window.setTimeout(() => delete item.dataset.simSkipClick, 0);
      context.clearSimulatorDropHighlights();
    });
    yearGrid?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-sim-remove-course]');
      if (removeButton) {
        context.removeSimulatorCourse(removeButton.dataset.simRemoveCourse);
        return;
      }
      const warningButton = event.target.closest('[data-sim-warning-course]');
      if (warningButton) {
        openSimulatorCourseDetail(warningButton.dataset.simWarningCourse);
        return;
      }
      const detailButton = event.target.closest('[data-sim-detail-course]');
      if (!detailButton) return;
      const card = detailButton.closest('[data-sim-drag-course]');
      if (card?.dataset.simSkipClick === 'true' || card?.dataset.simDragging === 'true') return;
      openSimulatorCourseDetail(detailButton.dataset.simDetailCourse);
    });
    document.getElementById('simulator-unknown-courses')?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-sim-remove-course]');
      if (removeButton) context.removeSimulatorCourse(removeButton.dataset.simRemoveCourse);
    });
    window.addEventListener('keydown', (event) => {
      if (!modal.classList.contains('is-active')) return;
      // The fullscreen view and detail layer are div-based dialogs, so contain Tab
      // in the active layer. The placement picker is native <dialog> and traps focus itself.
      if (placementDialog?.open || resetDialog?.open) return;
      if (event.key === 'Tab') {
        trapDialogTab(event, detailModal?.classList.contains('is-active') ? detailModal : modal);
        return;
      }
      if (event.key !== 'Escape') return;
      if (detailModal?.classList.contains('is-active')) {
        closeSimulatorCourseDetail();
        return;
      }
      closeSimulator();
    });
    if (searchInput) searchInput.addEventListener('input', context.renderSimulatorCourseResults);
    [
      'sim-course-year-filter',
      'sim-course-quarter-filter',
      'sim-course-category-filter',
      'sim-course-placement-filter',
    ]
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((select) =>
        select.addEventListener('change', () => {
          if (select.id === 'sim-course-placement-filter')
            context.state.simulatorPlacementFilter = select.value;
          context.renderSimulatorCourseResults();
        }),
      );
    document.querySelectorAll('[data-sim-palette-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        context.state.simulatorPaletteMode = tab.dataset.simPaletteMode === 'scheduled' ? 'scheduled' : 'all';
        document.querySelectorAll('[data-sim-palette-mode]').forEach((item) => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        context.renderSimulatorCourseResults();
      });
    });
  };
  return { setupSimulatorModal };
});
