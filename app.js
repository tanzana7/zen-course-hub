/**
 * アプリケーションのメインロジック
 */
// 公開切替はリリース成果物の設定として明示的に行う。localStorageやURLから
// 変更できないため、通常のfeature成果物を誤って公開しても正式導線は開かない。
const CURRICULUM_TREE_PUBLIC_ENABLED = window.CurriculumAccess?.publicEnabled === true;

async function initializeHub() {
  const examReady = window.ZenExam?.ready;
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');
  const relatedCourseDetailHost = document.getElementById('related-course-detail-host');
  const dataStatus = document.getElementById('data-status');
  const storageWarning = document.getElementById('storage-warning');

  const {
    normalizeClass,
    loadDifficultyData,
    loadGraduationDefinitionData,
    loadCourseRelationsData,
    loadCurriculumLayoutDefinition,
    buildRelationsMap,
    sortCourseData,
  } = window.ZenHubRepository.create({
    fetch,
    engine: window.GraduationRequirementsEngine,
    get sanitizeExternalUrl() {
      return sanitizeExternalUrl;
    },
  });

  const STORAGE_KEYS = {
    REGISTERED: 'myClasses',
    COMPLETED: 'completedClasses',
    FILTER_PREFERENCES: 'courseFilterPreferences',
    SCHEMA_VERSION: 'zenCourseHubStorageSchemaVersion',
  };
  const enrollmentStorageBackend = (() => {
    try {
      if (typeof localStorage === 'undefined') throw new Error('localStorage unavailable');
      return localStorage;
    } catch (error) {
      return {
        getItem: () => {
          throw error;
        },
        setItem: () => {
          throw error;
        },
        removeItem: () => {
          throw error;
        },
      };
    }
  })();
  const qualityUtils = window.ZenQualityUtils || {
    escapeHTML: (value) =>
      String(value ?? '').replace(
        /[&<>"']/g,
        (character) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[character],
      ),
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
      writable: false,
    }),
    saveEnrollmentState: () => ({
      saved: false,
      rollbackSucceeded: true,
      error: new Error('保存ユーティリティを読み込めませんでした'),
    }),
  };
  const SIMULATOR_STORAGE_KEY = 'fourYearSimulatorPlanV1';
  const courseSorting = window.CourseSorting;
  if (!courseSorting) {
    console.error('科目並び替えモジュールを読み込めませんでした。');
    return;
  }
  const { COURSE_SORT_OPTIONS, sortCourses } = courseSorting;
  const simulatorRules = window.SimulatorRules;
  const simulatorAvailable = Boolean(
    simulatorRules &&
    [
      'getQuarterInfo',
      'canPlaceCourseAt',
      'getPlacementOptions',
      'getPlacementStart',
      'isPrerequisiteSatisfied',
      'getPlacementIssues',
      'applyPlacement',
      'createEmptyPlan',
      'savePlanChange',
    ].every((name) => typeof simulatorRules[name] === 'function'),
  );

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
              selectedQuarter: Number(item?.selectedQuarter ?? item?.startQuarter ?? item?.quarter),
            }))
            .filter(
              (item) => item.courseId && Number.isInteger(item.year) && item.year >= 1 && item.year <= 4,
            )
        : [];
      return { version: 1, placements };
    } catch (error) {
      console.warn('シミュレーター計画を読み込めませんでした:', error);
      return { version: 1, placements: [] };
    }
  };

  const enrollmentStorage = qualityUtils.readEnrollmentState(enrollmentStorageBackend, {
    registered: STORAGE_KEYS.REGISTERED,
    completed: STORAGE_KEYS.COMPLETED,
    schemaVersion: STORAGE_KEYS.SCHEMA_VERSION,
  });

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
    storageIssues: [
      enrollmentStorage.registered,
      enrollmentStorage.completed,
      enrollmentStorage.schema,
    ].filter((item) => ['corrupt', 'invalid', 'future', 'unavailable'].includes(item.status)),
  };
  const escapeHTML = qualityUtils.escapeHTML;
  const sanitizeExternalUrl = qualityUtils.sanitizeExternalUrl;

  const {
    syncPrimaryViewNavigation,
    syncCourseSortOptions,
    loadFilterPreferences,
    saveFilterPreferences,
    setupFilters,
  } = window.ZenHubNavigation.create({
    STORAGE_KEYS,
    COURSE_SORT_OPTIONS,
    state,
    get renderSimulatorCourseResults() {
      return renderSimulatorCourseResults;
    },
    get clearCourseFilters() {
      return clearCourseFilters;
    },
    get renderPredefinedList() {
      return renderPredefinedList;
    },
  });

  const { curriculumState, renderCurriculumGraph, populateCurriculumFieldFilter, setupCurriculumTree } =
    window.ZenHubCurriculum.create({
      qualityUtils,
      state,
      escapeHTML,
      syncPrimaryViewNavigation,
      get loadCurriculumLayoutDefinition() {
        return loadCurriculumLayoutDefinition;
      },
      get commitStateChange() {
        return commitStateChange;
      },
      get renderCourseDetailMarkup() {
        return renderCourseDetailMarkup;
      },
      publicEnabled: CURRICULUM_TREE_PUBLIC_ENABLED,
    });

  const filterPreferences = loadFilterPreferences();
  state.excludePixiv = filterPreferences.excludePixiv;

  const { updateStorageWarning, commitStateChange, cleanupState, renderList } =
    window.ZenHubEnrollment.create({
      enrollmentRules: window.ZenEnrollmentState,
      list,
      completedList,
      storageWarning,
      STORAGE_KEYS,
      enrollmentStorageBackend,
      qualityUtils,
      state,
      escapeHTML,
      get renderSimulatorGraduationProjection() {
        return renderSimulatorGraduationProjection;
      },
      get sumCredits() {
        return sumCredits;
      },
      get analyzeGraduation() {
        return analyzeGraduation;
      },
      get calculateCredits() {
        return calculateCredits;
      },
      get renderGraduationGauge() {
        return renderGraduationGauge;
      },
      get renderGraduationAnalysis() {
        return renderGraduationAnalysis;
      },
      get renderAll() {
        return renderAll;
      },
    });

  const {
    renderSimulatorGraduationProjection,
    renderSimulatorCourseResults,
    renderSimulator,
    setupSimulatorModal,
  } = window.ZenHubSimulator.create({
    SIMULATOR_STORAGE_KEY,
    sortCourses,
    simulatorRules,
    simulatorAvailable,
    state,
    escapeHTML,
    syncPrimaryViewNavigation,
    get getRequirementDetail() {
      return getRequirementDetail;
    },
    get analyzeGraduation() {
      return analyzeGraduation;
    },
    get renderGraduationAnalysis() {
      return renderGraduationAnalysis;
    },
  });

  const {
    getRequirementDetail,
    sumCredits,
    analyzeGraduation,
    calculateCredits,
    renderGraduationGauge,
    renderGraduationAnalysis,
    setupAnalysisModal,
  } = window.ZenHubGraduation.create({
    state,
    escapeHTML,
  });

  const { clearCourseFilters, renderCourseDetailMarkup, renderPredefinedList } = window.ZenHubCatalog.create({
    predefinedList,
    relatedCourseDetailHost,
    sortCourses,
    state,
    escapeHTML,
    sanitizeExternalUrl,
    syncCourseSortOptions,
    saveFilterPreferences,
    commitStateChange,
  });

  const renderAll = () => {
    cleanupState();
    renderList();
    renderPredefinedList();
    if (document.body.classList.contains('curriculum-tree-mode')) renderCurriculumGraph();
  };

  const { setupTutorialModal, setupBackToTopButton } = window.ZenHubHelp.create();

  // Factories above only define behavior. Late-bound callbacks are safe after all controllers exist.
  examReady?.then(() => {
    if (state.coursesReady) {
      renderList();
      renderPredefinedList();
    }
  });
  syncCourseSortOptions();
  setupFilters();
  setupSimulatorModal();
  setupAnalysisModal();
  setupTutorialModal();
  setupBackToTopButton();
  setupCurriculumTree();
  renderGraduationGauge({ valid: false }, '—');

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
    state.coursesMap = new Map(normalizedData.map((item) => [item.id, item]));
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
      const mappingValidation = window.GraduationRequirementsEngine?.validateRequirementsAgainstCourses(
        definition,
        courses,
      );
      if (!mappingValidation?.valid) {
        console.error('卒業要件定義と科目データの対応を検証できません:', mappingValidation?.message);
        state.graduationDefinition = null;
      }
    }
  };

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
    state.courseValidationError = courseValidation?.valid
      ? null
      : courseValidation?.message || '科目データの検証に失敗しました。';
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
    setTimeout(() => {
      alert('授業データの読み込みに失敗しました。ページを再読み込みしてください。');
    }, 3000);
  }
}

// Keep startup failures observable even when a required browser module cannot be initialized.
document.addEventListener('DOMContentLoaded', () => {
  initializeHub().catch((error) => {
    console.error('アプリケーションを起動できません:', error);
    const status = document.getElementById('data-status');
    if (status) {
      status.hidden = false;
      status.classList.add('is-error');
      status.textContent = '読み込めませんでした。ページを再読み込みしてください。';
    }
  });
});
