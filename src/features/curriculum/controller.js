/** 互換性を維持する埋め込みマップ。公開の独立マップとはカメラ状態を共有しない。
 * contextは共有状態と明示的なコールバックだけを受け取る。
 * コールバックは初期化完了後に呼び、コントローラー間でDOMや保存処理を複製しない。
 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubCurriculum = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const curriculumState = {
    search: '',
    year: 'すべて表示',
    field: 'すべて表示',
    selectedId: '',
    // Reference relations are intentionally opt-in: the official PDF does not
    // define these prerequisite/successor edges, so hiding them by default
    // keeps the map legible and prevents an advisory graph from looking official.
    relationMode: 'off',
    didDrag: false,
    layout: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    fullscreen: false,
    enrollmentOpen: false,
    enrollmentManualOpen: false,
    enrollmentAutoOpened: false,
    autoFit: true,
    searchHighlightId: '',
    searchHighlightTimer: null,
    searchCandidateId: '',
  };

  // The map card handlers live outside setupCurriculumTree, so the drawer
  // transition helper must be shared at this scope. Keeping the existing
  // enrollment content and drop zone untouched preserves the normal
  // myClasses storage path while allowing drag registration to reveal them.
  const { setCurriculumEnrollmentOpen, setupCurriculumTree } = window.ZenCurriculumInteractions.create({
    get publicEnabled() {
      return context.publicEnabled;
    },
    get loadCurriculumLayoutDefinition() {
      return context.loadCurriculumLayoutDefinition;
    },
    get state() {
      return context.state;
    },
    get qualityUtils() {
      return context.qualityUtils;
    },
    get syncPrimaryViewNavigation() {
      return context.syncPrimaryViewNavigation;
    },
    get commitStateChange() {
      return context.commitStateChange;
    },
    get curriculumState() {
      return curriculumState;
    },
    get buildCurriculumLayout() {
      return buildCurriculumLayout;
    },
    get getCurriculumMatch() {
      return getCurriculumMatch;
    },
    get setCurriculumStatus() {
      return setCurriculumStatus;
    },
    get clearCurriculumFocus() {
      return clearCurriculumFocus;
    },
    get openCurriculumCourseDetail() {
      return openCurriculumCourseDetail;
    },
    get triggerCurriculumSearchHighlight() {
      return triggerCurriculumSearchHighlight;
    },
    get renderCurriculumGraph() {
      return renderCurriculumGraph;
    },
  });

  /**
   * PDFの構図を固定した正規化キャンバスへ科目を割り当てる。
   * 個別科目の位置を文字の読めないPDFから推測しないため、公式図で確認できる
   * 大分類だけを配置定義へ持ち、同じ区分内のカードは既存メタデータの順で並べる。
   * 参考関係の線は公式の履修前提条件ではないので、表示時にも明示的に区別する。
   */
  const { getCurriculumField, getCurriculumTrack, buildCurriculumLayout } = window.ZenCurriculumLayout.create(
    {
      get state() {
        return context.state;
      },
    },
  );

  const getCurriculumMatch = (course) => {
    const search = curriculumState.search.trim().toLowerCase();
    const matchesSearch =
      !search ||
      [course.subject, course.teacher, course.tag].some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(search),
      );
    const matchesYear = curriculumState.year === 'すべて表示' || course.year === curriculumState.year;
    const matchesField =
      curriculumState.field === 'すべて表示' || getCurriculumField(course) === curriculumState.field;
    return matchesSearch && matchesYear && matchesField;
  };

  const getCurriculumFocusIds = () => {
    const focusIds = new Set();
    if (!curriculumState.selectedId) return focusIds;
    focusIds.add(curriculumState.selectedId);
    const relations = context.state.relationsMap.get(curriculumState.selectedId);
    (relations?.prerequisites || []).forEach((relation) => focusIds.add(relation.id));
    (relations?.successors || []).forEach((relation) => focusIds.add(relation.id));
    return focusIds;
  };

  const setCurriculumStatus = (message, isError = false) => {
    const status = document.getElementById('curriculum-tree-status');
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('is-error', isError);
  };

  // Pan/zoom only changes the shared map transform. Keeping this separate from
  // the card rebuild means pointer movement never recreates all 275 course nodes.

  const clearCurriculumFocus = () => {
    if (!curriculumState.selectedId && !curriculumState.searchHighlightId) return;
    curriculumState.selectedId = '';
    curriculumState.searchHighlightId = '';
    if (curriculumState.searchHighlightTimer) {
      window.clearTimeout(curriculumState.searchHighlightTimer);
      curriculumState.searchHighlightTimer = null;
    }
    const detail = document.getElementById('curriculum-course-detail');
    if (detail) {
      detail.hidden = true;
      detail.replaceChildren();
    }
    renderCurriculumGraph();
  };

  const openCurriculumCourseDetail = (courseId) => {
    const course = context.state.coursesMap.get(courseId);
    const detail = document.getElementById('curriculum-course-detail');
    if (!course || !detail) return;

    // A direct card click is a normal exploration action; only a search submit
    // is allowed to leave a transient highlight behind.
    curriculumState.searchHighlightId = '';
    if (curriculumState.searchHighlightTimer) {
      window.clearTimeout(curriculumState.searchHighlightTimer);
      curriculumState.searchHighlightTimer = null;
    }
    curriculumState.selectedId = courseId;
    const isRegistered = context.state.registeredClasses.has(courseId);
    const isCompleted = context.state.completedClasses.has(courseId);
    const actionLabel = isRegistered ? '通常履修から削除' : isCompleted ? '履修予定に戻す' : '通常履修に追加';
    detail.innerHTML = `
      <div class="curriculum-course-detail-heading">
        <h3>科目詳細</h3>
        <button type="button" class="curriculum-detail-close" aria-label="科目詳細を閉じる">×</button>
      </div>
      <div class="class-detail open">${context.renderCourseDetailMarkup(course)}</div>
      <div class="curriculum-detail-actions">
        <button type="button" class="curriculum-enrollment-action">${actionLabel}</button>
      </div>
    `;
    detail.hidden = false;
    detail.querySelector('.curriculum-detail-close')?.addEventListener('click', () => {
      clearCurriculumFocus();
    });
    detail.querySelector('.curriculum-enrollment-action')?.addEventListener('click', () => {
      const saved = context.commitStateChange(courseId, isRegistered ? 'DELETE' : 'REGISTER');
      openCurriculumCourseDetail(courseId);
      setCurriculumStatus(
        saved
          ? `${course.subject}の通常履修状態を更新しました。`
          : `${course.subject}の変更を保存できませんでした。`,
        !saved,
      );
    });
    detail.querySelectorAll('.related-course-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const relatedId = link.dataset.courseId;
        if (relatedId && context.state.coursesMap.has(relatedId)) openCurriculumCourseDetail(relatedId);
      });
    });
    renderCurriculumGraph();
    detail.querySelector('.detail-subject')?.focus({ preventScroll: true });
  };

  const triggerCurriculumSearchHighlight = (courseId) => {
    curriculumState.searchHighlightId = courseId;
    if (curriculumState.searchHighlightTimer) window.clearTimeout(curriculumState.searchHighlightTimer);
    renderCurriculumGraph();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    curriculumState.searchHighlightTimer = window.setTimeout(
      () => {
        curriculumState.searchHighlightId = '';
        curriculumState.searchHighlightTimer = null;
        renderCurriculumGraph();
      },
      reduceMotion ? 1200 : 2200,
    );
  };

  const createCurriculumEdgePath = (from, to) => {
    const bend = Math.max(46, Math.abs(to.x - from.x) * 0.42);
    return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
  };

  const renderCurriculumGraph = () => {
    const graph = document.getElementById('curriculum-graph');
    const lanesHost = document.getElementById('curriculum-lanes');
    const edgesHost = document.getElementById('curriculum-edges');
    const stageAxis = document.getElementById('curriculum-stage-axis');
    const count = document.getElementById('curriculum-tree-count');
    if (!graph || !lanesHost || !edgesHost || !count || !context.state.predefinedData.length) return;

    try {
      const layout = curriculumState.layout || buildCurriculumLayout();
      curriculumState.layout = layout;
      graph.style.width = `${layout.graphWidth}px`;
      graph.style.height = `${layout.graphHeight}px`;
      graph.style.transformOrigin = '0 0';
      graph.style.transform = `translate(${curriculumState.panX || 0}px, ${curriculumState.panY || 0}px) scale(${curriculumState.zoom})`;
      lanesHost.innerHTML = '';
      if (stageAxis) stageAxis.innerHTML = '';
      edgesHost.innerHTML =
        '<defs><marker id="curriculum-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 0 z"></path></marker></defs>';
      edgesHost.setAttribute('width', String(layout.graphWidth));
      edgesHost.setAttribute('height', String(layout.graphHeight));
      edgesHost.setAttribute('viewBox', `0 0 ${layout.graphWidth} ${layout.graphHeight}`);
      (layout.definition.bands || []).forEach((band) => {
        if (!stageAxis) return;
        const bandEl = document.createElement('div');
        bandEl.className = `curriculum-official-band ${band.id}`;
        Object.assign(bandEl.style, {
          left: `${band.x}px`,
          top: `${band.y}px`,
          width: `${band.width}px`,
          height: `${band.height}px`,
          background: band.color || '',
        });
        bandEl.innerHTML = `<span>${context.escapeHTML(band.label || '')}</span>`;
        stageAxis.appendChild(bandEl);
      });

      const focusIds = getCurriculumFocusIds();
      const hasFocus = curriculumState.relationMode === 'selected' && focusIds.size > 0;
      const matchesById = new Map();
      let matchCount = 0;
      const hasActiveFilter = Boolean(
        curriculumState.search.trim() ||
        curriculumState.year !== 'すべて表示' ||
        curriculumState.field !== 'すべて表示',
      );
      layout.columns.forEach((column) => {
        const lane = document.createElement('section');
        lane.className = 'curriculum-lane';
        lane.dataset.officialGroup = column.group || '';
        lane.style.left = `${column.x}px`;
        lane.style.width = `${column.width}px`;
        lane.style.height = `${layout.graphHeight}px`;
        lane.innerHTML = `<h3><span>${context.escapeHTML(column.label)}</span><small>公式区分（構造）</small></h3>`;
        const courses = layout.byColumn.get(column.id) || [];
        courses.forEach((course) => {
          const position = layout.positions.get(course.id);
          if (!position) return;
          const matches = getCurriculumMatch(course);
          matchesById.set(course.id, matches);
          if (matches) matchCount += 1;
          const isRegistered = context.state.registeredClasses.has(course.id);
          const isCompleted = context.state.completedClasses.has(course.id);
          const relatedToFocus = !hasFocus || focusIds.has(course.id);
          const node = document.createElement('article');
          node.className = `curriculum-node official-${position.officialGroup || 'unknown'}`;
          if (matches) node.classList.add('is-match');
          else node.classList.add('is-dimmed');
          if (!relatedToFocus) node.classList.add('is-out-of-focus');
          if (course.id === curriculumState.selectedId) node.classList.add('is-selected');
          if (course.id === curriculumState.searchHighlightId) node.classList.add('is-search-highlight');
          if (isRegistered) node.classList.add('is-registered');
          if (isCompleted) node.classList.add('is-completed');
          node.classList.add(
            `curriculum-credit-${String(course.credits || '').replace(/[^0-9]/g, '') || 'unknown'}`,
          );
          if (position.officialConfidence !== 'confirmed') node.classList.add('is-provisional');
          node.dataset.courseId = course.id;
          node.dataset.officialConfidence = position.officialConfidence;
          node.dataset.verificationMethod = position.verificationMethod;
          if (position.collisionSize > 1) {
            node.classList.add('is-collision');
            node.dataset.collisionGroup = position.collisionGroup;
            node.dataset.collisionIndex = String(position.collisionIndex);
            node.dataset.collisionSize = String(position.collisionSize);
          }
          node.title =
            position.officialConfidence === 'confirmed'
              ? '公式PDFで配置を確認済み'
              : '公式PDF上の位置未確認（暫定配置）';
          node.draggable = true;
          node.tabIndex = 0;
          node.setAttribute('role', 'button');
          const collisionLabel =
            position.collisionSize > 1
              ? `（同一座標の科目 ${position.collisionIndex + 1}/${position.collisionSize}）`
              : '';
          node.setAttribute('aria-label', `${course.subject}の科目詳細${collisionLabel}`);
          const statusLabel = isCompleted ? '履修済み' : isRegistered ? 'マイ履修' : '';
          node.style.top = `${position.top}px`;
          node.style.left = `${position.left - column.x}px`;
          node.style.width = `${position.width || layout.nodeWidth}px`;
          node.style.height = `${position.height || layout.nodeHeight}px`;
          node.style.zIndex = String(10 + position.collisionIndex);
          node.innerHTML = `<div class="curriculum-node-title">${context.escapeHTML(course.subject)}</div><div class="curriculum-node-meta"><span class="curriculum-node-track">${context.escapeHTML(getCurriculumTrack(course))}</span><span>${context.escapeHTML(course.credits)}単位</span><span>${context.escapeHTML(course.quarter || '開講Q未登録')}</span>${statusLabel ? `<span class="curriculum-node-status">${statusLabel}</span>` : ''}</div>`;
          const openDetail = () => {
            if (curriculumState.didDrag) return;
            if (curriculumState.selectedId === course.id) return clearCurriculumFocus();
            openCurriculumCourseDetail(course.id);
          };
          node.addEventListener('click', (event) => {
            if (!event.target.closest('button')) openDetail();
          });
          // curriculum-detail-btn / curriculum-add-btn は詳細パネルへ集約し、
          // 既存の commitStateChange(course.id, 'REGISTER') 経路を使う。
          node.addEventListener('keydown', (event) => {
            if (event.target === node && ['Enter', ' '].includes(event.key)) {
              event.preventDefault();
              openDetail();
            }
          });
          node.addEventListener('dragstart', (event) => {
            curriculumState.didDrag = true;
            if (!curriculumState.enrollmentManualOpen) {
              setCurriculumEnrollmentOpen(true, { auto: true });
            }
            node.classList.add('is-dragging');
            event.dataTransfer?.setData('text/plain', course.id);
            event.dataTransfer?.setData('application/x-zen-course-id', course.id);
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
            document.getElementById('curriculum-drop-zone')?.classList.add('is-dragging');
          });
          node.addEventListener('dragend', () => {
            node.classList.remove('is-dragging');
            document.getElementById('curriculum-drop-zone')?.classList.remove('is-dragging', 'is-over');
            window.setTimeout(() => {
              curriculumState.didDrag = false;
              if (curriculumState.enrollmentAutoOpened && !curriculumState.enrollmentManualOpen) {
                setCurriculumEnrollmentOpen(false);
              }
            }, 120);
          });
          lane.appendChild(node);
        });
        lanesHost.appendChild(lane);
      });
      const relationMode = curriculumState.relationMode;
      const showAllRelations = relationMode === 'all';
      const showSelectedRelations = relationMode === 'selected' && Boolean(curriculumState.selectedId);
      context.state.relationsMap.forEach((relations, sourceId) => {
        if (!showAllRelations && !showSelectedRelations) return;
        if (
          showSelectedRelations &&
          sourceId !== curriculumState.selectedId &&
          !relations.successors.some((relation) => relation.id === curriculumState.selectedId)
        )
          return;
        const from = layout.positions.get(sourceId);
        if (!from) return;
        relations.successors.forEach((relation) => {
          if (
            showSelectedRelations &&
            sourceId !== curriculumState.selectedId &&
            relation.id !== curriculumState.selectedId
          )
            return;
          const to = layout.positions.get(relation.id);
          if (!to) return;
          const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          edge.setAttribute('d', createCurriculumEdgePath(from, to));
          edge.setAttribute(
            'class',
            `curriculum-edge is-reference ${relation.strength === 'strongly_recommended' ? 'is-strong' : 'is-recommended'}`,
          );
          if (hasActiveFilter && !matchesById.get(sourceId) && !matchesById.get(relation.id))
            edge.classList.add('is-filter-dimmed');
          if (
            hasFocus &&
            (sourceId === curriculumState.selectedId || relation.id === curriculumState.selectedId)
          )
            edge.classList.add('is-focused');
          if (hasFocus && !(focusIds.has(sourceId) && focusIds.has(relation.id)))
            edge.classList.add('is-out-of-focus');
          edgesHost.appendChild(edge);
        });
      });
      count.textContent = `${matchCount} / ${context.state.predefinedData.length}科目`;
      const noMatches = hasActiveFilter && matchCount === 0;
      setCurriculumStatus(
        hasActiveFilter
          ? noMatches
            ? '該当する科目はありません。条件を解除してください。'
            : `${matchCount}科目が条件に一致しています。`
          : '',
        noMatches,
      );
    } catch (error) {
      console.error('カリキュラムツリーの描画に失敗しました:', error);
      setCurriculumStatus('ツリーを表示できませんでした。ページを再読み込みしてください。', true);
    }
  };

  const populateCurriculumFieldFilter = () => {
    const fieldFilter = document.getElementById('curriculum-tree-field');
    if (!fieldFilter) return;
    const fields = [...new Set(context.state.predefinedData.map(getCurriculumField))].sort((a, b) =>
      a.localeCompare(b, 'ja'),
    );
    fieldFilter.innerHTML =
      '<option value="すべて表示">すべて表示</option>' +
      fields
        .map((field) => `<option value="${context.escapeHTML(field)}">${context.escapeHTML(field)}</option>`)
        .join('');
  };

  return { curriculumState, renderCurriculumGraph, populateCurriculumFieldFilter, setupCurriculumTree };
});
