/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');
  const relatedCourseDetailHost = document.getElementById('related-course-detail-host');
  const dataStatus = document.getElementById('data-status');
  const storageWarning = document.getElementById('storage-warning');

  /**
   * localStorageのキー管理
   */
  const STORAGE_KEYS = {
    REGISTERED: 'myClasses',
    COMPLETED: 'completedClasses',
    FILTER_PREFERENCES: 'courseFilterPreferences',
    SCHEMA_VERSION: 'zenCourseHubStorageSchemaVersion'
  };
  const enrollmentStorageBackend = (() => {
    try {
      if (typeof localStorage === 'undefined') throw new Error('localStorage unavailable');
      return localStorage;
    } catch (error) {
      return {
        getItem: () => { throw error; },
        setItem: () => { throw error; },
        removeItem: () => { throw error; }
      };
    }
  })();
  const qualityUtils = window.ZenQualityUtils || {
    escapeHTML: (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character])),
    sanitizeExternalUrl: (value) => {
      if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return null;
      try {
        const parsed = new URL(value.trim());
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
      } catch (error) {
        return null;
      }
    },
    readEnrollmentState: () => ({
      registered: { status: 'unavailable', ids: [] },
      completed: { status: 'unavailable', ids: [] },
      schema: { status: 'unavailable', version: null },
      writable: false
    }),
    saveEnrollmentState: () => ({ saved: false, rollbackSucceeded: true, error: new Error('保存ユーティリティを読み込めませんでした') })
  };
  const SIMULATOR_STORAGE_KEY = 'fourYearSimulatorPlanV1';
  const courseSorting = window.CourseSorting;
  if (!courseSorting) {
    console.error('科目並び替えモジュールを読み込めませんでした。');
    return;
  }
  const { COURSE_SORT_OPTIONS, sortCourses } = courseSorting;
  const simulatorRules = window.SimulatorRules;
  const simulatorAvailable = Boolean(simulatorRules && [
    'getQuarterInfo', 'canPlaceCourseAt',
    'getPlacementOptions', 'getPlacementStart', 'isPrerequisiteSatisfied', 'getPlacementIssues',
    'applyPlacement', 'createEmptyPlan', 'savePlanChange'
  ].every((name) => typeof simulatorRules[name] === 'function'));

  const loadSimulatorPlan = () => {
    try {
      const raw = localStorage.getItem(SIMULATOR_STORAGE_KEY);
      if (!raw) return { version: 1, placements: [] };
      const parsed = JSON.parse(raw);
      const placements = Array.isArray(parsed?.placements)
        ? parsed.placements
            .map((item) => ({
              ...item,
              courseId: String(item?.courseId || ''),
              year: Number(item?.year),
              selectedQuarter: Number(item?.selectedQuarter ?? item?.startQuarter ?? item?.quarter)
            }))
            .filter((item) => item.courseId && Number.isInteger(item.year) && item.year >= 1 && item.year <= 4)
        : [];
      return { version: 1, placements };
    } catch (error) {
      console.warn('シミュレーター計画を読み込めませんでした:', error);
      return { version: 1, placements: [] };
    }
  };

  /**
   * クラスデータの正規化（不正な型や欠損を修整）
   */
  const normalizeClass = (cls) => {
    const subject = (typeof cls === 'string' ? cls : cls?.subject);
    if (!subject) return null;
    return {
      ...(typeof cls === 'object' && cls !== null ? cls : {}),
      id: cls?.id || '',
      subject: subject,
      credits: Number(cls?.credits || 0),
      tag: String(cls?.tag || ''),
      tags: Array.isArray(cls?.tags) ? cls.tags : (cls?.tag ? [String(cls.tag)] : [])
    };
  };

  const enrollmentStorage = qualityUtils.readEnrollmentState(enrollmentStorageBackend, {
    registered: STORAGE_KEYS.REGISTERED,
    completed: STORAGE_KEYS.COMPLETED,
    schemaVersion: STORAGE_KEYS.SCHEMA_VERSION
  });

  /**
   * アプリケーションの状態（State）
   */
  const state = {
    // 科目IDの配列として管理
    registeredClasses: new Set(enrollmentStorage.registered.ids),
    completedClasses: new Set(enrollmentStorage.completed.ids),
    // 全科目データを id キーで高速検索するためのMap
    coursesMap: new Map(), 
    predefinedData: [],
    filterYear: 'すべて表示',
    filterQuarter: 'すべて表示',
    filterCategory: '分野',
    filterRequirement: 'すべて表示',
    filterIntro: 'すべて表示',
    filterSearch: '',
    difficultySort: 'default',
    excludePixiv: false,
    difficultyMap: new Map(), // 科目IDをキーにした難易度目安データ
    relationsMap: new Map(), // 科目IDをキーにした前提・後継科目データ
    simulatorPlan: loadSimulatorPlan(),
    simulatorPaletteMode: 'all',
    simulatorPaletteDefaulted: false,
    // マイ履修は通常の履修予定（myClasses）を表示するだけで、4年計画とは分離する。
    simulatorPlacementFilter: 'all',
    graduationDefinition: null,
    courseValidationError: null,
    curriculumLayoutDefinition: null,
    coursesReady: false,
    rawRelations: [],
    storageWritable: enrollmentStorage.writable,
    storageIssues: [enrollmentStorage.registered, enrollmentStorage.completed, enrollmentStorage.schema]
      .filter((item) => ['corrupt', 'invalid', 'future', 'unavailable'].includes(item.status))
  };
  const escapeHTML = qualityUtils.escapeHTML;
  const sanitizeExternalUrl = qualityUtils.sanitizeExternalUrl;

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

  /**
   * Main Hubとシミュレーターで同じ並べ替えメニューを使う。
   * 選択肢をHTMLへ複製せず、COURSE_SORT_OPTIONSを唯一の定義として描画することで、
   * 片方だけ選択肢や並び順が古くなることを防ぐ。
   */
  const syncCourseSortOptions = () => {
    const controls = [...document.querySelectorAll('[data-course-sort-control]')]
      .map((control) => ({
        root: control,
        button: control.querySelector('.course-sort-toggle'),
        menu: control.querySelector('.course-sort-menu')
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
      const selectedOption = COURSE_SORT_OPTIONS.find((option) => option.value === state.difficultySort)
        || COURSE_SORT_OPTIONS[0];
      state.difficultySort = selectedOption.value;
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
      if (!COURSE_SORT_OPTIONS.some((option) => option.value === value)) return;
      state.difficultySort = value;
      syncSelectedState();
      renderPredefinedList();
      renderSimulatorCourseResults();
      closeMenus(true);
    };

    controls.forEach((control) => {
      const { root, button, menu } = control;
      menu.replaceChildren(...COURSE_SORT_OPTIONS.map(({ value, label }) => {
        const optionButton = document.createElement('button');
        optionButton.type = 'button';
        optionButton.className = 'course-sort-option';
        optionButton.dataset.sortValue = value;
        optionButton.setAttribute('role', 'menuitemradio');
        optionButton.setAttribute('aria-checked', 'false');
        optionButton.textContent = label;
        optionButton.addEventListener('click', () => selectSort(value));
        return optionButton;
      }));

      button.addEventListener('click', () => {
        const willOpen = menu.hidden;
        closeMenus();
        if (!willOpen) return;
        menu.hidden = false;
        button.setAttribute('aria-expanded', 'true');
        openControl = control;
        [...menu.querySelectorAll('[data-sort-value]')]
          .find((optionButton) => optionButton.dataset.sortValue === state.difficultySort)
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

  /**
   * カリキュラムツリーの表示状態。
   * 科目の履修状態は既存の state/localStorage を参照し、ツリー専用には保存しない。
   */
  const curriculumState = {
    search: '',
    year: 'すべて表示',
    field: 'すべて表示',
    selectedId: '',
    didDrag: false,
    layout: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    fullscreen: false,
    enrollmentOpen: false,
    enrollmentManualOpen: false,
    enrollmentAutoOpened: false,
    autoFit: true
  };

  // The map card handlers live outside setupCurriculumTree, so the drawer
  // transition helper must be shared at this scope. Keeping the existing
  // enrollment content and drop zone untouched preserves the normal
  // myClasses storage path while allowing drag registration to reveal them.
  const setCurriculumEnrollmentOpen = (open, { manual = false, auto = false } = {}) => {
    const nextOpen = Boolean(open);
    const enrollmentContent = document.getElementById('my-enrollment-content');
    const dropZone = document.getElementById('curriculum-drop-zone');
    const enrollmentDrawerToggle = document.getElementById('curriculum-enrollment-drawer-toggle');
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    curriculumState.enrollmentOpen = nextOpen;
    if (manual) curriculumState.enrollmentManualOpen = nextOpen;
    curriculumState.enrollmentAutoOpened = auto && nextOpen;
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

  // 探索一覧の表示設定だけを独立保存し、履修データのlocalStorage形式へ混ぜない。
  const loadFilterPreferences = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.FILTER_PREFERENCES);
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
      localStorage.setItem(STORAGE_KEYS.FILTER_PREFERENCES, JSON.stringify({
        excludePixiv: preferences.excludePixiv === true
      }));
    } catch (error) {
      console.warn('授業検索設定の保存に失敗しました。', error);
    }
  };

  const filterPreferences = loadFilterPreferences();
  state.excludePixiv = filterPreferences.excludePixiv;

  /**
   * 難易度データを検証し、表示に利用できる形式へ正規化する
   */
  const normalizeDifficulty = (entry) => {
    try {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      const average = Number(entry?.average);
      const votes = Number(entry?.votes);
      const sourceUrl = typeof entry?.sourceUrl === 'string' ? entry.sourceUrl.trim() : '';
      const sourceName = typeof entry?.sourceName === 'string' ? entry.sourceName.trim() : '';
      const sourceAuthor = typeof entry?.sourceAuthor === 'string' ? entry.sourceAuthor.trim() : '';
      const sourceLabel = typeof entry?.sourceLabel === 'string' && entry.sourceLabel.trim()
        ? entry.sourceLabel.trim()
        : `${sourceName || '出典'}${sourceAuthor ? `（運営：${sourceAuthor}）` : ''}`;
      const safeSourceUrl = sanitizeExternalUrl(sourceUrl);

      if (
        !id ||
        !Number.isFinite(average) ||
        average < 0 ||
        average > 10 ||
        !Number.isInteger(votes) ||
        votes < 0 ||
        !safeSourceUrl
      ) {
        console.warn('不正な難易度データを除外しました:', entry);
        return null;
      }

      return { id, average, votes, sourceUrl: safeSourceUrl, sourceLabel };
    } catch (error) {
      console.warn('難易度データの検証に失敗しました:', error);
      return null;
    }
  };

  /**
   * 難易度データを任意データとして安全に読み込む
   */
  const loadDifficultyData = async () => {
    try {
      const response = await fetch('difficulty.json');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const difficultyData = await response.json();
      if (!Array.isArray(difficultyData)) {
        throw new TypeError('難易度データのルート要素が配列ではありません');
      }

      return new Map(
        difficultyData
          .map(normalizeDifficulty)
          .filter(Boolean)
          .map(entry => [entry.id, entry])
      );
    } catch (error) {
      // 難易度は任意情報のため、失敗しても授業データの読み込みを継続する
      console.warn('難易度データを読み込めませんでした。難易度欄を非表示にします:', error);
      return new Map();
    }
  };

  const loadGraduationDefinitionData = async () => {
    try {
      if (!window.GraduationRequirementsEngine) throw new Error('卒業要件エンジンが読み込まれていません');
      const response = await fetch('graduation-requirements.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const definition = await response.json();
      const validation = window.GraduationRequirementsEngine.validateRequirementsDefinition(definition);
      if (!validation.valid) throw new Error(validation.message);
      return definition;
    } catch (error) {
      console.error('卒業要件定義を読み込めませんでした。判定を無効化します:', error);
      return null;
    }
  };

  /**
   * 前提・後継科目の関係を任意データとして安全に読み込む。
   * 関係データは授業一覧とは独立させ、取得失敗時も授業一覧を利用可能にする。
   */
  const loadCourseRelationsData = async () => {
    try {
      const response = await fetch('course-relations.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const relations = await response.json();
      if (!Array.isArray(relations)) throw new TypeError('関係データのルート要素が配列ではありません');
      return relations;
    } catch (error) {
      console.warn('前提・後継科目データを読み込めませんでした。関連科目欄を非表示にします:', error);
      return [];
    }
  };

  const loadCurriculumLayoutDefinition = async () => {
    try {
      const response = await fetch('curriculum-tree-layout.json');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const definition = await response.json();
      if (!definition?.canvas || !Array.isArray(definition.columns) || !Array.isArray(definition.bands)) {
        throw new TypeError('カリキュラムツリー配置定義の形式が不正です');
      }
      return definition;
    } catch (error) {
      console.warn('公式配置定義を読み込めませんでした。既定の構図を使用します:', error);
      return null;
    }
  };

  /**
   * 一方向の関係データから、画面表示用の前提・後継の両方向を生成する。
   * コースIDが実在しない関係は表示対象から除外する。
   */
  const buildRelationsMap = (relations, coursesMap) => {
    const map = new Map();
    const ensure = (id) => {
      if (!map.has(id)) map.set(id, { prerequisites: [], successors: [] });
      return map.get(id);
    };

    (Array.isArray(relations) ? relations : []).forEach((entry) => {
      const prerequisiteId = typeof entry?.prerequisiteId === 'string' ? entry.prerequisiteId.trim() : '';
      const successorId = typeof entry?.successorId === 'string' ? entry.successorId.trim() : '';
      const strength = entry?.strength === 'strongly_recommended' || entry?.strength === 'recommended'
        ? entry.strength
        : '';
      if (!prerequisiteId || !successorId || prerequisiteId === successorId) return;
      if (!strength) {
        console.warn('不正な強度の関係を除外しました:', entry);
        return;
      }
      if (!coursesMap.has(prerequisiteId) || !coursesMap.has(successorId)) {
        console.warn('存在しない科目IDを含む関係を除外しました:', entry);
        return;
      }

      const prerequisiteRelations = ensure(prerequisiteId);
      const successorRelations = ensure(successorId);
      if (!prerequisiteRelations.successors.some((relation) => relation.id === successorId)) {
        prerequisiteRelations.successors.push({ id: successorId, strength });
      }
      if (!successorRelations.prerequisites.some((relation) => relation.id === prerequisiteId)) {
        successorRelations.prerequisites.push({ id: prerequisiteId, strength });
      }
    });

    return map;
  };

  const updateStorageWarning = () => {
    if (!storageWarning) return;
    const unknownIds = new Set(
      [...state.registeredClasses, ...state.completedClasses]
        .filter((id) => state.coursesMap.size > 0 && !state.coursesMap.has(id))
    );
    const hasStorageIssue = state.storageIssues.length > 0 || !state.storageWritable;
    if (hasStorageIssue || unknownIds.size > 0) {
      const messages = [];
      if (hasStorageIssue) messages.push('保存データを安全に更新できないため、履修状態の変更を一時停止しています。');
      if (unknownIds.size > 0) messages.push(`${unknownIds.size}件の保存済み科目は現在の授業データにないため保持しています。`);
      storageWarning.textContent = messages.join(' ');
      storageWarning.hidden = false;
      return;
    }
    storageWarning.textContent = '';
    storageWarning.hidden = true;
  };

  const showStorageWarning = (message) => {
    if (!storageWarning) return;
    storageWarning.textContent = message;
    storageWarning.hidden = false;
  };

  /**
   * 状態変更のコミット（追加・削除・移動をここで一括管理）
   * @param {string} id - 科目ID
   * @param {'REGISTER'|'COMPLETE'|'DELETE'} action - アクション
   */
  const commitStateChange = (id, action) => {
    if (typeof id !== 'string' || !id.trim()) return false;
    const nextRegistered = new Set(state.registeredClasses);
    const nextCompleted = new Set(state.completedClasses);
    switch (action) {
      case 'REGISTER':
        nextCompleted.delete(id);
        nextRegistered.add(id);
        break;
      case 'COMPLETE':
        nextRegistered.delete(id);
        nextCompleted.add(id);
        break;
      case 'DELETE':
        nextRegistered.delete(id);
        nextCompleted.delete(id);
        break;
      default:
        return false;
    }

    const result = saveState(nextRegistered, nextCompleted);
    if (!result.saved) {
      showStorageWarning(result.rollbackSucceeded === false
        ? '履修データの保存状態を確認できません。再読み込みして確認してください。'
        : '履修データを保存できませんでした。変更は確定していません。');
      return false;
    }
    state.registeredClasses = nextRegistered;
    state.completedClasses = nextCompleted;
    renderAll();
    return true;
  };

  /**
   * データの整合性チェックとクリーンアップ。
   * 未知IDは、後から科目データが追加された場合に復元できるよう保存したままにする。
   */
  const cleanupState = () => {
    // 排他制御の再確認
    state.registeredClasses.forEach(id => state.completedClasses.delete(id));
    updateStorageWarning();
  };

  /**
   * 既に対象科目が登録済みかチェック
   */
  const isAlreadyExists = (id) => {
    return state.registeredClasses.has(id) || state.completedClasses.has(id);
  };

  /**
   * localStorageへの保存（Setを配列に戻して保存、IDベースで保存）
   */
  const saveState = (registeredClasses = state.registeredClasses, completedClasses = state.completedClasses) => {
    if (!state.storageWritable) {
      return { saved: false, rollbackSucceeded: true, error: new Error('保存対象のストレージデータを安全に移行できません') };
    }
    const result = qualityUtils.saveEnrollmentState(enrollmentStorageBackend, {
      registered: STORAGE_KEYS.REGISTERED,
      completed: STORAGE_KEYS.COMPLETED,
      schemaVersion: STORAGE_KEYS.SCHEMA_VERSION
    }, registeredClasses, completedClasses);
    if (!result.saved && result.rollbackSucceeded === false) state.storageWritable = false;
    return result;
  };

  const saveSimulatorPlan = (nextPlan) => {
    try {
      const result = simulatorRules.savePlanChange(localStorage, SIMULATOR_STORAGE_KEY, nextPlan);
      if (result.saved) return true;
      console.error('シミュレーター計画を保存できませんでした:', result.error);
    } catch (error) {
      console.error('シミュレーター計画を保存できませんでした:', error);
    }
    return false;
  };

  const commitSimulatorPlan = (nextPlan) => {
    // Do not show a speculative placement or deletion: storage must accept the
    // complete next plan before the in-memory plan and rendered credits change.
    if (!saveSimulatorPlan(nextPlan)) {
      renderSimulator();
      showSimulatorFeedback('計画を保存できませんでした。ストレージの設定や空き容量を確認してください。', true);
      return false;
    }
    state.simulatorPlan = nextPlan;
    renderSimulator();
    return true;
  };

  const getQuarterInfo = simulatorRules?.getQuarterInfo;

  const getPlacementOption = (course, placement) => {
    return simulatorRules.getPlacementOptions(course)
      .find((option) => option.start === Number(placement?.selectedQuarter)) || null;
  };

  const formatSimulatorPlacement = (course, placement) => {
    const option = getPlacementOption(course, placement);
    if (option) return `${placement.year}年${option.label}`;
    const quarter = Number(placement?.selectedQuarter);
    return `${placement?.year || ''}年${Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? `Q${quarter}` : 'Q不明'}（要修正）`;
  };

  const getSimulatorPlacement = (courseId) => state.simulatorPlan.placements.find((placement) => placement.courseId === courseId);

  const getSimulatorWarnings = (course, placement) => {
    const prerequisites = state.relationsMap.get(course.id)?.prerequisites || [];
    return prerequisites.map((relation) => {
      const prerequisite = state.coursesMap.get(relation.id);
      if (!prerequisite) return null;
      const prerequisitePlacement = getSimulatorPlacement(prerequisite.id);
      const strengthLabel = relation.strength === 'strongly_recommended' ? '強く推奨' : '推奨';
      const strengthClass = relation.strength === 'strongly_recommended' ? 'strong' : 'recommended';

      // 通常画面で履修済みにした科目は、シミュレーター上では既に完了した前提科目として扱う。
      if (state.completedClasses.has(prerequisite.id)) return null;

      if (!prerequisitePlacement) {
        return {
          message: `前提科目「${prerequisite.subject}」が未配置です`,
          strengthLabel,
          strengthClass
        };
      }

      if (simulatorRules.isPrerequisiteSatisfied(prerequisite, prerequisitePlacement, course, placement)) return null;
      return {
        message: `前提科目「${prerequisite.subject}」を先に配置してください`,
        strengthLabel,
        strengthClass
      };
    }).filter(Boolean);
  };

  const getSimulatorPlanWarnings = () => state.simulatorPlan.placements.flatMap((placement) => {
    const course = state.coursesMap.get(placement.courseId);
    if (!course) return [];
    return getSimulatorWarnings(course, placement).map((warning) => ({
      course,
      placement,
      type: 'prerequisite',
      ...warning
    }));
  });

  const getSimulatorPlacementIssues = () => state.simulatorPlan.placements.flatMap((placement) => {
    const course = state.coursesMap.get(placement.courseId);
    if (!course) return [];
    return simulatorRules.getPlacementIssues(course, placement).map((issue) => ({ course, placement, ...issue }));
  });

  const renderSimulatorPlanCheck = () => {
    const summary = document.getElementById('simulator-plan-check-summary');
    const details = document.getElementById('simulator-plan-check-details');
    if (!summary || !details) return;

    const prerequisiteWarnings = getSimulatorPlanWarnings();
    const placementIssues = getSimulatorPlacementIssues();
    const quarterIssues = placementIssues.filter((issue) => issue.type === 'quarter').length;
    const strongCount = prerequisiteWarnings.filter((warning) => warning.strengthClass === 'strong').length;
    const recommendedCount = prerequisiteWarnings.length - strongCount;
    const issueCount = placementIssues.length + prerequisiteWarnings.length;
    summary.textContent = issueCount
      ? `⚠ 計画チェック：要修正 ${quarterIssues}・前提 ${strongCount}強/${recommendedCount}推奨`
      : '✓ 計画チェック';
    const checkItems = [
      ...placementIssues.map((issue) => ({ ...issue, strengthText: '要修正' })),
      ...prerequisiteWarnings.map((warning) => ({ ...warning, strengthText: warning.strengthLabel }))
    ];
    details.innerHTML = checkItems.length
      ? `<ul>${checkItems.map((warning) => `
          <li class="simulator-check-${escapeHTML(warning.type)}" data-sim-warning-course="${escapeHTML(warning.course.id)}">
            <strong>${escapeHTML(warning.course.subject)}</strong>
            <span>${escapeHTML(warning.message)}（${escapeHTML(warning.strengthText)}）</span>
          </li>
        `).join('')}</ul>`
      : '<p>計画上の注意はありません</p>';
  };

  let simulatorGraduationDetailState = null;

  const simulatorGraduationDetailLabels = {
    totalCredits: '総卒業算入単位',
    introduction: '導入科目',
    foundation: '基礎科目',
    'foundation.groups.math': '基礎：数理',
    'foundation.groups.information': '基礎：情報',
    'foundation.groups.cultureThought': '基礎：文化・思想',
    'foundation.groups.societyNetwork': '基礎：社会・ネットワーク',
    'foundation.groups.economyMarket': '基礎：経済・マーケット',
    'foundation.multilingualIT': '多言語ITコミュニケーション',
    advanced: '展開科目',
    literacy: '基盤リテラシー（基礎科目を含む）',
    multilingualInformation: '多言語情報理解（基礎科目を含む）',
    worldUnderstanding: '世界理解（基礎科目を含む）',
    'worldUnderstanding.industryHistory': '世界理解内：産業史系',
    socialConnection: '社会接続',
    projectPractice: 'プロジェクト実践'
  };

  const getRequirementDetail = (details, key) => {
    const path = key.split('.');
    return path.reduce((value, segment) => value?.[segment], details);
  };

  const renderCourseLinks = (courseIds, emptyLabel, { collapsible = false, summary = '一覧を表示' } = {}) => {
    if (!courseIds.length) return `<p class="simulator-graduation-course-empty">${escapeHTML(emptyLabel)}</p>`;
    const list = `<ul>${courseIds.map((courseId) => {
      const course = state.coursesMap.get(courseId);
      if (!course) return '';
      return `<li><button type="button" class="simulator-graduation-course-link" data-sim-detail-course="${escapeHTML(course.id)}">${escapeHTML(course.subject)}</button></li>`;
    }).join('')}</ul>`;
    return collapsible ? `<details><summary>${escapeHTML(summary)}</summary>${list}</details>` : list;
  };

  const renderSimulatorGraduationCourseDetail = (key) => {
    const panel = document.getElementById('simulator-graduation-course-detail');
    const detailState = simulatorGraduationDetailState;
    const label = simulatorGraduationDetailLabels[key];
    if (!panel || !detailState || !label) return;
    const current = getRequirementDetail(detailState.current, key);
    const projected = getRequirementDetail(detailState.projected, key);
    if (!current || !projected) return;
    const missing = projected.targetCourseIds.filter((courseId) => !projected.selectedCourseIds.includes(courseId));
    panel.hidden = false;
    panel.innerHTML = `
      <div class="simulator-graduation-course-detail-head">
        <h3>${escapeHTML(label)}</h3>
        <button type="button" class="simulator-graduation-course-detail-close" aria-label="詳細を閉じる">×</button>
      </div>
      <div class="simulator-graduation-course-detail-section">
        <strong>対象科目（${projected.targetCourseIds.length}件）</strong>
        ${renderCourseLinks(projected.targetCourseIds, '対象科目はありません', { collapsible: true })}
      </div>
      <div class="simulator-graduation-course-detail-section">
        <strong>現在</strong>
        ${renderCourseLinks(current.selectedCourseIds, '修得済みの対象科目はありません')}
      </div>
      <div class="simulator-graduation-course-detail-section">
        <strong>4年計画完了時</strong>
        ${renderCourseLinks(projected.selectedCourseIds, '計画に含まれる対象科目はありません')}
      </div>
      <div class="simulator-graduation-course-detail-section">
        <strong>不足を満たす候補</strong>
        ${renderCourseLinks(missing, '不足している対象科目はありません', { collapsible: missing.length > 20, summary: `${missing.length}件を表示` })}
      </div>`;
    panel.querySelector('.simulator-graduation-course-detail-close')?.addEventListener('click', () => {
      panel.hidden = true;
      panel.innerHTML = '';
    });
  };

  const renderSimulatorGraduationProjection = () => {
    const summary = document.getElementById('simulator-graduation-summary');
    const details = document.getElementById('simulator-graduation-details-content');
    const unknownNotice = document.getElementById('simulator-graduation-unknown');
    if (!summary || !details || !simulatorAvailable) return;

    const knownCourseIds = new Set(state.coursesMap.keys());
    const placements = state.simulatorPlan.placements;
    const unknownIds = simulatorRules.getUnknownSimulatorCourseIds(placements, knownCourseIds);
    const currentIds = [...state.completedClasses];
    const projectedIds = simulatorRules.buildGraduationProjectionCourseIds(
      currentIds,
      placements,
      knownCourseIds
    );
    const currentAnalysis = analyzeGraduation(currentIds);
    const projectedAnalysis = analyzeGraduation(projectedIds);

    if (unknownNotice) {
      unknownNotice.hidden = unknownIds.length === 0;
      unknownNotice.textContent = unknownIds.length
        ? '計画内に確認が必要な科目があります。この科目は卒業要件の見込み計算には含まれていません。'
        : '';
    }

    const engine = window.GraduationRequirementsEngine;
    const currentDetailResult = engine?.buildRequirementDetails?.(currentIds, state.predefinedData, state.graduationDefinition);
    const projectedDetailResult = engine?.buildRequirementDetails?.(projectedIds, state.predefinedData, state.graduationDefinition);
    simulatorGraduationDetailState = currentDetailResult?.valid && projectedDetailResult?.valid
      ? { current: currentDetailResult.details, projected: projectedDetailResult.details }
      : null;
    const courseDetailPanel = document.getElementById('simulator-graduation-course-detail');
    if (courseDetailPanel) {
      courseDetailPanel.hidden = true;
      courseDetailPanel.innerHTML = '';
    }

    if (!currentAnalysis.valid || !projectedAnalysis.valid || !simulatorGraduationDetailState) {
      summary.innerHTML = '<div class="simulator-graduation-unavailable" role="alert"><strong>卒業見込み：判定不能</strong><span>卒業要件データを確認できないため、計画表示はそのまま利用できます。</span></div>';
      details.innerHTML = '';
      return;
    }

    const target = projectedAnalysis.totalCredits.targetCredits;
    const totalValue = (analysis) => `${analysis.totalCredits.countedCredits} / ${target}単位`;
    summary.innerHTML = `
      <div class="simulator-graduation-status-grid">
        <div class="simulator-graduation-status">
          <strong>現在の修得状況</strong>
          <span>${totalValue(currentAnalysis)}</span>
          <em>${currentAnalysis.satisfied ? '達成' : '未達'}</em>
        </div>
        <div class="simulator-graduation-status">
          <strong>4年計画完了時</strong>
          <span>${totalValue(projectedAnalysis)}</span>
          <em>${projectedAnalysis.satisfied ? '要件充足見込み' : '不足あり'}</em>
        </div>
      </div>`;
    renderGraduationAnalysis(currentAnalysis, projectedAnalysis, details, {
      completedLabel: '現在',
      completedDescription: '実際に修得済みの科目のみ',
      plannedLabel: '4年計画完了時',
      plannedDescription: '修得済み＋シミュレーター計画',
      interactive: true
    });
  };

  let simulatorFeedbackTimer = null;
  const showSimulatorFeedback = (message, isError = false) => {
    const feedback = document.getElementById('simulator-feedback');
    if (!feedback) return;
    feedback.setAttribute('role', isError ? 'alert' : 'status');
    feedback.setAttribute('aria-live', isError ? 'assertive' : 'polite');
    feedback.classList.toggle('is-error', isError);
    feedback.textContent = message;
    feedback.hidden = false;
    window.clearTimeout(simulatorFeedbackTimer);
    simulatorFeedbackTimer = window.setTimeout(() => {
      feedback.hidden = true;
      feedback.textContent = '';
      feedback.classList.remove('is-error');
    }, 4500);
  };

  let simulatorTriggerElement = null;
  let simulatorDetailTriggerElement = null;
  let simulatorPlacementTriggerElement = null;

  const focusElement = (element) => {
    if (element?.isConnected && typeof element.focus === 'function') element.focus();
  };

  const focusPalettePlacementButton = (courseId) => {
    const button = [...document.querySelectorAll('[data-sim-placement-course]')]
      .find((item) => item.dataset.simPlacementCourse === courseId);
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
    const course = state.coursesMap.get(courseId);
    const dialog = document.getElementById('simulator-placement-dialog');
    const info = document.getElementById('simulator-placement-course-info');
    const optionsContainer = document.getElementById('simulator-placement-options');
    if (!course || !dialog || !info || !optionsContainer) return;

    const existingPlacement = getSimulatorPlacement(courseId);
    const quarterOptions = simulatorRules.getPlacementOptions(course);
    info.textContent = `${course.subject} · 開講Q: ${course.quarter || '未定'} · ${course.credits || 0}単位${existingPlacement ? ` · 現在: ${formatSimulatorPlacement(course, existingPlacement)}` : ''}`;
    // Materialize destinations only for the selected course; keeping choices out
    // of every palette card avoids multiplying the 275-course view by year/Q slots.
    optionsContainer.innerHTML = [1, 2, 3, 4].map((year) => `
      <section class="simulator-placement-year" aria-label="${year}年">
        <h3>${year}年</h3>
        <div>${quarterOptions.map((option) => `
          <button type="button" class="simulator-placement-option" data-sim-place-year="${year}" data-sim-place-quarter="${option.start}">
            ${year}年 ${escapeHTML(option.label)}
          </button>
        `).join('')}</div>
      </section>
    `).join('');
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
    const items = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((item) => !item.hidden && item.getClientRects().length > 0);
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
    } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
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
      else if (trigger?.dataset?.simDetailCourse) focusPalettePlacementButton(trigger.dataset.simDetailCourse);
      else focusElement(document.getElementById('simulator-modal-title'));
    }
  };

  const openSimulatorCourseDetail = (courseId) => {
    const course = state.coursesMap.get(courseId);
    const placement = getSimulatorPlacement(courseId);
    const modal = document.getElementById('simulator-course-detail');
    const content = document.getElementById('simulator-course-detail-content');
    const title = document.getElementById('simulator-course-detail-title');
    if (!course || !modal || !content || !title) return;

    if (!modal.classList.contains('is-active')) simulatorDetailTriggerElement = document.activeElement;

    const warnings = placement ? getSimulatorWarnings(course, placement) : [];
    const placementIssues = placement ? simulatorRules.getPlacementIssues(course, placement) : [];
    const difficulty = state.difficultyMap.get(course.id);
    const relations = state.relationsMap.get(course.id);
    const renderRelationList = (items) => (items || []).map((relation) => {
      const relatedCourse = state.coursesMap.get(relation.id);
      if (!relatedCourse) return '';
      const strengthLabel = relation.strength === 'strongly_recommended' ? '強く推奨' : '推奨';
      const strengthClass = relation.strength === 'strongly_recommended' ? 'strong' : 'recommended';
      return `<li><button type="button" class="simulator-related-course" data-sim-related-course="${escapeHTML(relatedCourse.id)}">${escapeHTML(relatedCourse.subject)}</button> <span class="relation-strength ${strengthClass}">${strengthLabel}</span></li>`;
    }).join('');
    const prerequisiteList = renderRelationList(relations?.prerequisites);
    const successorList = renderRelationList(relations?.successors);
    const relationHtml = prerequisiteList || successorList
      ? `<section class="simulator-course-detail-relations" aria-label="関連科目">
          <h3>関連科目</h3>
          ${prerequisiteList ? `<div><strong>前提科目</strong><ul>${prerequisiteList}</ul></div>` : ''}
          ${successorList ? `<div><strong>後継科目</strong><ul>${successorList}</ul></div>` : ''}
        </section>`
      : '';
    const placementIssueHtml = placementIssues.length
      ? `<section class="simulator-course-detail-warnings" aria-label="配置の確認">
          <h3>配置の確認</h3>
          <ul>${placementIssues.map((issue) => `<li class="simulator-warning ${issue.type === 'quarter' ? 'strong' : ''}">${escapeHTML(issue.message)}</li>`).join('')}</ul>
        </section>`
      : '';
    title.textContent = course.subject;
    content.innerHTML = `
      <dl class="simulator-course-detail-list">
        <div><dt>開講Q</dt><dd>${escapeHTML(course.quarter || 'Q未定')}</dd></div>
        ${placement ? `<div><dt>選択Q</dt><dd>${escapeHTML(formatSimulatorPlacement(course, placement))}</dd></div>` : ''}
        <div><dt>単位</dt><dd>${escapeHTML(String(course.credits || 0))}単位</dd></div>
        ${course.tag ? `<div><dt>分野</dt><dd>${escapeHTML(course.tag)}</dd></div>` : ''}
        ${course.method ? `<div><dt>授業方法</dt><dd>${escapeHTML(course.method)}</dd></div>` : ''}
        ${course.teacher ? `<div><dt>担当</dt><dd>${escapeHTML(course.teacher)}</dd></div>` : ''}
        ${difficulty ? `<div><dt>難易度</dt><dd>${difficulty.average.toFixed(2)} / 10.0（${difficulty.votes}票）<br><a href="${escapeHTML(difficulty.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(difficulty.sourceLabel)}</a></dd></div>` : ''}
      </dl>
      ${course.description ? `<section class="simulator-course-detail-description"><h3>概要</h3><p>${escapeHTML(course.description)}</p></section>` : ''}
      <section class="simulator-course-detail-warnings" aria-labelledby="simulator-course-detail-warning-title">
        <h3 id="simulator-course-detail-warning-title">前提科目</h3>
        ${warnings.length
          ? `<ul>${warnings.map((warning) => `<li class="simulator-warning ${warning.strengthClass === 'strong' ? 'strong' : ''}">${escapeHTML(warning.message)}（${escapeHTML(warning.strengthLabel)}）</li>`).join('')}</ul>`
          : `<p>${placement ? '前提科目に関する注意はありません' : '配置後に計画上の前提科目を確認できます'}</p>`}
      </section>
      ${placementIssueHtml}
      ${relationHtml}
      ${placement ? `<button type="button" class="simulator-course-detail-remove" data-sim-detail-remove="${escapeHTML(course.id)}">4年計画から削除</button>` : ''}
    `;
    modal.hidden = false;
    modal.classList.add('is-active');
    content.querySelector('[data-sim-detail-remove]')?.addEventListener('click', () => {
      removeSimulatorCourse(course.id);
      closeSimulatorCourseDetail();
    });
    content.querySelectorAll('[data-sim-related-course]').forEach((button) => {
      button.addEventListener('click', () => openSimulatorCourseDetail(button.dataset.simRelatedCourse));
    });
    title.focus();
  };

  const renderSimulatorCourseResults = () => {
    const results = document.getElementById('sim-course-results');
    if (!results) return;

    const searchInput = document.getElementById('sim-course-search');
    const yearFilter = document.getElementById('sim-course-year-filter');
    const quarterFilter = document.getElementById('sim-course-quarter-filter');
    const categoryFilter = document.getElementById('sim-course-category-filter');
    const placementFilter = document.getElementById('sim-course-placement-filter');
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const selectedYear = yearFilter?.value || 'すべて表示';
    const selectedQuarter = quarterFilter?.value || 'すべて表示';
    const selectedCategory = categoryFilter?.value || 'すべて表示';
    const selectedPlacement = placementFilter?.value || state.simulatorPlacementFilter;

    let matches = state.predefinedData.filter((course) => {
      if (state.simulatorPaletteMode === 'scheduled' && !state.registeredClasses.has(course.id)) return false;
      const isPlaced = Boolean(getSimulatorPlacement(course.id));
      if (selectedPlacement === 'placed' && !isPlaced) return false;
      if (selectedPlacement === 'unplaced' && isPlaced) return false;
      const subject = String(course.subject || '').toLowerCase();
      const teacher = String(course.teacher || '').toLowerCase();
      const matchSearch = !query || subject.includes(query) || teacher.includes(query);
      const matchYear = selectedYear === 'すべて表示' || course.year === selectedYear;
      const quarterNumber = Number.parseInt(String(selectedQuarter).replace(/[^0-9]/g, ''), 10);
      const matchQuarter = selectedQuarter === 'すべて表示'
        || getQuarterInfo(course).quarters.includes(quarterNumber);
      const matchCategory = selectedCategory === 'すべて表示' || course.tag === selectedCategory;
      return matchSearch && matchYear && matchQuarter && matchCategory;
    });

    matches = sortCourses(matches, state.difficultySort, state.difficultyMap);

    if (!matches.length) {
      const message = state.simulatorPaletteMode === 'scheduled'
        ? '履修予定の科目はありません。'
        : '該当する科目がありません。';
      results.innerHTML = `<p class="simulator-empty">${message}</p>`;
      return;
    }

    results.innerHTML = matches.map((course) => {
      const placement = getSimulatorPlacement(course.id);
      const difficulty = state.difficultyMap.get(course.id);
      const placementText = placement ? `✓ ${formatSimulatorPlacement(course, placement)}に配置済み` : '未配置';
      const difficultyText = difficulty ? `難易度 ${difficulty.average.toFixed(2)} / 10.0` : '難易度 未登録';
      const placedClass = placement ? ' is-placed' : '';
      return `
        <article class="sim-course-picker-item${placedClass}" draggable="${placement ? 'false' : 'true'}" data-sim-drag-course="${escapeHTML(course.id)}">
          <div class="sim-course-picker-info">
            <button type="button" class="sim-course-detail-trigger" data-sim-detail-course="${escapeHTML(course.id)}">${escapeHTML(course.subject)}</button>
            <span>${escapeHTML(course.quarter || 'Q未定')} ｜ ${escapeHTML(String(course.credits || 0))}単位</span>
            <small>${escapeHTML(difficultyText)} ｜ ${escapeHTML(placementText)}</small>
          </div>
          <div class="sim-course-placement-controls">
            <button type="button" class="sim-course-placement-open" data-sim-placement-course="${escapeHTML(course.id)}" aria-label="${escapeHTML(course.subject)}を${placement ? '別の場所へ移動' : '配置'}">${placement ? '配置先を変更' : '配置'}</button>
          </div>
        </article>
      `;
    }).join('');
  };

  const clearSimulatorDropHighlights = () => {
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      cell.classList.remove('is-drop-allowed', 'is-drop-forbidden', 'is-drop-active');
    });
  };

  const highlightSimulatorDropCells = (courseId) => {
    const course = state.coursesMap.get(courseId);
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      const quarter = Number(cell.dataset.simDropQuarter);
      const allowed = simulatorRules.canPlaceCourseAt(course, 1, quarter);
      cell.classList.toggle('is-drop-allowed', allowed);
      cell.classList.toggle('is-drop-forbidden', !allowed);
    });
  };

  // The visible drop target is the whole quarter cell.  Cards sit above that
  // background layer, so a drop on a title, warning, or action area must resolve
  // back to the card's assigned quarter instead of becoming a card-to-card action.
  const resolveSimulatorDropCell = (target) => {
    const yearGrid = document.getElementById('simulator-year-grid');
    if (!yearGrid || !target || typeof target.closest !== 'function') return null;
    const directCell = target.closest('[data-sim-drop-quarter]');
    if (directCell && yearGrid.contains(directCell)) return directCell;
    const card = target.closest('[data-sim-drag-course]');
    if (!card || !yearGrid.contains(card)) return null;
    const year = Number(card.dataset.simCardYear);
    const quarter = Number(card.dataset.simCardQuarter);
    if (!Number.isInteger(year) || !Number.isInteger(quarter)) return null;
    return yearGrid.querySelector(`[data-sim-drop-year="${year}"][data-sim-drop-quarter="${quarter}"]`);
  };

  const renderSimulator = () => {
    const summary = document.getElementById('simulator-summary');
    const totalSummary = document.getElementById('simulator-total-summary');
    const yearGrid = document.getElementById('simulator-year-grid');
    const unknownHost = document.getElementById('simulator-unknown-courses');
    if (!summary || !totalSummary || !yearGrid) return;

    const years = [1, 2, 3, 4];
    const getCourse = (id) => state.coursesMap.get(id);
    const yearPlacements = new Map(years.map((year) => [year, []]));
    state.simulatorPlan.placements.forEach((placement) => {
      if (yearPlacements.has(placement.year) && getCourse(placement.courseId)) yearPlacements.get(placement.year).push(placement);
    });

    // span科目が占有するQ区間を先に割り当て、各年に必要な行数だけを確保する。
    // これにより空の年はコンパクトなまま、科目が増えた年だけ4Qセル全体が伸びる。
    const buildYearLaneData = (placements) => {
      const lanes = [];
      const assignments = new Map();
      placements.forEach((placement) => {
        const course = getCourse(placement.courseId);
        const option = getPlacementOption(course, placement);
        // Legacy invalid-Q entries remain visible in their saved cell as a single repairable card.
        const savedQuarter = Number(placement.selectedQuarter);
        const start = option?.start || (Number.isInteger(savedQuarter) && savedQuarter >= 1 && savedQuarter <= 4 ? savedQuarter : 1);
        const end = option?.end || start;
        const span = end - start + 1;
        let lane = 0;
        while (lanes[lane]?.some((interval) => start <= interval.end && start + span - 1 >= interval.start)) lane += 1;
        if (!lanes[lane]) lanes[lane] = [];
        lanes[lane].push({ start, end: start + span - 1 });
        assignments.set(placement.courseId, { lane, start, span, invalidQuarter: !option });
      });
      return { laneCount: lanes.length, assignments };
    };
    const laneDataByYear = new Map(years.map((year) => [year, buildYearLaneData(yearPlacements.get(year))]));
    const quarterCreditsByYear = new Map(years.map((year) => [year, new Map([[1, 0], [2, 0], [3, 0], [4, 0]])]));
    state.simulatorPlan.placements.forEach((placement) => {
      const course = getCourse(placement.courseId);
      const quarterCredits = quarterCreditsByYear.get(placement.year);
      const savedQuarter = Number(placement.selectedQuarter);
      if (!course || !quarterCredits || !Number.isInteger(savedQuarter) || savedQuarter < 1 || savedQuarter > 4) return;
      // Span科目の単位は開始Qに一度だけ集計し、Q合計の二重計上を避ける。
      quarterCredits.set(savedQuarter, quarterCredits.get(savedQuarter) + Number(course.credits || 0));
    });

    const totalCredits = state.simulatorPlan.placements
      .map((placement) => getCourse(placement.courseId))
      .filter(Boolean)
      .reduce((sum, course) => sum + Number(course.credits || 0), 0);
    totalSummary.innerHTML = `<span>総予定単位</span><strong>${totalCredits}単位</strong>`;
    summary.innerHTML = `
      <div><strong>4年間の総予定単位</strong><span>${totalCredits}単位</span></div>
      ${years.map((year) => `<div><strong>${year}年</strong><span>${yearPlacements.get(year).reduce((sum, placement) => sum + Number(getCourse(placement.courseId)?.credits || 0), 0)}単位</span></div>`).join('')}
    `;

    yearGrid.innerHTML = years.map((year) => {
      const laneCount = laneDataByYear.get(year).laneCount;
      // Keep a short but usable card area for empty years, then grow only when
      // lane allocation requires it.  The same template is used by the quarter
      // cells and the card layer so every Q in a year remains equal height.
      const rowTemplate = laneCount ? `24px repeat(${laneCount}, minmax(34px, auto))` : '24px minmax(34px, auto)';
      return `
      <div class="simulator-year-row" data-sim-year="${year}">
        <div class="simulator-year-label"><strong>${year}年</strong><span>${yearPlacements.get(year).reduce((sum, placement) => sum + Number(getCourse(placement.courseId)?.credits || 0), 0)}単位</span></div>
        <div class="simulator-quarter-grid" style="grid-template-rows: ${rowTemplate};">
          ${[1, 2, 3, 4].map((quarter) => `<div class="simulator-quarter-cell" style="grid-column: ${quarter}; grid-row: 1 / -1;" data-sim-drop-year="${year}" data-sim-drop-quarter="${quarter}"><span class="simulator-quarter-header"><strong>${quarter}Q</strong><small>${quarterCreditsByYear.get(year).get(quarter)}単位</small></span></div>`).join('')}
          <div class="simulator-quarter-card-layer" style="grid-column: 1 / -1; grid-row: 1 / -1; grid-template-rows: ${rowTemplate};" aria-label="${year}年の配置済み科目"></div>
        </div>
      </div>
    `;
    }).join('');

    yearPlacements.forEach((placements, year) => {
      const row = yearGrid.querySelector(`[data-sim-year="${year}"]`);
      const cardLayer = row?.querySelector('.simulator-quarter-card-layer');
      if (!cardLayer) return;
      const laneData = laneDataByYear.get(year);

      placements.forEach((placement) => {
        const course = getCourse(placement.courseId);
        const assignment = laneData.assignments.get(placement.courseId);
        if (!assignment) return;

        const warnings = getSimulatorWarnings(course, placement);
        const placementIssues = simulatorRules.getPlacementIssues(course, placement);
        const warningTooltip = [...placementIssues.map((issue) => issue.message), ...warnings.map((warning) => `${warning.message}（${warning.strengthLabel}）`)].join(' / ');
        const warningClass = placementIssues.some((issue) => issue.type === 'quarter') || warnings.some((warning) => warning.strengthClass === 'strong')
          ? ' is-strong'
          : '';
        const quarterIssue = placementIssues.find((issue) => issue.type === 'quarter');
        const card = document.createElement('article');
        const hasWarning = warnings.length > 0 || placementIssues.length > 0;
        card.className = `sim-course-card${quarterIssue ? ' is-quarter-invalid' : ''}${quarterIssue ? ' has-inline-issue' : ''}${hasWarning ? ' has-warning' : ''}`;
        card.draggable = true;
        card.dataset.simDragCourse = course.id;
        card.dataset.simCardYear = String(year);
        card.dataset.simCardQuarter = String(assignment.start);
        card.style.gridColumn = `${assignment.start} / span ${assignment.span}`;
        card.style.gridRow = String(assignment.lane + 2);
        card.title = warningTooltip || `${course.subject}（${course.credits}単位）`;
        card.innerHTML = `
          <button type="button" class="sim-course-card-title" data-sim-detail-course="${escapeHTML(course.id)}">${escapeHTML(course.subject)}</button>
          <span class="sim-course-credits">${escapeHTML(String(course.credits || 0))}単位</span>
          ${quarterIssue ? `<span class="sim-course-quarter-warning" title="${escapeHTML(quarterIssue.message)}">要修正 · ${escapeHTML(quarterIssue.message)}</span>` : ''}
          <div class="sim-course-card-actions">
            ${warnings.length || placementIssues.length ? `<button type="button" class="sim-warning-badge${warningClass}" data-sim-warning-course="${escapeHTML(course.id)}" aria-label="配置・前提の注意を確認">⚠</button>` : ''}
            <button type="button" class="sim-course-detail-view" data-sim-detail-course="${escapeHTML(course.id)}" aria-label="${escapeHTML(course.subject)}の詳細を見る" title="科目詳細を見る">👁</button>
            <button type="button" class="sim-course-remove" data-sim-remove-course="${escapeHTML(course.id)}" aria-label="${escapeHTML(course.subject)}を削除">×</button>
          </div>
        `;
        cardLayer.appendChild(card);
      });
    });

    // A missing catalog entry may return in a later data release. Keep it out of
    // Q/credit calculations, but make the saved ID visible and removable by choice.
    if (unknownHost) {
      const unknownPlacements = state.simulatorPlan.placements.filter((placement) => !getCourse(placement.courseId));
      unknownHost.hidden = unknownPlacements.length === 0;
      unknownHost.replaceChildren();
      if (unknownPlacements.length) {
        const heading = document.createElement('h3');
        heading.textContent = '確認が必要な科目';
        unknownHost.appendChild(heading);
        unknownPlacements.forEach((placement) => {
          const row = document.createElement('div');
          row.className = 'simulator-unknown-course';
          const info = document.createElement('span');
          const quarter = Number(placement.selectedQuarter);
          const savedQuarter = Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? `${quarter}Q` : 'Q不明';
          info.textContent = `科目ID: ${placement.courseId} · 保存位置: ${placement.year}年${savedQuarter} · 現在の科目データでは確認できません · 単位不明`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.textContent = '削除';
          remove.dataset.simRemoveCourse = placement.courseId;
          remove.setAttribute('aria-label', `確認できない科目 ${placement.courseId} を計画から削除`);
          row.append(info, remove);
          unknownHost.appendChild(row);
        });
      }
    }

    const categoryFilter = document.getElementById('sim-course-category-filter');
    if (categoryFilter) {
      const categories = [...new Set(state.predefinedData.map((course) => course.tag).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
      const currentCategory = categoryFilter.value;
      categoryFilter.innerHTML = '<option value="すべて表示">分野</option>'
        + categories.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
      categoryFilter.value = categories.includes(currentCategory) ? currentCategory : 'すべて表示';
    }

    if (!state.simulatorPaletteDefaulted) {
      state.simulatorPaletteMode = [...state.registeredClasses]
        .some((courseId) => state.coursesMap.has(courseId))
        ? 'scheduled'
        : 'all';
      state.simulatorPaletteDefaulted = true;
    }
    document.querySelectorAll('[data-sim-palette-mode]').forEach((tab) => {
      const active = (tab.dataset.simPaletteMode === 'scheduled' ? 'scheduled' : 'all') === state.simulatorPaletteMode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    renderSimulatorCourseResults();
    renderSimulatorPlanCheck();
    renderSimulatorGraduationProjection();
  };

  const placeSimulatorCourse = (courseId, year, selectedQuarter) => {
    const course = state.coursesMap.get(courseId);
    const result = simulatorRules.applyPlacement(state.simulatorPlan.placements, course, year, selectedQuarter);
    if (!result.allowed) {
      if (result.reason === 'not-offered' && course) {
        showSimulatorFeedback(`この科目はQ${selectedQuarter}には開講されていません。計画は変更していません。`);
      }
      return false;
    }
    return commitSimulatorPlan({ ...state.simulatorPlan, placements: result.placements });
  };

  const removeSimulatorCourse = (courseId) => {
    const placements = state.simulatorPlan.placements.filter((placement) => placement.courseId !== courseId);
    return commitSimulatorPlan({ ...state.simulatorPlan, placements });
  };


  const sumCredits = (classes) => classes.reduce((sum, cls) => sum + Number(cls.credits || 0), 0);

  const invalidGraduationResult = (details = []) => ({
    valid: false,
    message: '科目データを確認できないため、卒業要件を判定できません。',
    details
  });

  const analyzeGraduation = (courseIds) => {
    if (state.courseValidationError) return invalidGraduationResult([state.courseValidationError]);
    if (!state.graduationDefinition || !window.GraduationRequirementsEngine) {
      return invalidGraduationResult(['卒業要件定義を読み込めませんでした。']);
    }
    return window.GraduationRequirementsEngine.analyzeGraduationRequirements(
      courseIds,
      state.predefinedData,
      state.graduationDefinition
    );
  };

  /**
   * 総単位ゲージは「履修予定込み」の卒業算入単位を表示する。
   * 詳細モーダルでは修得済みと履修予定込みを別々に表示するため、
   * 同じ科目を二重加算しない共通エンジンの結果だけを利用する。
   */
  const calculateCredits = (state) => {
    const courseIds = [...state.completedClasses, ...state.registeredClasses];
    const analysis = analyzeGraduation(courseIds);
    // 判定不能を0単位に変換すると、上部ゲージが正常な未履修状態と誤認される。
    if (!analysis.valid) return { valid: false };
    return {
      valid: true,
      totalCredits: analysis.totalCredits.countedCredits,
      rawTotalCredits: analysis.totalCredits.actualCredits,
      socialCredits: analysis.totalCredits.socialActualCredits
    };
  };

  const renderGraduationGauge = (stats, unavailableText = '判定不能') => {
    // Keep the analyzer optional during the bootstrap path: a minimal host DOM
    // (and the simulator's isolated test harness) may not expose querySelector.
    const valueElement = typeof document.querySelector === 'function'
      ? document.querySelector('.top-credit-gauge .gauge-value')
      : null;
    const fillElement = document.getElementById('top-earned-fill');
    if (!valueElement || !fillElement) return;

    const barElement = fillElement.parentElement;
    const targetCredits = state.graduationDefinition?.requirements?.totalCredits?.targetCredits;
    const canShowProgress = stats.valid && Number.isFinite(targetCredits) && targetCredits > 0;
    valueElement.textContent = canShowProgress ? `${stats.totalCredits}/${targetCredits}` : unavailableText;
    if (barElement) {
      // 判定不能や読み込み中の値を「0%の進捗」として読ませない。
      barElement.hidden = !canShowProgress;
      if (canShowProgress) {
        barElement.setAttribute('aria-valuenow', stats.totalCredits);
        barElement.setAttribute('aria-valuemax', targetCredits);
      } else {
        barElement.removeAttribute('aria-valuenow');
        barElement.removeAttribute('aria-valuemax');
      }
    }
    if (canShowProgress) {
      const pct = Math.max(0, Math.min(100, (stats.totalCredits / targetCredits) * 100));
      fillElement.style.width = `${pct}%`;
      fillElement.style.background = pct >= 100 ? '#22c55e' : (pct >= 60 ? '#3b82f6' : '#ef4444');
    }
  };

  const graduationStatus = (requirement, planned) => {
    if (requirement.satisfied) return planned ? '達成見込み' : '達成';
    return planned ? '不足' : '未達';
  };

  const renderGraduationAnalysis = (completedAnalysis, plannedAnalysis, targetElement = null, options = {}) => {
    const analysisResultElement = targetElement || document.getElementById('analysis-result');
    if (!analysisResultElement) return;
    const completedLabel = options.completedLabel || '修得済み';
    const completedDescription = options.completedDescription || '履修済みのみ';
    const plannedLabel = options.plannedLabel || '予定込み';
    const plannedDescription = options.plannedDescription || '履修済み＋履修予定';
    if (!completedAnalysis.valid || !plannedAnalysis.valid) {
      analysisResultElement.innerHTML = `<div class="analysis-box graduation-analysis-error" role="alert">${escapeHTML(completedAnalysis.message || plannedAnalysis.message || '科目データを確認できないため、卒業要件を判定できません。')}</div>`;
      return;
    }

    const ratio = (requirement, planned) => {
      const status = graduationStatus(requirement, planned);
      const statusClass = requirement.satisfied ? 'requirement-met' : 'requirement-remaining';
      return `<span class="requirement-progress"><span class="requirement-ratio">${requirement.credits ?? requirement.countedCredits} / ${requirement.targetCredits}単位</span> <span class="${statusClass}">${status}</span></span>`;
    };
    const interactiveRow = (label, key) => options.interactive
      ? ` data-sim-graduation-detail="${escapeHTML(key)}" role="button" tabindex="0" aria-label="${escapeHTML(label)}の詳細を表示"`
      : '';
    const dual = (label, completedRequirement, plannedRequirement, key) => `
      <div class="graduation-requirement-row"${interactiveRow(label, key)}>
        <strong>${escapeHTML(label)}</strong>
        <span>${escapeHTML(completedLabel)} ${ratio(completedRequirement, false)}</span>
        <span>${escapeHTML(plannedLabel)} ${ratio(plannedRequirement, true)}</span>
      </div>`;
    const foundationGroups = completedAnalysis.foundation.groups.map((group, index) => {
      const plannedGroup = plannedAnalysis.foundation.groups[index];
      return dual(`基礎：${group.label}`, group, plannedGroup, `foundation.groups.${group.key}`);
    }).join('');

    const socialRow = `
      <div class="graduation-requirement-row graduation-social-row"${interactiveRow('社会接続', 'socialConnection')}>
        <strong>社会接続</strong>
        <span>${escapeHTML(completedLabel)}取得：${completedAnalysis.socialConnection.actualCredits}単位 / 算入：${completedAnalysis.socialConnection.countedCredits}単位</span>
        <span>${escapeHTML(plannedLabel)}取得：${plannedAnalysis.socialConnection.actualCredits}単位 / 算入：${plannedAnalysis.socialConnection.countedCredits}単位（上限${plannedAnalysis.socialConnection.capCredits}単位）</span>
      </div>`;

    const projectCompleted = completedAnalysis.projectPractice;
    const projectPlanned = plannedAnalysis.projectPractice;
    const industryCompleted = completedAnalysis.worldUnderstanding.industryHistory;
    const industryPlanned = plannedAnalysis.worldUnderstanding.industryHistory;
    analysisResultElement.innerHTML = `
      <div class="analysis-box graduation-analysis" aria-describedby="graduation-analysis-note">
        <p class="graduation-analysis-legend"><strong>${escapeHTML(completedLabel)}</strong>は${escapeHTML(completedDescription)}、<strong>${escapeHTML(plannedLabel)}</strong>は${escapeHTML(plannedDescription)}です。</p>
        <div class="graduation-overall-status" aria-live="polite">
          ${escapeHTML(completedLabel)}：<strong>${completedAnalysis.satisfied ? '達成' : '未達'}</strong> ／
          ${escapeHTML(plannedLabel)}：<strong>${plannedAnalysis.satisfied ? '達成見込み' : '不足'}</strong>
        </div>
        ${dual('総卒業算入単位', completedAnalysis.totalCredits, plannedAnalysis.totalCredits, 'totalCredits')}
        ${dual('導入科目', completedAnalysis.introduction, plannedAnalysis.introduction, 'introduction')}
        <div class="graduation-requirement-group">
          ${dual('基礎科目', completedAnalysis.foundation, plannedAnalysis.foundation, 'foundation')}
          ${foundationGroups}
          ${dual('多言語ITコミュニケーション', completedAnalysis.foundation.multilingualIT, plannedAnalysis.foundation.multilingualIT, 'foundation.multilingualIT')}
        </div>
        ${dual('展開科目', completedAnalysis.advanced, plannedAnalysis.advanced, 'advanced')}
        ${dual('基盤リテラシー（基礎科目を含む）', completedAnalysis.literacy, plannedAnalysis.literacy, 'literacy')}
        ${dual('多言語情報理解（基礎科目を含む）', completedAnalysis.multilingualInformation, plannedAnalysis.multilingualInformation, 'multilingualInformation')}
        ${dual('世界理解（基礎科目を含む）', completedAnalysis.worldUnderstanding, plannedAnalysis.worldUnderstanding, 'worldUnderstanding')}
        <div class="graduation-requirement-row graduation-subrequirement-row"${interactiveRow('世界理解内：産業史系', 'worldUnderstanding.industryHistory')}>
          <strong>世界理解内：産業史系</strong>
          <span>${escapeHTML(completedLabel)} ${ratio(industryCompleted, false)}</span>
          <span>${escapeHTML(plannedLabel)} ${ratio(industryPlanned, true)}</span>
        </div>
        ${socialRow}
        ${dual('プロジェクト実践', projectCompleted, projectPlanned, 'projectPractice')}
        <p id="graduation-analysis-note" class="graduation-analysis-note">各要件は重複して充当される場合があるため、内訳の必要単位数を合計しないでください。</p>
      </div>
    `;
  };

  /**
   * 自分が登録した授業リスト（右カラム）を画面に描画する関数
   */
  const createClassItem = (cls, type) => {
    const li = document.createElement('li');
    li.className = 'class-item';

    li.innerHTML = `
      <div class="class-info">
        <strong>${escapeHTML(cls.subject)}</strong>
        <div class="class-meta">
          ${(cls.category === '必修' || cls.category === '選択必修') ? `<span class="badge required">${escapeHTML(cls.category)}</span>` : ''}
          ${cls.year ? `<span class="badge">${escapeHTML(cls.year)}</span>` : ''}
          ${cls.quarter ? cls.quarter.replace(/\s*([〜～ー－–—\-])\s*/g, '$1').split(/[・,、，\s]+/).filter(Boolean).map(q => `<span class="badge">${escapeHTML(q)}</span>`).join('') : ''}
        </div>
      </div>
      <div class="actions">
        <button class="delete-btn">削除</button>
      </div>
    `;

    li.querySelector('.delete-btn').onclick = () => {
      // IDベースでの一括削除を共通関数に委譲
      commitStateChange(cls.id, 'DELETE');
    };

    return li;
  };

  /**
   * データを保存して再描画する
   */
  const renderList = () => {
    list.innerHTML = '';
    completedList.innerHTML = '';

    // IDからオブジェクトを復元
    const regObjects = Array.from(state.registeredClasses).map(id => state.coursesMap.get(id)).filter(Boolean);
    const compObjects = Array.from(state.completedClasses).map(id => state.coursesMap.get(id)).filter(Boolean);
    // 空の一覧でも次の操作が分かるように、データがない状態を明示する。
    if (!regObjects.length) {
      list.innerHTML = '<li class="enrollment-empty-state">履修予定はありません。授業を探して追加できます。</li>';
    }
    if (!compObjects.length) {
      completedList.innerHTML = '<li class="enrollment-empty-state">履修済みの科目はありません。</li>';
    }

    const stats = calculateCredits(state);
    const regCredits = sumCredits(regObjects);
    const earnedCredits = sumCredits(compObjects);

    // 修得済みと履修予定込みを同じ純粋な判定器へ渡し、表示上も混同しないようにする。
    const completedAnalysis = analyzeGraduation([...state.completedClasses]);
    const plannedAnalysis = analyzeGraduation([...state.completedClasses, ...state.registeredClasses]);

    regObjects.forEach((cls) => list.appendChild(createClassItem(cls, 'registered')));
    compObjects.forEach((cls) => completedList.appendChild(createClassItem(cls, 'completed')));
    document.getElementById('earned-credits').textContent = earnedCredits;
    // Unknown IDs are retained for recovery but are not counted as visible courses.
    document.getElementById('registered-count').textContent = regObjects.length;
    document.getElementById('registered-credits').textContent = regCredits;
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    if (mobileEnrollmentToggle) {
      mobileEnrollmentToggle.textContent = `通常履修 ${regObjects.length}科目 / ${regCredits}単位`;
    }

    renderGraduationGauge(stats);

    renderGraduationAnalysis(completedAnalysis, plannedAnalysis);
    renderSimulatorGraduationProjection();
    return;

  };

  const clearCourseFilters = () => {
    state.filterYear = 'すべて表示';
    state.filterQuarter = 'すべて表示';
    state.filterCategory = '分野';
    state.filterRequirement = 'すべて表示';
    state.filterIntro = 'すべて表示';
    state.filterSearch = '';
    state.difficultySort = 'default';
    state.excludePixiv = false;
    saveFilterPreferences({ excludePixiv: false });

    const values = {
      'year-filter': state.filterYear,
      'quarter-filter': state.filterQuarter,
      'category-filter': state.filterCategory,
      'requirement-filter': state.filterRequirement,
      'intro-filter': state.filterIntro
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = '';
    const excludePixiv = document.getElementById('exclude-pixiv-filter');
    if (excludePixiv) excludePixiv.checked = false;
    syncCourseSortOptions();
    renderPredefinedList();
  };

  let relatedDetailReturnFocus = null;

  const renderRelationLinks = (relationItems) => (relationItems || []).map((relation) => {
    const relatedId = typeof relation === 'string' ? relation : relation.id;
    const strength = typeof relation === 'string' ? 'recommended' : relation.strength;
    const relatedCourse = state.coursesMap.get(relatedId);
    if (!relatedCourse) return '';
    const strengthLabel = strength === 'strongly_recommended' ? '強く推奨' : '推奨';
    const strengthClass = strength === 'strongly_recommended' ? 'strong' : 'recommended';
    return `<li><a href="#course-${escapeHTML(relatedCourse.id)}" class="related-course-link" data-course-id="${escapeHTML(relatedCourse.id)}">${escapeHTML(relatedCourse.subject)}</a> <span class="relation-strength ${strengthClass}">${strengthLabel}</span></li>`;
  }).join('');

  const renderCourseDetailMarkup = (data) => {
    if (!data || typeof data.id !== 'string' || !data.id) return '';

    const difficulty = state.difficultyMap.get(data.id);
    const safeSyllabusUrl = sanitizeExternalUrl(data.url);
    const teacher = String(data.teacher || '');
    const teacherParts = teacher.split(', ');
    const displayTeacher = teacherParts.length > 1
      ? `${teacherParts[0]} 他${teacherParts.length - 1}名`
      : teacher;
    const difficultyHtml = difficulty ? `
      <section class="difficulty-section" aria-label="授業難易度">
        <h5 class="difficulty-title">📊 授業難易度</h5>
        <p><strong>難易度目安：</strong>${difficulty.average.toFixed(2)} / 10.0</p>
        <p><strong>投票数：</strong>${difficulty.votes}票</p>
        <p class="difficulty-source-row">
          <strong>出典：</strong><a href="${escapeHTML(difficulty.sourceUrl)}" target="_blank" rel="noopener noreferrer" class="difficulty-source">${escapeHTML(difficulty.sourceLabel)}</a>
        </p>
      </section>
    ` : '';

    const relations = state.relationsMap.get(data.id);
    const prerequisiteLinks = renderRelationLinks(relations?.prerequisites);
    const successorLinks = renderRelationLinks(relations?.successors);
    const relationsHtml = (prerequisiteLinks || successorLinks) ? `
      <section class="course-relations" aria-label="関連科目">
        <h5 class="course-relations-title">関連科目</h5>
        ${prerequisiteLinks ? `<div class="course-relation-group"><strong>前提科目</strong><ul>${prerequisiteLinks}</ul></div>` : ''}
        ${successorLinks ? `<div class="course-relation-group"><strong>後継科目</strong><ul>${successorLinks}</ul></div>` : ''}
      </section>
    ` : '';

    return `
      <h4 class="detail-subject" tabindex="-1">${escapeHTML(data.subject)}</h4>
      <div class="detail-badges">
        <span class="badge-cat ${data.category === '必修' || data.category === '選択必修' ? 'important' : ''}">${escapeHTML(data.category)}</span>
        <span class="badge-item">${escapeHTML(data.credits)}単位</span>
        <span class="badge-item">${escapeHTML(data.year)}</span>
        <span class="badge-item">${escapeHTML(data.quarter)}</span>
      </div>
      <div class="detail-sections">
        <p><strong>科目区分:</strong> ${escapeHTML(data.method || '-')} ${data.remarks ? `(${escapeHTML(data.remarks)})` : ''}</p>
        <p><strong>タグ:</strong> ${data.tag ? `#${escapeHTML(data.tag)}` : '-'}</p>
        <p><strong>教員情報:</strong> ${escapeHTML(displayTeacher)}</p>
        <p class="evaluation"><strong>評価方法:</strong> ${escapeHTML(data.evaluation)}</p>
        ${safeSyllabusUrl ? `<p><a href="${escapeHTML(safeSyllabusUrl)}" target="_blank" rel="noopener noreferrer" class="syllabus-link" title="ZEN大学シラバスサイトの該当ページを開きます">ZEN大学シラバスで詳細を確認</a></p>` : ''}
        <p class="description"><strong>授業概要:</strong> ${escapeHTML(data.description)}</p>
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
        if (typeof courseId !== 'string' || !state.coursesMap.has(courseId)) return;

        if (relatedCourseDetailHost && relatedCourseDetailHost.hidden) {
          const sourceItem = link.closest('.predefined-item');
          relatedDetailReturnFocus = sourceItem?.querySelector('.detail-btn') || document.activeElement;
        }

        openCourseDetail(courseId);
      });
    });
  };

  const closeRelatedCourseDetail = (returnFocus = true) => {
    if (!relatedCourseDetailHost) return;
    relatedCourseDetailHost.hidden = true;
    relatedCourseDetailHost.replaceChildren();
    if (returnFocus && relatedDetailReturnFocus?.isConnected) relatedDetailReturnFocus.focus();
    relatedDetailReturnFocus = null;
  };

  const openCourseDetail = (courseId) => {
    const course = state.coursesMap.get(courseId);
    if (!course || !relatedCourseDetailHost) return;

    // 関連詳細は探索リスト外の独立領域で描画し、現在の検索・フィルター結果を変更しない。
    predefinedList.querySelectorAll('.class-detail.open').forEach((detail) => {
      detail.classList.remove('open');
      detail.closest('.predefined-item')?.querySelector('.detail-btn')?.setAttribute('aria-expanded', 'false');
    });

    relatedCourseDetailHost.innerHTML = `
      <div class="related-course-detail-shell">
        <button class="related-detail-close" type="button" aria-label="関連科目の詳細を閉じる">×</button>
        <div class="class-detail open">${renderCourseDetailMarkup(course)}</div>
      </div>
    `;
    relatedCourseDetailHost.hidden = false;
    relatedCourseDetailHost.querySelector('.related-detail-close')?.addEventListener('click', () => closeRelatedCourseDetail());
    bindRelatedCourseLinks(relatedCourseDetailHost);
    relatedCourseDetailHost.querySelector('.detail-subject')?.focus({ preventScroll: true });
    relatedCourseDetailHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && relatedCourseDetailHost && !relatedCourseDetailHost.hidden) {
      closeRelatedCourseDetail();
    }
  });

  /**
   * 既定の授業リスト（左カラム）を画面に描画する関数
   * renderAll() 内で呼び出されるため、初期化エラー（ReferenceError）を避けるために
   * renderAll や fetch 処理よりも前に定義する必要があります。
   */
  const renderPredefinedList = () => {
    predefinedList.innerHTML = '';

    const filtered = state.predefinedData.filter(item => {
      const matchYear = state.filterYear === 'すべて表示' || item.year === state.filterYear;

      // 学期（Quarter）判定：範囲指定(1Q〜2Q)や複数指定(1Q・2Q)に対応した正規化判定
      const matchQuarter = (function() {
        const f = state.filterQuarter;
        const q = item.quarter || '';
        if (f === 'すべて表示') return true;

        const filterNum = parseInt(f.replace(/[^0-9]/g, ''));
        // 1. 範囲記号（〜やハイフン）の前後のスペースを消し、記号を半角ハイフンに統一
        // 2. 区切り記号（・やカンマ、残ったスペース）を半角カンマに統一
        const standardized = q.replace(/\s*[〜～ー－–—\-]\s*/g, '-')
                              .replace(/[・,、，\s]+/g, ',');

        return standardized.split(',').filter(Boolean).some(part => {
          if (part.includes('-')) {
            const nums = part.split('-').map(s => parseInt(s.replace(/[^0-9]/g, '')));
            if (nums.length === 2 && !isNaN(nums[0]) && !isNaN(nums[1])) {
              return filterNum >= nums[0] && filterNum <= nums[1];
            }
          }
          return part.trim() === f || parseInt(part.replace(/[^0-9]/g, '')) === filterNum;
        });
      })();

      const matchRequirement = state.filterRequirement === 'すべて表示' || item.category === state.filterRequirement;

      // 導入科目フィルタは外部化された卒業要件定義を参照する。
      const introductionCourseIds = state.graduationDefinition?.requirements?.introduction?.courseIds || [];
      const matchIntro = state.filterIntro === 'すべて表示' || (state.filterIntro === '該当' ? introductionCourseIds.includes(item.id) : !introductionCourseIds.includes(item.id));

      let matchCategory = state.filterCategory === '分野';
      if (!matchCategory) {
        if (state.filterCategory === '多言語情報理解') {
          matchCategory = item.multilingualRequirement === true || 
                          item.foundationRequirement === '多言語情報理解' ||
                          item.tag === '多言語' || 
                          item.subject === '多言語ITコミュニケーション';
        } else if (state.filterCategory === '自由科目') {
          matchCategory = item.category === '自由' || item.tag === '自由科目';
        } else {
          matchCategory = item.tag === state.filterCategory;
        }
      }

      const searchLower = state.filterSearch.toLowerCase();

      const matchSearch =
        item.subject.toLowerCase().includes(searchLower) ||
        item.teacher.toLowerCase().includes(searchLower) ||
        (item.tag && item.tag.toLowerCase().includes(searchLower.replace('#', '')));

      const matchProvider = !state.excludePixiv || item.provider !== 'pixiv';

      return matchYear && matchQuarter && matchRequirement && matchIntro && matchCategory && matchSearch && matchProvider;
    });

    const sorted = sortCourses(filtered, state.difficultySort, state.difficultyMap);

    const hasActiveFilters = Boolean(
      state.filterSearch.trim() ||
      state.filterYear !== 'すべて表示' ||
      state.filterQuarter !== 'すべて表示' ||
      state.filterCategory !== '分野' ||
      state.filterRequirement !== 'すべて表示' ||
      state.filterIntro !== 'すべて表示' ||
      state.difficultySort !== 'default' ||
      state.excludePixiv
    );

    const activeConditionCount = [
      state.filterYear !== 'すべて表示',
      state.filterQuarter !== 'すべて表示',
      state.filterCategory !== '分野',
      state.filterRequirement !== 'すべて表示',
      state.excludePixiv,
      state.difficultySort !== 'default'
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
      predefinedList.appendChild(emptyItem);
      return;
    }


    sorted.forEach(data => {
      const isRegistered = state.registeredClasses.has(data.id);
      const isCompleted = state.completedClasses.has(data.id);
      // UI上の背景色などは「どちらかに入っている」場合に適用
      const isHandled = isRegistered || isCompleted; 

      // 難易度データが登録されている科目に限り、詳細欄へ表示する
      const difficulty = state.difficultyMap.get(data.id);
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
            <strong>${escapeHTML(data.subject)}</strong>
            <div class="class-meta">
              ${(data.category === '必修' || data.category === '選択必修') ? `<span class="badge required">${escapeHTML(data.category)}</span>` : ''}
              ${data.year ? `<span class="badge">${escapeHTML(data.year)}</span>` : ''}
              ${data.quarter ? data.quarter.replace(/\s*([〜～ー－–—\-])\s*/g, '$1').split(/[・,、，\s]+/).filter(Boolean).map(q => `<span class="badge">${escapeHTML(q)}</span>`).join('') : ''}
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
        commitStateChange(data.id, 'REGISTER');
      };

      li.querySelector('.complete-predefined').onclick = () => {
        // 排他的な追加（履修済みへ）
        commitStateChange(data.id, 'COMPLETE');
      };

      predefinedList.appendChild(li);
    });
  };

  /**
   * PDFの構図を固定した正規化キャンバスへ科目を割り当てる。
   * 個別科目の位置を文字の読めないPDFから推測しないため、公式図で確認できる
   * 大分類だけを配置定義へ持ち、同じ区分内のカードは既存メタデータの順で並べる。
   * 参考関係の線は公式の履修前提条件ではないので、表示時にも明示的に区別する。
   */
  const getCurriculumStage = (course) => {
    const stage = String(course?.year || '').trim();
    return ['1年次', '2年次', '3年次', '4年次'].includes(stage) ? stage : '未分類';
  };

  const getCurriculumField = (course) => String(course?.tag || '未分類').trim() || '未分類';

  const getCurriculumTrack = (course) => {
    if (course?.tag === '卒業プロジェクト') return 'プロジェクト実践';
    if (course?.category === '必修') return '導入科目';
    if (course?.foundationRequirement) return '基礎科目';
    if (course?.tag === '社会接続') return '社会接続';
    if (course?.category === '自由' || course?.tag === '自由科目') return '自由科目';
    return '展開科目';
  };

  const fallbackCurriculumDefinition = {
    canvas: { width: 2400, height: 2388 },
    bands: [],
    columns: [
      { id: 'foundation', label: '基盤リテラシー・数理', x: 178, width: 360, group: 'foundation', tags: ['情報', '数理'] },
      { id: 'foundation-social', label: '基礎・社会ネットワーク', x: 542, width: 350, group: 'foundation', tags: ['社会・ネットワーク'] },
      { id: 'multilingual', label: '多言語情報理解', x: 900, width: 140, group: 'multilingual', tags: ['多言語'] },
      { id: 'culture', label: '文化・思想', x: 1058, width: 320, group: 'world', tags: ['文化・思想'] },
      { id: 'social', label: '社会・ネットワーク', x: 1386, width: 320, group: 'world', tags: ['社会・ネットワーク', '社会接続'] },
      { id: 'economy', label: '経済・マーケット', x: 1714, width: 320, group: 'world', tags: ['経済・マーケット', 'デジタル産業'] },
      { id: 'free', label: '社会接続・自由科目', x: 2048, width: 330, group: 'free', tags: ['自由科目'] }
    ]
  };

  const getCurriculumDefinition = () => state.curriculumLayoutDefinition || fallbackCurriculumDefinition;

  const getOfficialColumn = (course, definition) => {
    const columns = definition.columns || [];
    const tag = getCurriculumField(course);
    // The official map places project practice with the world-understanding area.
    // Keep it in a real world column even though the layout definition uses
    // separate band metadata rather than a synthetic `world` column.
    if (course?.tag === '卒業プロジェクト') {
      return columns.find((column) => column.id === 'culture')
        || columns.find((column) => column.group === 'world')
        || columns[0];
    }
    if (course?.category === '自由' || tag === '自由科目') return columns.find((column) => column.id === 'free') || columns.at(-1);
    if (tag === '多言語') return columns.find((column) => column.id === 'multilingual') || columns[2] || columns[0];
    if (tag === '文化・思想') return columns.find((column) => column.id === 'culture') || columns[3] || columns[0];
    if (tag === '経済・マーケット' || tag === 'デジタル産業') return columns.find((column) => column.id === 'economy') || columns[5] || columns[0];
    if (tag === '社会・ネットワーク' || tag === '社会接続') return columns.find((column) => column.id === 'social') || columns[4] || columns[0];
    if (tag === '情報' || tag === '数理' || course?.category === '必修') {
      const id = tag === '社会・ネットワーク' ? 'foundation-social' : 'foundation';
      return columns.find((column) => column.id === id) || columns[0];
    }
    return columns.find((column) => column.id === 'foundation-social') || columns[1] || columns[0];
  };

  const buildCurriculumLayout = () => {
    const definition = getCurriculumDefinition();
    const canvasWidth = Number(definition.canvas?.width) || 2400;
    const canvasHeight = Number(definition.canvas?.height) || 2388;
    const columns = definition.columns?.length ? definition.columns : fallbackCurriculumDefinition.columns;
    const placementMap = new Map((definition.coursePlacements || [])
      .filter((placement) => placement && placement.courseId)
      .map((placement) => [placement.courseId, placement]));
    const getPlacementColumn = (course) => {
      const placement = placementMap.get(course.id);
      if (placement?.confidence === 'confirmed' && Number.isFinite(Number(placement.x))) {
        const pdfX = Number(placement.x) * canvasWidth;
        const nearest = columns.reduce((best, column) => {
          const center = Number(column.x) + Number(column.width) / 2;
          if (!best || Math.abs(center - pdfX) < best.distance) return { column, distance: Math.abs(center - pdfX) };
          return best;
        }, null);
        if (nearest?.column) return nearest.column;
      }
      // The PDF's orange introduction band spans the foundation columns. Use
      // the manually inspected horizontal coordinate for those cards instead
      // of routing every required course into the first semantic lane.
      if (placement?.category === '導入科目') {
        const x = Number(placement.x);
        const columnId = x < 0.225 ? 'foundation' : x < 0.375 ? 'foundation-social' : x < 0.44 ? 'multilingual' : x < 0.575 ? 'culture' : x < 0.715 ? 'social' : x < 0.85 ? 'economy' : 'free';
        return columns.find((column) => column.id === columnId) || getOfficialColumn(course, definition);
      }
      return getOfficialColumn(course, definition);
    };
    const positions = new Map();
    const byColumn = new Map(columns.map((column) => [column.id, []]));
    const compareCourses = (a, b) => {
      const yearA = Number.parseInt(a.year, 10) || 99;
      const yearB = Number.parseInt(b.year, 10) || 99;
      return yearA - yearB || String(a.subject || '').localeCompare(String(b.subject || ''), 'ja');
    };
    state.predefinedData.forEach((course) => {
      const column = getPlacementColumn(course) || columns[0];
      if (column && byColumn.has(column.id)) byColumn.get(column.id).push(course);
    });
    byColumn.forEach((items) => items.sort((a, b) => {
      const bucket = (course) => course.tag === '卒業プロジェクト' ? 3 : course.category === '必修' ? 0 : course.foundationRequirement ? 1 : 2;
      return bucket(a) - bucket(b) || compareCourses(a, b);
    }));
    const cardWidth = 142;
    const cardHeight = 76;
    const top = 178;
    const bottom = Math.max(1900, canvasHeight - 120);
    columns.forEach((column) => {
      const items = byColumn.get(column.id) || [];
      const cols = Math.max(1, Math.floor((Number(column.width) - 18) / (cardWidth + 8)));
      items.forEach((course, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = Number(column.x) + 9 + col * (cardWidth + 8);
        const bucket = course.tag === '卒業プロジェクト' ? 3 : course.category === '必修' ? 0 : course.foundationRequirement ? 1 : 2;
        const bucketOffset = bucket === 0 ? 0 : bucket === 1 ? 132 : bucket === 2 ? 312 : 1760;
        const y = Math.min(bottom - cardHeight, top + bucketOffset + row * (cardHeight + 10));
        const placement = placementMap.get(course.id);
        const requestedX = placement ? Number(placement.x) * canvasWidth : null;
        const requestedY = placement ? Number(placement.y) * canvasHeight : null;
        const requestedWidth = placement ? Number(placement.width) * canvasWidth : null;
        const requestedHeight = placement ? Number(placement.height) * canvasHeight : null;
        const nodeWidth = Number.isFinite(requestedWidth) && requestedWidth > 72 ? Math.min(170, requestedWidth) : cardWidth;
        const nodeHeight = Number.isFinite(requestedHeight) && requestedHeight > 48 ? Math.min(96, requestedHeight) : cardHeight;
        // PDF coordinates are global. Clamp only the final card box to its
        // semantic lane so narrow metadata columns never leak into neighbors.
        const laneLeft = Number(column.x) + 9;
        const laneRight = Number(column.x) + Number(column.width) - nodeWidth - 9;
        const positionedX = Number.isFinite(requestedX)
          ? Math.min(laneRight, Math.max(laneLeft, requestedX))
          : x;
        const positionedY = Number.isFinite(requestedY)
          ? Math.min(canvasHeight - nodeHeight - 18, Math.max(150, requestedY))
          : Math.min(bottom - cardHeight, y);
        positions.set(course.id, {
          x: positionedX + nodeWidth / 2,
          y: positionedY + nodeHeight / 2,
          left: positionedX,
          top: positionedY,
          width: nodeWidth,
          height: nodeHeight,
          lane: column.id,
          officialGroup: column.group,
          stage: getCurriculumStage(course),
          officialConfidence: placement?.confidence || 'provisional',
          verificationMethod: placement?.verificationMethod || 'structure-fallback'
        });
      });
    });
    return { definition, columns, positions, byColumn, graphWidth: canvasWidth, graphHeight: canvasHeight, nodeWidth: cardWidth, nodeHeight: cardHeight };
  };

  const getCurriculumMatch = (course) => {
    const search = curriculumState.search.trim().toLowerCase();
    const matchesSearch = !search || [course.subject, course.teacher, course.tag]
      .some((value) => String(value || '').toLowerCase().includes(search));
    const matchesYear = curriculumState.year === 'すべて表示' || course.year === curriculumState.year;
    const matchesField = curriculumState.field === 'すべて表示' || getCurriculumField(course) === curriculumState.field;
    return matchesSearch && matchesYear && matchesField;
  };

  const getCurriculumFocusIds = () => {
    const focusIds = new Set();
    if (!curriculumState.selectedId) return focusIds;
    focusIds.add(curriculumState.selectedId);
    const relations = state.relationsMap.get(curriculumState.selectedId);
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
  const applyCurriculumTransform = () => {
    const graph = document.getElementById('curriculum-graph');
    if (!graph) return;
    graph.style.transformOrigin = '0 0';
    graph.style.transform = `translate(${curriculumState.panX || 0}px, ${curriculumState.panY || 0}px) scale(${curriculumState.zoom})`;
    const zoomLevel = document.getElementById('curriculum-zoom-level');
    if (zoomLevel) zoomLevel.textContent = `${Math.round(curriculumState.zoom * 100)}%`;
  };

  const clearCurriculumFocus = () => {
    if (!curriculumState.selectedId) return;
    curriculumState.selectedId = '';
    const detail = document.getElementById('curriculum-course-detail');
    if (detail) {
      detail.hidden = true;
      detail.replaceChildren();
    }
    renderCurriculumGraph();
  };

  const openCurriculumCourseDetail = (courseId) => {
    const course = state.coursesMap.get(courseId);
    const detail = document.getElementById('curriculum-course-detail');
    if (!course || !detail) return;

    curriculumState.selectedId = courseId;
    const isRegistered = state.registeredClasses.has(courseId);
    const isCompleted = state.completedClasses.has(courseId);
    const actionLabel = isRegistered ? '通常履修から削除' : isCompleted ? '履修予定に戻す' : '通常履修に追加';
    detail.innerHTML = `
      <div class="curriculum-course-detail-heading">
        <h3>科目詳細</h3>
        <button type="button" class="curriculum-detail-close" aria-label="科目詳細を閉じる">×</button>
      </div>
      <div class="class-detail open">${renderCourseDetailMarkup(course)}</div>
      <div class="curriculum-detail-actions">
        <button type="button" class="curriculum-enrollment-action">${actionLabel}</button>
      </div>
    `;
    detail.hidden = false;
    detail.querySelector('.curriculum-detail-close')?.addEventListener('click', () => {
      clearCurriculumFocus();
    });
    detail.querySelector('.curriculum-enrollment-action')?.addEventListener('click', () => {
      const saved = commitStateChange(courseId, isRegistered ? 'DELETE' : 'REGISTER');
      openCurriculumCourseDetail(courseId);
      setCurriculumStatus(saved
        ? `${course.subject}の通常履修状態を更新しました。`
        : `${course.subject}の変更を保存できませんでした。`, !saved);
    });
    detail.querySelectorAll('.related-course-link').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        const relatedId = link.dataset.courseId;
        if (relatedId && state.coursesMap.has(relatedId)) openCurriculumCourseDetail(relatedId);
      });
    });
    renderCurriculumGraph();
    detail.querySelector('.detail-subject')?.focus({ preventScroll: true });
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
    if (!graph || !lanesHost || !edgesHost || !count || !state.predefinedData.length) return;

    try {
      const layout = curriculumState.layout || buildCurriculumLayout();
      curriculumState.layout = layout;
      graph.style.width = `${layout.graphWidth}px`;
      graph.style.height = `${layout.graphHeight}px`;
      graph.style.transformOrigin = '0 0';
      graph.style.transform = `translate(${curriculumState.panX || 0}px, ${curriculumState.panY || 0}px) scale(${curriculumState.zoom})`;
      lanesHost.innerHTML = '';
      if (stageAxis) stageAxis.innerHTML = '';
      edgesHost.innerHTML = '<defs><marker id="curriculum-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 0 z"></path></marker></defs>';
      edgesHost.setAttribute('width', String(layout.graphWidth));
      edgesHost.setAttribute('height', String(layout.graphHeight));
      edgesHost.setAttribute('viewBox', `0 0 ${layout.graphWidth} ${layout.graphHeight}`);
      (layout.definition.bands || []).forEach((band) => {
        if (!stageAxis) return;
        const bandEl = document.createElement('div');
        bandEl.className = `curriculum-official-band ${band.id}`;
        Object.assign(bandEl.style, { left: `${band.x}px`, top: `${band.y}px`, width: `${band.width}px`, height: `${band.height}px`, background: band.color || '' });
        bandEl.innerHTML = `<span>${escapeHTML(band.label || '')}</span>`;
        stageAxis.appendChild(bandEl);
      });

      const focusIds = getCurriculumFocusIds();
      const hasFocus = focusIds.size > 0;
      const matchesById = new Map();
      let matchCount = 0;
      const hasActiveFilter = Boolean(curriculumState.search.trim() || curriculumState.year !== 'すべて表示' || curriculumState.field !== 'すべて表示');
      layout.columns.forEach((column) => {
        const lane = document.createElement('section');
        lane.className = 'curriculum-lane';
        lane.dataset.officialGroup = column.group || '';
        lane.style.left = `${column.x}px`;
        lane.style.width = `${column.width}px`;
        lane.style.height = `${layout.graphHeight}px`;
        lane.innerHTML = `<h3><span>${escapeHTML(column.label)}</span><small>公式区分（構造）</small></h3>`;
        const courses = layout.byColumn.get(column.id) || [];
        courses.forEach((course) => {
          const position = layout.positions.get(course.id);
          if (!position) return;
          const matches = getCurriculumMatch(course);
          matchesById.set(course.id, matches);
          if (matches) matchCount += 1;
          const isRegistered = state.registeredClasses.has(course.id);
          const isCompleted = state.completedClasses.has(course.id);
          const relatedToFocus = !hasFocus || focusIds.has(course.id);
          const node = document.createElement('article');
          node.className = `curriculum-node official-${position.officialGroup || 'unknown'}`;
          if (matches) node.classList.add('is-match'); else node.classList.add('is-dimmed');
          if (!relatedToFocus) node.classList.add('is-out-of-focus');
          if (course.id === curriculumState.selectedId) node.classList.add('is-selected');
          if (isRegistered) node.classList.add('is-registered');
          if (isCompleted) node.classList.add('is-completed');
          node.classList.add(`curriculum-credit-${String(course.credits || '').replace(/[^0-9]/g, '') || 'unknown'}`);
          if (position.officialConfidence !== 'confirmed') node.classList.add('is-provisional');
          node.dataset.courseId = course.id;
          node.dataset.officialConfidence = position.officialConfidence;
          node.dataset.verificationMethod = position.verificationMethod;
          node.title = position.officialConfidence === 'confirmed'
            ? '公式PDFで配置を確認済み'
            : '公式PDF上の位置未確認（暫定配置）';
          node.draggable = true;
          node.tabIndex = 0;
          node.setAttribute('role', 'button');
          node.setAttribute('aria-label', `${course.subject}の科目詳細`);
          const statusLabel = isCompleted ? '履修済み' : isRegistered ? 'マイ履修' : '';
          node.style.top = `${position.top}px`;
          node.style.left = `${position.left - column.x}px`;
          node.style.width = `${position.width || layout.nodeWidth}px`;
          node.style.height = `${position.height || layout.nodeHeight}px`;
          node.innerHTML = `<div class="curriculum-node-title">${escapeHTML(course.subject)}</div><div class="curriculum-node-meta"><span class="curriculum-node-track">${escapeHTML(getCurriculumTrack(course))}</span><span>${escapeHTML(course.credits)}単位</span><span>${escapeHTML(course.quarter || '開講Q未登録')}</span>${statusLabel ? `<span class="curriculum-node-status">${statusLabel}</span>` : ''}</div>`;
          const openDetail = () => {
            if (curriculumState.didDrag) return;
            if (curriculumState.selectedId === course.id) return clearCurriculumFocus();
            openCurriculumCourseDetail(course.id);
          };
          node.addEventListener('click', (event) => { if (!event.target.closest('button')) openDetail(); });
          // curriculum-detail-btn / curriculum-add-btn は詳細パネルへ集約し、
          // 既存の commitStateChange(course.id, 'REGISTER') 経路を使う。
          node.addEventListener('keydown', (event) => { if (event.target === node && ['Enter', ' '].includes(event.key)) { event.preventDefault(); openDetail(); } });
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
      state.relationsMap.forEach((relations, sourceId) => {
        const from = layout.positions.get(sourceId);
        if (!from) return;
        relations.successors.forEach((relation) => {
          const to = layout.positions.get(relation.id);
          if (!to) return;
          const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          edge.setAttribute('d', createCurriculumEdgePath(from, to));
          edge.setAttribute('class', `curriculum-edge is-reference ${relation.strength === 'strongly_recommended' ? 'is-strong' : 'is-recommended'}`);
          if (hasActiveFilter && !matchesById.get(sourceId) && !matchesById.get(relation.id)) edge.classList.add('is-filter-dimmed');
          if (hasFocus && (sourceId === curriculumState.selectedId || relation.id === curriculumState.selectedId)) edge.classList.add('is-focused');
          if (hasFocus && !(focusIds.has(sourceId) && focusIds.has(relation.id))) edge.classList.add('is-out-of-focus');
          edgesHost.appendChild(edge);
        });
      });
      count.textContent = `${matchCount} / ${state.predefinedData.length}科目`;
      const noMatches = hasActiveFilter && matchCount === 0;
      setCurriculumStatus(hasActiveFilter ? (noMatches ? '該当する科目はありません。条件を解除してください。' : `${matchCount}科目が条件に一致しています。`) : '', noMatches);
    } catch (error) {
      console.error('カリキュラムツリーの描画に失敗しました:', error);
      setCurriculumStatus('ツリーを表示できませんでした。ページを再読み込みしてください。', true);
    }
  };

  const populateCurriculumFieldFilter = () => {
    const fieldFilter = document.getElementById('curriculum-tree-field');
    if (!fieldFilter) return;
    const fields = [...new Set(state.predefinedData.map(getCurriculumField))].sort((a, b) => a.localeCompare(b, 'ja'));
    fieldFilter.innerHTML = '<option value="すべて表示">すべて表示</option>' + fields
      .map((field) => `<option value="${escapeHTML(field)}">${escapeHTML(field)}</option>`).join('');
  };

  const setupCurriculumTree = () => {
    const nav = document.getElementById('curriculum-tree-nav');
    const close = document.getElementById('curriculum-tree-close');
    const view = document.getElementById('curriculum-tree-view');
    const dropZone = document.getElementById('curriculum-drop-zone');
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    const enrollmentContent = document.getElementById('my-enrollment-content');
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
    const zoomLevel = document.getElementById('curriculum-zoom-level');
    if (!nav || !view || !dropZone || !search || !year || !field) return;
    let renderFrame = null;
    let transformFrame = null;
    const scheduleCurriculumRender = () => {
      if (renderFrame != null) return;
      renderFrame = window.requestAnimationFrame(() => {
        renderFrame = null;
        renderCurriculumGraph();
      });
    };
    const scheduleCurriculumTransform = () => {
      if (transformFrame != null) return;
      transformFrame = window.requestAnimationFrame(() => {
        transformFrame = null;
        applyCurriculumTransform();
      });
    };

    // The tree stays unpublished on production. A local-only query flag is used for
    // review so the public Netlify host cannot expose the unfinished navigation entry.
    const previewEnabled = ['localhost', '127.0.0.1'].includes(window.location.hostname)
      && new URLSearchParams(window.location.search).get('curriculumPreview') === '1';
    nav.hidden = !previewEnabled;
    if (previewEnabled) {
      loadCurriculumLayoutDefinition().then((definition) => {
        if (!definition) return;
        state.curriculumLayoutDefinition = definition;
        curriculumState.layout = null;
        if (document.body.classList.contains('curriculum-tree-mode')) {
          renderCurriculumGraph();
          window.requestAnimationFrame(() => fitCurriculumToViewport());
        }
      });
    }

    const updateZoom = (nextZoom, anchor = null) => {
      curriculumState.autoFit = false;
      const viewportRect = graphScroll?.getBoundingClientRect();
      const previousZoom = curriculumState.zoom;
      const next = Math.min(2.4, Math.max(0.25, Number(nextZoom.toFixed(2))));
      if (anchor && viewportRect) {
        const localX = anchor.clientX - viewportRect.left;
        const localY = anchor.clientY - viewportRect.top;
        const worldX = (localX - (curriculumState.panX || 0)) / previousZoom;
        const worldY = (localY - (curriculumState.panY || 0)) / previousZoom;
        curriculumState.panX = localX - worldX * next;
        curriculumState.panY = localY - worldY * next;
      }
      curriculumState.zoom = next;
      if (zoomLevel) zoomLevel.value = `${Math.round(curriculumState.zoom * 100)}%`;
      if (document.body.classList.contains('curriculum-tree-mode')) scheduleCurriculumTransform();
    };

    const fitCurriculumToViewport = () => {
      const layout = curriculumState.layout || buildCurriculumLayout();
      curriculumState.layout = layout;
      const rect = graphScroll?.getBoundingClientRect();
      if (!rect) return;
      const scale = Math.min((rect.width - 28) / layout.graphWidth, (rect.height - 28) / layout.graphHeight, 1);
      curriculumState.zoom = Math.min(2.4, Math.max(0.25, Number(scale.toFixed(2))));
      curriculumState.panX = Math.max(14, (rect.width - layout.graphWidth * curriculumState.zoom) / 2);
      curriculumState.panY = Math.max(14, (rect.height - layout.graphHeight * curriculumState.zoom) / 2);
      curriculumState.autoFit = true;
      scheduleCurriculumTransform();
    };

    const setMode = (enabled) => {
      document.body.classList.toggle('curriculum-tree-mode', enabled);
      view.hidden = !enabled;
      if (enrollmentTitle) enrollmentTitle.textContent = enabled ? '通常履修' : 'マイ履修';
      setCurriculumEnrollmentOpen(enabled ? false : true);
      nav.setAttribute('aria-pressed', String(enabled));
      syncPrimaryViewNavigation(enabled ? 'tree' : 'list');
      if (enabled) {
        curriculumState.enrollmentManualOpen = false;
        curriculumState.enrollmentAutoOpened = false;
        curriculumState.autoFit = true;
        curriculumState.panX = 0;
        curriculumState.panY = 0;
        renderCurriculumGraph();
        window.requestAnimationFrame(() => {
          fitCurriculumToViewport();
          search.focus({ preventScroll: true });
        });
      } else {
        const detail = document.getElementById('curriculum-course-detail');
        if (detail) detail.hidden = true;
        curriculumState.selectedId = '';
      }
    };

    nav.addEventListener('click', () => setMode(!document.body.classList.contains('curriculum-tree-mode')));
    document.getElementById('course-list-nav')?.addEventListener('click', () => setMode(false));
    close?.addEventListener('click', () => setMode(false));
    mobileEnrollmentToggle?.addEventListener('click', () => {
      setCurriculumEnrollmentOpen(!curriculumState.enrollmentOpen, { manual: true });
    });
    enrollmentDrawerToggle?.addEventListener('click', () => {
      setCurriculumEnrollmentOpen(!curriculumState.enrollmentOpen, { manual: true });
    });
    search.addEventListener('input', () => {
      curriculumState.search = search.value;
      scheduleCurriculumRender();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const course = state.predefinedData.find((item) => getCurriculumMatch(item));
      if (!course) return;
      event.preventDefault();
      openCurriculumCourseDetail(course.id);
      const position = curriculumState.layout?.positions.get(course.id);
      const rect = graphScroll?.getBoundingClientRect();
      if (position && rect) {
        curriculumState.zoom = Math.max(curriculumState.zoom, 1);
        curriculumState.panX = rect.width / 2 - position.x * curriculumState.zoom;
        curriculumState.panY = rect.height / 2 - position.y * curriculumState.zoom;
        renderCurriculumGraph();
      }
    });
    year.addEventListener('change', () => {
      curriculumState.year = year.value;
      scheduleCurriculumRender();
    });
    field.addEventListener('change', () => {
      curriculumState.field = field.value;
      scheduleCurriculumRender();
    });
    zoomOut?.addEventListener('click', () => updateZoom(curriculumState.zoom - 0.1));
    zoomIn?.addEventListener('click', () => updateZoom(curriculumState.zoom + 0.1));
    zoomReset?.addEventListener('click', () => { curriculumState.panX = 14; curriculumState.panY = 14; updateZoom(1); });
    zoomFit?.addEventListener('click', fitCurriculumToViewport);
    fullscreen?.addEventListener('click', () => {
      curriculumState.fullscreen = !curriculumState.fullscreen;
      document.body.classList.toggle('curriculum-tree-explorer-mode', curriculumState.fullscreen);
      fullscreen.setAttribute('aria-pressed', String(curriculumState.fullscreen));
      fullscreen.textContent = curriculumState.fullscreen ? '通常表示' : '探索モード';
      window.requestAnimationFrame(() => fitCurriculumToViewport());
    });
    graphScroll?.addEventListener('wheel', (event) => {
      event.preventDefault();
      updateZoom(curriculumState.zoom * (event.deltaY < 0 ? 1.08 : 0.92), event);
    }, { passive: false });
    let panState = null;
    let pinchState = null;
    const pointers = new Map();
    graphScroll?.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.curriculum-node, button, input, select')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 1) panState = { x: event.clientX, y: event.clientY, panX: curriculumState.panX || 0, panY: curriculumState.panY || 0 };
      if (pointers.size === 2) {
        const points = [...pointers.values()];
        const distance = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y);
        pinchState = { distance, zoom: curriculumState.zoom };
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
      curriculumState.panX = panState.panX + event.clientX - panState.x;
      curriculumState.panY = panState.panY + event.clientY - panState.y;
      curriculumState.autoFit = false;
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
      if (!event.target.closest('.curriculum-node')) clearCurriculumFocus();
    });
    window.addEventListener('resize', () => {
      if (!document.body.classList.contains('curriculum-tree-mode') || !curriculumState.autoFit) return;
      window.requestAnimationFrame(() => fitCurriculumToViewport());
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('curriculum-tree-mode') && curriculumState.selectedId) {
        clearCurriculumFocus();
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
      const courseId = event.dataTransfer?.getData('application/x-zen-course-id') || event.dataTransfer?.getData('text/plain');
      const course = state.coursesMap.get(courseId);
      if (!course) {
        setCurriculumStatus('科目を追加できませんでした。', true);
        return;
      }
      if (state.registeredClasses.has(courseId)) {
        setCurriculumStatus(`${course.subject}はすでに履修予定です。`);
        return;
      }
      const saved = commitStateChange(courseId, 'REGISTER');
      setCurriculumStatus(saved
        ? `${course.subject}を履修予定に追加しました。`
        : `${course.subject}を追加できませんでした。`, !saved);
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') dropZone.classList.remove('is-over');
    });
  };

  /**
   * 全体の描画（クリーンアップを伴う）
   */
  const renderAll = () => {
    cleanupState();
    renderList();
    renderPredefinedList();
    if (document.body.classList.contains('curriculum-tree-mode')) renderCurriculumGraph();
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
        '自由科目'
      ];
      categoryFilter.innerHTML = fields.map(f => `<option value="${f}">${f}</option>`).join('');
    }

    // 各フィルタ要素が存在する場合のみイベントリスナーを設定（エラー落ち防止）
    const yearF = document.getElementById('year-filter');
    if (yearF) yearF.addEventListener('change', (e) => {
      state.filterYear = e.target.value;
      renderPredefinedList();
    });

    const quarterF = document.getElementById('quarter-filter');
    if (quarterF) quarterF.addEventListener('change', (e) => {
      state.filterQuarter = e.target.value;
      renderPredefinedList();
    });

    if (categoryFilter) categoryFilter.addEventListener('change', (e) => {
      state.filterCategory = e.target.value;
      renderPredefinedList();
    });

    const reqF = document.getElementById('requirement-filter');
    if (reqF) reqF.addEventListener('change', (e) => {
      state.filterRequirement = e.target.value;
      renderPredefinedList();
    });

    const introF = document.getElementById('intro-filter');
    if (introF) introF.addEventListener('change', (e) => {
      state.filterIntro = e.target.value;
      renderPredefinedList();
    });

    const searchB = document.getElementById('search-bar');
    if (searchB) searchB.addEventListener('input', (e) => {
      state.filterSearch = e.target.value;
      renderPredefinedList();
    });

    const excludePixiv = document.getElementById('exclude-pixiv-filter');
    if (excludePixiv) {
      excludePixiv.checked = state.excludePixiv;
      excludePixiv.addEventListener('change', (event) => {
        state.excludePixiv = event.target.checked;
        saveFilterPreferences({ excludePixiv: state.excludePixiv });
        renderPredefinedList();
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
    if (clearFiltersButton) clearFiltersButton.addEventListener('click', clearCourseFilters);
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
    if (!simulatorAvailable) {
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
      syncPrimaryViewNavigation('list');
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
      syncPrimaryViewNavigation('simulator');
      renderSimulator();
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
      if (commitSimulatorPlan(simulatorRules.createEmptyPlan())) {
        showSimulatorFeedback('計画をリセットしました。');
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
      placeSimulatorCourse(courseId, Number(optionButton.dataset.simPlaceYear), Number(optionButton.dataset.simPlaceQuarter));
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
      if (trigger) renderSimulatorGraduationCourseDetail(trigger.dataset.simGraduationDetail);
    });
    graduationDetails?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const trigger = event.target.closest('[data-sim-graduation-detail]');
      if (!trigger) return;
      event.preventDefault();
      renderSimulatorGraduationCourseDetail(trigger.dataset.simGraduationDetail);
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
      highlightSimulatorDropCells(item.dataset.simDragCourse);
    });
    paletteResults?.addEventListener('dragend', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      delete item.dataset.simDragging;
      item.dataset.simSkipClick = 'true';
      window.setTimeout(() => delete item.dataset.simSkipClick, 0);
      clearSimulatorDropHighlights();
    });
    yearGrid?.addEventListener('dragenter', (event) => {
      const target = resolveSimulatorDropCell(event.target);
      const courseId = event.dataTransfer?.getData('text/plain');
      if (target && courseId && target.classList.contains('is-drop-allowed')) target.classList.add('is-drop-active');
    });
    yearGrid?.addEventListener('dragover', (event) => {
      const target = resolveSimulatorDropCell(event.target);
      if (!target) return;
      // Accept the drop event on invalid cells only to give feedback; shared validation still rejects it.
      event.preventDefault();
      if (target.classList.contains('is-drop-allowed')) target.classList.add('is-drop-active');
    });
    yearGrid?.addEventListener('dragleave', (event) => {
      const target = resolveSimulatorDropCell(event.target);
      const relatedTarget = resolveSimulatorDropCell(event.relatedTarget);
      if (target && relatedTarget !== target) target.classList.remove('is-drop-active');
    });
    yearGrid?.addEventListener('drop', (event) => {
      const target = resolveSimulatorDropCell(event.target);
      if (!target) return;
      event.preventDefault();
      clearSimulatorDropHighlights();
      const courseId = event.dataTransfer?.getData('text/plain');
      if (courseId) placeSimulatorCourse(courseId, Number(target.dataset.simDropYear), Number(target.dataset.simDropQuarter));
    });
    yearGrid?.addEventListener('dragstart', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      item.dataset.simDragging = 'true';
      event.dataTransfer?.setData('text/plain', item.dataset.simDragCourse);
      highlightSimulatorDropCells(item.dataset.simDragCourse);
    });
    yearGrid?.addEventListener('dragend', (event) => {
      const item = event.target.closest('[data-sim-drag-course]');
      if (!item) return;
      delete item.dataset.simDragging;
      item.dataset.simSkipClick = 'true';
      window.setTimeout(() => delete item.dataset.simSkipClick, 0);
      clearSimulatorDropHighlights();
    });
    yearGrid?.addEventListener('click', (event) => {
      const removeButton = event.target.closest('[data-sim-remove-course]');
      if (removeButton) {
        removeSimulatorCourse(removeButton.dataset.simRemoveCourse);
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
      if (removeButton) removeSimulatorCourse(removeButton.dataset.simRemoveCourse);
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
    if (searchInput) searchInput.addEventListener('input', renderSimulatorCourseResults);
    ['sim-course-year-filter', 'sim-course-quarter-filter', 'sim-course-category-filter', 'sim-course-placement-filter']
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((select) => select.addEventListener('change', () => {
        if (select.id === 'sim-course-placement-filter') state.simulatorPlacementFilter = select.value;
        renderSimulatorCourseResults();
      }));
    document.querySelectorAll('[data-sim-palette-mode]').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.simulatorPaletteMode = tab.dataset.simPaletteMode === 'scheduled' ? 'scheduled' : 'all';
        document.querySelectorAll('[data-sim-palette-mode]').forEach((item) => {
          const active = item === tab;
          item.classList.toggle('is-active', active);
          item.setAttribute('aria-selected', String(active));
        });
        renderSimulatorCourseResults();
      });
    });
  };

  const setupAnalysisModal = () => {
    const modal = document.getElementById('analysis-modal');
    const btn = document.getElementById('analysis-btn');
    const closeButton = document.getElementById('close-modal');

    if (modal && closeButton) {
      // ×ボタンをモーダルの右上に常に固定し、コンテンツが伸びても隠れないように設定
      closeButton.style.position = 'sticky';
      closeButton.style.top = '0';
      closeButton.style.float = 'right';
      closeButton.style.zIndex = '1000';
      closeButton.style.backgroundColor = 'inherit'; // モーダルの背景色を継承して背後の文字を隠す

      const modalContent = typeof modal.querySelector === 'function'
        ? modal.querySelector('.modal-content')
        : null;
      if (modalContent) {
        modalContent.style.maxHeight = '90vh'; // 画面外に突き抜けないように制限
        modalContent.style.overflowY = 'auto'; // モーダル内部をスクロール可能にする
      }
    }

    if (btn && modal) {
      const closeModal = () => {
        modal.style.display = 'none';
        btn.focus();
      };
      btn.onclick = () => {
        modal.style.display = 'block';
        closeButton?.focus();
      };
      if (closeButton) closeButton.onclick = closeModal;

      modal.onclick = (event) => {
        if (event.target === modal) closeModal();
      };

      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.style.display === 'block') closeModal();
      });
    }
  };

  /**
   * 使い方（チュートリアル）モーダルの制御
   */
  const setupTutorialModal = async () => {
    const modal = document.getElementById('tutorial-modal');
    const btn = document.getElementById('tutorial-btn');
    const closeButton = document.getElementById('close-tutorial');
    const body = document.getElementById('tutorial-body');

    if (btn && modal && body) {
      // JSONからデータを読み込んでHTMLを生成
      try {
        const res = await fetch('tutorial.json');
        if (res.ok) {
          const data = await res.json();
          body.innerHTML = `
            <h1>${data.title}</h1>
            <p>${data.intro}</p>
            ${data.sections.map(s => `
              <div class="tutorial-section">
                <h3>${s.heading}</h3>
                ${s.list ? `<ul>${s.list.map(item => `<li>${item}</li>`).join('')}</ul>` : ''}
                ${s.text ? `<p>${s.text}</p>` : ''}
              </div>
            `).join('')}
            <hr>
            <div class="disclaimer-box">
              <p><strong>${data.disclaimer.heading}</strong></p>
              <p style="font-size: 0.85em; color: #666;">${data.disclaimer.text}</p>
            </div>
          `;
        } else {
          body.innerHTML = '<p>使い方の読み込みに失敗しました。</p>';
        }
      } catch (e) {
        console.error('Tutorial load error:', e);
        body.innerHTML = '<p>使い方の読み込みに失敗しました。</p>';
      }

      const closeTutorial = () => {
        modal.style.display = 'none';
        btn.focus();
      };

      btn.onclick = () => {
        modal.style.display = 'block';
        closeButton?.focus();
      };

      // ×ボタンのイベント
      if (closeButton) closeButton.onclick = closeTutorial;

      // モーダル外クリックで閉じる
      modal.onclick = (event) => {
        if (event.target === modal) closeTutorial();
      };

      // Escキーで閉じる（アクセシビリティ対応）
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
          closeTutorial();
        }
      });
    }
  };

  /**
   * スマートフォンでは常に表示する固定ボタンから先頭へ戻れるようにする。
   * 表示・非表示はCSSのブレークポイントで制御し、クリック時の移動だけを担当する。
   */
  const setupBackToTopButton = () => {
    const button = document.getElementById('back-to-top-btn');
    if (!button) return;

    button.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  // --- アプリケーションの実行開始 ---
  // すべての関数(const)の定義が完了した後に、呼び出しを行います。

  syncCourseSortOptions();
  setupFilters();
  setupSimulatorModal();
  setupAnalysisModal();
  setupTutorialModal();
  setupBackToTopButton();
  setupCurriculumTree();
  renderGraduationGauge({ valid: false }, '—');

  // 科目本体を先に描画し、難易度・関係・卒業要件は到着した順に後付けする。
  // 任意データの遅延や失敗で、最初の検索・フィルター操作をブロックしない。
  const sortCourseData = (data) => {
    data.sort((a, b) => {
      const getPriority = (cat) => {
        if (cat === '必修') return 1;
        if (cat === '選択必修') return 2;
        if (cat === '選択') return 3;
        return 4;
      };

      const priorityA = getPriority(a.category);
      const priorityB = getPriority(b.category);
      if (priorityA !== priorityB) return priorityA - priorityB;

      const aYear = parseInt(a.year) || 0;
      const bYear = parseInt(b.year) || 0;
      if (aYear !== bYear) return aYear - bYear;

      if (a.tag !== b.tag) return (a.tag || '').localeCompare(b.tag || '', 'ja');
      return a.subject.localeCompare(b.subject, 'ja');
    });
    return data;
  };

  const refreshOptionalData = ({ difficulty = false, relations = false, graduation = false } = {}) => {
    if (!state.coursesReady) return;
    if (relations) state.relationsMap = buildRelationsMap(state.rawRelations, state.coursesMap);
    updateStorageWarning();
    if (difficulty || relations) renderPredefinedList();
    if (relations && document.body.classList.contains('curriculum-tree-mode')) renderCurriculumGraph();
    if (graduation) renderList();
    if (simulatorAvailable && (difficulty || relations || graduation)) renderSimulator();
  };

  const applyCourseData = (data) => {
    const normalizedSource = Array.isArray(data) ? sortCourseData(data) : [];
    const normalizedData = normalizedSource.map(normalizeClass).filter(Boolean);
    state.predefinedData = normalizedData;
    state.coursesMap = new Map(normalizedData.map(item => [item.id, item]));
    state.coursesReady = true;
    state.relationsMap = buildRelationsMap(state.rawRelations, state.coursesMap);
    populateCurriculumFieldFilter();
    curriculumState.layout = null;
    cleanupState();
    if (dataStatus) {
      dataStatus.hidden = true;
      dataStatus.classList.remove('is-error');
    }
    renderAll();
    if (simulatorAvailable) renderSimulator();
  };

  const applyGraduationDefinition = (definition, courses) => {
    state.graduationDefinition = definition;
    if (definition && !state.courseValidationError) {
      const mappingValidation = window.GraduationRequirementsEngine?.validateRequirementsAgainstCourses(definition, courses);
      if (!mappingValidation?.valid) {
        console.error('卒業要件定義と科目データの対応を検証できません:', mappingValidation?.message);
        state.graduationDefinition = null;
      }
    }
  };

  let loadErrorTimer = null; // 通信エラーアラートの遅延表示用タイマー
  try {
    // 任意データの通信は先に開始するが、最初の描画は courses.json の到着を待たない。
    // Promiseの完了処理は coursesReady 後にのみ画面へ反映する。
    const difficultyPromise = loadDifficultyData();
    const relationsPromise = loadCourseRelationsData();
    const graduationPromise = loadGraduationDefinitionData();
    const coursesRes = await fetch('courses.json');
    if (!coursesRes.ok) throw new Error(`授業データが見つかりません (${coursesRes.status})`);
    const data = await coursesRes.json();
    if (!Array.isArray(data) || data.length === 0) throw new TypeError('授業データの形式が不正です');
    const courseValidation = window.GraduationRequirementsEngine?.validateCourses(data);
    state.courseValidationError = courseValidation?.valid ? null : (courseValidation?.message || '科目データの検証に失敗しました。');
    if (courseValidation && !courseValidation.valid) throw new TypeError(state.courseValidationError);
    applyCourseData(data);

    // 任意データは独立して読み込み、各レスポンス後に表示を更新する。
    difficultyPromise.then((difficultyMap) => {
      state.difficultyMap = difficultyMap;
      refreshOptionalData({ difficulty: true });
    });
    relationsPromise.then((relationsData) => {
      state.rawRelations = relationsData;
      refreshOptionalData({ relations: true });
    });
    graduationPromise.then((graduationDefinition) => {
      applyGraduationDefinition(graduationDefinition, data);
      refreshOptionalData({ graduation: true });
    });
  } catch (error) {
    console.error('データの読み込みに失敗しました:', error);
    renderGraduationGauge({ valid: false });
    if (dataStatus) {
      dataStatus.hidden = false;
      dataStatus.classList.add('is-error');
      dataStatus.textContent = '授業データの読み込みに失敗しました。ページを再読み込みしてください。';
    }
    // GitHub Pagesの初回読み込み遅延等による誤検知を防ぐため、3秒待機してからアラートを表示する。
    loadErrorTimer = setTimeout(() => {
      alert('授業データの読み込みに失敗しました。ページを再読み込みしてください。');
    }, 3000);
  }
});
