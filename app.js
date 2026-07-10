/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');

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
    reviewsMap: new Map(), // 科目IDをキーにしたMap管理
    difficultyMap: new Map() // 科目IDをキーにした難易度目安データ
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

    // 検索結果件数の表示更新
    const searchCountEl = document.getElementById('search-count');
    if (searchCountEl) {
      searchCountEl.textContent = `表示中：${filtered.length}科目`;
    }


    filtered.forEach(data => {
      const isRegistered = state.registeredClasses.has(data.id);
      const isCompleted = state.completedClasses.has(data.id);
      // UI上の背景色などは「どちらかに入っている」場合に適用
      const isHandled = isRegistered || isCompleted; 

      const teacherParts = data.teacher.split(', ');
      const displayTeacher = teacherParts.length > 1 
        ? `${teacherParts[0]} 他${teacherParts.length - 1}名` 
        : data.teacher;

      // 授業攻略情報（レビュー）セクションの生成
      const review = state.reviewsMap.get(data.id);
      let reviewsHtml = '';

      if (review) {
        reviewsHtml = `
        <div class="review-section" style="background: #f9f9f9; border-left: 4px solid #007bff; padding: 12px; margin-top: 15px; font-size: 0.95em;">
          <p style="margin: 0 0 10px 0; font-weight: bold; font-size: 1em;">🎮 授業攻略情報</p>
          <p style="margin: 10px 0 4px 0;"><strong>一言：</strong></p>
          <div style="white-space: pre-wrap; color: #333; line-height: 1.6; background: #fff; padding: 8px; border-radius: 4px; border: 1px solid #eee;">${escapeHTML(review.comment)}</div>
        </div>
        `;
      }

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

      const li = document.createElement('li');

      li.className = 'predefined-item';
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
            <button class="add-predefined" ${isRegistered ? 'disabled' : ''}>追加</button>
            <button class="complete-predefined" ${isCompleted ? 'disabled' : ''}>履修済み</button>
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
            ${data.url ? `<p><a href="${data.url}" target="_blank" class="syllabus-link" title="ZEN大学シラバスサイトの該当ページを開きます">ZEN大学シラバスで詳細を確認</a></p>` : ''}
            <p class="description"><strong>授業概要:</strong> ${data.description}</p>
            ${difficultyHtml}
            ${reviewsHtml}
          </div>
        </div>
      `;

      const detailBtn = li.querySelector('.detail-btn');
      const detailDiv = li.querySelector('.class-detail');
      detailBtn.onclick = () => detailDiv.classList.toggle('open');

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

  // --- アプリケーションの実行開始 ---
  // すべての関数(const)の定義が完了した後に、呼び出しを行います。

  setupFilters();
  setupAnalysisModal();
  setupTutorialModal();

  // 外部JSONから授業データを読み込む
  let loadErrorTimer = null; // 通信エラーアラートの遅延表示用タイマー
  try {
    // 授業データ、口コミデータ、任意の難易度データを並行して読み込む
    const [coursesRes, reviewsRes, difficultyMap] = await Promise.all([
      fetch('courses.json'),
      fetch('reviews.json').catch(() => ({ ok: false })), // ファイルがない場合は空として扱う
      loadDifficultyData()
    ]);

    if (!coursesRes.ok) throw new Error(`授業データが見つかりません (${coursesRes.status})`);
    const data = await coursesRes.json();

    if (reviewsRes.ok) {
      const reviewsData = await reviewsRes.json();
      state.reviewsMap = new Map((Array.isArray(reviewsData) ? reviewsData : []).map(r => [r.id, r]));
    }
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

    // 3秒以内に読み込みが完了した場合は、もし予約されていたエラーアラートがあればキャンセルする
    if (loadErrorTimer) clearTimeout(loadErrorTimer);
    renderAll(); // データロード後にクリーンアップを含めて再描画
  } catch (error) {
    console.error('データの読み込みに失敗しました:', error);
    // GitHub Pagesの初回読み込み遅延等による誤検知を防ぐため、3秒待機してからアラートを表示する。
    loadErrorTimer = setTimeout(() => {
      alert('授業データの読み込みに失敗しました。VS Codeの Live Server などを使用して開いてください。');
    }, 3000);
  }
});
