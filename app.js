/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');
  const relatedCourseDetailHost = document.getElementById('related-course-detail-host');
  const dataStatus = document.getElementById('data-status');

  /**
   * localStorageのキー管理
   */
  const STORAGE_KEYS = {
    REGISTERED: 'myClasses',
    COMPLETED: 'completedClasses',
    FILTER_PREFERENCES: 'courseFilterPreferences'
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

  /**
   * HTML文字列のエスケープ処理（セキュリティ対策）
   */
  const escapeHTML = (str) => {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;',
      '"': '&quot;', "'": '&#39;'
    }[m]));
  };

  /**
   * localStorageから安全にデータを取得・パースする関数
   */
  const safeParse = (key) => {
    try {
      const item = localStorage.getItem(key);
      if (!item || item === 'undefined' || item === 'null' || item === '[]') return [];
      let parsed = JSON.parse(item);
      if (!Array.isArray(parsed)) parsed = [];

      // IDのみを抽出（不正データは排除）
      return parsed
        .map(i => (typeof i === 'object' && i !== null) ? i.id : i)
        .filter(val => typeof val === 'string')
        .map(s => s.trim())
        .filter(s => s && s.length > 0);
    } catch (e) {
      return [];
    }
  };

  /**
   * アプリケーションの状態（State）
   */
  const state = {
    // 科目IDの配列として管理
    registeredClasses: new Set(safeParse(STORAGE_KEYS.REGISTERED)), 
    completedClasses: new Set(safeParse(STORAGE_KEYS.COMPLETED)),
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
    courseValidationError: null
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
      const parsedSourceUrl = sourceUrl ? new URL(sourceUrl, window.location.href) : null;
      const hasSafeSourceUrl = parsedSourceUrl && ['http:', 'https:'].includes(parsedSourceUrl.protocol);

      if (
        !id ||
        !Number.isFinite(average) ||
        average < 0 ||
        average > 10 ||
        !Number.isInteger(votes) ||
        votes < 0 ||
        !hasSafeSourceUrl
      ) {
        console.warn('不正な難易度データを除外しました:', entry);
        return null;
      }

      return { id, average, votes, sourceUrl, sourceLabel };
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

  /**
   * 状態変更のコミット（追加・削除・移動をここで一括管理）
   * @param {string} id - 科目ID
   * @param {'REGISTER'|'COMPLETE'|'DELETE'} action - アクション
   */
  const commitStateChange = (id, action) => {
    switch (action) {
      case 'REGISTER':
        state.completedClasses.delete(id);
        state.registeredClasses.add(id);
        break;
      case 'COMPLETE':
        state.registeredClasses.delete(id);
        state.completedClasses.add(id);
        break;
      case 'DELETE':
        state.registeredClasses.delete(id);
        state.completedClasses.delete(id);
        break;
    }

    saveState();
    renderAll();
  };

  /**
   * データの整合性チェックとクリーンアップ
   */
  const cleanupState = () => {
    const validate = (set) => {
      const validArray = Array.from(set).filter(id => id && state.coursesMap.has(id));
      set.clear();
      validArray.forEach(id => set.add(id));
    };
    validate(state.registeredClasses);
    validate(state.completedClasses);
    // 排他制御の再確認
    state.registeredClasses.forEach(id => state.completedClasses.delete(id));
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
  const saveState = () => {
    const reg = Array.from(state.registeredClasses).filter(id => id && state.coursesMap.has(id));
    const comp = Array.from(state.completedClasses).filter(id => id && state.coursesMap.has(id));
    
    localStorage.setItem(STORAGE_KEYS.REGISTERED, JSON.stringify(reg));
    localStorage.setItem(STORAGE_KEYS.COMPLETED, JSON.stringify(comp));
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
        <strong>不足</strong>
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
        <strong>${cls.subject}</strong>
        <div class="class-meta">
          ${(cls.category === '必修' || cls.category === '選択必修') ? `<span class="badge required">${cls.category}</span>` : ''}
          ${cls.year ? `<span class="badge">${cls.year}</span>` : ''}
          ${cls.quarter ? cls.quarter.replace(/\s*([〜～ー－–—\-])\s*/g, '$1').split(/[・,、，\s]+/).filter(Boolean).map(q => `<span class="badge">${q}</span>`).join('') : ''}
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
    document.getElementById('registered-count').textContent = state.registeredClasses.size;
    document.getElementById('registered-credits').textContent = regCredits;

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

    const teacherParts = data.teacher.split(', ');
    const displayTeacher = teacherParts.length > 1
      ? `${teacherParts[0]} 他${teacherParts.length - 1}名`
      : data.teacher;

    return `
      <h4 class="detail-subject" tabindex="-1">${data.subject}</h4>
      <div class="detail-badges">
        <span class="badge-cat ${data.category === '必修' || data.category === '選択必修' ? 'important' : ''}">${data.category}</span>
        <span class="badge-item">${data.credits}単位</span>
        <span class="badge-item">${data.year}</span>
        <span class="badge-item">${data.quarter}</span>
      </div>
      <div class="detail-sections">
        <p><strong>科目区分:</strong> ${data.method || '-'} ${data.remarks ? `(${data.remarks})` : ''}</p>
        <p><strong>タグ:</strong> ${data.tag ? `#${data.tag}` : '-'}</p>
        <p><strong>教員情報:</strong> ${displayTeacher}</p>
        <p class="evaluation"><strong>評価方法:</strong> ${data.evaluation}</p>
        ${data.url ? `<p><a href="${data.url}" target="_blank" rel="noopener noreferrer" class="syllabus-link" title="ZEN大学シラバスサイトの該当ページを開きます">ZEN大学シラバスで詳細を確認</a></p>` : ''}
        <p class="description"><strong>授業概要:</strong> ${data.description}</p>
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
            <strong>${data.subject}</strong>
            <div class="class-meta">
              ${(data.category === '必修' || data.category === '選択必修') ? `<span class="badge required">${data.category}</span>` : ''}
              ${data.year ? `<span class="badge">${data.year}</span>` : ''}
              ${data.quarter ? data.quarter.replace(/\s*([〜～ー－–—\-])\s*/g, '$1').split(/[・,、，\s]+/).filter(Boolean).map(q => `<span class="badge">${q}</span>`).join('') : ''}
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
   * 全体の描画（クリーンアップを伴う）
   */
  const renderAll = () => {
    cleanupState();
    renderList();
    renderPredefinedList();
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
    button.textContent = simulatorTitle;
    const title = document.getElementById('simulator-modal-title');
    let simulatorResetTriggerElement = null;
    if (title) title.textContent = simulatorTitle;
    if (!simulatorAvailable) {
      // A broken optional rules script must never prevent the ordinary Hub from loading.
      // Disabling the entry point is safer than allowing placements without Q validation.
      console.error('シミュレーターのルールを読み込めませんでした。');
      button.disabled = true;
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
      focusElement(simulatorTriggerElement || button);
      simulatorTriggerElement = null;
    };

    button.onclick = () => {
      simulatorTriggerElement = button;
      modal.hidden = false;
      modal.classList.add('is-active');
      document.body.classList.add('simulator-view-active');
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
  renderGraduationGauge({ valid: false }, '—');

  // 外部JSONから授業データを読み込む
  let loadErrorTimer = null; // 通信エラーアラートの遅延表示用タイマー
  try {
    // 授業データ、任意の難易度データ、前提・後継科目データを並行して読み込む
    const [coursesRes, difficultyMap, relationsData, graduationDefinition] = await Promise.all([
      fetch('courses.json'),
      loadDifficultyData(),
      loadCourseRelationsData(),
      loadGraduationDefinitionData()
    ]);

    if (!coursesRes.ok) throw new Error(`授業データが見つかりません (${coursesRes.status})`);
    const data = await coursesRes.json();

    state.difficultyMap = difficultyMap;
    state.graduationDefinition = graduationDefinition;
    const courseValidation = window.GraduationRequirementsEngine?.validateCourses(data);
    state.courseValidationError = courseValidation?.valid ? null : (courseValidation?.message || '科目データの検証に失敗しました。');
    if (!state.courseValidationError && graduationDefinition) {
      const requirementMappingValidation = window.GraduationRequirementsEngine?.validateRequirementsAgainstCourses(graduationDefinition, data);
      if (!requirementMappingValidation?.valid) {
        console.error('卒業要件定義と科目データの対応を検証できません:', requirementMappingValidation?.message);
        state.graduationDefinition = null;
      }
    }

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

    // データの正規化
    const normalizedData = data.map(normalizeClass).filter(Boolean);
    state.predefinedData = normalizedData;
    state.coursesMap = new Map(normalizedData.map(item => [item.id, item]));
    state.relationsMap = buildRelationsMap(relationsData, state.coursesMap);

    // 3秒以内に読み込みが完了した場合は、もし予約されていたエラーアラートがあればキャンセルする
    if (loadErrorTimer) clearTimeout(loadErrorTimer);
    if (dataStatus) {
      dataStatus.hidden = true;
      dataStatus.classList.remove('is-error');
    }
    renderAll(); // データロード後にクリーンアップを含めて再描画
    if (simulatorAvailable) renderSimulator();
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
