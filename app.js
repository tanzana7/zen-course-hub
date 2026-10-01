/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');
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
    COMPLETED: 'completedClasses'
  };
  const SIMULATOR_STORAGE_KEY = 'fourYearSimulatorPlanV1';

  const loadSimulatorPlan = () => {
    try {
      const raw = localStorage.getItem(SIMULATOR_STORAGE_KEY);
      if (!raw) return { version: 1, placements: [] };
      const parsed = JSON.parse(raw);
      const placements = Array.isArray(parsed?.placements)
        ? parsed.placements
            .map((item) => ({
              courseId: String(item?.courseId || ''),
              year: Number(item?.year),
              selectedQuarter: Number(item?.selectedQuarter ?? item?.startQuarter)
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
    difficultyMap: new Map(), // 科目IDをキーにした難易度目安データ
    relationsMap: new Map(), // 科目IDをキーにした前提・後継科目データ
    simulatorPlan: loadSimulatorPlan(),
    simulatorPaletteMode: 'all',
    // 通常の履修予定タブとは別に、4年計画上の配置状態だけを絞り込む。
    simulatorPlacementFilter: 'all'
  };

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

  const saveSimulatorPlan = () => {
    try {
      localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify(state.simulatorPlan));
    } catch (error) {
      console.warn('シミュレーター計画を保存できませんでした:', error);
    }
  };

  const cleanupSimulatorPlan = () => {
    const seen = new Set();
    state.simulatorPlan.placements = state.simulatorPlan.placements.map((placement) => {
      const course = state.coursesMap.get(placement.courseId);
      if (!course) return null;
      const options = getQuarterInfo(course).options;
      const selectedQuarter = options.some((option) => option.start === placement.selectedQuarter)
        ? placement.selectedQuarter
        : options[0]?.start;
      if (!selectedQuarter) return null;
      return { ...placement, selectedQuarter };
    }).filter((placement) => {
      if (!placement) return false;
      if (seen.has(placement.courseId) || !state.coursesMap.has(placement.courseId)) return false;
      seen.add(placement.courseId);
      return true;
    });
    saveSimulatorPlan();
  };

  const getQuarterInfo = (course) => {
    const label = String(course?.quarter || 'Q未定');
    if (label.includes('通期')) {
      return {
        label,
        quarters: [1, 2, 3, 4],
        options: [{ start: 1, end: 4, label: '1-4Q', contiguous: true }],
        start: 1,
        end: 4,
        contiguous: true
      };
    }

    const segments = label.split(/[,、]/).map((segment) => segment.trim()).filter(Boolean);
    const quarters = [...new Set((label.match(/[1-4]/g) || []).map(Number))].sort((a, b) => a - b);
    if (!quarters.length) return { label, quarters: [], options: [], start: null, end: null, contiguous: false };

    const options = [];
    segments.forEach((segment) => {
      const segmentQuarters = [...new Set((segment.match(/[1-4]/g) || []).map(Number))].sort((a, b) => a - b);
      if (!segmentQuarters.length) return;
      const isContiguous = segmentQuarters.every((quarter, index) => index === 0 || quarter === segmentQuarters[index - 1] + 1);
      if (isContiguous) {
        options.push({
          start: segmentQuarters[0],
          end: segmentQuarters[segmentQuarters.length - 1],
          label: segmentQuarters.length > 1
            ? `${segmentQuarters[0]}-${segmentQuarters[segmentQuarters.length - 1]}Q`
            : `${segmentQuarters[0]}Q`,
          contiguous: true
        });
      } else {
        // 1Q, 3Q のような非連続表記は、各Qを独立した配置候補として扱う。
        segmentQuarters.forEach((quarter) => options.push({
          start: quarter,
          end: quarter,
          label: `${quarter}Q`,
          contiguous: false
        }));
      }
    });

    const uniqueOptions = options.filter((option, index, list) => list.findIndex((candidate) => candidate.start === option.start) === index);
    const firstOption = uniqueOptions[0];
    return {
      label,
      quarters,
      options: uniqueOptions,
      start: firstOption?.start || null,
      end: firstOption?.end || null,
      contiguous: uniqueOptions.length === 1
    };
  };

  const getPlacementOption = (course, placement) => {
    const quarterInfo = getQuarterInfo(course);
    return quarterInfo.options.find((option) => option.start === placement?.selectedQuarter) || quarterInfo.options[0] || null;
  };

  const formatSimulatorPlacement = (course, placement) => {
    const option = getPlacementOption(course, placement);
    return option ? `${placement.year}年${option.label}` : `${placement.year}年`;
  };

  const getPlacementPeriod = (course, placement) => {
    const option = getPlacementOption(course, placement);
    if (!option || !Number.isInteger(placement?.year)) return null;
    return {
      start: (placement.year - 1) * 4 + option.start,
      end: (placement.year - 1) * 4 + option.end
    };
  };

  const getSimulatorPlacement = (courseId) => state.simulatorPlan.placements.find((placement) => placement.courseId === courseId);

  const getSimulatorWarnings = (course, placement) => {
    const prerequisites = state.relationsMap.get(course.id)?.prerequisites || [];
    const targetPeriod = getPlacementPeriod(course, placement);

    return prerequisites.map((relation) => {
      const prerequisite = state.coursesMap.get(relation.id);
      if (!prerequisite) return null;
      const placement = getSimulatorPlacement(prerequisite.id);
      const strengthLabel = relation.strength === 'strongly_recommended' ? '強く推奨' : '推奨';
      const strengthClass = relation.strength === 'strongly_recommended' ? 'strong' : 'recommended';

      // 通常画面で履修済みにした科目は、シミュレーター上では既に完了した前提科目として扱う。
      if (state.completedClasses.has(prerequisite.id)) return null;

      if (!placement) {
        return {
          message: `前提科目「${prerequisite.subject}」が未配置です`,
          strengthLabel,
          strengthClass
        };
      }

      const prerequisitePeriod = getPlacementPeriod(prerequisite, placement);
      if (!targetPeriod || !prerequisitePeriod || prerequisitePeriod.end < targetPeriod.start) return null;
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
      ...warning
    }));
  });

  const renderSimulatorPlanCheck = () => {
    const summary = document.getElementById('simulator-plan-check-summary');
    const details = document.getElementById('simulator-plan-check-details');
    if (!summary || !details) return;

    const warnings = getSimulatorPlanWarnings();
    const strongCount = warnings.filter((warning) => warning.strengthClass === 'strong').length;
    const recommendedCount = warnings.length - strongCount;
    summary.textContent = warnings.length
      ? `⚠ 計画チェック ${warnings.length}件（強く推奨 ${strongCount}・推奨 ${recommendedCount}）`
      : '✓ 計画チェック';
    details.innerHTML = warnings.length
      ? `<ul>${warnings.map((warning) => `
          <li data-sim-warning-course="${escapeHTML(warning.course.id)}">
            <strong>${escapeHTML(warning.course.subject)}</strong>
            <span>${escapeHTML(warning.message)}（${escapeHTML(warning.strengthLabel)}）</span>
          </li>
        `).join('')}</ul>`
      : '<p>前提科目に関する注意はありません</p>';
  };

  const closeSimulatorCourseDetail = () => {
    const modal = document.getElementById('simulator-course-detail');
    if (!modal) return;
    modal.classList.remove('is-active');
    modal.hidden = true;
  };

  const openSimulatorCourseDetail = (courseId) => {
    const course = state.coursesMap.get(courseId);
    const placement = getSimulatorPlacement(courseId);
    const option = course && placement ? getPlacementOption(course, placement) : null;
    const modal = document.getElementById('simulator-course-detail');
    const content = document.getElementById('simulator-course-detail-content');
    const title = document.getElementById('simulator-course-detail-title');
    if (!course || !modal || !content || !title) return;

    const warnings = placement ? getSimulatorWarnings(course, placement) : [];
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
    title.textContent = course.subject;
    content.innerHTML = `
      <dl class="simulator-course-detail-list">
        <div><dt>開講Q</dt><dd>${escapeHTML(course.quarter || 'Q未定')}</dd></div>
        ${placement && option ? `<div><dt>選択Q</dt><dd>${escapeHTML(formatSimulatorPlacement(course, placement))}</dd></div>` : ''}
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
    document.getElementById('close-simulator-course-detail')?.focus();
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

    if (selectedSort !== 'default') {
      matches = matches
        .map((item, index) => ({ item, index, average: state.difficultyMap.get(item.id)?.average }))
        .sort((a, b) => {
          const aMissing = !Number.isFinite(a.average);
          const bMissing = !Number.isFinite(b.average);
          if (aMissing !== bMissing) return aMissing ? 1 : -1;
          if (aMissing) return a.index - b.index;
          const difference = selectedSort === 'difficulty-asc'
            ? a.average - b.average
            : b.average - a.average;
          return difference || (a.index - b.index);
        })
        .map(({ item }) => item);
    }

    if (!matches.length) {
      results.innerHTML = '<p class="simulator-empty">該当する科目がありません。</p>';
      return;
    }

    results.innerHTML = matches.map((course) => {
      const placement = getSimulatorPlacement(course.id);
      const difficulty = state.difficultyMap.get(course.id);
      const placementText = placement ? `✓ ${formatSimulatorPlacement(course, placement)}に配置済み` : '未配置';
      const difficultyText = difficulty ? `難易度 ${difficulty.average.toFixed(2)} / 10.0` : '難易度 未登録';
      const placedClass = placement ? ' is-placed' : '';
      const quarterOptions = getQuarterInfo(course).options;
      const mobilePlacementButtons = quarterOptions.flatMap((option) => [1, 2, 3, 4].map((year) => `
        <button type="button" class="sim-mobile-place-button" data-sim-place-year="${year}" data-sim-place-quarter="${option.start}" data-sim-course-id="${escapeHTML(course.id)}">${year}年${option.label}</button>
      `)).join('');
      return `
        <article class="sim-course-picker-item${placedClass}" draggable="${placement ? 'false' : 'true'}" data-sim-drag-course="${escapeHTML(course.id)}" data-sim-detail-course="${escapeHTML(course.id)}" role="button" tabindex="0" aria-label="${escapeHTML(course.subject)}：${escapeHTML(placementText)}。選択で詳細を表示">
          <div class="sim-course-picker-info">
            <strong>${escapeHTML(course.subject)}</strong>
            <span>${escapeHTML(course.quarter || 'Q未定')} ｜ ${escapeHTML(String(course.credits || 0))}単位</span>
            <small>${escapeHTML(difficultyText)} ｜ ${escapeHTML(placementText)}</small>
          </div>
          <div class="sim-mobile-place-controls" aria-label="${escapeHTML(course.subject)}の配置先">
            ${mobilePlacementButtons}
          </div>
        </article>
      `;
    }).join('');

    results.querySelectorAll('[data-sim-place-year][data-sim-place-quarter]').forEach((button) => {
      button.onclick = () => placeSimulatorCourse(
        button.dataset.simCourseId,
        Number(button.dataset.simPlaceYear),
        Number(button.dataset.simPlaceQuarter)
      );
    });
    results.querySelectorAll('[data-sim-drag-course]').forEach((item) => {
      item.addEventListener('dragstart', (event) => {
        item.dataset.simDragging = 'true';
        if (item.classList.contains('is-placed')) {
          event.preventDefault();
          return;
        }
        event.dataTransfer?.setData('text/plain', item.dataset.simDragCourse);
        highlightSimulatorDropCells(item.dataset.simDragCourse);
      });
      item.addEventListener('dragend', () => {
        delete item.dataset.simDragging;
        item.dataset.simSkipClick = 'true';
        window.setTimeout(() => delete item.dataset.simSkipClick, 0);
        clearSimulatorDropHighlights();
      });
      item.addEventListener('click', (event) => {
        if (event.target.closest('button') || item.dataset.simDragging === 'true' || item.dataset.simSkipClick === 'true') return;
        openSimulatorCourseDetail(item.dataset.simDetailCourse);
      });
      item.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('button')) {
          event.preventDefault();
          openSimulatorCourseDetail(item.dataset.simDetailCourse);
        }
      });
    });
  };

  const clearSimulatorDropHighlights = () => {
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      cell.classList.remove('is-drop-allowed', 'is-drop-forbidden', 'is-drop-active');
    });
  };

  const highlightSimulatorDropCells = (courseId) => {
    const course = state.coursesMap.get(courseId);
    const options = course ? getQuarterInfo(course).options : [];
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      const quarter = Number(cell.dataset.simDropQuarter);
      const allowed = options.some((option) => option.start === quarter);
      cell.classList.toggle('is-drop-allowed', allowed);
      cell.classList.toggle('is-drop-forbidden', !allowed);
    });
  };

  const renderSimulator = () => {
    const summary = document.getElementById('simulator-summary');
    const totalSummary = document.getElementById('simulator-total-summary');
    const yearGrid = document.getElementById('simulator-year-grid');
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
        if (!option) return;
        const start = option.start;
        const span = option.end - option.start + 1;
        let lane = 0;
        while (lanes[lane]?.some((interval) => start <= interval.end && start + span - 1 >= interval.start)) lane += 1;
        if (!lanes[lane]) lanes[lane] = [];
        lanes[lane].push({ start, end: start + span - 1 });
        assignments.set(placement.courseId, { lane, start, span });
      });
      return { laneCount: lanes.length, assignments };
    };
    const laneDataByYear = new Map(years.map((year) => [year, buildYearLaneData(yearPlacements.get(year))]));
    const quarterCreditsByYear = new Map(years.map((year) => [year, new Map([[1, 0], [2, 0], [3, 0], [4, 0]])]));
    state.simulatorPlan.placements.forEach((placement) => {
      const course = getCourse(placement.courseId);
      const option = course ? getPlacementOption(course, placement) : null;
      const quarterCredits = quarterCreditsByYear.get(placement.year);
      if (!course || !option || !quarterCredits) return;
      // Span科目の単位は開始Qに一度だけ集計し、Q合計の二重計上を避ける。
      quarterCredits.set(option.start, quarterCredits.get(option.start) + Number(course.credits || 0));
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
      const rowTemplate = laneCount ? `30px repeat(${laneCount}, minmax(28px, auto))` : '30px';
      return `
      <div class="simulator-year-row" data-sim-year="${year}">
        <div class="simulator-year-label"><strong>${year}年</strong><span>${yearPlacements.get(year).reduce((sum, placement) => sum + Number(getCourse(placement.courseId)?.credits || 0), 0)}単位</span></div>
        <div class="simulator-quarter-grid" style="grid-template-rows: ${rowTemplate};">
          ${[1, 2, 3, 4].map((quarter) => `<div class="simulator-quarter-cell" style="grid-column: ${quarter}; grid-row: 1 / span ${laneCount + 1};" data-sim-drop-year="${year}" data-sim-drop-quarter="${quarter}"><span class="simulator-quarter-header"><strong>${quarter}Q</strong><small>${quarterCreditsByYear.get(year).get(quarter)}単位</small></span></div>`).join('')}
        </div>
      </div>
    `;
    }).join('');

    yearPlacements.forEach((placements, year) => {
      const row = yearGrid.querySelector(`[data-sim-year="${year}"]`);
      const quarterGrid = row?.querySelector('.simulator-quarter-grid');
      if (!quarterGrid) return;
      const laneData = laneDataByYear.get(year);

      placements.forEach((placement) => {
        const course = getCourse(placement.courseId);
        const option = getPlacementOption(course, placement);
        if (!option) return;
        const assignment = laneData.assignments.get(placement.courseId);
        if (!assignment) return;

        const warnings = getSimulatorWarnings(course, placement);
        const warningTooltip = warnings
          .map((warning) => `${warning.message}（${warning.strengthLabel}）`)
          .join(' / ');
        const warningClass = warnings.some((warning) => warning.strengthClass === 'strong')
          ? ' is-strong'
          : '';
        const card = document.createElement('article');
        card.className = 'sim-course-card';
        card.draggable = true;
        card.dataset.simDragCourse = course.id;
        card.style.gridColumn = `${assignment.start} / span ${assignment.span}`;
        card.style.gridRow = String(assignment.lane + 2);
        card.title = warningTooltip || `${course.subject}（${course.credits}単位）`;
        card.setAttribute('aria-label', `${course.subject} ${course.credits}単位${warningTooltip ? `。${warningTooltip}` : ''}`);
        card.dataset.simDetailCourse = course.id;
        card.innerHTML = `
          <strong>${escapeHTML(course.subject)}</strong>
          <span class="sim-course-credits">${escapeHTML(String(course.credits || 0))}単位</span>
          ${warnings.length ? `<button type="button" class="sim-warning-badge${warningClass}" data-sim-warning-course="${escapeHTML(course.id)}" aria-label="前提科目の注意を確認">⚠</button>` : ''}
          <button type="button" class="sim-course-remove" data-sim-remove-course="${escapeHTML(course.id)}" aria-label="${escapeHTML(course.subject)}を削除">×</button>
        `;
        quarterGrid.appendChild(card);
      });
    });

    yearGrid.querySelectorAll('[data-sim-drop-quarter]').forEach((target) => {
      target.addEventListener('dragenter', (event) => {
        const courseId = event.dataTransfer?.getData('text/plain');
        if (courseId && target.classList.contains('is-drop-allowed')) target.classList.add('is-drop-active');
      });
      target.addEventListener('dragover', (event) => {
        if (!target.classList.contains('is-drop-allowed')) return;
        event.preventDefault();
        target.classList.add('is-drop-active');
      });
      target.addEventListener('dragleave', (event) => {
        if (!event.relatedTarget || !target.contains(event.relatedTarget)) target.classList.remove('is-drop-active');
      });
      target.addEventListener('drop', (event) => {
        if (!target.classList.contains('is-drop-allowed')) return;
        event.preventDefault();
        clearSimulatorDropHighlights();
        const courseId = event.dataTransfer?.getData('text/plain');
        if (courseId) placeSimulatorCourse(courseId, Number(target.dataset.simDropYear), Number(target.dataset.simDropQuarter));
      });
    });
    yearGrid.querySelectorAll('[data-sim-drag-course]').forEach((item) => {
      item.addEventListener('dragstart', (event) => {
        item.dataset.simDragging = 'true';
        event.dataTransfer?.setData('text/plain', item.dataset.simDragCourse);
        highlightSimulatorDropCells(item.dataset.simDragCourse);
      });
      item.addEventListener('dragend', () => {
        delete item.dataset.simDragging;
        item.dataset.simSkipClick = 'true';
        window.setTimeout(() => delete item.dataset.simSkipClick, 0);
        clearSimulatorDropHighlights();
      });
    });
    yearGrid.querySelectorAll('[data-sim-remove-course]').forEach((button) => {
      button.onclick = () => removeSimulatorCourse(button.dataset.simRemoveCourse);
    });
    yearGrid.querySelectorAll('[data-sim-detail-course]').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('button') || card.dataset.simDragging === 'true' || card.dataset.simSkipClick === 'true') return;
        openSimulatorCourseDetail(card.dataset.simDetailCourse);
      });
    });
    yearGrid.querySelectorAll('[data-sim-warning-course]').forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        openSimulatorCourseDetail(button.dataset.simWarningCourse);
      };
    });

    const categoryFilter = document.getElementById('sim-course-category-filter');
    if (categoryFilter) {
      const categories = [...new Set(state.predefinedData.map((course) => course.tag).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ja'));
      const currentCategory = categoryFilter.value;
      categoryFilter.innerHTML = '<option value="すべて表示">分野</option>'
        + categories.map((category) => `<option value="${escapeHTML(category)}">${escapeHTML(category)}</option>`).join('');
      categoryFilter.value = categories.includes(currentCategory) ? currentCategory : 'すべて表示';
    }

    renderSimulatorCourseResults();
    renderSimulatorPlanCheck();
  };

  const placeSimulatorCourse = (courseId, year, selectedQuarter) => {
    const course = state.coursesMap.get(courseId);
    if (!course || !Number.isInteger(year) || year < 1 || year > 4) return;
    const option = getQuarterInfo(course).options.find((candidate) => candidate.start === selectedQuarter)
      || getQuarterInfo(course).options[0];
    if (!option) return;
    state.simulatorPlan.placements = state.simulatorPlan.placements.filter((placement) => placement.courseId !== courseId);
    state.simulatorPlan.placements.push({ courseId, year, selectedQuarter: option.start });
    saveSimulatorPlan();
    renderSimulator();
  };

  const removeSimulatorCourse = (courseId) => {
    state.simulatorPlan.placements = state.simulatorPlan.placements.filter((placement) => placement.courseId !== courseId);
    saveSimulatorPlan();
    renderSimulator();
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
    const historyCount = allSelected.filter(cls => cls.digitalIndustryHistoryRequirement === true).length;

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
      const remainingText = isMet ? '' : `<span style="font-size: 0.85em; color: #888;">（あと${min - current}単位）</span>`;

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
      const formatRatio = (current, target) => {
        const safeCurrent = Number(current) || 0;
        const safeTarget = Number(target) || 0;
        const isMet = safeCurrent >= safeTarget;
        const color = isMet ? 'green' : 'red';
        return `<span style="color: ${color}; font-weight: bold;">${safeCurrent} / ${safeTarget}</span>`;
      };

      analysisResult.innerHTML = `
        <div class="analysis-box" style="border:2px solid #007bff; border-radius:10px; padding:12px 14px; background:#f0f7ff;">
          <p style="font-size: 1.1em; margin-bottom: 10px;">
            <strong>総単位：</strong> ${formatRatio(stats.totalCredits, 124)} 単位（卒業要件）
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
                <span style="font-size: 0.85em; color: #666; margin-left: 8px;">（産業史系 ${historyCount}/2）</span>
              </div>
            </details>
          </p>
          <p style="margin-bottom: 5px;">
            <strong>卒業プロジェクト科目：</strong>
            ${(() => {
              const projectCredits = sumCredits(allSelected.filter(cls => cls.projectPracticeRequirement === true || cls.projectPractice === true || cls.projectPracticeRequirement === 'true'));
              const projectTarget = 4;
              return formatRatio(projectCredits, projectTarget);
            })()}
          </p>
          <p style="color: #666; font-size: 0.9em;"><strong>参考総単位：</strong> ${stats.rawTotalCredits} 単位（制限なしの値）</p>
        </div>
      `;
    }
  };

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

      return matchYear && matchQuarter && matchRequirement && matchIntro && matchCategory && matchSearch;
    });

    const sorted = state.difficultySort === 'default'
      ? filtered
      : filtered
          .map((item, index) => ({ item, index, average: state.difficultyMap.get(item.id)?.average }))
          .sort((a, b) => {
            const aMissing = !Number.isFinite(a.average);
            const bMissing = !Number.isFinite(b.average);
            if (aMissing !== bMissing) return aMissing ? 1 : -1;
            if (aMissing) return a.index - b.index;
            const difference = state.difficultySort === 'difficulty-asc'
              ? a.average - b.average
              : b.average - a.average;
            return difference || (a.index - b.index);
          })
          .map(({ item }) => item);

    // 検索結果件数の表示更新
    const searchCountEl = document.getElementById('search-count');
    if (searchCountEl) {
      searchCountEl.textContent = `表示中：${sorted.length}科目`;
    }


    sorted.forEach(data => {
      const isRegistered = state.registeredClasses.has(data.id);
      const isCompleted = state.completedClasses.has(data.id);
      // UI上の背景色などは「どちらかに入っている」場合に適用
      const isHandled = isRegistered || isCompleted; 

      const teacherParts = data.teacher.split(', ');
      const displayTeacher = teacherParts.length > 1
        ? `${teacherParts[0]} 他${teacherParts.length - 1}名`
        : data.teacher;

      // 難易度データが登録されている科目に限り、詳細欄へ表示する
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
      const renderRelationLinks = (relationItems) => (relationItems || []).map((relation) => {
        const relatedId = typeof relation === 'string' ? relation : relation.id;
        const strength = typeof relation === 'string' ? 'recommended' : relation.strength;
        const relatedCourse = state.coursesMap.get(relatedId);
        if (!relatedCourse) return '';
        const strengthLabel = strength === 'strongly_recommended' ? '強く推奨' : '推奨';
        const strengthClass = strength === 'strongly_recommended' ? 'strong' : 'recommended';
        return `<li><a href="#course-${escapeHTML(relatedCourse.id)}" class="related-course-link" data-course-id="${escapeHTML(relatedCourse.id)}">${escapeHTML(relatedCourse.subject)}</a> <span class="relation-strength ${strengthClass}">${strengthLabel}</span></li>`;
      }).join('');
      const prerequisiteLinks = renderRelationLinks(relations?.prerequisites);
      const successorLinks = renderRelationLinks(relations?.successors);
      const relationsHtml = (prerequisiteLinks || successorLinks) ? `
        <section class="course-relations" aria-label="関連科目">
          <h5 class="course-relations-title">関連科目</h5>
          ${prerequisiteLinks ? `<div class="course-relation-group"><strong>前提科目</strong><ul>${prerequisiteLinks}</ul></div>` : ''}
          ${successorLinks ? `<div class="course-relation-group"><strong>後継科目</strong><ul>${successorLinks}</ul></div>` : ''}
        </section>
      ` : '';

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
            </div>
          </div>
          <div class="actions">
            <button class="detail-btn">詳細</button>
            ${addButton}
            ${completeButton}
          </div>
        </div>
        <div class="class-detail">
          <h4 class="detail-subject">${data.subject}</h4>
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
        </div>
      `;

      const detailBtn = li.querySelector('.detail-btn');
      const detailDiv = li.querySelector('.class-detail');
      detailBtn.onclick = () => detailDiv.classList.toggle('open');

      li.querySelectorAll('.related-course-link').forEach((link) => {
        link.addEventListener('click', (event) => {
          const relatedId = link.dataset.courseId;
          const relatedItem = Array.from(predefinedList.querySelectorAll('.predefined-item'))
            .find((item) => item.dataset.courseId === relatedId);
          if (!relatedItem) return;

          event.preventDefault();
          relatedItem.querySelector('.class-detail')?.classList.add('open');
          relatedItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      });

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
  };

  const setupSimulatorModal = () => {
    const modal = document.getElementById('simulator-modal');
    const detailModal = document.getElementById('simulator-course-detail');
    const detailCloseButton = document.getElementById('close-simulator-course-detail');
    const button = document.getElementById('simulator-btn');
    const closeButton = document.getElementById('close-simulator');
    const searchInput = document.getElementById('sim-course-search');
    if (!modal || !button) return;
    const simulatorTitle = modal.dataset.simulatorTitle || '4年間履修シミュレーター';
    button.textContent = simulatorTitle;
    const title = document.getElementById('simulator-modal-title');
    if (title) title.textContent = simulatorTitle;

    const closeSimulator = () => {
      closeSimulatorCourseDetail();
      modal.classList.remove('is-active');
      modal.hidden = true;
      document.body.classList.remove('simulator-view-active');
      button.focus();
    };

    button.onclick = () => {
      modal.hidden = false;
      modal.classList.add('is-active');
      document.body.classList.add('simulator-view-active');
      renderSimulator();
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
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !modal.classList.contains('is-active')) return;
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
    const closeSpan = document.getElementById('close-modal');

    if (modal && closeSpan) {
      // ×ボタンをモーダルの右上に常に固定し、コンテンツが伸びても隠れないように設定
      closeSpan.style.position = 'sticky';
      closeSpan.style.top = '0';
      closeSpan.style.float = 'right';
      closeSpan.style.zIndex = '1000';
      closeSpan.style.backgroundColor = 'inherit'; // モーダルの背景色を継承して背後の文字を隠す

      const modalContent = modal.querySelector('.modal-content');
      if (modalContent) {
        modalContent.style.maxHeight = '90vh'; // 画面外に突き抜けないように制限
        modalContent.style.overflowY = 'auto'; // モーダル内部をスクロール可能にする
      }
    }

    if (btn && modal) {
      btn.onclick = () => (modal.style.display = 'block');
      if (closeSpan) closeSpan.onclick = () => (modal.style.display = 'none');

      modal.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
      };
    }
  };

  /**
   * 使い方（チュートリアル）モーダルの制御
   */
  const setupTutorialModal = async () => {
    const modal = document.getElementById('tutorial-modal');
    const btn = document.getElementById('tutorial-btn');
    const closeSpan = document.getElementById('close-tutorial');
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

      btn.onclick = () => (modal.style.display = 'block');
      
      // ×ボタンのイベント
      if (closeSpan) {
        closeSpan.onclick = () => {
          modal.style.display = 'none';
        };
      }

      // モーダル外クリックで閉じる
      modal.onclick = (event) => {
        if (event.target === modal) modal.style.display = 'none';
      };

      // Escキーで閉じる（アクセシビリティ対応）
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.style.display === 'block') {
          modal.style.display = 'none';
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
    cleanupSimulatorPlan();

    // 3秒以内に読み込みが完了した場合は、もし予約されていたエラーアラートがあればキャンセルする
    if (loadErrorTimer) clearTimeout(loadErrorTimer);
    if (dataStatus) {
      dataStatus.hidden = true;
      dataStatus.classList.remove('is-error');
    }
    renderAll(); // データロード後にクリーンアップを含めて再描画
    renderSimulator();
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
