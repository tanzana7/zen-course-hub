/* Standalone map: camera coordinates are independent of document scrolling. */
(function exposeMap(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root?.document) {
    root.CurriculumMapGeometry = api;
    root.document.addEventListener('DOMContentLoaded', () => api.start(root).catch((error) => {
      console.error('カリキュラムマップを起動できませんでした:', error);
      const message = root.document.getElementById('map-loading-message');
      if (message) message.textContent = '読み込めませんでした。ページを再読み込みしてください。';
      root.document.getElementById('map-app').hidden = true;
      root.document.getElementById('map-unavailable').hidden = false;
    }));
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CARD_WIDTH = 224;
  const CARD_HEIGHT = 128;
  const GAP = 20;
  const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  // Source coordinates retain the reviewed PDF arrangement. Their rectangles
  // overlap partially even when there are no identical slots. Expand the map
  // and move only colliding display boxes downward; never rewrite source data.
  const buildLayout = (definition, courses) => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    const placed = [];
    const source = [...definition.coursePlacements].sort((a, b) => a.y - b.y || a.x - b.x || a.courseId.localeCompare(b.courseId));
    for (const entry of source) {
      if (!byId.has(entry.courseId) || ![entry.x, entry.y].every(Number.isFinite)) throw new Error('科目配置を確認できません');
      const box = { id: entry.courseId, x: entry.x * 6000, y: entry.y * 6500, width: CARD_WIDTH, height: CARD_HEIGHT, sourceX: entry.x, sourceY: entry.y };
      for (;;) {
        const padded = { x: box.x - GAP / 2, y: box.y - GAP / 2, width: box.width + GAP, height: box.height + GAP };
        const collisions = placed.filter((other) => intersects(padded, other));
        if (!collisions.length) break;
        box.y = Math.max(...collisions.map((other) => other.y + other.height)) + GAP;
      }
      placed.push(box);
    }
    if (placed.length !== byId.size || new Set(placed.map((box) => box.id)).size !== byId.size) throw new Error('科目配置に欠落または重複があります');
    return { positions: placed, width: Math.max(6000, ...placed.map((box) => box.x + box.width + 80)), height: Math.max(6500, ...placed.map((box) => box.y + box.height + 120)) };
  };

  const zoomAt = (camera, nextScale, anchor) => {
    const scale = Math.max(.05, Math.min(2.4, nextScale));
    return { scale, x: anchor.x - (anchor.x - camera.x) * scale / camera.scale, y: anchor.y - (anchor.y - camera.y) * scale / camera.scale };
  };
  const centerOn = (box, viewport, scale = 1) => ({ scale, x: viewport.width / 2 - (box.x + box.width / 2) * scale, y: viewport.height / 2 - (box.y + box.height / 2) * scale });
  const fitMap = (layout, viewport) => {
    const scale = Math.min((viewport.width - 40) / layout.width, (viewport.height - 140) / layout.height, 1);
    return { scale: Math.max(.05, scale), x: (viewport.width - layout.width * scale) / 2, y: (viewport.height - layout.height * scale) / 2 + 20 };
  };

  async function start(win) {
    const doc = win.document;
    if (!win.CurriculumAccess?.canAccess(win.location)) {
      doc.getElementById('map-loading-message').textContent = '現在は公開準備中です。';
      return;
    }
    const utils = win.ZenQualityUtils;
    if (!utils) throw new Error('保存ユーティリティを読み込めません');
    const keys = { registered: 'myClasses', completed: 'completedClasses', schemaVersion: 'zenCourseHubStorageSchemaVersion' };
    const storage = (() => { try { return win.localStorage; } catch (error) { return { getItem: () => { throw error; } }; } })();
    const fetchJSON = async (file) => {
      const response = await win.fetch(file);
      if (!response.ok) throw new Error(`${file}: ${response.status}`);
      return response.json();
    };
    const [courses, definition] = await Promise.all([fetchJSON('courses.json'), fetchJSON('curriculum-tree-layout.json')]);
    const catalog = new Map(courses.map((course) => [course.id, course]));
    const layout = buildLayout(definition, courses);
    const positions = new Map(layout.positions.map((box) => [box.id, box]));
    let enrollment = utils.readEnrollmentState(storage, keys);
    let selectedId = '';
    let drawerMode = '';
    let lastFocus = null;
    let relations = [];
    let difficulty = {};
    let relationMode = 'off';
    let statusTimer;
    let cameraFrame;
    let camera = { scale: 1, x: 0, y: 0 };
    const viewport = doc.getElementById('map-viewport');
    const world = doc.getElementById('map-world');
    const drawer = doc.getElementById('map-drawer');
    const drawerContent = doc.getElementById('map-drawer-content');
    const nodes = new Map();
    const size = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
    const element = (tag, text, className) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
    const status = (text, persistent = false) => {
      clearTimeout(statusTimer);
      const node = doc.getElementById('map-status');
      node.textContent = text;
      node.hidden = !text;
      if (!persistent) statusTimer = win.setTimeout(() => { node.hidden = true; }, 4000);
    };
    const applyCamera = () => {
      if (cameraFrame) return;
      cameraFrame = win.requestAnimationFrame(() => {
        cameraFrame = null;
        world.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
        doc.getElementById('map-zoom-value').textContent = `${Math.round(camera.scale * 100)}%`;
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
    const previewQuery = !win.CurriculumAccess.publicEnabled ? '?curriculumPreview=1' : '';
    doc.getElementById('map-back').href = `index.html${previewQuery}`;
    world.style.width = `${layout.width}px`;
    world.style.height = `${layout.height}px`;

    const background = doc.getElementById('map-background');
    const groupColors = { foundation: '#e2e9f7', multilingual: '#fce7ed', world: '#e0f3f2', free: '#eee7f5' };
    for (const column of definition.columns) {
      const node = element('section', undefined, 'map-column');
      Object.assign(node.style, { left: `${column.x / definition.canvas.width * 6000}px`, top: '330px', width: `${column.width / definition.canvas.width * 6000}px`, height: `${layout.height - 460}px`, background: groupColors[column.group] || '#ecf0e8' });
      node.append(element('h2', column.label));
      background.append(node);
    }
    for (const band of definition.bands.filter((item) => ['ap4', 'ap1-ap3-foundation', 'ap2', 'ap1-ap3-world'].includes(item.id))) {
      const node = element('div', band.label, 'map-band');
      Object.assign(node.style, { left: `${band.x / definition.canvas.width * 6000}px`, top: `${band.y * 2}px`, width: `${band.width / definition.canvas.width * 6000}px`, background: band.color });
      background.append(node);
    }
    const host = doc.getElementById('map-courses');
    for (const box of layout.positions) {
      const course = catalog.get(box.id);
      const node = element('button', undefined, 'map-course');
      node.type = 'button';
      node.dataset.courseId = course.id;
      node.draggable = true;
      node.setAttribute('aria-label', `${course.subject}の詳細`);
      Object.assign(node.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, background: course.credits === 1 ? '#a7d8e6' : course.credits === 4 ? '#fff6bf' : '#fff' });
      node.append(element('strong', course.subject), element('small', `${course.year} · ${course.credits}単位 · ${course.quarter || ''}`), element('span', '', 'course-state'));
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
        node.querySelector('.course-state').textContent = completed.has(id) ? '履修済み' : registered.has(id) ? 'マイ履修 ✓' : '';
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
        if (relationMode === 'selected' && ![relation.prerequisiteId, relation.successorId].includes(selectedId)) continue;
        const a = positions.get(relation.prerequisiteId), b = positions.get(relation.successorId);
        if (!a || !b) continue;
        const line = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
        line.setAttribute('d', `M${a.x + a.width / 2},${a.y + a.height / 2} L${b.x + b.width / 2},${b.y + b.height / 2}`);
        line.setAttribute('stroke', relation.strength === 'strongly_recommended' ? '#b17b21' : '#427e85');
        line.setAttribute('stroke-width', '3');
        line.setAttribute('stroke-dasharray', '8 6');
        line.setAttribute('fill', 'none');
        svg.append(line);
      }
    };
    const openDrawer = (mode, title) => {
      if (drawer.hidden) lastFocus = doc.activeElement;
      drawerMode = mode;
      drawer.hidden = false;
      doc.getElementById('map-drawer-title').textContent = title;
      doc.getElementById('map-enrollment-toggle').setAttribute('aria-expanded', String(mode === 'enrollment'));
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
    const saveEnrollment = (id, remove = false) => {
      // Re-read immediately before a write to preserve changes made in another
      // Hub tab. Never create a second plan or treat registered as completed.
      const current = utils.readEnrollmentState(storage, keys);
      const next = new Set(current.registered.ids);
      if (remove) next.delete(id);
      else if (!current.completed.ids.includes(id) && catalog.has(id)) next.add(id);
      const result = utils.saveEnrollmentState(storage, keys, next, current.completed.ids);
      enrollment = utils.readEnrollmentState(storage, keys);
      updateNodes();
      if (drawerMode === 'enrollment') renderEnrollment();
      else if (drawerMode === 'detail') renderDetail(selectedId, false);
      if (!result.saved) {
        console.warn('通常履修を保存できませんでした:', result.error);
        status(result.rollbackSucceeded ? '保存できませんでした。再度お試しください。' : '保存状態を確認できません。ページを再読み込みしてください。', true);
      } else status(remove ? '削除しました' : '追加しました');
      return result.saved;
    };
    const renderEnrollment = () => {
      drawerContent.replaceChildren();
      const known = enrollment.registered.ids.map((id) => catalog.get(id)).filter(Boolean);
      drawerContent.append(element('p', `${known.length}科目 · ${known.reduce((sum, course) => sum + Number(course.credits), 0)}単位`));
      if (!enrollment.registered.ids.length) drawerContent.append(element('p', '科目を選んで追加してください。'));
      for (const id of enrollment.registered.ids) {
        const course = catalog.get(id);
        const row = element('div', undefined, 'enrollment-row');
        const detail = element('button', course?.subject || '未確認の科目');
        detail.type = 'button';
        detail.disabled = !course;
        detail.addEventListener('click', () => { focusCourse(id); renderDetail(id); });
        const remove = element('button', '削除', 'remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `${course?.subject || '未確認の科目'}をマイ履修から削除`);
        remove.disabled = !enrollment.writable;
        remove.addEventListener('click', () => saveEnrollment(id, true));
        row.append(detail, remove);
        drawerContent.append(row);
      }
    };
    const renderDetail = (id, open = true) => {
      const course = catalog.get(id);
      if (!course) return;
      selectedId = id;
      updateNodes();
      if (open) openDrawer('detail', '科目詳細');
      drawerContent.replaceChildren(element('h3', course.subject));
      const metadata = element('dl');
      for (const [label, value] of [['学年', course.year], ['開講Q', course.quarter], ['単位', `${course.credits}単位`], ['分野', course.tag], ['教員', course.teacher], ['形式', course.method]]) {
        if (value) metadata.append(element('dt', label), element('dd', value));
      }
      drawerContent.append(metadata);
      const action = element('button', enrollment.completed.ids.includes(id) ? '履修済み' : enrollment.registered.ids.includes(id) ? 'マイ履修から削除' : 'マイ履修に追加', 'enrollment-action');
      action.type = 'button';
      action.disabled = !enrollment.writable || enrollment.completed.ids.includes(id);
      action.addEventListener('click', () => saveEnrollment(id, enrollment.registered.ids.includes(id)));
      drawerContent.append(action);
      if (course.description) drawerContent.append(element('p', course.description));
      const rating = difficulty[id];
      if (rating && typeof rating.average === 'number') {
        drawerContent.append(element('h4', '履修難易度'), element('p', `${rating.average} / 10 · ${rating.votes}票`));
        const url = utils.sanitizeExternalUrl(rating.sourceUrl);
        if (url) { const link = element('a', '難易度の出典'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; drawerContent.append(link); }
      }
      for (const [title, field, relatedField] of [['前提科目', 'successorId', 'prerequisiteId'], ['後継科目', 'prerequisiteId', 'successorId']]) {
        const entries = relations.filter((relation) => relation[field] === id && catalog.has(relation[relatedField]));
        if (!entries.length) continue;
        drawerContent.append(element('h4', title));
        for (const relation of entries) {
          const button = element('button', catalog.get(relation[relatedField]).subject, 'related-course');
          button.type = 'button';
          const strong = relation.strength === 'strongly_recommended';
          button.append(element('span', strong ? '強く推奨' : '推奨', `relation-badge${strong ? ' strong' : ''}`));
          button.addEventListener('click', () => { focusCourse(relation[relatedField]); renderDetail(relation[relatedField]); });
          drawerContent.append(button);
        }
      }
      if (relations.some((relation) => relation.prerequisiteId === id || relation.successorId === id)) drawerContent.append(element('p', '参考関係です。公式の履修前提条件ではありません。'));
      const syllabus = utils.sanitizeExternalUrl(course.url);
      if (syllabus) { const link = element('a', '公式シラバス'); link.href = syllabus; link.target = '_blank'; link.rel = 'noopener noreferrer'; drawerContent.append(link); }
    };

    let suppressClickUntil = 0;
    let dragging = false;
    host.addEventListener('click', (event) => {
      const node = event.target.closest('[data-course-id]');
      if (node && Date.now() > suppressClickUntil && !dragging) renderDetail(node.dataset.courseId);
    });
    const dropTarget = doc.getElementById('map-drop-target');
    host.addEventListener('dragstart', (event) => {
      const node = event.target.closest('[data-course-id]');
      if (!node || !event.dataTransfer) return;
      dragging = true;
      event.dataTransfer.setData('application/x-zen-course-id', node.dataset.courseId);
      event.dataTransfer.setData('text/plain', node.dataset.courseId);
      event.dataTransfer.effectAllowed = 'copy';
      dropTarget.hidden = false;
    });
    host.addEventListener('dragend', () => { dropTarget.hidden = true; dragging = false; suppressClickUntil = Date.now() + 250; });
    dropTarget.addEventListener('dragover', (event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; dropTarget.classList.add('is-over'); });
    dropTarget.addEventListener('dragleave', () => dropTarget.classList.remove('is-over'));
    dropTarget.addEventListener('drop', (event) => {
      event.preventDefault();
      const id = event.dataTransfer.getData('application/x-zen-course-id') || event.dataTransfer.getData('text/plain');
      if (catalog.has(id)) saveEnrollment(id);
      dropTarget.hidden = true;
      dropTarget.classList.remove('is-over');
      dragging = false;
      suppressClickUntil = Date.now() + 250;
    });

    // Capture touch gestures on cards as well as the background. A moved touch
    // suppresses its click; a stationary tap still opens the course drawer.
    const pointers = new Map();
    let gesture = null;
    const beginGesture = () => {
      const points = [...pointers.values()];
      if (!points.length) { gesture = null; viewport.classList.remove('is-moving'); return; }
      const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
      gesture = { camera: { ...camera }, center, distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, moved: false };
    };
    viewport.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || (event.pointerType === 'mouse' && event.target.closest('[data-course-id]'))) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      beginGesture();
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId) || !gesture) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const points = [...pointers.values()];
      const center = points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0];
      const dx = center.x - gesture.center.x, dy = center.y - gesture.center.y;
      if (Math.hypot(dx, dy) > 5 || points.length > 1) { gesture.moved = true; suppressClickUntil = Date.now() + 350; viewport.classList.add('is-moving'); }
      if (!gesture.moved) return;
      camera = points.length > 1 ? zoomAt(gesture.camera, gesture.camera.scale * Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / Math.max(1, gesture.distance), gesture.center) : { ...gesture.camera };
      camera.x += dx; camera.y += dy;
      applyCamera();
    });
    const endPointer = (event) => {
      if (!pointers.has(event.pointerId)) return;
      const moved = gesture?.moved;
      pointers.delete(event.pointerId);
      if (moved) suppressClickUntil = Date.now() + 350;
      else if (event.pointerType !== 'mouse') {
        const target = doc.elementFromPoint(event.clientX, event.clientY)?.closest('[data-course-id]');
        if (target) { renderDetail(target.dataset.courseId); suppressClickUntil = Date.now() + 350; }
      }
      beginGesture();
    };
    viewport.addEventListener('pointerup', endPointer);
    viewport.addEventListener('pointercancel', (event) => { pointers.delete(event.pointerId); beginGesture(); suppressClickUntil = Date.now() + 350; });
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      camera = zoomAt(camera, camera.scale * Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * .002), { x: event.clientX, y: event.clientY });
      applyCamera();
    }, { passive: false });
    viewport.addEventListener('keydown', (event) => {
      if (event.target !== viewport) return;
      const step = event.shiftKey ? 400 : 100;
      const offsets = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (offsets[event.key]) { event.preventDefault(); camera.x += offsets[event.key][0]; camera.y += offsets[event.key][1]; applyCamera(); }
      if (['+', '-', '='].includes(event.key)) { event.preventDefault(); camera = zoomAt(camera, camera.scale * (event.key === '-' ? .8 : 1.25), { x: size().width / 2, y: size().height / 2 }); applyCamera(); }
    });
    for (const [id, multiplier] of [['map-zoom-in', 1.25], ['map-zoom-out', .8]]) doc.getElementById(id).addEventListener('click', () => { camera = zoomAt(camera, camera.scale * multiplier, { x: size().width / 2, y: size().height / 2 }); applyCamera(); });
    doc.getElementById('map-normal').addEventListener('click', () => { camera = zoomAt(camera, 1, { x: size().width / 2, y: size().height / 2 }); applyCamera(); });
    doc.getElementById('map-fit').addEventListener('click', () => { camera = fitMap(layout, size()); applyCamera(); });
    doc.getElementById('map-menu-toggle').addEventListener('click', () => {
      const menu = doc.getElementById('map-menu');
      menu.hidden = !menu.hidden;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', String(!menu.hidden));
      doc.getElementById('map-search-results').hidden = true;
    });
    doc.getElementById('map-enrollment-toggle').addEventListener('click', () => {
      if (!drawer.hidden && drawerMode === 'enrollment') return closeDrawer();
      enrollment = utils.readEnrollmentState(storage, keys);
      updateNodes(); openDrawer('enrollment', 'マイ履修'); renderEnrollment();
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
    for (const value of [...new Set(courses.map((course) => course.tag).filter(Boolean))].sort()) { const option = element('option', value); option.value = value; field.append(option); }
    field.addEventListener('change', () => { for (const [id, node] of nodes) node.classList.toggle('is-dimmed', Boolean(field.value && catalog.get(id).tag !== field.value)); });
    doc.getElementById('map-relation-mode').addEventListener('change', (event) => { relationMode = event.target.value; drawRelations(); });
    doc.querySelectorAll('[data-map-year]').forEach((button) => button.addEventListener('click', () => {
      const options = courses.filter((course) => Number.parseInt(course.year) === Number(button.dataset.mapYear));
      const target = options.sort((a, b) => positions.get(a.id).y - positions.get(b.id).y)[0];
      if (target) focusCourse(target.id);
      doc.getElementById('map-menu').hidden = true;
      doc.getElementById('map-menu-toggle').setAttribute('aria-expanded', 'false');
    }));
    const search = doc.getElementById('map-search');
    const results = doc.getElementById('map-search-results');
    const matches = () => courses.filter((course) => `${course.subject} ${course.teacher || ''}`.toLocaleLowerCase('ja').includes(search.value.trim().toLocaleLowerCase('ja')));
    search.addEventListener('input', () => {
      results.replaceChildren();
      const candidates = matches();
      results.hidden = !search.value.trim();
      if (!candidates.length) results.append(element('p', '該当する科目はありません'));
      for (const course of candidates) {
        const button = element('button', course.subject); button.type = 'button';
        button.addEventListener('click', () => { focusCourse(course.id); results.hidden = true; search.blur(); });
        results.append(button);
      }
    });
    doc.getElementById('map-search-form').addEventListener('submit', (event) => {
      event.preventDefault();
      if (!search.value.trim()) return;
      const candidates = matches();
      if (candidates.length) { focusCourse(candidates[0].id); results.hidden = true; search.blur(); }
      else status('該当する科目はありません');
    });
    win.addEventListener('storage', (event) => {
      if (![keys.registered, keys.completed, keys.schemaVersion].includes(event.key) && event.key !== null) return;
      enrollment = utils.readEnrollmentState(storage, keys); updateNodes();
      if (drawerMode === 'enrollment') renderEnrollment();
      if (drawerMode === 'detail') renderDetail(selectedId, false);
    });
    win.addEventListener('resize', applyCamera);
    doc.getElementById('map-app').hidden = false;
    doc.getElementById('map-unavailable').hidden = true;
    // A first-year cluster gives an immediate readable view of neighboring
    // subjects; the single introductory card leaves most screens blank.
    const first = positions.get('data_science_intro') || layout.positions[0];
    camera = centerOn(first, size(), 1);
    applyCamera(); updateNodes();
    if (!enrollment.writable) status('保存データを読み取れません。既存データは変更しません。', true);
    // Optional datasets do not block the map or enrollment if unavailable.
    await Promise.all([
      fetchJSON('course-relations.json').then((data) => { relations = data.filter((item) => catalog.has(item.prerequisiteId) && catalog.has(item.successorId)); drawRelations(); }).catch((error) => console.warn('参考関係を読み込めません:', error)),
      fetchJSON('difficulty.json').then((data) => { difficulty = Array.isArray(data) ? Object.fromEntries(data.map((item) => [item.courseId || item.id, item])) : data; }).catch((error) => console.warn('難易度を読み込めません:', error))
    ]);
  }
  return { buildLayout, intersects, zoomAt, centerOn, fitMap, start };
}));
