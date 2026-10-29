/** 埋め込みマップの座標・年次・分野レイアウト。DOMイベントや保存処理は扱わない。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenCurriculumLayout = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const getCurriculumStage = (course) => {
    const stage = String(course?.year || '').trim();
    return ['1年次', '2年次', '3年次', '4年次'].includes(stage) ? stage : '未分類';
  };

  const getCurriculumField = (course) => String(course?.tag || '未分類').trim() || '未分類';

  const getCurriculumTrack = (course) => {
    if (course?.tag === '卒業プロジェクト') return 'プロジェクト実践';
    if (course?.category === '必修') return '導入科目';
    if (course?.foundationRequirement) return '基礎科目';
    if (course?.tag === '社会接続') return '社会接続';
    if (course?.category === '自由' || course?.tag === '自由科目') return '自由科目';
    return '展開科目';
  };

  const fallbackCurriculumDefinition = {
    canvas: { width: 2400, height: 2388 },
    bands: [],
    columns: [
      {
        id: 'foundation',
        label: '基盤リテラシー・数理',
        x: 178,
        width: 360,
        group: 'foundation',
        tags: ['情報', '数理'],
      },
      {
        id: 'foundation-social',
        label: '基礎・社会ネットワーク',
        x: 542,
        width: 350,
        group: 'foundation',
        tags: ['社会・ネットワーク'],
      },
      {
        id: 'multilingual',
        label: '多言語情報理解',
        x: 900,
        width: 140,
        group: 'multilingual',
        tags: ['多言語'],
      },
      { id: 'culture', label: '文化・思想', x: 1058, width: 320, group: 'world', tags: ['文化・思想'] },
      {
        id: 'social',
        label: '社会・ネットワーク',
        x: 1386,
        width: 320,
        group: 'world',
        tags: ['社会・ネットワーク', '社会接続'],
      },
      {
        id: 'economy',
        label: '経済・マーケット',
        x: 1714,
        width: 320,
        group: 'world',
        tags: ['経済・マーケット', 'デジタル産業'],
      },
      { id: 'free', label: '社会接続・自由科目', x: 2048, width: 330, group: 'free', tags: ['自由科目'] },
    ],
  };

  const getCurriculumDefinition = () =>
    context.state.curriculumLayoutDefinition || fallbackCurriculumDefinition;

  const getOfficialColumn = (course, definition) => {
    const columns = definition.columns || [];
    const tag = getCurriculumField(course);
    // The official map places project practice with the world-understanding area.
    // Keep it in a real world column even though the layout definition uses
    // separate band metadata rather than a synthetic `world` column.
    if (course?.tag === '卒業プロジェクト') {
      return (
        columns.find((column) => column.id === 'culture') ||
        columns.find((column) => column.group === 'world') ||
        columns[0]
      );
    }
    if (course?.category === '自由' || tag === '自由科目')
      return columns.find((column) => column.id === 'free') || columns.at(-1);
    if (tag === '多言語')
      return columns.find((column) => column.id === 'multilingual') || columns[2] || columns[0];
    if (tag === '文化・思想')
      return columns.find((column) => column.id === 'culture') || columns[3] || columns[0];
    if (tag === '経済・マーケット' || tag === 'デジタル産業')
      return columns.find((column) => column.id === 'economy') || columns[5] || columns[0];
    if (tag === '社会・ネットワーク' || tag === '社会接続')
      return columns.find((column) => column.id === 'social') || columns[4] || columns[0];
    if (tag === '情報' || tag === '数理' || course?.category === '必修') {
      const id = tag === '社会・ネットワーク' ? 'foundation-social' : 'foundation';
      return columns.find((column) => column.id === id) || columns[0];
    }
    return columns.find((column) => column.id === 'foundation-social') || columns[1] || columns[0];
  };

  const buildCurriculumLayout = () => {
    const definition = getCurriculumDefinition();
    const canvasWidth = Number(definition.canvas?.width) || 2400;
    const canvasHeight = Number(definition.canvas?.height) || 2388;
    const columns = definition.columns?.length ? definition.columns : fallbackCurriculumDefinition.columns;
    const placementMap = new Map(
      (definition.coursePlacements || [])
        .filter((placement) => placement && placement.courseId)
        .map((placement) => [placement.courseId, placement]),
    );
    // Preserve the PDF coordinates in the data file. When two catalog entries
    // share the exact same rectangle, the renderer fans them into a vertical
    // access stack instead of letting the later DOM node make the first one
    // unreachable. This is an interaction affordance, not a new official
    // coordinate.
    const collisionGroups = new Map();
    placementMap.forEach((placement) => {
      const key = ['x', 'y', 'width', 'height'].map((field) => Number(placement[field])).join('|');
      if (!collisionGroups.has(key)) collisionGroups.set(key, []);
      collisionGroups.get(key).push(placement.courseId);
    });
    const collisionInfo = new Map();
    collisionGroups.forEach((courseIds, key) => {
      if (courseIds.length < 2) return;
      courseIds.forEach((courseId, index) =>
        collisionInfo.set(courseId, {
          key,
          index,
          size: courseIds.length,
        }),
      );
    });
    const getPlacementColumn = (course) => {
      const placement = placementMap.get(course.id);
      if (placement?.confidence === 'confirmed' && Number.isFinite(Number(placement.x))) {
        const pdfX = Number(placement.x) * canvasWidth;
        const nearest = columns.reduce((best, column) => {
          const center = Number(column.x) + Number(column.width) / 2;
          if (!best || Math.abs(center - pdfX) < best.distance)
            return { column, distance: Math.abs(center - pdfX) };
          return best;
        }, null);
        if (nearest?.column) return nearest.column;
      }
      // The PDF's orange introduction band spans the foundation columns. Use
      // the manually inspected horizontal coordinate for those cards instead
      // of routing every required course into the first semantic lane.
      if (placement?.category === '導入科目') {
        const x = Number(placement.x);
        const columnId =
          x < 0.225
            ? 'foundation'
            : x < 0.375
              ? 'foundation-social'
              : x < 0.44
                ? 'multilingual'
                : x < 0.575
                  ? 'culture'
                  : x < 0.715
                    ? 'social'
                    : x < 0.85
                      ? 'economy'
                      : 'free';
        return columns.find((column) => column.id === columnId) || getOfficialColumn(course, definition);
      }
      return getOfficialColumn(course, definition);
    };
    const positions = new Map();
    const byColumn = new Map(columns.map((column) => [column.id, []]));
    const compareCourses = (a, b) => {
      const yearA = Number.parseInt(a.year, 10) || 99;
      const yearB = Number.parseInt(b.year, 10) || 99;
      return yearA - yearB || String(a.subject || '').localeCompare(String(b.subject || ''), 'ja');
    };
    context.state.predefinedData.forEach((course) => {
      const column = getPlacementColumn(course) || columns[0];
      if (column && byColumn.has(column.id)) byColumn.get(column.id).push(course);
    });
    byColumn.forEach((items) =>
      items.sort((a, b) => {
        const bucket = (course) =>
          course.tag === '卒業プロジェクト'
            ? 3
            : course.category === '必修'
              ? 0
              : course.foundationRequirement
                ? 1
                : 2;
        return bucket(a) - bucket(b) || compareCourses(a, b);
      }),
    );
    const cardWidth = 142;
    const cardHeight = 76;
    const top = 178;
    const bottom = Math.max(1900, canvasHeight - 120);
    columns.forEach((column) => {
      const items = byColumn.get(column.id) || [];
      const cols = Math.max(1, Math.floor((Number(column.width) - 18) / (cardWidth + 8)));
      items.forEach((course, index) => {
        const row = Math.floor(index / cols);
        const col = index % cols;
        const x = Number(column.x) + 9 + col * (cardWidth + 8);
        const bucket =
          course.tag === '卒業プロジェクト'
            ? 3
            : course.category === '必修'
              ? 0
              : course.foundationRequirement
                ? 1
                : 2;
        const bucketOffset = bucket === 0 ? 0 : bucket === 1 ? 132 : bucket === 2 ? 312 : 1760;
        const y = Math.min(bottom - cardHeight, top + bucketOffset + row * (cardHeight + 10));
        const placement = placementMap.get(course.id);
        const requestedX = placement ? Number(placement.x) * canvasWidth : null;
        const requestedY = placement ? Number(placement.y) * canvasHeight : null;
        const requestedWidth = placement ? Number(placement.width) * canvasWidth : null;
        const requestedHeight = placement ? Number(placement.height) * canvasHeight : null;
        const nodeWidth =
          Number.isFinite(requestedWidth) && requestedWidth > 72 ? Math.min(170, requestedWidth) : cardWidth;
        const nodeHeight =
          Number.isFinite(requestedHeight) && requestedHeight > 48
            ? Math.min(96, requestedHeight)
            : cardHeight;
        // PDF coordinates are global. Clamp only the final card box to its
        // semantic lane so narrow metadata columns never leak into neighbors.
        const laneLeft = Number(column.x) + 9;
        const laneRight = Number(column.x) + Number(column.width) - nodeWidth - 9;
        const positionedX = Number.isFinite(requestedX)
          ? Math.min(laneRight, Math.max(laneLeft, requestedX))
          : x;
        const positionedY = Number.isFinite(requestedY)
          ? Math.min(canvasHeight - nodeHeight - 18, Math.max(150, requestedY))
          : Math.min(bottom - cardHeight, y);
        const collision = collisionInfo.get(course.id);
        const collisionOffset = collision ? collision.index * (nodeHeight + 8) : 0;
        const accessibleY = Math.min(canvasHeight - nodeHeight - 18, positionedY + collisionOffset);
        positions.set(course.id, {
          x: positionedX + nodeWidth / 2,
          y: accessibleY + nodeHeight / 2,
          left: positionedX,
          top: accessibleY,
          width: nodeWidth,
          height: nodeHeight,
          lane: column.id,
          officialGroup: column.group,
          stage: getCurriculumStage(course),
          officialConfidence: placement?.confidence || 'provisional',
          verificationMethod: placement?.verificationMethod || 'structure-fallback',
          collisionGroup: collision?.key || '',
          collisionIndex: collision?.index || 0,
          collisionSize: collision?.size || 1,
        });
      });
    });
    return {
      definition,
      columns,
      positions,
      byColumn,
      graphWidth: canvasWidth,
      graphHeight: canvasHeight,
      nodeWidth: cardWidth,
      nodeHeight: cardHeight,
    };
  };
  return { getCurriculumField, getCurriculumTrack, buildCurriculumLayout };
});
