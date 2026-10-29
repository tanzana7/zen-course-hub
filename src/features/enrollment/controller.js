/** 履修状態の遷移と一覧表示。保存成功後にのみ再描画を依頼する。
 * contextは共有状態と明示的なコールバックだけを受け取る。
 * コールバックは初期化完了後に呼び、コントローラー間でDOMや保存処理を複製しない。
 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubEnrollment = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  if (typeof context.enrollmentRules?.transition !== 'function') {
    throw new TypeError('履修状態の判定モジュールを確認できません');
  }
  const updateStorageWarning = () => {
    if (!context.storageWarning) return;
    const unknownIds = new Set(
      [...context.state.registeredClasses, ...context.state.completedClasses].filter(
        (id) => context.state.coursesMap.size > 0 && !context.state.coursesMap.has(id),
      ),
    );
    const hasStorageIssue = context.state.storageIssues.length > 0 || !context.state.storageWritable;
    if (hasStorageIssue || unknownIds.size > 0) {
      const messages = [];
      if (hasStorageIssue)
        messages.push('保存データを安全に更新できないため、履修状態の変更を一時停止しています。');
      if (unknownIds.size > 0)
        messages.push(`${unknownIds.size}件の保存済み科目は現在の授業データにないため保持しています。`);
      context.storageWarning.textContent = messages.join(' ');
      context.storageWarning.hidden = false;
      return;
    }
    context.storageWarning.textContent = '';
    context.storageWarning.hidden = true;
  };

  const showStorageWarning = (message) => {
    if (!context.storageWarning) return;
    context.storageWarning.textContent = message;
    context.storageWarning.hidden = false;
  };

  /**
   * 状態変更のコミット（追加・削除・移動をここで一括管理）
   * @param {string} id - 科目ID
   * @param {'REGISTER'|'COMPLETE'|'DELETE'} action - アクション
   */
  const commitStateChange = (id, action) => {
    const next = context.enrollmentRules.transition(context.state, id, action);
    if (!next) return false;
    const { registeredClasses: nextRegistered, completedClasses: nextCompleted } = next;
    const result = saveState(nextRegistered, nextCompleted);
    if (!result.saved) {
      showStorageWarning(
        result.rollbackSucceeded === false
          ? '履修データの保存状態を確認できません。再読み込みして確認してください。'
          : '履修データを保存できませんでした。変更は確定していません。',
      );
      return false;
    }
    context.state.registeredClasses = nextRegistered;
    context.state.completedClasses = nextCompleted;
    context.renderAll();
    return true;
  };

  /**
   * データの整合性チェックとクリーンアップ。
   * 未知IDは、後から科目データが追加された場合に復元できるよう保存したままにする。
   */
  const cleanupState = () => {
    // 排他制御の再確認
    context.state.registeredClasses.forEach((id) => context.state.completedClasses.delete(id));
    updateStorageWarning();
  };

  const saveState = (
    registeredClasses = context.state.registeredClasses,
    completedClasses = context.state.completedClasses,
  ) => {
    if (!context.state.storageWritable) {
      return {
        saved: false,
        rollbackSucceeded: true,
        error: new Error('保存対象のストレージデータを安全に移行できません'),
      };
    }
    const result = context.qualityUtils.saveEnrollmentState(
      context.enrollmentStorageBackend,
      {
        registered: context.STORAGE_KEYS.REGISTERED,
        completed: context.STORAGE_KEYS.COMPLETED,
        schemaVersion: context.STORAGE_KEYS.SCHEMA_VERSION,
      },
      registeredClasses,
      completedClasses,
    );
    if (!result.saved && result.rollbackSucceeded === false) context.state.storageWritable = false;
    return result;
  };

  const createClassItem = (cls) => {
    const li = document.createElement('li');
    li.className = 'class-item';

    li.innerHTML = `
      <div class="class-info">
        <strong>${context.escapeHTML(cls.subject)}</strong>
        <div class="class-meta">
          ${cls.category === '必修' || cls.category === '選択必修' ? `<span class="badge required">${context.escapeHTML(cls.category)}</span>` : ''}
          ${cls.year ? `<span class="badge">${context.escapeHTML(cls.year)}</span>` : ''}
          ${
            cls.quarter
              ? cls.quarter
                  .replace(/\s*([〜～ー－–—-])\s*/g, '$1')
                  .split(/[・,、，\s]+/)
                  .filter(Boolean)
                  .map((q) => `<span class="badge">${context.escapeHTML(q)}</span>`)
                  .join('')
              : ''
          }
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

  const renderList = () => {
    window.ZenExam?.renderEnrollment([...context.state.registeredClasses, ...context.state.completedClasses]);
    context.list.innerHTML = '';
    context.completedList.innerHTML = '';

    // IDからオブジェクトを復元
    const regObjects = Array.from(context.state.registeredClasses)
      .map((id) => context.state.coursesMap.get(id))
      .filter(Boolean);
    const compObjects = Array.from(context.state.completedClasses)
      .map((id) => context.state.coursesMap.get(id))
      .filter(Boolean);
    // 空の一覧でも次の操作が分かるように、データがない状態を明示する。
    if (!regObjects.length) {
      context.list.innerHTML =
        '<li class="enrollment-empty-state">履修予定はありません。授業を探して追加できます。</li>';
    }
    if (!compObjects.length) {
      context.completedList.innerHTML =
        '<li class="enrollment-empty-state">履修済みの科目はありません。</li>';
    }

    const stats = context.calculateCredits(context.state);
    const regCredits = context.sumCredits(regObjects);
    const earnedCredits = context.sumCredits(compObjects);

    // 修得済みと履修予定込みを同じ純粋な判定器へ渡し、表示上も混同しないようにする。
    const completedAnalysis = context.analyzeGraduation([...context.state.completedClasses]);
    const plannedAnalysis = context.analyzeGraduation([
      ...context.state.completedClasses,
      ...context.state.registeredClasses,
    ]);

    regObjects.forEach((cls) => context.list.appendChild(createClassItem(cls)));
    compObjects.forEach((cls) => context.completedList.appendChild(createClassItem(cls)));
    document.getElementById('earned-credits').textContent = earnedCredits;
    // Unknown IDs are retained for recovery but are not counted as visible courses.
    document.getElementById('registered-count').textContent = regObjects.length;
    document.getElementById('registered-credits').textContent = regCredits;
    const mobileEnrollmentToggle = document.getElementById('curriculum-mobile-enrollment-toggle');
    if (mobileEnrollmentToggle) {
      mobileEnrollmentToggle.textContent = `通常履修 ${regObjects.length}科目 / ${regCredits}単位`;
    }

    context.renderGraduationGauge(stats);

    context.renderGraduationAnalysis(completedAnalysis, plannedAnalysis);
    context.renderSimulatorGraduationProjection();
    return;
  };
  return { updateStorageWarning, commitStateChange, cleanupState, renderList };
});
