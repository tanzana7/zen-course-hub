/** 埋め込みマップの入力、パン・ズーム、履修ドロップ。描画と保存はコールバックで接続する。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenCurriculumInteractions = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const setCurriculumEnrollmentOpen = (open, { manual = false, auto = false } = {}) => {
    const enrollmentContent = document.getElementById('my-enrollment-content');
    const nextOpen = Boolean(open);
    const dropZone = document.getElementById('curriculum-drop-zone');
    const enrollmentDrawerToggle = document.getElementById('curriculum-enrollment-drawer-toggle');
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    context.curriculumState.enrollmentOpen = nextOpen;
    if (manual) context.curriculumState.enrollmentManualOpen = nextOpen;
    context.curriculumState.enrollmentAutoOpened = auto && nextOpen;
    document.body.classList.toggle('curriculum-enrollment-open', nextOpen);
    if (enrollmentContent) enrollmentContent.hidden = !nextOpen;
    if (dropZone) dropZone.hidden = !nextOpen;
    if (enrollmentDrawerToggle) {
      enrollmentDrawerToggle.setAttribute('aria-expanded', String(nextOpen));
      enrollmentDrawerToggle.textContent = nextOpen ? '通常履修を閉じる' : '通常履修';
    }
    if (mobileEnrollmentToggle) {
      mobileEnrollmentToggle.hidden = !document.body.classList.contains('curriculum-tree-mode');
      mobileEnrollmentToggle.setAttribute('aria-expanded', String(nextOpen));
    }
  };

  const applyCurriculumTransform = () => {
    const graph = document.getElementById('curriculum-graph');
    if (!graph) return;
    graph.style.transformOrigin = '0 0';
    graph.style.transform = `translate(${context.curriculumState.panX || 0}px, ${context.curriculumState.panY || 0}px) scale(${context.curriculumState.zoom})`;
    const zoomLevel = document.getElementById('curriculum-zoom-level');
    if (zoomLevel) zoomLevel.textContent = `${Math.round(context.curriculumState.zoom * 100)}%`;
  };

  const setupCurriculumTree = () => {
    const nav = document.getElementById('curriculum-tree-nav');
    const close = document.getElementById('curriculum-tree-close');
    const view = document.getElementById('curriculum-tree-view');
    const dropZone = document.getElementById('curriculum-drop-zone');
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    const enrollmentTitle = document.getElementById('my-enrollment-title');
    const search = document.getElementById('curriculum-tree-search');
    const year = document.getElementById('curriculum-tree-year');
    const field = document.getElementById('curriculum-tree-field');
    const graph = document.getElementById('curriculum-graph');
    const graphScroll = document.getElementById('curriculum-graph-scroll');
    const zoomOut = document.getElementById('curriculum-zoom-out');
    const zoomIn = document.getElementById('curriculum-zoom-in');
    const zoomFit = document.getElementById('curriculum-zoom-fit');
    const zoomReset = document.getElementById('curriculum-zoom-reset');
    const fullscreen = document.getElementById('curriculum-fullscreen');
    const enrollmentDrawerToggle = document.getElementById('curriculum-enrollment-drawer-toggle');
    const relationMode = document.getElementById('curriculum-relation-mode');
    const zoomLevel = document.getElementById('curriculum-zoom-level');
    const searchResults = document.getElementById('curriculum-tree-search-results');
    if (!nav || !view || !dropZone || !search || !year || !field) return;
    let renderFrame = null;
    let transformFrame = null;
    const scheduleCurriculumRender = () => {
      if (renderFrame != null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        context.renderCurriculumGraph();
      });
    };
    const scheduleCurriculumTransform = () => {
      if (transformFrame != null) return;
      transformFrame = window.requestAnimationFrame(() => {
        transformFrame = null;
        applyCurriculumTransform();
      });
    };

    // ナビゲーション表示は独立ページと同じ公開設定に従う。ローカルの
    // 明示的プレビューだけは、公開OFFのままリンク先を確認できる。
    const curriculumTreePreviewEnabled =
      ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
      new URLSearchParams(window.location.search).get('curriculumPreview') === '1';
    const curriculumTreeEnabled = context.publicEnabled || curriculumTreePreviewEnabled;
    // Keep the existing local variable name as a compatibility alias for the
    // preview gate tests and diagnostics; its value now represents either
    // approved public access or the local preview.
    const previewEnabled = curriculumTreeEnabled;
    nav.hidden = !previewEnabled;
    if (previewEnabled) {
      context.loadCurriculumLayoutDefinition().then((definition) => {
        if (!definition) return;
        context.state.curriculumLayoutDefinition = definition;
        context.curriculumState.layout = null;
        if (document.body.classList.contains('curriculum-tree-mode')) {
          context.renderCurriculumGraph();
          window.requestAnimationFrame(() => fitCurriculumToViewport());
        }
      });
    }

    const updateZoom = (nextZoom, anchor = null) => {
      context.curriculumState.autoFit = false;
      const viewportRect = graphScroll?.getBoundingClientRect();
      const previousZoom = context.curriculumState.zoom;
      const next = Math.min(2.4, Math.max(0.25, Number(nextZoom.toFixed(2))));
      if (anchor && viewportRect) {
        const localX = anchor.clientX - viewportRect.left;
        const localY = anchor.clientY - viewportRect.top;
        const worldX = (localX - (context.curriculumState.panX || 0)) / previousZoom;
        const worldY = (localY - (context.curriculumState.panY || 0)) / previousZoom;
        context.curriculumState.panX = localX - worldX * next;
        context.curriculumState.panY = localY - worldY * next;
      }
      context.curriculumState.zoom = next;
      if (zoomLevel) zoomLevel.value = `${Math.round(context.curriculumState.zoom * 100)}%`;
      if (document.body.classList.contains('curriculum-tree-mode')) scheduleCurriculumTransform();
    };

    const fitCurriculumToViewport = () => {
      const layout = context.curriculumState.layout || context.buildCurriculumLayout();
      context.curriculumState.layout = layout;
      const rect = graphScroll?.getBoundingClientRect();
      if (!rect) return;
      const fit = context.qualityUtils.calculateCurriculumFit({
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        contentWidth: layout.graphWidth,
        contentHeight: layout.graphHeight,
        padding: 28,
        maxScale: 1,
        minScale: 0.05,
      });
      context.curriculumState.zoom = fit.scale;
      context.curriculumState.panX = fit.panX;
      context.curriculumState.panY = fit.panY;
      context.curriculumState.autoFit = true;
      scheduleCurriculumTransform();
    };

    const setMode = (enabled) => {
      document.body.classList.toggle('curriculum-tree-mode', enabled);
      view.hidden = !enabled;
      if (enrollmentTitle) enrollmentTitle.textContent = enabled ? '通常履修' : 'マイ履修';
      setCurriculumEnrollmentOpen(enabled ? false : true);
      nav.setAttribute('aria-pressed', String(enabled));
      context.syncPrimaryViewNavigation(enabled ? 'tree' : 'list');
      if (enabled) {
        context.curriculumState.enrollmentManualOpen = false;
        context.curriculumState.enrollmentAutoOpened = false;
        context.curriculumState.autoFit = true;
        context.curriculumState.panX = 0;
        context.curriculumState.panY = 0;
        context.renderCurriculumGraph();
        window.requestAnimationFrame(() => {
          fitCurriculumToViewport();
          search.focus({ preventScroll: true });
        });
      } else {
        // Returning to the list must also leave the map's fullscreen mode.
        // Otherwise the explorer class keeps body scrolling locked after the
        // tree is hidden, making the ordinary Hub appear frozen.
        context.curriculumState.fullscreen = false;
        document.body.classList.remove('curriculum-tree-explorer-mode');
        fullscreen?.setAttribute('aria-pressed', 'false');
        if (fullscreen) fullscreen.textContent = '探索モード';
        const detail = document.getElementById('curriculum-course-detail');
        if (detail) detail.hidden = true;
        context.curriculumState.selectedId = '';
      }
    };

    nav.addEventListener('click', () => {
      if (!previewEnabled) return;
      window.location.assign(`curriculum.html${curriculumTreePreviewEnabled ? '?curriculumPreview=1' : ''}`);
    });
    document.getElementById('course-list-nav')?.addEventListener('click', () => setMode(false));
    close?.addEventListener('click', () => setMode(false));
    mobileEnrollmentToggle?.addEventListener('click', () => {
      setCurriculumEnrollmentOpen(!context.curriculumState.enrollmentOpen, { manual: true });
    });
    enrollmentDrawerToggle?.addEventListener('click', () => {
      setCurriculumEnrollmentOpen(!context.curriculumState.enrollmentOpen, { manual: true });
    });
    const getSearchMatches = () =>
      context.state.predefinedData.filter((item) => context.getCurriculumMatch(item));
    const syncSearchResults = () => {
      if (!searchResults) return;
      const matches = getSearchMatches();
      searchResults.replaceChildren();
      if (!context.curriculumState.search.trim() || matches.length < 2) {
        searchResults.hidden = true;
        context.curriculumState.searchCandidateId = matches[0]?.id || '';
        return;
      }
      const fragment = document.createDocumentFragment();
      matches.forEach((course) => {
        const option = document.createElement('option');
        option.value = course.id;
        option.textContent = course.teacher ? `${course.subject}（${course.teacher}）` : course.subject;
        fragment.appendChild(option);
      });
      searchResults.appendChild(fragment);
      const selected = matches.some((course) => course.id === context.curriculumState.searchCandidateId)
        ? context.curriculumState.searchCandidateId
        : matches[0].id;
      searchResults.value = selected;
      context.curriculumState.searchCandidateId = selected;
      searchResults.hidden = false;
    };
    const focusSearchCourse = (course) => {
      if (!course) return;
      context.curriculumState.searchCandidateId = course.id;
      context.openCurriculumCourseDetail(course.id);
      const position = context.curriculumState.layout?.positions.get(course.id);
      const rect = graphScroll?.getBoundingClientRect();
      if (!position || !rect) return;
      // Search is the one intentional navigation shortcut: bring the result
      // into a readable 100–150% range, while direct clicks and manual pan/
      // zoom continue to preserve the user's current viewport.
      const cardWidth = Math.max(96, Number(position.width) || 142);
      const cardHeight = Math.max(64, Number(position.height) || 76);
      const readableScale = Math.min(
        Math.max(260, rect.width - 48) / (cardWidth * 3.5),
        Math.max(180, rect.height - 48) / (cardHeight * 3.5),
      );
      context.curriculumState.zoom = Math.min(1.5, Math.max(1, Number(readableScale.toFixed(2))));
      context.curriculumState.panX = rect.width / 2 - position.x * context.curriculumState.zoom;
      context.curriculumState.panY = rect.height / 2 - position.y * context.curriculumState.zoom;
      context.renderCurriculumGraph();
      context.triggerCurriculumSearchHighlight(course.id);
    };
    search.addEventListener('input', () => {
      context.curriculumState.search = search.value;
      context.curriculumState.searchCandidateId = '';
      syncSearchResults();
      scheduleCurriculumRender();
    });
    searchResults?.addEventListener('change', () => {
      context.curriculumState.searchCandidateId = searchResults.value;
      const course = context.state.predefinedData.find((item) => item.id === searchResults.value);
      if (course) focusSearchCourse(course);
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const matches = getSearchMatches();
      const selectedId = searchResults?.value || context.curriculumState.searchCandidateId;
      const course = matches.find((item) => item.id === selectedId) || matches[0];
      if (!course) return;
      event.preventDefault();
      focusSearchCourse(course);
    });
    year.addEventListener('change', () => {
      context.curriculumState.year = year.value;
      syncSearchResults();
      scheduleCurriculumRender();
    });
    field.addEventListener('change', () => {
      context.curriculumState.field = field.value;
      syncSearchResults();
      scheduleCurriculumRender();
    });
    relationMode?.addEventListener('change', () => {
      const nextMode = ['off', 'selected', 'all'].includes(relationMode.value) ? relationMode.value : 'off';
      context.curriculumState.relationMode = nextMode;
      scheduleCurriculumRender();
    });
    zoomOut?.addEventListener('click', () => updateZoom(context.curriculumState.zoom - 0.1));
    zoomIn?.addEventListener('click', () => updateZoom(context.curriculumState.zoom + 0.1));
    zoomReset?.addEventListener('click', () => {
      context.curriculumState.panX = 14;
      context.curriculumState.panY = 14;
      updateZoom(1);
    });
    zoomFit?.addEventListener('click', fitCurriculumToViewport);
    fullscreen?.addEventListener('click', () => {
      context.curriculumState.fullscreen = !context.curriculumState.fullscreen;
      document.body.classList.toggle('curriculum-tree-explorer-mode', context.curriculumState.fullscreen);
      fullscreen.setAttribute('aria-pressed', String(context.curriculumState.fullscreen));
      fullscreen.textContent = context.curriculumState.fullscreen ? '通常表示' : '探索モード';
      window.requestAnimationFrame(() => fitCurriculumToViewport());
    });
    graphScroll?.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        updateZoom(context.curriculumState.zoom * (event.deltaY < 0 ? 1.08 : 0.92), event);
      },
      { passive: false },
    );
    let panState = null;
    let pinchState = null;
    const pointers = new Map();
    graphScroll?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.curriculum-node, button, input, select')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1)
        panState = {
          x: event.clientX,
          y: event.clientY,
          panX: context.curriculumState.panX || 0,
          panY: context.curriculumState.panY || 0,
        };
      if (pointers.size === 2) {
        const points = [...pointers.values()];
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        pinchState = { distance, zoom: context.curriculumState.zoom };
        panState = null;
      }
      graphScroll.classList.add('is-panning');
      graphScroll.setPointerCapture?.(event.pointerId);
    });
    graphScroll?.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchState && pointers.size >= 2) {
        const points = [...pointers.values()].slice(0, 2);
        const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
        const center = { clientX: (points[0].x + points[1].x) / 2, clientY: (points[0].y + points[1].y) / 2 };
        updateZoom(pinchState.zoom * (distance / pinchState.distance), center);
        return;
      }
      if (!panState || pointers.size !== 1) return;
      context.curriculumState.panX = panState.panX + event.clientX - panState.x;
      context.curriculumState.panY = panState.panY + event.clientY - panState.y;
      context.curriculumState.autoFit = false;
      scheduleCurriculumTransform();
    });
    const stopPan = (event) => {
      if (event?.pointerId != null) pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchState = null;
      panState = null;
      if (!pointers.size) graphScroll?.classList.remove('is-panning');
    };
    graphScroll?.addEventListener('pointerup', stopPan);
    graphScroll?.addEventListener('pointercancel', stopPan);
    graph?.addEventListener('click', (event) => {
      if (!event.target.closest('.curriculum-node')) context.clearCurriculumFocus();
    });
    window.addEventListener('resize', () => {
      if (!document.body.classList.contains('curriculum-tree-mode') || !context.curriculumState.autoFit)
        return;
      window.requestAnimationFrame(() => fitCurriculumToViewport());
    });
    document.addEventListener('keydown', (event) => {
      if (
        event.key === 'Escape' &&
        document.body.classList.contains('curriculum-tree-mode') &&
        context.curriculumState.selectedId
      ) {
        context.clearCurriculumFocus();
      }
    });

    dropZone.addEventListener('dragenter', (event) => {
      event.preventDefault();
      dropZone.classList.add('is-over');
    });
    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('is-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging', 'is-over');
      const courseId =
        event.dataTransfer?.getData('application/x-zen-course-id') ||
        event.dataTransfer?.getData('text/plain');
      const course = context.state.coursesMap.get(courseId);
      if (!course) {
        context.setCurriculumStatus('科目を追加できませんでした。', true);
        return;
      }
      if (context.state.registeredClasses.has(courseId)) {
        context.setCurriculumStatus(`${course.subject}はすでに履修予定です。`);
        return;
      }
      const saved = context.commitStateChange(courseId, 'REGISTER');
      context.setCurriculumStatus(
        saved ? `${course.subject}を履修予定に追加しました。` : `${course.subject}を追加できませんでした。`,
        !saved,
      );
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dropZone.classList.remove('is-over');
    });
  };
  return { setCurriculumEnrollmentOpen, setupCurriculumTree };
});
