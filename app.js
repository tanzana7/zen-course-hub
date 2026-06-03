/**
 * アプリケーションのメインロジック
 */
document.addEventListener('DOMContentLoaded', async () => {
  const list = document.getElementById('list');
  const completedList = document.getElementById('completed-list');
  const predefinedList = document.getElementById('predefined-classes-list');

  const introSubjects = [
    'ITリテラシー',
    'アカデミックリテラシー',
    'デジタルツールの使い方',
    '経済入門',
    '現代社会と数学',
    '人工知能活用実践',
    '人文社会入門'
  ];

  /**
   * アプリケーションの状態（State）
   */
  const state = {
    registeredClasses: JSON.parse(localStorage.getItem('myClasses')) || [],
    completedClasses: JSON.parse(localStorage.getItem('completedClasses')) || [],
    predefinedData: [],
    filterYear: 'すべて表示',
    filterQuarter: 'すべて表示',
    filterCategory: '分野',
    filterSearch: '',
    filterIntro: 'すべて表示'
  };


  /**
   * ロジック：単位数や統計の計算
   */
  const calculateCredits = (state) => {
    const allSelected = [...state.registeredClasses, ...state.completedClasses];
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
  const createClassItem = (cls, index, type) => {
    const li = document.createElement('li');
    li.className = 'class-item';

    li.innerHTML = `
      <div class="class-info">
        <strong>${cls.subject}${cls.category === '必修' || cls.category === '選択必修' ? `(${cls.category})` : ''}</strong>
      </div>
      <div class="actions">
        <button class="delete-btn" data-index="${index}">削除</button>
      </div>
    `;

    li.querySelector('.delete-btn').onclick = () => {
      if (type === 'registered') {
        state.registeredClasses.splice(index, 1);
      } else {
        state.completedClasses.splice(index, 1);
      }
      saveAndRender();
    };

    return li;
  };

  /**
   * データを保存して再描画する
   */
  const renderList = () => {
    list.innerHTML = '';
    completedList.innerHTML = '';

    const allSelected = [...state.registeredClasses, ...state.completedClasses];
    const stats = calculateCredits(state);
    const regCredits = sumCredits(state.registeredClasses);
    const earnedCredits = sumCredits(state.completedClasses);

    const completedIntro = allSelected.filter(c => introSubjects.includes(c.subject));
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

    state.registeredClasses.forEach((cls, index) => {
      list.appendChild(createClassItem(cls, index, 'registered'));
    });

    state.completedClasses.forEach((cls, index) => {
      completedList.appendChild(createClassItem(cls, index, 'completed'));
    });

    document.getElementById('earned-credits').textContent = earnedCredits;

    const topXEl = document.getElementById('top-earned-x');
    const topFillEl = document.getElementById('top-earned-fill');
    if (topXEl && topFillEl) {
      topXEl.textContent = stats.totalCredits;
      const pct = Math.max(0, Math.min(100, (stats.totalCredits / 124) * 100));
      topFillEl.style.width = pct + '%';
      topFillEl.style.background = pct >= 100 ? '#22c55e' : (pct >= 60 ? '#3b82f6' : '#ef4444');
    }

    document.getElementById('registered-count').textContent = state.registeredClasses.length;
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
                  ${introSubjects
                    .map(s => {
                      const has = allSelected.some(c => c.subject === s);
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

  const saveAndRender = () => {
    localStorage.setItem('myClasses', JSON.stringify(state.registeredClasses));
    localStorage.setItem('completedClasses', JSON.stringify(state.completedClasses));
    renderList();
    renderPredefinedList();
  };

  // 外部JSONから授業データを読み込む
  try {
    const response = await fetch('courses.json');
    if (!response.ok) throw new Error(`ファイルが見つかりません (${response.status})`);
    const data = await response.json();

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

    state.predefinedData = data;
  } catch (error) {
    console.error('データの読み込みに失敗しました:', error);
    alert('授業データの読み込みに失敗しました。VS Codeの Live Server などを使用して開いてください。');
  }

  const renderPredefinedList = () => {
    predefinedList.innerHTML = '';

    const filtered = state.predefinedData.filter(item => {
      const matchYear = state.filterYear === 'すべて表示' || item.year === state.filterYear;
      const matchQuarter = state.filterQuarter === 'すべて表示' || item.quarter.includes(state.filterQuarter);

      let matchCategory = state.filterCategory === '分野';
      if (!matchCategory) {
        if (state.filterCategory === '導入科目') {
          matchCategory = introSubjects.includes(item.subject);
        } else if (state.filterCategory === '多言語情報理解') {
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

      const isIntro = introSubjects.includes(item.subject);
      // プルダウンの値に関係なく「対象科目のみ強調表示」する（リスト自体は従来通り全件表示）
      const shouldHighlightIntro = state.filterIntro === '該当' && isIntro;
      const searchLower = state.filterSearch.toLowerCase();

      const matchSearch =
        item.subject.toLowerCase().includes(searchLower) ||
        item.teacher.toLowerCase().includes(searchLower) ||
        (item.tag && item.tag.toLowerCase().includes(searchLower.replace('#', '')));
      // 探索条件（年/学期/カテゴリ/検索）は従来通り適用し、導入科目は表示の強調だけに使用する
      return matchYear && matchQuarter && matchCategory && matchSearch;
    });



    filtered.forEach(data => {
      const isRegistered = state.registeredClasses.some(cls => cls.subject === data.subject);
      const isCompleted = state.completedClasses.some(cls => cls.subject === data.subject);
      const isHandled = isRegistered || isCompleted;

      const isIntro = introSubjects.includes(data.subject);
      const shouldHighlightIntro = state.filterIntro === '該当' && isIntro;

      // 非該当はハイライトしない（対象のみ強調表示）

      const li = document.createElement('li');

      li.className = 'predefined-item';
      li.innerHTML = `
        <div class="class-item ${isHandled ? 'added' : ''}${shouldHighlightIntro ? ' intro-highlight' : ''}">


          <div class="class-info">
            <strong>${data.subject}${data.category === '必修' || data.category === '選択必修' ? `(${data.category})` : ''}</strong>
          </div>
          <div class="actions">
            <button class="detail-btn">詳細</button>
            <button class="add-predefined" ${isHandled ? 'disabled' : ''}>追加</button>
            <button class="complete-predefined" ${isHandled ? 'disabled' : ''}>履修済み</button>
          </div>
        </div>
        <div class="class-detail">
          <small class="meta">${data.teacher} / ${data.year} / ${data.quarter} / ${data.credits}単位 [${data.category}] / ${data.method}${data.remarks ? ` / ${data.remarks}` : ''}${data.tag ? ` / #${data.tag}` : ''}</small>
          <p class="evaluation"><strong>評価方法:</strong> ${data.evaluation}</p>
          <p class="description">${data.description}</p>
          ${data.url ? `<a href="${data.url}" target="_blank" class="syllabus-link" title="ZEN大学シラバスサイトの該当ページを開きます">ZEN大学シラバスで詳細を確認</a>` : ''}
        </div>
      `;

      const detailBtn = li.querySelector('.detail-btn');
      const detailDiv = li.querySelector('.class-detail');
      detailBtn.onclick = () => detailDiv.classList.toggle('open');

      li.querySelector('.add-predefined').onclick = () => {
        if (isHandled) {
          alert('「' + data.subject + '」はすでに登録されています。');
          return;
        }
        state.registeredClasses.push(data);
        saveAndRender();
      };

      li.querySelector('.complete-predefined').onclick = () => {
        if (isHandled) {
          alert('「' + data.subject + '」はすでに登録されています。');
          return;
        }
        state.completedClasses.push(data);
        saveAndRender();
      };

      predefinedList.appendChild(li);
    });
  };

  const setupFilters = () => {
    // フィルターの選択肢を「分野」リストに書き換え
    const categoryFilter = document.getElementById('category-filter');
    if (categoryFilter) {
      const fields = [
        '分野',
        '導入科目',
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

    document.getElementById('year-filter').addEventListener('change', (e) => {
      state.filterYear = e.target.value;
      renderPredefinedList();
    });

    document.getElementById('quarter-filter').addEventListener('change', (e) => {
      state.filterQuarter = e.target.value;
      renderPredefinedList();
    });

    document.getElementById('category-filter').addEventListener('change', (e) => {
      state.filterCategory = e.target.value;
      renderPredefinedList();
    });

    document.getElementById('intro-filter').addEventListener('change', (e) => {
      state.filterIntro = e.target.value;
      renderPredefinedList();
    });


    document.getElementById('search-bar').addEventListener('input', (e) => {
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

    btn.onclick = () => (modal.style.display = 'block');
    closeSpan.onclick = () => (modal.style.display = 'none');

    modal.onclick = (event) => {
      if (event.target === modal) modal.style.display = 'none';
    };
  };

  setupFilters();
  setupAnalysisModal();
  renderPredefinedList();
  renderList();
});
