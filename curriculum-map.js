/* Standalone map: camera coordinates are independent of document scrolling. */
(function exposeMap(root, factory) {
  const geometry =
    typeof module !== 'undefined' && module.exports
      ? require('./src/features/map/geometry.js')
      : root.ZenMapLayout;
  const api = factory(geometry);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root?.document) {
    root.CurriculumMapGeometry = api;
    root.document.addEventListener('DOMContentLoaded', () =>
      api.start(root).catch((error) => {
        console.error('カリキュラムマップを起動できませんでした:', error);
        const message = root.document.getElementById('map-loading-message');
        if (message) message.textContent = '読み込めませんでした。ページを再読み込みしてください。';
        root.document.getElementById('map-app').hidden = true;
        root.document.getElementById('map-unavailable').hidden = false;
      }),
    );
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, (geometry) => {
  const { CARD_PITCH_Y, intersects, buildLayout, zoomAt, centerOn, initialCamera, fitMap } = geometry;

  async function start(win) {
    const examReady = win.ZenExam.ready;
    const doc = win.document;
    if (!win.CurriculumAccess?.canAccess(win.location)) {
      doc.getElementById('map-loading-message').textContent = '現在は公開準備中です。';
      return;
    }
    const utils = win.ZenQualityUtils;
    if (!utils) throw new Error('保存ユーティリティを読み込めません');
    const keys = {
      registered: 'myClasses',
      completed: 'completedClasses',
      schemaVersion: 'zenCourseHubStorageSchemaVersion',
    };
    const storage = (() => {
      try {
        return win.localStorage;
      } catch (error) {
        return {
          getItem: () => {
            throw error;
          },
        };
      }
    })();
    const fetchJSON = async (file) => {
      const response = await win.fetch(file);
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return response.json();
    };
    const [courses, definition] = await Promise.all([
      fetchJSON('courses.json'),
      fetchJSON('curriculum-tree-layout.json'),
    ]);
    const catalog = new Map(courses.map((course) => [course.id, course]));
    const layout = buildLayout(definition, courses);
    const positions = new Map(layout.positions.map((box) => [box.id, box]));
    let enrollment = utils.readEnrollmentState(storage, keys);
    let selectedId = '';
    let drawerMode = '';
    let lastFocus = null;
    let relations = [];
    let difficulty = {};
    // 参考関係線の初期値は「選択科目のみ」。科目を選ぶとその前提・後継だけが現れる。
    // 全体表示（all）とOFFはメニューから従来どおり選べる。
    let relationMode = 'selected';
    let statusTimer;
    let cameraFrame;
    let camera = { scale: 1, x: 0, y: 0 };
    const viewport = doc.getElementById('map-viewport');
    const world = doc.getElementById('map-world');
    const drawer = doc.getElementById('map-drawer');
    const drawerContent = doc.getElementById('map-drawer-content');
    const nodes = new Map();
    const size = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
    const element = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text !== undefined) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    // 教員が多い科目（6名以上）は先頭5名＋他N名に折りたたみ、「すべて表示」で
    // 展開する。ホーム詳細と同じ挙動。データ自体は変えない。
    const TEACHER_COLLAPSE_LIMIT = 6;
    const TEACHER_PREVIEW_COUNT = 5;
    const renderTeacherCell = (teacherText) => {
      const parts = String(teacherText || '')
        .split(', ')
        .filter(Boolean);
      if (parts.length === 0) return element('dd', '―');
      if (parts.length < TEACHER_COLLAPSE_LIMIT) {
        return element('dd', parts.length > 1 ? `${parts[0]} 他${parts.length - 1}名` : parts[0]);
      }
      const cell = element('dd');
      const line = element('span', undefined, 'teacher-line');
      const preview = element(
        'span',
        `${parts.slice(0, TEACHER_PREVIEW_COUNT).join('、')}… 他${parts.length - TEACHER_PREVIEW_COUNT}名`,
        'teacher-preview',
      );
      const expand = element('button', 'すべて表示', 'teacher-expand-btn');
      expand.type = 'button';
      const full = element('span', undefined, 'teacher-full');
      full.hidden = true;
      full.append(element('span', parts.join('、')));
      const collapse = element('button', '折りたたむ', 'teacher-collapse-btn');
      collapse.type = 'button';
      full.append(collapse);
      expand.addEventListener('click', () => {
        preview.hidden = true;
        expand.hidden = true;
        full.hidden = false;
      });
      collapse.addEventListener('click', () => {
        preview.hidden = false;
        expand.hidden = false;
        full.hidden = true;
      });
      line.append(preview, expand, full);
      cell.append(line);
      return cell;
    };
    const status = (text, persistent = false) => {
      clearTimeout(statusTimer);
      const node = doc.getElementById('map-status');
      node.textContent = text;
      node.hidden = !text;
      if (!persistent)
        statusTimer = win.setTimeout(() => {
          node.hidden = true;
        }, 4000);
    };
    // Deletion gets the same undo affordance as the Hub list: a 5s toast that
    // restores both lists exactly, including the saved localStorage values.
    let undoToastTimer;
    const hideUndoToast = () => {
      clearTimeout(undoToastTimer);
      undoToastTimer = undefined;
      doc.getElementById('map-undo-toast')?.remove();
    };
    const showUndoToast = (message, onUndo) => {
      hideUndoToast();
      const toast = element('div', undefined, 'undo-toast');
      toast.id = 'map-undo-toast';
      toast.setAttribute('role', 'status');
      const text = element('span', message);
      const undoButton = element('button', '元に戻す', 'undo-toast-button');
      undoButton.type = 'button';
      undoButton.addEventListener('click', () => {
        hideUndoToast();
        onUndo();
      });
      toast.append(text, undoButton);
      doc.body.append(toast);
      undoButton.focus();
      undoToastTimer = win.setTimeout(hideUndoToast, 5000);
    };
    const applyCamera = () => {
      if (cameraFrame) return;
      cameraFrame = win.requestAnimationFrame(() => {
        cameraFrame = null;
        world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
        doc.getElementById('map-zoom-value').textContent = `${Math.round(camera.scale * 100)}%`;
        // The viewport center is the navigation context so the label follows
        // the central map area on both desktop and phone layouts.
        const center = {
          x: (size().width / 2 - camera.x) / camera.scale,
          y: (size().height / 2 - camera.y) / camera.scale,
        };
        const year = layout.years.find(
          (region) => center.y >= region.y && center.y < region.y + region.height,
        );
        const field = layout.fields.find(
          (region) => center.x >= region.x && center.x < region.x + region.width,
        );
        doc.getElementById('map-location').textContent =
          center.y < layout.introHeight
            ? '導入科目'
            : center.y >= layout.projectY
              ? '卒業プロジェクト'
              : year
                ? `${year.year}年次 · ${field?.field || '分野を選択'}`
                : 'カリキュラムマップ';
      });
    };
    const focusCourse = (id) => {
      const box = positions.get(id);
      if (!box) return;
      camera = centerOn(box, size(), 1);
      applyCamera();
      selectedId = id;
      updateNodes();
    };
    const currentYear = () => {
      const centerY = (size().height / 2 - camera.y) / camera.scale;
      return layout.years.find((year) => centerY >= year.y && centerY < year.y + year.height)?.year || 1;
    };
    const regionCamera = (year, field) => ({
      scale: 1,
      // On desktop center the selected field so its location label matches
      // the view. On phones keep the first card near the left edge because a
      // full field is wider than the viewport.
      x: size().width < 600 ? 40 - field.x - 18 : size().width / 2 - field.x - field.width / 2,
      // Keep the preceding row completely above the viewport. The year
      // heading still clears the floating toolbar at normal zoom.
      y: 62 - year.y,
    });
    const focusRegion = (year, fieldName) => {
      const region = layout.years.find((item) => item.year === year);
      const field = layout.fields.find((item) => item.field === fieldName);
      if (!region || !field) return;
      // Frame the region title and its first complete card, including on a
      // narrow phone. The selected course is not silently changed by a jump.
      camera = regionCamera(region, field);
      selectedId = '';
      applyCamera();
      updateNodes();
    };
    const previewQuery = !win.CurriculumAccess.publicEnabled ? '?curriculumPreview=1' : '';
    doc.getElementById('map-back').href = `index.html${previewQuery}`;
    // Toolbar year jump: moves the camera to that year's area. This is a
    // viewport jump only — it never changes filters, selections, or enrollment.
    const currentField = () => {
      const centerX = (size().width / 2 - camera.x) / camera.scale;
      return (
        layout.fields.find((field) => centerX >= field.x && centerX < field.x + field.width)?.field || '情報'
      );
    };
    const yearJump = doc.getElementById('map-year-jump');
    yearJump?.addEventListener('change', () => {
      const year = Number(yearJump.value);
      if (!year) return;
      const count = (field) =>
        layout.positions.filter((box) => box.region === `year-${year}` && box.field === field).length;
      const available = layout.fields.find(
        (field) => field.field === currentField() && count(field.field) >= 3,
      );
      // A year jump should land on a meaningful cluster, not a nearly empty
      // field merely because the camera happened to be there before.
      const fallback = [...layout.fields].sort((a, b) => count(b.field) - count(a.field))[0];
      focusRegion(year, (available || fallback).field);
      yearJump.value = '';
    });
    world.style.width = `${layout.width}px`;
    world.style.height = `${layout.height}px`;

    const background = doc.getElementById('map-background');
    const apBands = definition.bands.filter((item) =>
      ['ap4', 'ap1-ap3-foundation', 'ap2', 'ap1-ap3-world'].includes(item.id),
    );
    const foundationsWidth =
      layout.fields
        .filter((field) => ['情報', '数理'].includes(field.field))
        .reduce((sum, field) => sum + field.width + 16, 0) - 16;
    for (const band of apBands) {
      const node = element('div', band.label, 'map-band');
      const isTop = band.id === 'ap4';
      const x =
        isTop || band.id === 'ap1-ap3-foundation'
          ? 64
          : band.id === 'ap2'
            ? 64 + foundationsWidth + 16
            : layout.fields.find((field) => field.field === '文化・思想').x;
      const width = isTop
        ? layout.width - 128
        : band.id === 'ap1-ap3-foundation'
          ? foundationsWidth
          : band.id === 'ap2'
            ? layout.fields.find((field) => field.field === '多言語').width
            : layout.width - x - 64;
      Object.assign(node.style, {
        left: `${x}px`,
        top: `${isTop ? 20 : 76}px`,
        width: `${width}px`,
        background: band.color,
      });
      background.append(node);
    }
    const introBand = element('section', undefined, 'map-stage-band map-intro-band');
    Object.assign(introBand.style, {
      top: '132px',
      left: '64px',
      width: `${layout.width - 128}px`,
      height: `${layout.introHeight - 148}px`,
    });
    introBand.append(element('h2', '導入科目 · 14単位'));
    background.append(introBand);
    for (const year of layout.years) {
      const band = element('section', undefined, 'map-stage-band map-year-band');
      Object.assign(band.style, {
        top: `${year.y}px`,
        left: '64px',
        width: `${layout.width - 128}px`,
        height: `${year.height}px`,
      });
      band.append(element('h2', `${year.year}年次`));
      background.append(band);
      for (const field of layout.fields) {
        const count = layout.positions.filter(
          (box) => box.region === `year-${year.year}` && box.field === field.field,
        ).length;
        if (!count) continue;
        // A field's tint should frame its cards, not suggest that a sparse
        // field occupies every lane needed by a different field that year.
        const rows = Math.ceil(count / field.lanes);
        const cell = element('section', undefined, 'map-field-cell');
        Object.assign(cell.style, {
          left: `${field.x}px`,
          top: `${year.y + 66}px`,
          width: `${field.width}px`,
          height: `${60 + rows * CARD_PITCH_Y}px`,
          background: field.color,
        });
        cell.append(element('h3', field.field));
        background.append(cell);
      }
    }
    const projectBand = element('section', undefined, 'map-stage-band map-project-band');
    Object.assign(projectBand.style, {
      top: `${layout.projectY}px`,
      left: '64px',
      width: `${layout.width - 128}px`,
      height: `${layout.height - layout.projectY - 32}px`,
    });
    projectBand.append(element('h2', '卒業プロジェクト'));
    background.append(projectBand);
    const host = doc.getElementById('map-courses');
    for (const box of layout.positions) {
      const course = catalog.get(box.id);
      const node = element('button', undefined, 'map-course');
      node.type = 'button';
      node.dataset.courseId = course.id;
      node.dataset.year = Number.parseInt(course.year, 10);
      node.dataset.field = box.field;
      node.dataset.stage = box.stage;
      node.dataset.prominence = box.prominence;
      node.classList.toggle('is-prominent', box.prominence === 'prominent');
      node.draggable = true;
      node.setAttribute('aria-label', `${course.subject}の詳細`);
      Object.assign(node.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        background: course.credits === 1 ? '#a7d8e6' : course.credits === 4 ? '#fff6bf' : '#fff',
      });
      node.append(
        element('strong', course.subject),
        element('small', `${box.stage} · ${course.credits}単位 · ${course.quarter || ''}`),
        element('span', '', 'course-state'),
      );
      nodes.set(course.id, node);
      host.append(node);
    }
    const updateNodes = () => {
      const registered = new Set(enrollment.registered.ids);
      const completed = new Set(enrollment.completed.ids);
      for (const [id, node] of nodes) {
        node.classList.toggle('is-registered', registered.has(id));
        node.classList.toggle('is-completed', completed.has(id));
        node.classList.toggle('is-selected', selectedId === id);
        node.querySelector('.course-state').textContent = completed.has(id)
          ? '履修済み ✓'
          : registered.has(id)
            ? '履修予定 ✓'
            : '';
      }
      doc.getElementById('map-enrollment-count').textContent = enrollment.registered.ids.length;
      drawRelations();
    };
    const drawRelations = () => {
      const svg = doc.getElementById('map-relations');
      svg.replaceChildren();
      svg.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
      if (relationMode === 'off') return;
      for (const relation of relations) {
        if (
          relationMode === 'selected' &&
          ![relation.prerequisiteId, relation.successorId].includes(selectedId)
        )
          continue;
        const a = positions.get(relation.prerequisiteId),
          b = positions.get(relation.successorId);
        if (!a || !b) continue;
        const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute(
          'd',
          `M${a.x + a.width / 2},${a.y + a.height / 2} L${b.x + b.width / 2},${b.y + b.height / 2}`,
        );
        line.setAttribute('stroke', relation.strength === 'strongly_recommended' ? '#b17b21' : '#427e85');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-dasharray', '8 6');
        line.setAttribute('fill', 'none');
        // 方向はデータの prerequisiteId→successorId で確定。後継側（終点）に矢印。
        line.setAttribute(
          'marker-end',
          `url(#${relation.strength === 'strongly_recommended' ? 'map-relation-arrow-strong' : 'map-relation-arrow-normal'})`,
        );
        svg.append(line);
      }
    };
    const openDrawer = (mode, title) => {
      if (drawer.hidden) lastFocus = doc.activeElement;
      drawerMode = mode;
      drawer.hidden = false;
      doc.getElementById('map-drawer-title').textContent = title;
      doc
        .getElementById('map-enrollment-toggle')
        .setAttribute('aria-expanded', String(mode === 'enrollment'));
      doc.getElementById('map-menu').hidden = true;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', 'false');
      doc.getElementById('map-drawer-close').focus({ preventScroll: true });
    };
    const closeDrawer = () => {
      drawer.hidden = true;
      drawerMode = '';
      doc.getElementById('map-enrollment-toggle').setAttribute('aria-expanded', 'false');
      if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    };
    const changeEnrollment = (id, target) => {
      // Re-read immediately before a write to preserve changes made in another
      // Hub tab. The two lists are mutually exclusive and the simulator plan
      // is intentionally not part of this transaction.
      if (!['registered', 'completed'].includes(target) || !catalog.has(id)) return false;
      const current = utils.readEnrollmentState(storage, keys);
      const previousRegistered = [...current.registered.ids];
      const previousCompleted = [...current.completed.ids];
      const nextRegistered = new Set(previousRegistered);
      const nextCompleted = new Set(previousCompleted);
      const active = target === 'registered' ? nextRegistered.has(id) : nextCompleted.has(id);
      if (target === 'registered') {
        if (active) nextRegistered.delete(id);
        else {
          nextRegistered.add(id);
          nextCompleted.delete(id);
        }
      } else if (active) {
        nextCompleted.delete(id);
      } else {
        nextCompleted.add(id);
        nextRegistered.delete(id);
      }
      const result = utils.saveEnrollmentState(storage, keys, nextRegistered, nextCompleted);
      enrollment = utils.readEnrollmentState(storage, keys);
      updateNodes();
      if (drawerMode === 'enrollment') renderEnrollment();
      else if (drawerMode === 'detail') renderDetail(selectedId, false);
      if (!result.saved) {
        console.warn('履修状態を保存できませんでした:', result.error);
        status(
          result.rollbackSucceeded
            ? '保存できませんでした。再度お試しください。'
            : '保存状態を確認できません。ページを再読み込みしてください。',
          true,
        );
      } else
        status(
          active
            ? '削除しました'
            : target === 'registered'
              ? '履修予定に追加しました'
              : '履修済みに追加しました',
        );
      if (result.saved && active) {
        const course = catalog.get(id);
        showUndoToast(`${course?.subject || '科目'}を削除しました`, () => {
          const restoreResult = utils.saveEnrollmentState(
            storage,
            keys,
            new Set(previousRegistered),
            new Set(previousCompleted),
          );
          if (!restoreResult.saved) {
            status(
              restoreResult.rollbackSucceeded
                ? '変更を元に戻せませんでした。再度お試しください。'
                : '保存状態を確認できません。ページを再読み込みしてください。',
              true,
            );
            return;
          }
          enrollment = utils.readEnrollmentState(storage, keys);
          updateNodes();
          if (drawerMode === 'enrollment') renderEnrollment();
          else if (drawerMode === 'detail') renderDetail(selectedId, false);
        });
      }
      return result.saved;
    };
    const appendEnrollmentGroup = (title, ids, target) => {
      const section = element('section', undefined, 'enrollment-group');
      section.append(element('h3', title));
      const known = ids.map((id) => catalog.get(id)).filter(Boolean);
      section.append(
        element(
          'p',
          `${known.length}科目 · ${known.reduce((sum, course) => sum + Number(course.credits), 0)}単位`,
        ),
      );
      for (const id of ids) {
        const course = catalog.get(id);
        const row = element('div', undefined, 'enrollment-row');
        const detail = element('button', course?.subject || '未確認の科目');
        detail.type = 'button';
        detail.disabled = !course;
        detail.addEventListener('click', () => {
          focusCourse(id);
          renderDetail(id);
        });
        const remove = element('button', '削除', 'remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${course?.subject || '未確認の科目'}を${title}から削除`);
        remove.disabled = !enrollment.writable;
        remove.addEventListener('click', () => changeEnrollment(id, target));
        row.append(detail, remove);
        section.append(row);
      }
      drawerContent.append(section);
    };
    const renderEnrollment = () => {
      drawerContent.replaceChildren();
      if (!enrollment.registered.ids.length && !enrollment.completed.ids.length)
        drawerContent.append(element('p', '科目を選んで追加してください。'));
      if (enrollment.registered.ids.length)
        appendEnrollmentGroup('履修予定', enrollment.registered.ids, 'registered');
      if (enrollment.completed.ids.length)
        appendEnrollmentGroup('履修済み', enrollment.completed.ids, 'completed');
    };
    const renderDetail = (id, open = true) => {
      const course = catalog.get(id);
      if (!course) return;
      selectedId = id;
      updateNodes();
      if (open) openDrawer('detail', '科目詳細');
      drawerContent.replaceChildren(element('h3', course.subject));
      const metadata = element('dl');
      // 分野・区分・レベルの行は科目によらず常に同じ並びで表示する。値は既存データのみ
      // （分野=course.tag の分野値、区分=course.category、レベル=配置データの区分列で
      //  カード側の表記と同じもの）。値がない場合は行を消さず「―」で示す。
      const isFieldTag = (tag) => Boolean(tag) && tag !== '必修' && tag !== '卒業プロジェクト';
      const stageRow = definition.coursePlacements.find((placement) => placement.courseId === id)?.category;
      const metadataRows = [
        ['学年', course.year],
        ['開講Q', course.quarter],
        ['単位', course.credits != null ? `${course.credits}単位` : '―'],
        ['分野', isFieldTag(course.tag) ? course.tag : '―'],
        ['区分', course.category || '―'],
        ['レベル', stageRow || '―'],
        ['教員', null],
        ['形式', course.method],
      ];
      for (const [label, value] of metadataRows) {
        metadata.append(
          element('dt', label),
          label === '教員' ? renderTeacherCell(course.teacher) : element('dd', value || '―'),
        );
      }
      drawerContent.append(metadata);
      // ホームの科目詳細と同じ評価方法（レポート・試験の配分）を表示する。
      metadata.append(element('dt', '評価方法'), element('dd', course.evaluation || '情報なし'));
      const exam = element('section');
      win.ZenExam.appendDetail(exam, course);
      drawerContent.append(exam);
      const planned = enrollment.registered.ids.includes(id);
      const completed = enrollment.completed.ids.includes(id);
      // 状態遷移はホームと同じトグル。表示名も状態に合わせて曖昧さをなくす。
      const plannedLabel = planned ? '履修予定から削除' : completed ? '履修予定に戻す' : '履修予定に追加';
      const completedLabel = completed ? '履修済みから削除' : planned ? '履修済みにする' : '履修済みに追加';
      const actions = element('div', undefined, 'enrollment-actions');
      const plannedAction = element('button', plannedLabel, 'enrollment-action enrollment-action-planned');
      plannedAction.type = 'button';
      plannedAction.disabled = !enrollment.writable;
      plannedAction.addEventListener('click', () => changeEnrollment(id, 'registered'));
      const completedAction = element(
        'button',
        completedLabel,
        'enrollment-action enrollment-action-completed',
      );
      completedAction.type = 'button';
      completedAction.disabled = !enrollment.writable;
      completedAction.addEventListener('click', () => changeEnrollment(id, 'completed'));
      actions.append(plannedAction, completedAction);
      drawerContent.append(actions);
      if (course.description) drawerContent.append(element('p', course.description));
      const rating = difficulty[id];
      if (rating && typeof rating.average === 'number') {
        // ホーム・シミュレーターと同じ小数第1位＋票数併記に統一する。
        drawerContent.append(
          element('h4', '履修難易度'),
          element(
            'p',
            `${rating.average.toFixed(1)} / 10.0${Number.isFinite(rating.votes) ? `（${rating.votes}票）` : ''}`,
          ),
        );
        const url = utils.sanitizeExternalUrl(rating.sourceUrl);
        if (url) {
          const link = element('a', '難易度の出典');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          drawerContent.append(link);
        }
      } else {
        // difficulty.json にエントリがない科目（＝投票なし）はプレースホルダーを
        // 出して「データがない」ことを明示する。
        drawerContent.append(element('h4', '履修難易度'), element('p', '―（投票なし）'));
      }
      for (const [title, field, relatedField] of [
        ['前提科目', 'successorId', 'prerequisiteId'],
        ['後継科目', 'prerequisiteId', 'successorId'],
      ]) {
        const entries = relations.filter(
          (relation) => relation[field] === id && catalog.has(relation[relatedField]),
        );
        if (!entries.length) continue;
        drawerContent.append(element('h4', title));
        for (const relation of entries) {
          const button = element('button', catalog.get(relation[relatedField]).subject, 'related-course');
          button.type = 'button';
          const strong = relation.strength === 'strongly_recommended';
          button.append(
            element('span', strong ? '強く推奨' : '推奨', `relation-badge${strong ? ' strong' : ''}`),
          );
          button.addEventListener('click', () => {
            focusCourse(relation[relatedField]);
            renderDetail(relation[relatedField]);
          });
          drawerContent.append(button);
        }
      }
      if (relations.some((relation) => relation.prerequisiteId === id || relation.successorId === id))
        drawerContent.append(element('p', '参考関係です。公式の履修前提条件ではありません。'));
      const syllabus = utils.sanitizeExternalUrl(course.url);
      if (syllabus) {
        const link = element('a', '公式シラバス');
        link.href = syllabus;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        drawerContent.append(link);
      }
    };

    let suppressClickUntil = 0;
    let dragging = false;
    host.addEventListener('click', (event) => {
      const node = event.target.closest('[data-course-id]');
      if (node && Date.now() > suppressClickUntil && !dragging) renderDetail(node.dataset.courseId);
    });
    const dropTargets = [...doc.querySelectorAll('[data-enrollment-target]')];
    const setDropTargetsHidden = (hidden) => {
      for (const dropTarget of dropTargets) {
        dropTarget.hidden = hidden;
        if (hidden) dropTarget.classList.remove('is-over');
      }
    };
    host.addEventListener('dragstart', (event) => {
      const node = event.target.closest('[data-course-id]');
      if (!node || !event.dataTransfer) return;
      dragging = true;
      event.dataTransfer.setData('application/x-zen-course-id', node.dataset.courseId);
      event.dataTransfer.setData('text/plain', node.dataset.courseId);
      event.dataTransfer.effectAllowed = 'copy';
      setDropTargetsHidden(false);
    });
    host.addEventListener('dragend', () => {
      setDropTargetsHidden(true);
      dragging = false;
      suppressClickUntil = Date.now() + 250;
    });
    for (const dropTarget of dropTargets) {
      dropTarget.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        dropTarget.classList.add('is-over');
      });
      dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('is-over'));
      dropTarget.addEventListener('drop', (event) => {
        event.preventDefault();
        const id =
          event.dataTransfer.getData('application/x-zen-course-id') ||
          event.dataTransfer.getData('text/plain');
        // The meaning of a drop follows the existing changeEnrollment toggle:
        // dropping an already-completed course on its zone removes it there.
        if (catalog.has(id)) changeEnrollment(id, dropTarget.dataset.enrollmentTarget);
        setDropTargetsHidden(true);
        dragging = false;
        suppressClickUntil = Date.now() + 250;
      });
    }

    // Capture touch gestures on cards as well as the background. A moved touch
    // suppresses its click; a stationary tap still opens the course drawer.
    const pointers = new Map();
    let gesture = null;
    const beginGesture = () => {
      const points = [...pointers.values()];
      if (!points.length) {
        gesture = null;
        viewport.classList.remove('is-moving');
        return;
      }
      const center =
        points.length > 1
          ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
          : points[0];
      gesture = {
        camera: { ...camera },
        center,
        distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
        moved: false,
      };
    };
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.pointerType === 'mouse' && event.target.closest('[data-course-id]')))
        return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      beginGesture();
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.values()];
      const center =
        points.length > 1
          ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }
          : points[0];
      const dx = center.x - gesture.center.x,
        dy = center.y - gesture.center.y;
      if (Math.hypot(dx, dy) > 5 || points.length > 1) {
        gesture.moved = true;
        suppressClickUntil = Date.now() + 350;
        viewport.classList.add('is-moving');
      }
      if (!gesture.moved) return;
      camera =
        points.length > 1
          ? zoomAt(
              gesture.camera,
              (gesture.camera.scale * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)) /
                Math.max(1, gesture.distance),
              gesture.center,
            )
          : { ...gesture.camera };
      camera.x += dx;
      camera.y += dy;
      applyCamera();
    });
    const endPointer = (event) => {
      if (!pointers.has(event.pointerId)) return;
      const moved = gesture?.moved;
      pointers.delete(event.pointerId);
      if (moved) suppressClickUntil = Date.now() + 350;
      else if (event.pointerType !== 'mouse') {
        const target = doc.elementFromPoint(event.clientX, event.clientY)?.closest('[data-course-id]');
        if (target) {
          renderDetail(target.dataset.courseId);
          suppressClickUntil = Date.now() + 350;
        }
      }
      beginGesture();
    };
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', (event) => {
      pointers.delete(event.pointerId);
      beginGesture();
      suppressClickUntil = Date.now() + 350;
    });
    viewport.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        camera = zoomAt(
          camera,
          camera.scale * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.002),
          { x: event.clientX, y: event.clientY },
        );
        applyCamera();
      },
      { passive: false },
    );
    viewport.addEventListener('keydown', (event) => {
      if (event.target !== viewport) return;
      const step = event.shiftKey ? 400 : 100;
      const offsets = {
        ArrowLeft: [step, 0],
        ArrowRight: [-step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (offsets[event.key]) {
        event.preventDefault();
        camera.x += offsets[event.key][0];
        camera.y += offsets[event.key][1];
        applyCamera();
      }
      if (['+', '-', '='].includes(event.key)) {
        event.preventDefault();
        camera = zoomAt(camera, camera.scale * (event.key === '-' ? 0.8 : 1.25), {
          x: size().width / 2,
          y: size().height / 2,
        });
        applyCamera();
      }
    });
    for (const [id, multiplier] of [
      ['map-zoom-in', 1.25],
      ['map-zoom-out', 0.8],
    ])
      doc.getElementById(id).addEventListener('click', () => {
        camera = zoomAt(camera, camera.scale * multiplier, { x: size().width / 2, y: size().height / 2 });
        applyCamera();
      });
    doc.getElementById('map-normal').addEventListener('click', () => {
      camera = zoomAt(camera, 1, { x: size().width / 2, y: size().height / 2 });
      applyCamera();
    });
    doc.getElementById('map-fit').addEventListener('click', () => {
      camera = fitMap(layout, size());
      applyCamera();
    });
    doc.getElementById('map-menu-toggle').addEventListener('click', () => {
      const menu = doc.getElementById('map-menu');
      menu.hidden = !menu.hidden;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
      doc.getElementById('map-search-results').hidden = true;
    });
    doc.getElementById('map-enrollment-toggle').addEventListener('click', () => {
      if (!drawer.hidden && drawerMode === 'enrollment') return closeDrawer();
      enrollment = utils.readEnrollmentState(storage, keys);
      updateNodes();
      openDrawer('enrollment', 'マイ履修');
      renderEnrollment();
    });
    doc.getElementById('map-drawer-close').addEventListener('click', closeDrawer);
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!drawer.hidden) closeDrawer();
      doc.getElementById('map-menu').hidden = true;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', 'false');
      doc.getElementById('map-search-results').hidden = true;
    });
    const field = doc.getElementById('map-field');
    for (const region of layout.fields) {
      const option = element('option', region.field);
      option.value = region.field;
      field.append(option);
    }
    field.addEventListener('change', () => {
      if (!field.value) return;
      const chosen = field.value;
      const presentYears = layout.years.filter((region) =>
        layout.positions.some((box) => box.region === `year-${region.year}` && box.field === chosen),
      );
      const year = presentYears.find((region) => region.year === currentYear()) || presentYears[0];
      if (year) focusRegion(year.year, chosen);
      doc.getElementById('map-menu').hidden = true;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', 'false');
    });
    doc.getElementById('map-relation-mode').addEventListener('change', (event) => {
      relationMode = event.target.value;
      drawRelations();
    });
    const search = doc.getElementById('map-search');
    const results = doc.getElementById('map-search-results');
    const matches = () =>
      courses.filter((course) =>
        `${course.subject} ${course.teacher || ''}`
          .toLocaleLowerCase('ja')
          .includes(search.value.trim().toLocaleLowerCase('ja')),
      );
    search.addEventListener('input', () => {
      results.replaceChildren();
      const candidates = matches();
      results.hidden = !search.value.trim();
      if (!candidates.length) results.append(element('p', '該当する科目はありません'));
      for (const course of candidates) {
        const button = element('button', course.subject);
        button.type = 'button';
        button.addEventListener('click', () => {
          focusCourse(course.id);
          results.hidden = true;
          search.blur();
        });
        results.append(button);
      }
    });
    doc.getElementById('map-search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!search.value.trim()) return;
      const candidates = matches();
      if (candidates.length) {
        focusCourse(candidates[0].id);
        results.hidden = true;
        search.blur();
      } else status('該当する科目はありません');
    });
    win.addEventListener('storage', (event) => {
      if (![keys.registered, keys.completed, keys.schemaVersion].includes(event.key) && event.key !== null)
        return;
      enrollment = utils.readEnrollmentState(storage, keys);
      updateNodes();
      if (drawerMode === 'enrollment') renderEnrollment();
      if (drawerMode === 'detail') renderDetail(selectedId, false);
    });
    win.addEventListener('resize', applyCamera);
    doc.getElementById('map-app').hidden = false;
    doc.getElementById('map-unavailable').hidden = true;
    // Start in the map's central upper area at readable scale. Search, year,
    // field, and fit controls continue to use their explicit camera targets.
    camera = initialCamera(layout, size());
    applyCamera();
    updateNodes();
    if (!enrollment.writable) status('保存データを読み取れません。既存データは変更しません。', true);
    examReady.then(() => {
      if (drawerMode === 'detail') renderDetail(selectedId, false);
    });
    // Optional datasets do not block the map or enrollment if unavailable.
    await Promise.all([
      fetchJSON('course-relations.json')
        .then((data) => {
          relations = data.filter(
            (item) => catalog.has(item.prerequisiteId) && catalog.has(item.successorId),
          );
          drawRelations();
        })
        .catch((error) => console.warn('参考関係を読み込めません:', error)),
      fetchJSON('difficulty.json')
        .then((data) => {
          difficulty = Array.isArray(data)
            ? Object.fromEntries(data.map((item) => [item.courseId || item.id, item]))
            : data;
        })
        .catch((error) => console.warn('難易度を読み込めません:', error)),
    ]);
  }
  return { buildLayout, intersects, zoomAt, centerOn, initialCamera, fitMap, start };
});
