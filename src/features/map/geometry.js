/** Pure official-map layout and camera geometry; no DOM, storage or network access. */
(function expose(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenMapLayout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CARD_WIDTH = 224;

  const CARD_HEIGHT = 128;

  const PROMINENT_CARD_WIDTH = 264;

  const PROMINENT_CARD_HEIGHT = 156;

  const CARD_PITCH_X = 280;

  const CARD_PITCH_Y = 176;

  const FIELD_ORDER = [
    '情報',
    '数理',
    '多言語',
    '文化・思想',
    '社会・ネットワーク',
    '経済・マーケット',
    'デジタル産業',
    '社会接続',
    '自由科目',
  ];

  const FIELD_COLORS = {
    情報: '#e1eafb',
    数理: '#e1eafb',
    多言語: '#ffe5ed',
    '文化・思想': '#e2f4f1',
    '社会・ネットワーク': '#e2f4f1',
    '経済・マーケット': '#e2f4f1',
    デジタル産業: '#e2f4f1',
    社会接続: '#f0f0df',
    自由科目: '#eee6f4',
  };

  const intersects = (a, b) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

  const buildLayout = (definition, courses) => {
    const byId = new Map(courses.map((course) => [course.id, course]));
    if (byId.size !== courses.length || definition.coursePlacements.length !== courses.length)
      throw new Error('科目配置の数を確認できません');
    const entries = definition.coursePlacements;
    if (
      entries.some(
        (entry) => !byId.has(entry.courseId) || !Number.isFinite(entry.x) || !Number.isFinite(entry.y),
      )
    )
      throw new Error('科目配置を確認できません');
    const sortBySource = (a, b) => a.y - b.y || a.x - b.x || a.courseId.localeCompare(b.courseId);
    const placed = [];
    const put = (entry, x, y, region) => {
      const course = byId.get(entry.courseId);
      // Mandatory courses and the graduation project are the map's primary
      // wayfinding anchors. Their larger blocks make the official stage
      // hierarchy visible without inventing a new importance score from
      // course names or descriptions.
      const prominent = course.category === '必修' || entry.category === '卒業プロジェクト';
      placed.push({
        id: entry.courseId,
        x,
        y,
        width: prominent ? PROMINENT_CARD_WIDTH : CARD_WIDTH,
        height: prominent ? PROMINENT_CARD_HEIGHT : CARD_HEIGHT,
        prominence: prominent ? 'prominent' : 'standard',
        sourceX: entry.x,
        sourceY: entry.y,
        year: course.year,
        field: entry.field,
        stage: entry.category,
        region,
      });
    };
    const intro = entries.filter((entry) => entry.category === '導入科目').sort(sortBySource);
    const introColumns = [...new Set(intro.map((entry) => entry.x))].sort((a, b) => a - b);
    const introSlots = new Map();
    intro.forEach((entry) => {
      const column = introColumns.indexOf(entry.x);
      const row = introSlots.get(column) || 0;
      introSlots.set(column, row + 1);
      put(entry, 84 + column * CARD_PITCH_X, 178 + row * CARD_PITCH_Y, 'intro');
    });
    const introHeight = 178 + Math.max(...introSlots.values(), 0) * CARD_PITCH_Y + 46;
    const gridEntries = entries.filter(
      (entry) => entry.category !== '導入科目' && entry.category !== '卒業プロジェクト',
    );
    const fields = FIELD_ORDER.filter((field) => gridEntries.some((entry) => entry.field === field)).map(
      (field) => {
        const maximum = Math.max(
          ...[1, 2, 3, 4].map(
            (year) =>
              gridEntries.filter(
                (entry) =>
                  entry.field === field && Number.parseInt(byId.get(entry.courseId).year, 10) === year,
              ).length,
          ),
        );
        return { field, lanes: Math.max(1, Math.ceil(maximum / 7)), color: FIELD_COLORS[field] };
      },
    );
    if (gridEntries.some((entry) => !FIELD_ORDER.includes(entry.field)))
      throw new Error('未確認の分野があります');
    let nextX = 64;
    for (const field of fields) {
      field.x = nextX;
      field.width = field.lanes * CARD_PITCH_X + 36;
      nextX += field.width + 16;
    }
    const width = Math.max(nextX + 48, 1600);
    const years = [];
    let nextY = introHeight;
    for (let year = 1; year <= 4; year++) {
      const rows = Math.max(
        ...fields.map(({ field, lanes }) =>
          Math.ceil(
            gridEntries.filter(
              (entry) => entry.field === field && Number.parseInt(byId.get(entry.courseId).year, 10) === year,
            ).length / lanes,
          ),
        ),
      );
      const region = { year, y: nextY, height: 136 + rows * CARD_PITCH_Y + 28 };
      years.push(region);
      for (const field of fields) {
        const group = gridEntries
          .filter(
            (entry) =>
              entry.field === field.field && Number.parseInt(byId.get(entry.courseId).year, 10) === year,
          )
          .sort(sortBySource);
        group.forEach((entry, index) =>
          put(
            entry,
            field.x + 18 + (index % field.lanes) * CARD_PITCH_X,
            nextY + 130 + Math.floor(index / field.lanes) * CARD_PITCH_Y,
            `year-${year}`,
          ),
        );
      }
      nextY += region.height + 16;
    }
    const project = entries.filter((entry) => entry.category === '卒業プロジェクト');
    project.forEach((entry, index) => put(entry, 84 + index * CARD_PITCH_X, nextY + 110, 'project'));
    if (placed.length !== byId.size || new Set(placed.map((box) => box.id)).size !== byId.size) {
      const ids = new Set(placed.map((box) => box.id));
      throw new Error(
        `科目配置に欠落または重複があります: ${entries
          .filter((entry) => !ids.has(entry.courseId))
          .map((entry) => entry.courseId)
          .join(', ')}`,
      );
    }
    return {
      positions: placed,
      width,
      height: nextY + 110 + Math.max(1, project.length) * CARD_PITCH_Y + 50,
      fields,
      years,
      introHeight,
      projectY: nextY,
    };
  };

  const zoomAt = (camera, nextScale, anchor) => {
    const scale = Math.max(0.05, Math.min(2.4, nextScale));
    return {
      scale,
      x: anchor.x - ((anchor.x - camera.x) * scale) / camera.scale,
      y: anchor.y - ((anchor.y - camera.y) * scale) / camera.scale,
    };
  };

  const centerOn = (box, viewport, scale = 1) => ({
    scale,
    x: viewport.width / 2 - (box.x + box.width / 2) * scale,
    y: viewport.height / 2 - (box.y + box.height / 2) * scale,
  });

  const initialCamera = (layout, viewport) => {
    const firstYear = layout.years[0];
    const centralField = layout.fields.find((field) => field.field === '文化・思想');
    const centralCard = layout.positions
      .filter((box) => box.region === 'year-1' && box.field === centralField?.field)
      .sort((a, b) => a.x - b.x || a.y - b.y)[0];
    const centralStart = layout.positions
      .filter((box) => box.region === 'year-1' && box.field === '多言語')
      .sort((a, b) => a.x - b.x || a.y - b.y)[0];
    const firstVisibleX =
      viewport.width < 600
        ? centralCard?.x || layout.width / 2
        : centralStart?.x || centralCard?.x || layout.width / 2;
    const target = { x: firstVisibleX + viewport.width / 2, y: firstYear.y + 350 };
    return { scale: 1, x: viewport.width / 2 - target.x, y: viewport.height / 2 - target.y };
  };

  const fitMap = (layout, viewport) => {
    const scale = Math.min((viewport.width - 40) / layout.width, (viewport.height - 140) / layout.height, 1);
    return {
      scale: Math.max(0.05, scale),
      x: (viewport.width - layout.width * scale) / 2,
      y: (viewport.height - layout.height * scale) / 2 + 20,
    };
  };
  return { CARD_PITCH_Y, intersects, buildLayout, zoomAt, centerOn, initialCamera, fitMap };
});
