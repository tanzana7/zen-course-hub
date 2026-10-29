/** 4年計画の表示・配置・ダイアログ操作。判定自体はSimulatorRulesへ委譲する。
 * contextは共有状態と明示的なコールバックだけを受け取る。
 * コールバックは初期化完了後に呼び、コントローラー間でDOMや保存処理を複製しない。
 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubSimulator = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const saveSimulatorPlan = (nextPlan) => {
    try {
      const result = context.simulatorRules.savePlanChange(
        localStorage,
        context.SIMULATOR_STORAGE_KEY,
        nextPlan,
      );
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
      showSimulatorFeedback(
        '計画を保存できませんでした。ストレージの設定や空き容量を確認してください。',
        true,
      );
      return false;
    }
    context.state.simulatorPlan = nextPlan;
    renderSimulator();
    return true;
  };

  const getQuarterInfo = context.simulatorRules?.getQuarterInfo;

  const getPlacementOption = (course, placement) => {
    return (
      context.simulatorRules
        .getPlacementOptions(course)
        .find((option) => option.start === Number(placement?.selectedQuarter)) || null
    );
  };

  const formatSimulatorPlacement = (course, placement) => {
    const option = getPlacementOption(course, placement);
    if (option) return `${placement.year}年${option.label}`;
    const quarter = Number(placement?.selectedQuarter);
    return `${placement?.year || ''}年${Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? `Q${quarter}` : 'Q不明'}（要修正）`;
  };

  const getSimulatorPlacement = (courseId) =>
    context.state.simulatorPlan.placements.find((placement) => placement.courseId === courseId);

  const getSimulatorWarnings = (course, placement) => {
    const prerequisites = context.state.relationsMap.get(course.id)?.prerequisites || [];
    return prerequisites
      .map((relation) => {
        const prerequisite = context.state.coursesMap.get(relation.id);
        if (!prerequisite) return null;
        const prerequisitePlacement = getSimulatorPlacement(prerequisite.id);
        const strengthLabel = relation.strength === 'strongly_recommended' ? '強く推奨' : '推奨';
        const strengthClass = relation.strength === 'strongly_recommended' ? 'strong' : 'recommended';

        // 通常画面で履修済みにした科目は、シミュレーター上では既に完了した前提科目として扱う。
        if (context.state.completedClasses.has(prerequisite.id)) return null;

        if (!prerequisitePlacement) {
          return {
            message: `前提科目「${prerequisite.subject}」が未配置です`,
            strengthLabel,
            strengthClass,
          };
        }

        if (
          context.simulatorRules.isPrerequisiteSatisfied(
            prerequisite,
            prerequisitePlacement,
            course,
            placement,
          )
        )
          return null;
        return {
          message: `前提科目「${prerequisite.subject}」を先に配置してください`,
          strengthLabel,
          strengthClass,
        };
      })
      .filter(Boolean);
  };

  const getSimulatorPlanWarnings = () =>
    context.state.simulatorPlan.placements.flatMap((placement) => {
      const course = context.state.coursesMap.get(placement.courseId);
      if (!course) return [];
      return getSimulatorWarnings(course, placement).map((warning) => ({
        course,
        placement,
        type: 'prerequisite',
        ...warning,
      }));
    });

  const getSimulatorPlacementIssues = () =>
    context.state.simulatorPlan.placements.flatMap((placement) => {
      const course = context.state.coursesMap.get(placement.courseId);
      if (!course) return [];
      return context.simulatorRules
        .getPlacementIssues(course, placement)
        .map((issue) => ({ course, placement, ...issue }));
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
      ...prerequisiteWarnings.map((warning) => ({ ...warning, strengthText: warning.strengthLabel })),
    ];
    details.innerHTML = checkItems.length
      ? `<ul>${checkItems
          .map(
            (warning) => `
          <li class="simulator-check-${context.escapeHTML(warning.type)}" data-sim-warning-course="${context.escapeHTML(warning.course.id)}">
            <strong>${context.escapeHTML(warning.course.subject)}</strong>
            <span>${context.escapeHTML(warning.message)}（${context.escapeHTML(warning.strengthText)}）</span>
          </li>
        `,
          )
          .join('')}</ul>`
      : '<p>計画上の注意はありません</p>';
  };

  const { renderSimulatorGraduationCourseDetail, renderSimulatorGraduationProjection } =
    window.ZenSimulatorGraduation.create({
      get escapeHTML() {
        return context.escapeHTML;
      },
      get state() {
        return context.state;
      },
      get getRequirementDetail() {
        return context.getRequirementDetail;
      },
      get simulatorAvailable() {
        return context.simulatorAvailable;
      },
      get simulatorRules() {
        return context.simulatorRules;
      },
      get analyzeGraduation() {
        return context.analyzeGraduation;
      },
      get renderGraduationAnalysis() {
        return context.renderGraduationAnalysis;
      },
    });

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

  const { setupSimulatorModal } = window.ZenSimulatorDialogs.create({
    get state() {
      return context.state;
    },
    get simulatorRules() {
      return context.simulatorRules;
    },
    get escapeHTML() {
      return context.escapeHTML;
    },
    get simulatorAvailable() {
      return context.simulatorAvailable;
    },
    get syncPrimaryViewNavigation() {
      return context.syncPrimaryViewNavigation;
    },
    get commitSimulatorPlan() {
      return commitSimulatorPlan;
    },
    get formatSimulatorPlacement() {
      return formatSimulatorPlacement;
    },
    get getSimulatorPlacement() {
      return getSimulatorPlacement;
    },
    get getSimulatorWarnings() {
      return getSimulatorWarnings;
    },
    get renderSimulatorGraduationCourseDetail() {
      return renderSimulatorGraduationCourseDetail;
    },
    get showSimulatorFeedback() {
      return showSimulatorFeedback;
    },
    get renderSimulatorCourseResults() {
      return renderSimulatorCourseResults;
    },
    get clearSimulatorDropHighlights() {
      return clearSimulatorDropHighlights;
    },
    get highlightSimulatorDropCells() {
      return highlightSimulatorDropCells;
    },
    get resolveSimulatorDropCell() {
      return resolveSimulatorDropCell;
    },
    get renderSimulator() {
      return renderSimulator;
    },
    get placeSimulatorCourse() {
      return placeSimulatorCourse;
    },
    get removeSimulatorCourse() {
      return removeSimulatorCourse;
    },
  });

  const renderSimulatorCourseResults = () => {
    const results = document.getElementById('sim-course-results');
    if (!results) return;

    const searchInput = document.getElementById('sim-course-search');
    const yearFilter = document.getElementById('sim-course-year-filter');
    const quarterFilter = document.getElementById('sim-course-quarter-filter');
    const categoryFilter = document.getElementById('sim-course-category-filter');
    const placementFilter = document.getElementById('sim-course-placement-filter');
    const query = String(searchInput?.value || '')
      .trim()
      .toLowerCase();
    const selectedYear = yearFilter?.value || 'すべて表示';
    const selectedQuarter = quarterFilter?.value || 'すべて表示';
    const selectedCategory = categoryFilter?.value || 'すべて表示';
    const selectedPlacement = placementFilter?.value || context.state.simulatorPlacementFilter;

    let matches = context.state.predefinedData.filter((course) => {
      if (
        context.state.simulatorPaletteMode === 'scheduled' &&
        !context.state.registeredClasses.has(course.id)
      )
        return false;
      const isPlaced = Boolean(getSimulatorPlacement(course.id));
      if (selectedPlacement === 'placed' && !isPlaced) return false;
      if (selectedPlacement === 'unplaced' && isPlaced) return false;
      const subject = String(course.subject || '').toLowerCase();
      const teacher = String(course.teacher || '').toLowerCase();
      const matchSearch = !query || subject.includes(query) || teacher.includes(query);
      const matchYear = selectedYear === 'すべて表示' || course.year === selectedYear;
      const quarterNumber = Number.parseInt(String(selectedQuarter).replace(/[^0-9]/g, ''), 10);
      const matchQuarter =
        selectedQuarter === 'すべて表示' || getQuarterInfo(course).quarters.includes(quarterNumber);
      const matchCategory = selectedCategory === 'すべて表示' || course.tag === selectedCategory;
      return matchSearch && matchYear && matchQuarter && matchCategory;
    });

    matches = context.sortCourses(matches, context.state.difficultySort, context.state.difficultyMap);

    if (!matches.length) {
      const message =
        context.state.simulatorPaletteMode === 'scheduled'
          ? '履修予定の科目はありません。'
          : '該当する科目がありません。';
      results.innerHTML = `<p class="simulator-empty">${message}</p>`;
      return;
    }

    results.innerHTML = matches
      .map((course) => {
        const placement = getSimulatorPlacement(course.id);
        const difficulty = context.state.difficultyMap.get(course.id);
        const placementText = placement
          ? `✓ ${formatSimulatorPlacement(course, placement)}に配置済み`
          : '未配置';
        const difficultyText = difficulty
          ? `難易度 ${difficulty.average.toFixed(2)} / 10.0`
          : '難易度 未登録';
        const placedClass = placement ? ' is-placed' : '';
        return `
        <article class="sim-course-picker-item${placedClass}" draggable="${placement ? 'false' : 'true'}" data-sim-drag-course="${context.escapeHTML(course.id)}">
          <div class="sim-course-picker-info">
            <button type="button" class="sim-course-detail-trigger" data-sim-detail-course="${context.escapeHTML(course.id)}">${context.escapeHTML(course.subject)}</button>
            <span>${context.escapeHTML(course.quarter || 'Q未定')} ｜ ${context.escapeHTML(String(course.credits || 0))}単位</span>
            <small>${context.escapeHTML(difficultyText)} ｜ ${context.escapeHTML(placementText)}</small>
          </div>
          <div class="sim-course-placement-controls">
            <button type="button" class="sim-course-placement-open" data-sim-placement-course="${context.escapeHTML(course.id)}" aria-label="${context.escapeHTML(course.subject)}を${placement ? '別の場所へ移動' : '配置'}">${placement ? '配置先を変更' : '配置'}</button>
          </div>
        </article>
      `;
      })
      .join('');
  };

  const clearSimulatorDropHighlights = () => {
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      cell.classList.remove('is-drop-allowed', 'is-drop-forbidden', 'is-drop-active');
    });
  };

  const highlightSimulatorDropCells = (courseId) => {
    const course = context.state.coursesMap.get(courseId);
    document.querySelectorAll('#simulator-year-grid [data-sim-drop-quarter]').forEach((cell) => {
      const quarter = Number(cell.dataset.simDropQuarter);
      const allowed = context.simulatorRules.canPlaceCourseAt(course, 1, quarter);
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
    const getCourse = (id) => context.state.coursesMap.get(id);
    const yearPlacements = new Map(years.map((year) => [year, []]));
    context.state.simulatorPlan.placements.forEach((placement) => {
      if (yearPlacements.has(placement.year) && getCourse(placement.courseId))
        yearPlacements.get(placement.year).push(placement);
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
        const start =
          option?.start ||
          (Number.isInteger(savedQuarter) && savedQuarter >= 1 && savedQuarter <= 4 ? savedQuarter : 1);
        const end = option?.end || start;
        const span = end - start + 1;
        let lane = 0;
        while (lanes[lane]?.some((interval) => start <= interval.end && start + span - 1 >= interval.start))
          lane += 1;
        if (!lanes[lane]) lanes[lane] = [];
        lanes[lane].push({ start, end: start + span - 1 });
        assignments.set(placement.courseId, { lane, start, span, invalidQuarter: !option });
      });
      return { laneCount: lanes.length, assignments };
    };
    const laneDataByYear = new Map(years.map((year) => [year, buildYearLaneData(yearPlacements.get(year))]));
    const quarterCreditsByYear = new Map(
      years.map((year) => [
        year,
        new Map([
          [1, 0],
          [2, 0],
          [3, 0],
          [4, 0],
        ]),
      ]),
    );
    context.state.simulatorPlan.placements.forEach((placement) => {
      const course = getCourse(placement.courseId);
      const quarterCredits = quarterCreditsByYear.get(placement.year);
      const savedQuarter = Number(placement.selectedQuarter);
      if (
        !course ||
        !quarterCredits ||
        !Number.isInteger(savedQuarter) ||
        savedQuarter < 1 ||
        savedQuarter > 4
      )
        return;
      // Span科目の単位は開始Qに一度だけ集計し、Q合計の二重計上を避ける。
      quarterCredits.set(savedQuarter, quarterCredits.get(savedQuarter) + Number(course.credits || 0));
    });

    const totalCredits = context.state.simulatorPlan.placements
      .map((placement) => getCourse(placement.courseId))
      .filter(Boolean)
      .reduce((sum, course) => sum + Number(course.credits || 0), 0);
    totalSummary.innerHTML = `<span>総予定単位</span><strong>${totalCredits}単位</strong>`;
    summary.innerHTML = `
      <div><strong>4年間の総予定単位</strong><span>${totalCredits}単位</span></div>
      ${years.map((year) => `<div><strong>${year}年</strong><span>${yearPlacements.get(year).reduce((sum, placement) => sum + Number(getCourse(placement.courseId)?.credits || 0), 0)}単位</span></div>`).join('')}
    `;

    yearGrid.innerHTML = years
      .map((year) => {
        const laneCount = laneDataByYear.get(year).laneCount;
        // Keep a short but usable card area for empty years, then grow only when
        // lane allocation requires it.  The same template is used by the quarter
        // cells and the card layer so every Q in a year remains equal height.
        const rowTemplate = laneCount
          ? `24px repeat(${laneCount}, minmax(34px, auto))`
          : '24px minmax(34px, auto)';
        return `
      <div class="simulator-year-row" data-sim-year="${year}">
        <div class="simulator-year-label"><strong>${year}年</strong><span>${yearPlacements.get(year).reduce((sum, placement) => sum + Number(getCourse(placement.courseId)?.credits || 0), 0)}単位</span></div>
        <div class="simulator-quarter-grid" style="grid-template-rows: ${rowTemplate};">
          ${[1, 2, 3, 4].map((quarter) => `<div class="simulator-quarter-cell" style="grid-column: ${quarter}; grid-row: 1 / -1;" data-sim-drop-year="${year}" data-sim-drop-quarter="${quarter}"><span class="simulator-quarter-header"><strong>${quarter}Q</strong><small>${quarterCreditsByYear.get(year).get(quarter)}単位</small></span></div>`).join('')}
          <div class="simulator-quarter-card-layer" style="grid-column: 1 / -1; grid-row: 1 / -1; grid-template-rows: ${rowTemplate};" aria-label="${year}年の配置済み科目"></div>
        </div>
      </div>
    `;
      })
      .join('');

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
        const placementIssues = context.simulatorRules.getPlacementIssues(course, placement);
        const warningTooltip = [
          ...placementIssues.map((issue) => issue.message),
          ...warnings.map((warning) => `${warning.message}（${warning.strengthLabel}）`),
        ].join(' / ');
        const warningClass =
          placementIssues.some((issue) => issue.type === 'quarter') ||
          warnings.some((warning) => warning.strengthClass === 'strong')
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
          <button type="button" class="sim-course-card-title" data-sim-detail-course="${context.escapeHTML(course.id)}">${context.escapeHTML(course.subject)}</button>
          <span class="sim-course-credits">${context.escapeHTML(String(course.credits || 0))}単位</span>
          ${quarterIssue ? `<span class="sim-course-quarter-warning" title="${context.escapeHTML(quarterIssue.message)}">要修正 · ${context.escapeHTML(quarterIssue.message)}</span>` : ''}
          <div class="sim-course-card-actions">
            ${warnings.length || placementIssues.length ? `<button type="button" class="sim-warning-badge${warningClass}" data-sim-warning-course="${context.escapeHTML(course.id)}" aria-label="配置・前提の注意を確認">⚠</button>` : ''}
            <button type="button" class="sim-course-detail-view" data-sim-detail-course="${context.escapeHTML(course.id)}" aria-label="${context.escapeHTML(course.subject)}の詳細を見る" title="科目詳細を見る">👁</button>
            <button type="button" class="sim-course-remove" data-sim-remove-course="${context.escapeHTML(course.id)}" aria-label="${context.escapeHTML(course.subject)}を削除">×</button>
          </div>
        `;
        cardLayer.appendChild(card);
      });
    });

    // A missing catalog entry may return in a later data release. Keep it out of
    // Q/credit calculations, but make the saved ID visible and removable by choice.
    if (unknownHost) {
      const unknownPlacements = context.state.simulatorPlan.placements.filter(
        (placement) => !getCourse(placement.courseId),
      );
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
          const savedQuarter =
            Number.isInteger(quarter) && quarter >= 1 && quarter <= 4 ? `${quarter}Q` : 'Q不明';
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
      const categories = [
        ...new Set(context.state.predefinedData.map((course) => course.tag).filter(Boolean)),
      ].sort((a, b) => a.localeCompare(b, 'ja'));
      const currentCategory = categoryFilter.value;
      categoryFilter.innerHTML =
        '<option value="すべて表示">分野</option>' +
        categories
          .map(
            (category) =>
              `<option value="${context.escapeHTML(category)}">${context.escapeHTML(category)}</option>`,
          )
          .join('');
      categoryFilter.value = categories.includes(currentCategory) ? currentCategory : 'すべて表示';
    }

    if (!context.state.simulatorPaletteDefaulted) {
      context.state.simulatorPaletteMode = [...context.state.registeredClasses].some((courseId) =>
        context.state.coursesMap.has(courseId),
      )
        ? 'scheduled'
        : 'all';
      context.state.simulatorPaletteDefaulted = true;
    }
    document.querySelectorAll('[data-sim-palette-mode]').forEach((tab) => {
      const active =
        (tab.dataset.simPaletteMode === 'scheduled' ? 'scheduled' : 'all') ===
        context.state.simulatorPaletteMode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    renderSimulatorCourseResults();
    renderSimulatorPlanCheck();
    renderSimulatorGraduationProjection();
  };

  const placeSimulatorCourse = (courseId, year, selectedQuarter) => {
    const course = context.state.coursesMap.get(courseId);
    const result = context.simulatorRules.applyPlacement(
      context.state.simulatorPlan.placements,
      course,
      year,
      selectedQuarter,
    );
    if (!result.allowed) {
      if (result.reason === 'not-offered' && course) {
        showSimulatorFeedback(
          `この科目はQ${selectedQuarter}には開講されていません。計画は変更していません。`,
        );
      }
      return false;
    }
    return commitSimulatorPlan({ ...context.state.simulatorPlan, placements: result.placements });
  };

  const removeSimulatorCourse = (courseId) => {
    const placements = context.state.simulatorPlan.placements.filter(
      (placement) => placement.courseId !== courseId,
    );
    return commitSimulatorPlan({ ...context.state.simulatorPlan, placements });
  };

  return {
    renderSimulatorGraduationProjection,
    renderSimulatorCourseResults,
    renderSimulator,
    setupSimulatorModal,
  };
});
