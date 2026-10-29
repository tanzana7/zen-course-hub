/** 4年計画の卒業要件見通しと内訳表示。実績と予定を混同しない。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenSimulatorGraduation = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
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
    projectPractice: 'プロジェクト実践',
  };

  const renderCourseLinks = (courseIds, emptyLabel, { collapsible = false, summary = '一覧を表示' } = {}) => {
    if (!courseIds.length)
      return `<p class="simulator-graduation-course-empty">${context.escapeHTML(emptyLabel)}</p>`;
    const list = `<ul>${courseIds
      .map((courseId) => {
        const course = context.state.coursesMap.get(courseId);
        if (!course) return '';
        return `<li><button type="button" class="simulator-graduation-course-link" data-sim-detail-course="${context.escapeHTML(course.id)}">${context.escapeHTML(course.subject)}</button></li>`;
      })
      .join('')}</ul>`;
    return collapsible ? `<details><summary>${context.escapeHTML(summary)}</summary>${list}</details>` : list;
  };

  const renderSimulatorGraduationCourseDetail = (key) => {
    const panel = document.getElementById('simulator-graduation-course-detail');
    const detailState = simulatorGraduationDetailState;
    const label = simulatorGraduationDetailLabels[key];
    if (!panel || !detailState || !label) return;
    const current = context.getRequirementDetail(detailState.current, key);
    const projected = context.getRequirementDetail(detailState.projected, key);
    if (!current || !projected) return;
    const missing = projected.targetCourseIds.filter(
      (courseId) => !projected.selectedCourseIds.includes(courseId),
    );
    panel.hidden = false;
    panel.innerHTML = `
      <div class="simulator-graduation-course-detail-head">
        <h3>${context.escapeHTML(label)}</h3>
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
    if (!summary || !details || !context.simulatorAvailable) return;

    const knownCourseIds = new Set(context.state.coursesMap.keys());
    const placements = context.state.simulatorPlan.placements;
    const unknownIds = context.simulatorRules.getUnknownSimulatorCourseIds(placements, knownCourseIds);
    const currentIds = [...context.state.completedClasses];
    const projectedIds = context.simulatorRules.buildGraduationProjectionCourseIds(
      currentIds,
      placements,
      knownCourseIds,
    );
    const currentAnalysis = context.analyzeGraduation(currentIds);
    const projectedAnalysis = context.analyzeGraduation(projectedIds);

    if (unknownNotice) {
      unknownNotice.hidden = unknownIds.length === 0;
      unknownNotice.textContent = unknownIds.length
        ? '計画内に確認が必要な科目があります。この科目は卒業要件の見込み計算には含まれていません。'
        : '';
    }

    const engine = window.GraduationRequirementsEngine;
    const currentDetailResult = engine?.buildRequirementDetails?.(
      currentIds,
      context.state.predefinedData,
      context.state.graduationDefinition,
    );
    const projectedDetailResult = engine?.buildRequirementDetails?.(
      projectedIds,
      context.state.predefinedData,
      context.state.graduationDefinition,
    );
    simulatorGraduationDetailState =
      currentDetailResult?.valid && projectedDetailResult?.valid
        ? { current: currentDetailResult.details, projected: projectedDetailResult.details }
        : null;
    const courseDetailPanel = document.getElementById('simulator-graduation-course-detail');
    if (courseDetailPanel) {
      courseDetailPanel.hidden = true;
      courseDetailPanel.innerHTML = '';
    }

    if (!currentAnalysis.valid || !projectedAnalysis.valid || !simulatorGraduationDetailState) {
      summary.innerHTML =
        '<div class="simulator-graduation-unavailable" role="alert"><strong>卒業見込み：判定不能</strong><span>卒業要件データを確認できないため、計画表示はそのまま利用できます。</span></div>';
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
    context.renderGraduationAnalysis(currentAnalysis, projectedAnalysis, details, {
      completedLabel: '現在',
      completedDescription: '実際に修得済みの科目のみ',
      plannedLabel: '4年計画完了時',
      plannedDescription: '修得済み＋シミュレーター計画',
      interactive: true,
    });
  };
  return { renderSimulatorGraduationCourseDetail, renderSimulatorGraduationProjection };
});
