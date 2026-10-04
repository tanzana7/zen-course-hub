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
    graduationDefinition: null,
    courseValidationError: null
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
    if (!analysis.valid) return { totalCredits: 0, rawTotalCredits: 0, socialCredits: 0 };
    return {
      totalCredits: analysis.totalCredits.countedCredits,
      rawTotalCredits: analysis.totalCredits.actualCredits,
      socialCredits: analysis.totalCredits.socialActualCredits
    };
  };

  const graduationStatus = (requirement, planned) => {
    if (requirement.satisfied) return planned ? '達成見込み' : '達成';
    return planned ? '不足' : '未達';
  };

  const renderGraduationAnalysis = (completedAnalysis, plannedAnalysis) => {
    const analysisResultElement = document.getElementById('analysis-result');
    if (!analysisResultElement) return;
    if (!completedAnalysis.valid || !plannedAnalysis.valid) {
      analysisResultElement.innerHTML = `<div class="analysis-box graduation-analysis-error" role="alert">${escapeHTML(completedAnalysis.message || plannedAnalysis.message || '科目データを確認できないため、卒業要件を判定できません。')}</div>`;
      return;
    }

    const ratio = (requirement, planned) => {
      const status = graduationStatus(requirement, planned);
      const statusClass = requirement.satisfied ? 'requirement-met' : 'requirement-remaining';
      return `<span class="requirement-progress"><span class="requirement-ratio">${requirement.credits ?? requirement.countedCredits} / ${requirement.targetCredits}単位</span> <span class="${statusClass}">${status}</span></span>`;
    };
    const dual = (label, completedRequirement, plannedRequirement) => `
      <div class="graduation-requirement-row">
        <strong>${escapeHTML(label)}</strong>
        <span>修得済み ${ratio(completedRequirement, false)}</span>
        <span>予定込み ${ratio(plannedRequirement, true)}</span>
      </div>`;
    const foundationGroups = completedAnalysis.foundation.groups.map((group, index) => {
      const plannedGroup = plannedAnalysis.foundation.groups[index];
      return dual(`基礎：${group.label}`, group, plannedGroup);
    }).join('');

    const socialRow = `
      <div class="graduation-requirement-row graduation-social-row">
        <strong>社会接続</strong>
        <span>取得：${completedAnalysis.socialConnection.actualCredits}単位 / 算入：${completedAnalysis.socialConnection.countedCredits}単位</span>
        <span>予定込み取得：${plannedAnalysis.socialConnection.actualCredits}単位 / 算入：${plannedAnalysis.socialConnection.countedCredits}単位（上限${plannedAnalysis.socialConnection.capCredits}単位）</span>
      </div>`;

    const projectCompleted = completedAnalysis.projectPractice;
    const projectPlanned = plannedAnalysis.projectPractice;
    const industryCompleted = completedAnalysis.worldUnderstanding.industryHistory;
    const industryPlanned = plannedAnalysis.worldUnderstanding.industryHistory;
    analysisResultElement.innerHTML = `
      <div class="analysis-box graduation-analysis" aria-describedby="graduation-analysis-note">
        <p class="graduation-analysis-legend"><strong>修得済み</strong>は履修済みのみ、<strong>予定込み</strong>は履修済み＋履修予定です。</p>
        <div class="graduation-overall-status" aria-live="polite">
          修得済み：<strong>${completedAnalysis.satisfied ? '達成' : '未達'}</strong> ／
          予定込み：<strong>${plannedAnalysis.satisfied ? '達成見込み' : '不足'}</strong>
        </div>
        ${dual('総卒業算入単位', completedAnalysis.totalCredits, plannedAnalysis.totalCredits)}
        ${dual('導入科目', completedAnalysis.introduction, plannedAnalysis.introduction)}
        <div class="graduation-requirement-group">
          ${dual('基礎科目', completedAnalysis.foundation, plannedAnalysis.foundation)}
          ${foundationGroups}
          ${dual('多言語ITコミュニケーション', completedAnalysis.foundation.multilingualIT, plannedAnalysis.foundation.multilingualIT)}
        </div>
        ${dual('展開科目', completedAnalysis.advanced, plannedAnalysis.advanced)}
        ${dual('基盤リテラシー（基礎科目を含む）', completedAnalysis.literacy, plannedAnalysis.literacy)}
        ${dual('多言語情報理解（基礎科目を含む）', completedAnalysis.multilingualInformation, plannedAnalysis.multilingualInformation)}
        ${dual('世界理解（基礎科目を含む）', completedAnalysis.worldUnderstanding, plannedAnalysis.worldUnderstanding)}
        <div class="graduation-requirement-row graduation-subrequirement-row">
          <strong>世界理解内：産業史系</strong>
          <span>修得済み ${ratio(industryCompleted, false)}</span>
          <span>予定込み ${ratio(industryPlanned, true)}</span>
        </div>
        ${socialRow}
        ${dual('プロジェクト実践', projectCompleted, projectPlanned)}
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

    const topGaugeXEl = document.getElementById('top-earned-x');
    const topGaugeTargetEl = document.getElementById('top-earned-target');
    const topGaugeFillEl = document.getElementById('top-earned-fill');
    if (topGaugeXEl && topGaugeFillEl) {
      topGaugeXEl.textContent = stats.totalCredits;
      const targetCredits = state.graduationDefinition?.requirements?.totalCredits?.targetCredits;
      if (topGaugeTargetEl) topGaugeTargetEl.textContent = Number.isFinite(targetCredits) ? targetCredits : '—';
      const gaugeBar = topGaugeFillEl.parentElement;
      if (gaugeBar) {
        gaugeBar.setAttribute('aria-valuenow', stats.totalCredits);
        gaugeBar.setAttribute('aria-valuemax', Number.isFinite(targetCredits) ? targetCredits : '0');
      }
      const pct = Number.isFinite(targetCredits) && targetCredits > 0
        ? Math.max(0, Math.min(100, (stats.totalCredits / targetCredits) * 100))
        : 0;
      topGaugeFillEl.style.width = `${pct}%`;
      topGaugeFillEl.style.background = pct >= 100 ? '#22c55e' : (pct >= 60 ? '#3b82f6' : '#ef4444');
    }

    renderGraduationAnalysis(completedAnalysis, plannedAnalysis);
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
  setupAnalysisModal();
  setupTutorialModal();
  setupBackToTopButton();

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
