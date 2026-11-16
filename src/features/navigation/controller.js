/** 主要ビューの入口、並べ替えと探索条件。選択肢を共有し、保存先の形式は変更しない。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubNavigation = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  /**
   * 一覧・ツリー・4年計画は同格の入口だが、既存の画面実装は独立している。
   * ナビゲーションの見た目だけをここで同期し、各画面の保存状態や表示ロジックは変更しない。
   */
  const syncPrimaryViewNavigation = (activeView) => {
    document.querySelectorAll('.primary-view-button').forEach((button) => {
      const isActive = button.dataset.view === activeView;
      button.setAttribute('aria-pressed', String(isActive));
      button.classList.toggle('is-active', isActive);
    });
  };

  const syncCourseSortOptions = () => {
    const controls = [...document.querySelectorAll('[data-course-sort-control]')]
      .map((control) => ({
        root: control,
        button: control.querySelector('.course-sort-toggle'),
        menu: control.querySelector('.course-sort-menu'),
      }))
      .filter(({ button, menu }) => button && menu);
    if (!controls.length) return;

    let openControl = null;
    const closeMenus = (returnFocus = false) => {
      controls.forEach(({ button, menu }) => {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      });
      if (returnFocus && openControl?.button) openControl.button.focus();
      openControl = null;
    };

    const syncSelectedState = () => {
      const selectedOption =
        context.COURSE_SORT_OPTIONS.find((option) => option.value === context.state.difficultySort) ||
        context.COURSE_SORT_OPTIONS[0];
      context.state.difficultySort = selectedOption.value;
      controls.forEach(({ button, menu }) => {
        const current = button.querySelector('.course-sort-current');
        if (current) current.textContent = `：${selectedOption.label}`;
        menu.querySelectorAll('[data-sort-value]').forEach((optionButton) => {
          const isSelected = optionButton.dataset.sortValue === selectedOption.value;
          optionButton.classList.toggle('is-selected', isSelected);
          optionButton.setAttribute('aria-checked', String(isSelected));
        });
      });
    };

    const selectSort = (value) => {
      if (!context.COURSE_SORT_OPTIONS.some((option) => option.value === value)) return;
      context.state.difficultySort = value;
      syncSelectedState();
      context.renderPredefinedList();
      context.renderSimulatorCourseResults();
      closeMenus(true);
    };

    controls.forEach((control) => {
      const { root, button, menu } = control;
      menu.replaceChildren(
        ...context.COURSE_SORT_OPTIONS.map(({ value, label }) => {
          const optionButton = document.createElement('button');
          optionButton.type = 'button';
          optionButton.className = 'course-sort-option';
          optionButton.dataset.sortValue = value;
          optionButton.setAttribute('role', 'menuitemradio');
          optionButton.setAttribute('aria-checked', 'false');
          optionButton.textContent = label;
          optionButton.addEventListener('click', () => selectSort(value));
          return optionButton;
        }),
      );

      button.addEventListener('click', () => {
        const willOpen = menu.hidden;
        closeMenus();
        if (!willOpen) return;
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        openControl = control;
        [...menu.querySelectorAll('[data-sort-value]')]
          .find((optionButton) => optionButton.dataset.sortValue === context.state.difficultySort)
          ?.focus();
      });

      // Keeping the wrapper as the click boundary allows the popover to close
      // without interfering with filter-panel clicks in either screen.
      root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !menu.hidden) {
          event.preventDefault();
          closeMenus(true);
        }
      });
    });

    document.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (openControl && !target?.closest('[data-course-sort-control]')) closeMenus();
    });

    syncSelectedState();
  };

  const loadFilterPreferences = () => {
    try {
      const raw = localStorage.getItem(context.STORAGE_KEYS.FILTER_PREFERENCES);
      if (!raw) return { excludePixiv: false };
      const parsed = JSON.parse(raw);
      return { excludePixiv: parsed?.excludePixiv === true };
    } catch (error) {
      console.warn('授業検索設定の復元に失敗しました。初期値を使用します。', error);
      return { excludePixiv: false };
    }
  };

  const saveFilterPreferences = (preferences) => {
    try {
      localStorage.setItem(
        context.STORAGE_KEYS.FILTER_PREFERENCES,
        JSON.stringify({
          excludePixiv: preferences.excludePixiv === true,
        }),
      );
    } catch (error) {
      console.warn('授業検索設定の保存に失敗しました。', error);
    }
  };

  const setupFilters = () => {
    // フィルターの選択肢を「分野」リストに書き換え
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
      const fields = [
        '分野',
        '情報',
        '数理',
        '多言語情報理解',
        '文化・思想',
        '社会・ネットワーク',
        '経済・マーケット',
        'デジタル産業',
        '社会接続',
        '自由科目',
      ];
      categoryFilter.innerHTML = fields.map((f) => `<option value="${f}">${f}</option>`).join('');
    }

    // 各フィルタ要素が存在する場合のみイベントリスナーを設定（エラー落ち防止）
    const yearF = document.getElementById('year-filter');
    if (yearF)
      yearF.addEventListener('change', (e) => {
        context.state.filterYear = e.target.value;
        context.renderPredefinedList();
      });

    const quarterF = document.getElementById('quarter-filter');
    if (quarterF)
      quarterF.addEventListener('change', (e) => {
        context.state.filterQuarter = e.target.value;
        context.renderPredefinedList();
      });

    if (categoryFilter)
      categoryFilter.addEventListener('change', (e) => {
        context.state.filterCategory = e.target.value;
        context.renderPredefinedList();
      });

    const reqF = document.getElementById('requirement-filter');
    if (reqF)
      reqF.addEventListener('change', (e) => {
        context.state.filterRequirement = e.target.value;
        context.renderPredefinedList();
      });

    const introF = document.getElementById('intro-filter');
    if (introF)
      introF.addEventListener('change', (e) => {
        context.state.filterIntro = e.target.value;
        context.renderPredefinedList();
      });

    const searchB = document.getElementById('search-bar');
    if (searchB)
      searchB.addEventListener('input', (e) => {
        context.state.filterSearch = e.target.value;
        context.renderPredefinedList();
      });

    const excludePixiv = document.getElementById('exclude-pixiv-filter');
    if (excludePixiv) {
      excludePixiv.checked = context.state.excludePixiv;
      excludePixiv.addEventListener('change', (event) => {
        context.state.excludePixiv = event.target.checked;
        saveFilterPreferences({ excludePixiv: context.state.excludePixiv });
        context.renderPredefinedList();
      });
    }

    const filterToggle = document.getElementById('filter-options-toggle');
    const filterPanel = document.getElementById('filter-options-panel');
    if (filterToggle && filterPanel) {
      const setFilterPanelOpen = (isOpen, returnFocus = false) => {
        filterPanel.hidden = !isOpen;
        filterToggle.setAttribute('aria-expanded', String(isOpen));
        if (!isOpen && returnFocus) filterToggle.focus();
      };

      filterToggle.addEventListener('click', () => {
        setFilterPanelOpen(filterPanel.hidden);
      });

      document.addEventListener('click', (event) => {
        if (
          !filterPanel.hidden &&
          !event.target.closest('.input-area') &&
          !event.target.closest('.related-course-link') &&
          !event.target.closest('.related-course-detail-host') &&
          !event.target.matches('.related-detail-close')
        ) {
          setFilterPanelOpen(false);
        }
      });

      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !filterPanel.hidden) {
          setFilterPanelOpen(false, true);
        }
      });
    }

    const clearFiltersButton = document.getElementById('clear-course-filters');
    if (clearFiltersButton) clearFiltersButton.addEventListener('click', context.clearCourseFilters);
  };
  return {
    syncPrimaryViewNavigation,
    syncCourseSortOptions,
    loadFilterPreferences,
    saveFilterPreferences,
    setupFilters,
  };
});
