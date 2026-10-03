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
    relationsMap: new Map() // 科目IDをキーにした前提・後継科目データ
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
    layout: null
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
   * 既存の科目データから、学年レーンを持つDAG表示用の座標を作る。
   * 公式の配置データは存在しないため、yearは推奨年次として扱い、relationは
   * 元データの向きをそのままSVGの矢印へ反映する。複数前提・複数後継は維持する。
   */
  const buildCurriculumLayout = () => {
    const laneNames = ['1年次', '2年次', '3年次', '4年次'];
    const laneWidth = 310;
    const nodeHeight = 82;
    const graphTop = 54;
    const nodeGap = 8;
    const positions = new Map();
    const laneItems = new Map(laneNames.map((lane) => [lane, []]));
    const fallbackItems = [];

    state.predefinedData.forEach((course) => {
      if (laneItems.has(course.year)) laneItems.get(course.year).push(course);
      else fallbackItems.push(course);
    });

    const compareCourses = (a, b) => {
      const fieldCompare = String(a.tag || '').localeCompare(String(b.tag || ''), 'ja');
      return fieldCompare || String(a.subject || '').localeCompare(String(b.subject || ''), 'ja');
    };

    laneItems.forEach((items) => items.sort(compareCourses));
    fallbackItems.sort(compareCourses);
    if (fallbackItems.length) laneItems.set('未分類', fallbackItems);

    const lanes = Array.from(laneItems.entries());
    const maxRows = Math.max(1, ...lanes.map(([, items]) => items.length));
    const graphWidth = Math.max(4, lanes.length) * laneWidth;
    const graphHeight = graphTop + maxRows * (nodeHeight + nodeGap) + 24;

    lanes.forEach(([laneName, items], laneIndex) => {
      items.forEach((course, index) => {
        positions.set(course.id, {
          x: laneIndex * laneWidth + laneWidth / 2,
          y: graphTop + index * (nodeHeight + nodeGap) + nodeHeight / 2,
          lane: laneName
        });
      });
    });

    return { lanes, laneWidth, nodeHeight, graphWidth, graphHeight, positions };
  };

  const getCurriculumField = (course) => String(course?.tag || '未分類').trim() || '未分類';

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
    detail.innerHTML = `
      <div class="curriculum-course-detail-heading">
        <h3>科目詳細</h3>
        <button type="button" class="curriculum-detail-close" aria-label="科目詳細を閉じる">×</button>
      </div>
      <div class="class-detail open">${renderCourseDetailMarkup(course)}</div>
    `;
    detail.hidden = false;
    detail.querySelector('.curriculum-detail-close')?.addEventListener('click', () => {
      clearCurriculumFocus();
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
    const count = document.getElementById('curriculum-tree-count');
    if (!graph || !lanesHost || !edgesHost || !count || !state.predefinedData.length) return;

    try {
      const layout = curriculumState.layout || buildCurriculumLayout();
      curriculumState.layout = layout;
      graph.style.width = `${layout.graphWidth}px`;
      graph.style.height = `${layout.graphHeight}px`;
      lanesHost.innerHTML = '';
      edgesHost.innerHTML = `
        <defs>
          <marker id="curriculum-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z"></path>
          </marker>
        </defs>
      `;
      edgesHost.setAttribute('width', String(layout.graphWidth));
      edgesHost.setAttribute('height', String(layout.graphHeight));
      edgesHost.setAttribute('viewBox', `0 0 ${layout.graphWidth} ${layout.graphHeight}`);

      const focusIds = getCurriculumFocusIds();
      const hasFocus = focusIds.size > 0;
      const coursesById = state.coursesMap;
      const matchesById = new Map();
      let matchCount = 0;

      layout.lanes.forEach(([laneName, courses], laneIndex) => {
        const lane = document.createElement('section');
        lane.className = 'curriculum-lane';
        lane.style.left = `${laneIndex * layout.laneWidth}px`;
        lane.style.width = `${layout.laneWidth}px`;
        lane.innerHTML = `<h3>${escapeHTML(laneName)}</h3>`;

        courses.forEach((course) => {
          const matches = getCurriculumMatch(course);
          matchesById.set(course.id, matches);
          if (matches) matchCount += 1;
          const isRegistered = state.registeredClasses.has(course.id);
          const isCompleted = state.completedClasses.has(course.id);
          const relatedToFocus = !hasFocus || focusIds.has(course.id);
          const node = document.createElement('article');
          node.className = 'curriculum-node';
          if (matches) node.classList.add('is-match');
          else node.classList.add('is-dimmed');
          if (!relatedToFocus) node.classList.add('is-out-of-focus');
          if (course.id === curriculumState.selectedId) node.classList.add('is-selected');
          if (isRegistered) node.classList.add('is-registered');
          if (isCompleted) node.classList.add('is-completed');
          node.dataset.courseId = course.id;
          node.draggable = true;
          node.tabIndex = 0;
          node.setAttribute('role', 'button');
          node.setAttribute('aria-label', `${course.subject}の科目詳細`);

          const statusLabel = isCompleted ? '履修済み' : isRegistered ? 'マイ履修' : '';
          const addLabel = isRegistered ? 'マイ履修 ✓' : isCompleted ? 'マイ履修に戻す' : 'マイ履修に追加';
          node.innerHTML = `
            <div class="curriculum-node-title">${escapeHTML(course.subject)}</div>
            <div class="curriculum-node-meta">
              <span>${escapeHTML(getCurriculumField(course))}</span>
              <span>${escapeHTML(course.quarter || '')}</span>
              ${statusLabel ? `<span class="curriculum-node-status">${statusLabel}</span>` : ''}
            </div>
            <div class="curriculum-node-actions">
              <button type="button" class="curriculum-detail-btn">詳細</button>
              <button type="button" class="curriculum-add-btn" ${isRegistered ? 'disabled' : ''}>${addLabel}</button>
            </div>
          `;

          const openDetail = () => {
            if (curriculumState.didDrag) return;
            if (curriculumState.selectedId === course.id) {
              clearCurriculumFocus();
              return;
            }
            openCurriculumCourseDetail(course.id);
          };
          node.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            openDetail();
          });
          node.addEventListener('keydown', (event) => {
            if (event.target !== node || !['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            openDetail();
          });
          node.querySelector('.curriculum-detail-btn')?.addEventListener('click', () => openCurriculumCourseDetail(course.id));
          node.querySelector('.curriculum-add-btn')?.addEventListener('click', () => {
            if (isRegistered) return;
            commitStateChange(course.id, 'REGISTER');
            setCurriculumStatus(`${course.subject}を履修予定に追加しました。`);
          });
          node.addEventListener('dragstart', (event) => {
            curriculumState.didDrag = true;
            event.dataTransfer?.setData('text/plain', course.id);
            event.dataTransfer?.setData('application/x-zen-course-id', course.id);
            event.dataTransfer.effectAllowed = 'copy';
            document.getElementById('curriculum-drop-zone')?.classList.add('is-dragging');
          });
          node.addEventListener('dragend', () => {
            document.getElementById('curriculum-drop-zone')?.classList.remove('is-dragging', 'is-over');
            window.setTimeout(() => { curriculumState.didDrag = false; }, 0);
          });
          lane.appendChild(node);
        });
        lanesHost.appendChild(lane);
      });

      const edges = [];
      state.relationsMap.forEach((relations, sourceId) => {
        const from = layout.positions.get(sourceId);
        if (!from) return;
        relations.successors.forEach((relation) => {
          const to = layout.positions.get(relation.id);
          if (!to || !coursesById.has(sourceId) || !coursesById.has(relation.id)) return;
          const edge = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          edge.setAttribute('d', createCurriculumEdgePath(from, to));
          edge.setAttribute('class', `curriculum-edge ${relation.strength === 'strongly_recommended' ? 'is-strong' : 'is-recommended'}`);
          const hasActiveFilter = Boolean(curriculumState.search.trim() || curriculumState.year !== 'すべて表示' || curriculumState.field !== 'すべて表示');
          if (hasActiveFilter && !matchesById.get(sourceId) && !matchesById.get(relation.id)) edge.classList.add('is-filter-dimmed');
          if (hasFocus && (sourceId === curriculumState.selectedId || relation.id === curriculumState.selectedId)) edge.classList.add('is-focused');
          if (hasFocus && !(focusIds.has(sourceId) && focusIds.has(relation.id))) edge.classList.add('is-out-of-focus');
          edges.push(edge);
        });
      });
      edges.forEach((edge) => edgesHost.appendChild(edge));
      count.textContent = `${matchCount} / ${state.predefinedData.length}科目`;
      const hasActiveFilter = Boolean(curriculumState.search.trim() || curriculumState.year !== 'すべて表示' || curriculumState.field !== 'すべて表示');
      if (hasActiveFilter && matchCount === 0) {
        setCurriculumStatus('該当する科目はありません。条件を解除してください。', true);
      } else if (hasActiveFilter) {
        setCurriculumStatus(`${matchCount}科目が条件に一致しています。`);
      } else {
        setCurriculumStatus('');
      }
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
    const search = document.getElementById('curriculum-tree-search');
    const year = document.getElementById('curriculum-tree-year');
    const field = document.getElementById('curriculum-tree-field');
    const graph = document.getElementById('curriculum-graph');
    if (!nav || !view || !dropZone || !search || !year || !field) return;

    const setMode = (enabled) => {
      document.body.classList.toggle('curriculum-tree-mode', enabled);
      view.hidden = !enabled;
      dropZone.hidden = !enabled;
      nav.setAttribute('aria-pressed', String(enabled));
      nav.textContent = enabled ? '履修一覧' : 'カリキュラムツリー';
      if (enabled) {
        renderCurriculumGraph();
        search.focus({ preventScroll: true });
      } else {
        const detail = document.getElementById('curriculum-course-detail');
        if (detail) detail.hidden = true;
        curriculumState.selectedId = '';
      }
    };

    nav.addEventListener('click', () => setMode(!document.body.classList.contains('curriculum-tree-mode')));
    close?.addEventListener('click', () => setMode(false));
    search.addEventListener('input', () => {
      curriculumState.search = search.value;
      renderCurriculumGraph();
    });
    year.addEventListener('change', () => {
      curriculumState.year = year.value;
      renderCurriculumGraph();
    });
    field.addEventListener('change', () => {
      curriculumState.field = field.value;
      renderCurriculumGraph();
    });
    graph?.addEventListener('click', (event) => {
      if (!event.target.closest('.curriculum-node')) clearCurriculumFocus();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('curriculum-tree-mode') && curriculumState.selectedId) {
        clearCurriculumFocus();
      }
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
      commitStateChange(courseId, 'REGISTER');
      setCurriculumStatus(`${course.subject}を履修予定に追加しました。`);
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
  setupCurriculumTree();

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
    populateCurriculumFieldFilter();
    curriculumState.layout = null;

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
