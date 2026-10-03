/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');
  const relatedCourseDetailHost = document.getElementById('related-course-detail-host');
  const dataStatus = document.getElementById('data-status');

  // 卒業要件分析（導入科目）の判定に使用するリストを復活
  const introSubjects = [
    'it_literacy',
    'academic_literacy',
    'digital_tools_usage',
    'economics_intro',
    'modern_society_math',
    'ai_practical_usage',
    'humanities_intro'
  ];

  /**
   * localStorageのキー管理
   */
  const STORAGE_KEYS = {
    REGISTERED: 'myClasses',
    COMPLETED: 'completedClasses',
    FILTER_PREFERENCES: 'courseFilterPreferences'
  };
  const SIMULATOR_STORAGE_KEY = 'fourYearSimulatorPlanV1';
  const simulatorRules = window.SimulatorRules;
  const simulatorAvailable = Boolean(simulatorRules && [
    'getQuarterInfo', 'canPlaceCourseAt',
    'getPlacementStart', 'isPrerequisiteSatisfied', 'getPlacementIssues',
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
    simulatorPlacementFilter: 'all'
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
    const quarterInfo = getQuarterInfo(course);
    return quarterInfo.options.find((option) => option.start === placement?.selectedQuarter) || null;
  };

  const formatSimulatorPlacement = (course, placement) => {
    const option = getPlacementOption(course, placement);
    if (option) return `${placement.year}年${option.label}`;
    const quarter = Number(placement?.selectedQuarter);
    return `${placement?.year || ''}年${Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? `Q${quarter}` : 'Q不明'}（要修正）`;
  };

  const getSimulatorPlacement = (courseId) => state.simulatorPlan.placements.find((placement) => placement.courseId === courseId);

  // Main Hubとシミュレーターで同じ難易度順・未登録末尾・安定順序を使う。
  // 標準順は呼び出し側の既存配列をそのまま返し、既存の科目順を維持する。
  const sortCoursesByDifficulty = (courses, sortMode) => {
    if (sortMode === 'default') return courses;
    return courses
      .map((item, index) => ({ item, index, average: state.difficultyMap.get(item.id)?.average }))
      .sort((a, b) => {
        const aMissing = !Number.isFinite(a.average);
        const bMissing = !Number.isFinite(b.average);
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing) return a.index - b.index;
        const difference = sortMode === 'difficulty-asc'
          ? a.average - b.average
          : b.average - a.average;
        return difference || (a.index - b.index);
      })
      .map(({ item }) => item);
  };

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
    const quarterOptions = getQuarterInfo(course).options;
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
    const sortFilter = document.getElementById('sim-course-sort');
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const selectedYear = yearFilter?.value || 'すべて表示';
    const selectedQuarter = quarterFilter?.value || 'すべて表示';
    const selectedCategory = categoryFilter?.value || 'すべて表示';
    const selectedPlacement = placementFilter?.value || state.simulatorPlacementFilter;
    const selectedSort = sortFilter?.value || 'default';

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

    matches = sortCoursesByDifficulty(matches, selectedSort);

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


  /**
   * ロジック：単位数や統計の計算
   */
  const calculateCredits = (state) => {
    const allSelected = [
      ...Array.from(state.registeredClasses),
      ...Array.from(state.completedClasses)
    ].map(id => state.coursesMap.get(id)).filter(Boolean);

    let rawTotalCredits = 0;
    let socialCredits = 0;
    let otherCredits = 0;

    allSelected.forEach(cls => {
      const credits = Number(cls.credits || 0);
      rawTotalCredits += credits;
      const isSocial = cls.tag === '社会接続' || (Array.isArray(cls.tags) && cls.tags.includes('社会接続'));

      if (isSocial) socialCredits += credits;
      else otherCredits += credits;
    });

    return {
      totalCredits: otherCredits + Math.min(socialCredits, 10),
      rawTotalCredits,
      socialCredits
    };
  };

  const sumCredits = (classes) => classes.reduce((sum, cls) => sum + Number(cls.credits || 0), 0);

  // 基礎科目の「対象科目」選択フォームを、courses.jsonのデータからオプション生成する
  const renderFoundationTargetOptions = (fieldKey, selectEl) => {
    if (!selectEl) return;

    const subjectMap = {
      '数理': ['数学的思考とは何か', '数学史', '現代社会とサイエンス'],
      '情報': [],
      '文化思想': [],
      '社会ネットワーク': [],
        '経済マーケット': ['企業経営', '地域アントレナーシップ', '地域課題の解決とイノベーション'],
        '世界理解': []
    };

    const targets = subjectMap[fieldKey] || [];

    if (!targets.length) {
      selectEl.innerHTML = '<option value="">-- 追加する科目を選択 --</option>';
      return;
    }

    const optionsHtml = targets.map(s => `<option value="${s}">${s}</option>`).join('');
    selectEl.innerHTML = `<option value="">-- 追加する科目を選択 --</option>${optionsHtml}`;
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
    const allSelected = [...regObjects, ...compObjects];

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

    const completedIntro = allSelected.filter(c => introSubjects.includes(c.id));
    const introCredits = sumCredits(completedIntro);


    const literacyCredits = sumCredits(allSelected.filter(cls => cls.literacyRequirement === true));
    const multilingualInfoCredits = sumCredits(allSelected.filter(cls => 
      cls.multilingualRequirement === true || 
      cls.foundationRequirement === '多言語情報理解' ||
      cls.subject === '多言語ITコミュニケーション'
    ));
    const globalStudiesCredits = sumCredits(allSelected.filter(cls => cls.globalStudiesRequirement === true));
    // 産業史系は「対象科目数」ではなく卒業要件に算入する単位数を表示する。
    // 例えば2単位の産業史を1科目履修した場合も、進捗は1/2ではなく2/2となる。
    const historyCredits = sumCredits(allSelected.filter(cls => cls.digitalIndustryHistoryRequirement === true));

    const advancedCredits = sumCredits(allSelected.filter(cls => cls.advancedRequirement === true));
    const advancedTarget = 74;

    const foundationConfigs = [
      { key: '数理', label: '数理' },
      { key: '情報', label: '情報' },
      { key: '文化思想', label: '文化思想' },
      { key: '社会ネットワーク', label: '社会ネットワーク' },
      { key: '経済マーケット', label: '経済マーケット' },
      { key: '情報ITコミュニケーション', label: '多言語ITコミュニケーション' },
    ];

    const foundationStats = allSelected.reduce((acc, cls) => {
      let field = cls.requirementField || cls.foundationRequirement;
      // 「多言語ITコミュニケーション」を基礎科目のバケットに強制的に含める
      if (cls.subject === '多言語ITコミュニケーション') {
        field = '情報ITコミュニケーション';
      }
      if (field) acc[field] = (acc[field] || 0) + Number(cls.credits || 0);
      return acc;
    }, {});

    const foundationTotal = foundationConfigs.reduce((sum, config) => {
      const current = foundationStats[config.key] || 0;
      return sum + Math.min(current, 2);
    }, 0);

    const foundationHtml = foundationConfigs.map(config => {
      const current = foundationStats[config.key] || 0;
      const min = 2;
      const isMet = current >= min;
      const statusIcon = isMet ? '<span style="color: green;">✔</span>' : '<span style="color: red;">✖</span>';
      const remainingText = isMet
        ? '<span class="requirement-met">✓ 達成</span>'
        : `<span class="requirement-remaining">（残り${Math.max(0, min - current)}単位）</span>`;

      // 対象科目欄: 追加UI（select/ボタン）を消して、科目名だけ表示する
      // 多言語ITコミュニケーション（対象科目の表示自体を不要とする）
      if (config.key === '情報ITコミュニケーション') {
        const targetSelectHtml = '';
        return `
          <p style="margin: 10px 0; font-size: 0.95em;">
            ${config.label}：${current} / ${min} ${statusIcon} ${remainingText}
          </p>
        `;
      }

      const initialOptions = {
        '数理': ['数学的思考とは何か', '数学史', '現代社会とサイエンス'],
        '情報': ['情報セキュリティ概論', '情報倫理と法', 'データサイエンス概論'],
        '文化思想': ['日本文学Ⅰ', '文化人類学Ⅰ', '心理学'],
        '社会ネットワーク': ['社会学Ⅰ', '法学Ⅰ', '伝わる論理とコミュニケーション'],
'経済マーケット': ['企業経営', '地域アントレナーシップ', '地域課題の解決とイノベーション'],
'世界理解': [],
        '情報ITコミュニケーション': [],
        '世界理解': undefined,
      }[config.key] || [];

      const targetSelectHtml = `
        <div style="margin-top: 8px;">
          <details style="display: inline-block; margin-left: 10px;">
            <summary style="cursor: pointer; text-decoration: underline; color:#333;">詳細</summary>
            <div style="margin-top: 8px; color:#111; font-size:0.95em;">
              ${initialOptions.length ? initialOptions.join(' / ') : '（未設定）'}
            </div>
          </details>
        </div>
      `;

      return `
        <p style="margin: 10px 0; font-size: 0.95em;">
          ${config.label}：${current} / ${min} ${statusIcon} ${remainingText}
          <span style="font-size: 0.85em; margin-left: 10px; color: #666;">${targetSelectHtml}</span>
        </p>
      `;
    }).join('');

    regObjects.forEach((cls) => {
      list.appendChild(createClassItem(cls, 'registered'));
    });

    compObjects.forEach((cls) => {
      completedList.appendChild(createClassItem(cls, 'completed'));
    });

    document.getElementById('earned-credits').textContent = earnedCredits;

    const topXEl = document.getElementById('top-earned-x');
    const topFillEl = document.getElementById('top-earned-fill');
    if (topXEl && topFillEl) {
      topXEl.textContent = stats.totalCredits;
      const gaugeBar = topFillEl.parentElement;
      if (gaugeBar) {
        gaugeBar.setAttribute("aria-valuenow", stats.totalCredits);
      }
      const pct = Math.max(0, Math.min(100, (stats.totalCredits / 124) * 100));
      topFillEl.style.width = pct + '%';
      topFillEl.style.background = pct >= 100 ? '#22c55e' : (pct >= 60 ? '#3b82f6' : '#ef4444');
    }

    document.getElementById('registered-count').textContent = state.registeredClasses.size;
    document.getElementById('registered-credits').textContent = regCredits;

    const analysisResult = document.getElementById('analysis-result');
    if (analysisResult) {
      const formatRatio = (current, target, unit = '単位') => {
        const safeCurrent = Math.max(0, Number(current) || 0);
        const safeTarget = Math.max(0, Number(target) || 0);
        const isMet = safeCurrent >= safeTarget;
        const remaining = Math.max(0, safeTarget - safeCurrent);
        const status = isMet
          ? '<span class="requirement-met">✓ 達成</span>'
          : `<span class="requirement-remaining">（残り${remaining}${unit}）</span>`;
        const color = isMet ? 'green' : 'red';
        return `<span class="requirement-progress"><span class="requirement-ratio" style="color: ${color}; font-weight: bold;">${safeCurrent} / ${safeTarget}</span> ${status}</span>`;
      };

      analysisResult.innerHTML = `
        <div class="analysis-box" style="border:2px solid #007bff; border-radius:10px; padding:12px 14px; background:#f0f7ff;">
          <p style="font-size: 1.1em; margin-bottom: 10px;">
            <strong>総単位：</strong> ${formatRatio(stats.totalCredits, 124)}（卒業要件）
            ${stats.socialCredits > 10 ? '<span style="color: #ff9900; font-weight: bold; margin-left: 8px;">！</span>' : ''}
            <span style="font-size: 0.9em; margin-left: 10px; color: #666;">
              <details style="display: inline-block; margin-left: 6px;">
                <summary style="cursor: pointer; text-decoration: underline;">詳細</summary>
                <div style="margin-top: 8px; padding: 10px 12px; background: #f9f9f9; border-radius: 6px; border: 1px solid #eee;">
                  「社会接続科目から卒業要件に算入できる単位の数は10単位とする」
                </div>
              </details>
            </span>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>導入科目：</strong> ${formatRatio(introCredits, 14)}
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 10px; padding: 10px; background: #fff; border: 1px solid #ddd; border-radius: 5px; min-width: 220px;">
                <ul style="margin: 0; padding: 0; list-style: none; font-size: 0.85em;">
                  ${introSubjects.map(id => state.coursesMap.get(id)?.subject || id)
                    .map(s => {
                      const has = allSelected.some(c => c.subject === s || c.id === s);
                      return `<li style="padding: 3px 0; border-bottom: 1px dashed #eee; display: flex; justify-content: space-between; color: ${has ? '#2c7a7b' : '#e53e3e'};">
                        <span>${s}</span>
                        <span>${has ? '〇' : '×'}</span>
                      </li>`;
                    }).join('')}
                </ul>
              </div>
            </details>
          </p>
          <p style="margin-bottom: 10px;">
            <strong>基礎科目：</strong> ${formatRatio(foundationTotal, 12)}
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 10px; padding: 10px; background: #f9f9f9; border-radius: 5px; border-left: 4px solid #ccc; min-width: 220px;">
                ${foundationHtml}
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>展開科目：</strong> ${formatRatio(advancedCredits, advancedTarget)}
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 8px; padding: 8px; background: #fff; border: 1px solid #ddd; border-radius: 5px;">
                <a href="https://img.zen-univ.jp/studentBook/curriculumtree2026_260310.pdf" target="_blank" rel="noopener noreferrer" style="color:#007bff; font-size: 0.85em;">
                  カリキュラムツリーで対象科目を確認
                </a>
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>基盤リテラシー：</strong> ${formatRatio(literacyCredits, 8)}
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 8px; padding: 8px; background: #fff; border: 1px solid #ddd; border-radius: 5px;">
                <a href="https://img.zen-univ.jp/studentBook/curriculumtree2026_260310.pdf" target="_blank" rel="noopener noreferrer" style="color:#007bff; font-size: 0.85em;">
                  カリキュラムツリーで対象科目を確認
                </a>
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>多言語情報理解科目：</strong> ${formatRatio(multilingualInfoCredits, 8)}
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 8px; padding: 8px; background: #fff; border: 1px solid #ddd; border-radius: 5px; font-size: 0.85em; color: #111;">
                多言語ITコミュニケーション / 機械翻訳実践(英語読解・作文) / 機械翻訳実践(法学) / 機械翻訳実践(情報) / 機械翻訳実践(異文化理解) / 機械翻訳実践(自然科学) / 機械翻訳実践(日本研究)
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>世界理解科目：</strong> ${formatRatio(globalStudiesCredits, 26)} 
            <details style="display: inline-block; margin-left: 5px;">
              <summary style="cursor: pointer; color: #007bff; font-size: 0.9em; text-decoration: underline;">詳細</summary>
              <div style="margin-top: 8px; padding: 8px; background: #fff; border: 1px solid #ddd; border-radius: 5px;">
                <a href="https://img.zen-univ.jp/studentBook/curriculumtree2026_260310.pdf" target="_blank" rel="noopener noreferrer" style="color:#007bff; font-size: 0.85em;">
                  カリキュラムツリーで対象科目を確認
                </a>
                <span style="font-size: 0.85em; color: #666; margin-left: 8px;">（産業史系 ${formatRatio(historyCredits, 2)}）</span>
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>卒業プロジェクト科目：</strong>
            ${(() => {
              const projectCredits = sumCredits(allSelected.filter(cls =>
                cls.graduationRequirement === true ||
                cls.projectPracticeRequirement === true ||
                cls.projectPractice === true ||
                cls.projectPracticeRequirement === 'true'
              ));
              const projectTarget = 4;
              return formatRatio(projectCredits, projectTarget);
            })()}
          </p>
          <p style="color: #666; font-size: 0.9em;"><strong>参考総単位：</strong> ${stats.rawTotalCredits} 単位（制限なしの値）</p>
        </div>
      `;
    }
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
      'intro-filter': state.filterIntro,
      'sort-filter': state.difficultySort
    };
    Object.entries(values).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.value = value;
    });
    const searchBar = document.getElementById('search-bar');
    if (searchBar) searchBar.value = '';
    const excludePixiv = document.getElementById('exclude-pixiv-filter');
    if (excludePixiv) excludePixiv.checked = false;
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

      // 導入科目フィルタ：introSubjectsに含まれるかどうかで判定
      const matchIntro = state.filterIntro === 'すべて表示' || (state.filterIntro === '該当' ? introSubjects.includes(item.id) : !introSubjects.includes(item.id));

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

    const sorted = sortCoursesByDifficulty(filtered, state.difficultySort);

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

    const sortF = document.getElementById('sort-filter');
    if (sortF) sortF.addEventListener('change', (e) => {
      state.difficultySort = e.target.value;
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
    ['sim-course-year-filter', 'sim-course-quarter-filter', 'sim-course-category-filter', 'sim-course-sort', 'sim-course-placement-filter']
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

      const modalContent = modal.querySelector('.modal-content');
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

  setupFilters();
  setupSimulatorModal();
  setupAnalysisModal();
  setupTutorialModal();
  setupBackToTopButton();

  // 外部JSONから授業データを読み込む
  let loadErrorTimer = null; // 通信エラーアラートの遅延表示用タイマー
  try {
    // 授業データ、任意の難易度データ、前提・後継科目データを並行して読み込む
    const [coursesRes, difficultyMap, relationsData] = await Promise.all([
      fetch('courses.json'),
      loadDifficultyData(),
      loadCourseRelationsData()
    ]);

    if (!coursesRes.ok) throw new Error(`授業データが見つかりません (${coursesRes.status})`);
    const data = await coursesRes.json();

    state.difficultyMap = difficultyMap;

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
