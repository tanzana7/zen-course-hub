/** 卒業要件の集計と内訳表示。判定自体はGraduationRequirementsEngineへ委譲する。
 * contextは共有状態と明示的なコールバックだけを受け取る。
 * コールバックは初期化完了後に呼び、コントローラー間でDOMや保存処理を複製しない。
 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubGraduation = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const getRequirementDetail = (details, key) => {
    const path = key.split('.');
    return path.reduce((value, segment) => value?.[segment], details);
  };

  const sumCredits = (classes) => classes.reduce((sum, cls) => sum + Number(cls.credits || 0), 0);

  const invalidGraduationResult = (details = []) => ({
    valid: false,
    message: '科目データを確認できないため、卒業要件を判定できません。',
    details,
  });

  const analyzeGraduation = (courseIds) => {
    if (context.state.courseValidationError)
      return invalidGraduationResult([context.state.courseValidationError]);
    if (!context.state.graduationDefinition || !window.GraduationRequirementsEngine) {
      return invalidGraduationResult(['卒業要件定義を読み込めませんでした。']);
    }
    return window.GraduationRequirementsEngine.analyzeGraduationRequirements(
      courseIds,
      context.state.predefinedData,
      context.state.graduationDefinition,
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
      socialCredits: analysis.totalCredits.socialActualCredits,
    };
  };

  const renderGraduationGauge = (stats, unavailableText = '判定不能') => {
    // Keep the analyzer optional during the bootstrap path: a minimal host DOM
    // (and the simulator's isolated test harness) may not expose querySelector.
    const valueElement =
      typeof document.querySelector === 'function'
        ? document.querySelector('.top-credit-gauge .gauge-value')
        : null;
    const fillElement = document.getElementById('top-earned-fill');
    if (!valueElement || !fillElement) return;

    const barElement = fillElement.parentElement;
    const targetCredits = context.state.graduationDefinition?.requirements?.totalCredits?.targetCredits;
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
      fillElement.style.background = pct >= 100 ? '#22c55e' : pct >= 60 ? '#3b82f6' : '#ef4444';
    }
  };

  const graduationStatus = (requirement, planned) => {
    if (requirement.satisfied) return planned ? '達成見込み' : '達成';
    return planned ? '不足' : '未達';
  };

  let homeGraduationDetailState = null;

  const renderHomeGraduationCourseList = (detailsElement) => {
    const key = detailsElement.dataset.homeGraduationKey;
    const target = detailsElement.querySelector('.graduation-course-breakdown-content');
    if (!key || !target || !homeGraduationDetailState) return;
    const category = key.startsWith('category:') ? key.slice('category:'.length) : null;
    const courseIds = category
      ? context.state.predefinedData
          .filter((course) => course.category === category)
          .map((course) => course.id)
      : getRequirementDetail(homeGraduationDetailState, key)?.targetCourseIds;
    if (!Array.isArray(courseIds)) return;
    target.replaceChildren();
    if (!courseIds.length) {
      const empty = document.createElement('p');
      empty.textContent = '対象科目はありません。';
      target.append(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'graduation-course-breakdown-list';
    for (const courseId of courseIds) {
      const course = context.state.coursesMap.get(courseId);
      if (!course) continue;
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = course.subject;
      const metadata = document.createElement('small');
      metadata.textContent = `${course.credits}単位 · ${course.category}`;
      const status = document.createElement('strong');
      status.textContent = context.state.completedClasses.has(courseId)
        ? '履修済み'
        : context.state.registeredClasses.has(courseId)
          ? '履修予定'
          : '未履修';
      item.append(name, metadata, status);
      list.append(item);
    }
    target.append(list);
  };

  const renderGraduationAnalysis = (
    completedAnalysis,
    plannedAnalysis,
    targetElement = null,
    options = {},
  ) => {
    const analysisResultElement = targetElement || document.getElementById('analysis-result');
    if (!analysisResultElement) return;
    const completedLabel = options.completedLabel || '修得済み';
    const completedDescription = options.completedDescription || '履修済みのみ';
    const plannedLabel = options.plannedLabel || '予定込み';
    const plannedDescription = options.plannedDescription || '履修済み＋履修予定';
    if (!targetElement) homeGraduationDetailState = null;
    if (!completedAnalysis.valid || !plannedAnalysis.valid) {
      analysisResultElement.innerHTML = `<div class="analysis-box graduation-analysis-error" role="alert">${context.escapeHTML(completedAnalysis.message || plannedAnalysis.message || '科目データを確認できないため、卒業要件を判定できません。')}</div>`;
      return;
    }

    // Keep the official analyzer as the single source for category membership.
    // The historical detail lists are restored only in the Hub modal; Simulator
    // retains its existing course-detail interaction and projected plan semantics.
    if (!targetElement) {
      const result = window.GraduationRequirementsEngine?.buildRequirementDetails?.(
        [...context.state.completedClasses, ...context.state.registeredClasses],
        context.state.predefinedData,
        context.state.graduationDefinition,
      );
      homeGraduationDetailState = result?.valid ? result.details : null;
    }

    const breakdown = (key, label, completedRequirement, plannedRequirement) => {
      if (!homeGraduationDetailState || targetElement) return '';
      const completedCredits = completedRequirement.credits ?? completedRequirement.countedCredits;
      const projectedCredits = plannedRequirement.credits ?? plannedRequirement.countedCredits;
      const plannedCredits = Math.max(0, projectedCredits - completedCredits);
      const targetCredits = plannedRequirement.targetCredits;
      const missingCredits = Math.max(0, targetCredits - projectedCredits);
      return `<details class="graduation-course-breakdown" data-home-graduation-key="${context.escapeHTML(key)}">
        <summary aria-label="${context.escapeHTML(label)}の対象科目を表示">対象科目・単位内訳</summary>
        <p class="graduation-breakdown-credits">必要 ${targetCredits}単位 · 修得済み ${completedCredits}単位 · 履修予定 ${plannedCredits}単位 · 不足 ${missingCredits}単位${plannedRequirement.satisfied ? '' : missingCredits === 0 ? ' · 内訳の要件が未達' : ''}</p>
        <div class="graduation-course-breakdown-content"></div>
      </details>`;
    };
    const categoryBreakdown = (category) => {
      if (!homeGraduationDetailState || targetElement) return '';
      const courses = context.state.predefinedData.filter((course) => course.category === category);
      const completedCredits = courses
        .filter((course) => context.state.completedClasses.has(course.id))
        .reduce((sum, course) => sum + course.credits, 0);
      const plannedCredits = courses
        .filter(
          (course) =>
            context.state.registeredClasses.has(course.id) && !context.state.completedClasses.has(course.id),
        )
        .reduce((sum, course) => sum + course.credits, 0);
      return `<details class="graduation-category-breakdown" data-home-graduation-key="category:${context.escapeHTML(category)}">
        <summary>${context.escapeHTML(category)}科目（${courses.length}科目）</summary>
        <p class="graduation-breakdown-credits">修得済み ${completedCredits}単位 · 履修予定 ${plannedCredits}単位 · 区分単独の必要単位設定なし</p>
        <div class="graduation-course-breakdown-content"></div>
      </details>`;
    };

    const ratio = (requirement, planned) => {
      const status = graduationStatus(requirement, planned);
      const statusClass = requirement.satisfied ? 'requirement-met' : 'requirement-remaining';
      return `<span class="requirement-progress"><span class="requirement-ratio">${requirement.credits ?? requirement.countedCredits} / ${requirement.targetCredits}単位</span> <span class="${statusClass}">${status}</span></span>`;
    };
    const interactiveRow = (label, key) =>
      options.interactive
        ? ` data-sim-graduation-detail="${context.escapeHTML(key)}" role="button" tabindex="0" aria-label="${context.escapeHTML(label)}の詳細を表示"`
        : '';
    const dual = (label, completedRequirement, plannedRequirement, key) => `
      <div class="graduation-requirement-row"${interactiveRow(label, key)}>
        <strong>${context.escapeHTML(label)}</strong>
        <span>${context.escapeHTML(completedLabel)} ${ratio(completedRequirement, false)}</span>
        <span>${context.escapeHTML(plannedLabel)} ${ratio(plannedRequirement, true)}</span>
      </div>${breakdown(key, label, completedRequirement, plannedRequirement)}`;
    const foundationGroups = completedAnalysis.foundation.groups
      .map((group, index) => {
        const plannedGroup = plannedAnalysis.foundation.groups[index];
        return dual(`基礎：${group.label}`, group, plannedGroup, `foundation.groups.${group.key}`);
      })
      .join('');

    const socialRow = `
      <div class="graduation-requirement-row graduation-social-row"${interactiveRow('社会接続', 'socialConnection')}>
        <strong>社会接続</strong>
        <span>${context.escapeHTML(completedLabel)}取得：${completedAnalysis.socialConnection.actualCredits}単位 / 算入：${completedAnalysis.socialConnection.countedCredits}単位</span>
        <span>${context.escapeHTML(plannedLabel)}取得：${plannedAnalysis.socialConnection.actualCredits}単位 / 算入：${plannedAnalysis.socialConnection.countedCredits}単位（上限${plannedAnalysis.socialConnection.capCredits}単位）</span>
      </div>${
        !targetElement && homeGraduationDetailState
          ? `<details class="graduation-course-breakdown" data-home-graduation-key="socialConnection">
        <summary aria-label="社会接続の対象科目を表示">対象科目・単位内訳</summary>
        <p class="graduation-breakdown-credits">修得済み ${completedAnalysis.socialConnection.actualCredits}単位 · 履修予定 ${Math.max(0, plannedAnalysis.socialConnection.actualCredits - completedAnalysis.socialConnection.actualCredits)}単位 · 卒業算入 ${plannedAnalysis.socialConnection.countedCredits}単位（上限${plannedAnalysis.socialConnection.capCredits}単位）</p>
        <div class="graduation-course-breakdown-content"></div>
      </details>`
          : ''
      }`;

    const projectCompleted = completedAnalysis.projectPractice;
    const projectPlanned = plannedAnalysis.projectPractice;
    const industryCompleted = completedAnalysis.worldUnderstanding.industryHistory;
    const industryPlanned = plannedAnalysis.worldUnderstanding.industryHistory;
    analysisResultElement.innerHTML = `
      <div class="analysis-box graduation-analysis" aria-describedby="graduation-analysis-note">
        <p class="graduation-analysis-legend"><strong>${context.escapeHTML(completedLabel)}</strong>は${context.escapeHTML(completedDescription)}、<strong>${context.escapeHTML(plannedLabel)}</strong>は${context.escapeHTML(plannedDescription)}です。</p>
        <div class="graduation-overall-status" aria-live="polite">
          ${context.escapeHTML(completedLabel)}：<strong>${completedAnalysis.satisfied ? '達成' : '未達'}</strong> ／
          ${context.escapeHTML(plannedLabel)}：<strong>${plannedAnalysis.satisfied ? '達成見込み' : '不足'}</strong>
        </div>
        ${categoryBreakdown('必修')}
        ${categoryBreakdown('選択必修')}
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
          <span>${context.escapeHTML(completedLabel)} ${ratio(industryCompleted, false)}</span>
          <span>${context.escapeHTML(plannedLabel)} ${ratio(industryPlanned, true)}</span>
        </div>
        ${breakdown('worldUnderstanding.industryHistory', '世界理解内：産業史系', industryCompleted, industryPlanned)}
        ${socialRow}
        ${dual('プロジェクト実践', projectCompleted, projectPlanned, 'projectPractice')}
        <p id="graduation-analysis-note" class="graduation-analysis-note">各要件は重複して充当される場合があるため、内訳の必要単位数を合計しないでください。</p>
      </div>
    `;
  };

  const setupAnalysisModal = () => {
    const modal = document.getElementById('analysis-modal');
    const btn = document.getElementById('analysis-btn');
    const closeButton = document.getElementById('close-modal');
    const analysisResult = document.getElementById('analysis-result');

    // Large categories (including the 124-credit total) are populated only
    // when opened, so normal list updates do not build hundreds of hidden rows.
    analysisResult?.addEventListener(
      'toggle',
      (event) => {
        const detail = event.target;
        if (detail instanceof HTMLDetailsElement && detail.open && detail.dataset.homeGraduationKey) {
          renderHomeGraduationCourseList(detail);
        }
      },
      true,
    );

    if (modal && closeButton) {
      // ×ボタンをモーダルの右上に常に固定し、コンテンツが伸びても隠れないように設定
      closeButton.style.position = 'sticky';
      closeButton.style.top = '0';
      closeButton.style.float = 'right';
      closeButton.style.zIndex = '1000';
      closeButton.style.backgroundColor = 'inherit'; // モーダルの背景色を継承して背後の文字を隠す

      const modalContent =
        typeof modal.querySelector === 'function' ? modal.querySelector('.modal-content') : null;
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
  return {
    getRequirementDetail,
    sumCredits,
    analyzeGraduation,
    calculateCredits,
    renderGraduationGauge,
    renderGraduationAnalysis,
    setupAnalysisModal,
  };
});
