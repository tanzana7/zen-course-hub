/** 静的JSONの取得・正規化・検証。通信と卒業要件エンジンを注入し、用途ごとに失敗の影響を限定する。 */
(function expose(root, factory) {
  const api = { create: factory };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenHubRepository = api;
})(typeof window !== 'undefined' ? window : globalThis, function create(context) {
  'use strict';
  const fetchJSON = async (file) => {
    const response = await context.fetch(file);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const normalizeClass = (cls) => {
    const subject = typeof cls === 'string' ? cls : cls?.subject;
    if (!subject) return null;
    return {
      ...(typeof cls === 'object' && cls !== null ? cls : {}),
      id: cls?.id || '',
      subject: subject,
      credits: Number(cls?.credits || 0),
      tag: String(cls?.tag || ''),
      tags: Array.isArray(cls?.tags) ? cls.tags : cls?.tag ? [String(cls.tag)] : [],
    };
  };

  const normalizeDifficulty = (entry) => {
    try {
      const id = typeof entry?.id === 'string' ? entry.id.trim() : '';
      const average = Number(entry?.average);
      const votes = Number(entry?.votes);
      const sourceUrl = typeof entry?.sourceUrl === 'string' ? entry.sourceUrl.trim() : '';
      const sourceName = typeof entry?.sourceName === 'string' ? entry.sourceName.trim() : '';
      const sourceAuthor = typeof entry?.sourceAuthor === 'string' ? entry.sourceAuthor.trim() : '';
      const sourceLabel =
        typeof entry?.sourceLabel === 'string' && entry.sourceLabel.trim()
          ? entry.sourceLabel.trim()
          : `${sourceName || '出典'}${sourceAuthor ? `（運営：${sourceAuthor}）` : ''}`;
      const safeSourceUrl = context.sanitizeExternalUrl(sourceUrl);

      if (
        !id ||
        !Number.isFinite(average) ||
        average < 0 ||
        average > 10 ||
        !Number.isInteger(votes) ||
        votes < 0 ||
        !safeSourceUrl
      ) {
        console.warn('不正な難易度データを除外しました:', entry);
        return null;
      }

      return { id, average, votes, sourceUrl: safeSourceUrl, sourceLabel };
    } catch (error) {
      console.warn('難易度データの検証に失敗しました:', error);
      return null;
    }
  };

  const loadDifficultyData = async () => {
    try {
      const difficultyData = await fetchJSON('difficulty.json');
      if (!Array.isArray(difficultyData)) {
        throw new TypeError('難易度データのルート要素が配列ではありません');
      }

      return new Map(
        difficultyData
          .map(normalizeDifficulty)
          .filter(Boolean)
          .map((entry) => [entry.id, entry]),
      );
    } catch (error) {
      // 難易度は任意情報のため、失敗しても授業データの読み込みを継続する
      console.warn('難易度データを読み込めませんでした。難易度欄を非表示にします:', error);
      return new Map();
    }
  };

  const loadGraduationDefinitionData = async () => {
    try {
      if (!context.engine) throw new Error('卒業要件エンジンが読み込まれていません');
      const definition = await fetchJSON('graduation-requirements.json');
      const validation = context.engine.validateRequirementsDefinition(definition);
      if (!validation.valid) throw new Error(validation.message);
      return definition;
    } catch (error) {
      console.error('卒業要件定義を読み込めませんでした。判定を無効化します:', error);
      return null;
    }
  };

  const loadCourseRelationsData = async () => {
    try {
      const relations = await fetchJSON('course-relations.json');
      if (!Array.isArray(relations)) throw new TypeError('関係データのルート要素が配列ではありません');
      return relations;
    } catch (error) {
      console.warn('前提・後継科目データを読み込めませんでした。関連科目欄を非表示にします:', error);
      return [];
    }
  };

  const loadCurriculumLayoutDefinition = async () => {
    try {
      const definition = await fetchJSON('curriculum-tree-layout.json');
      if (!definition?.canvas || !Array.isArray(definition.columns) || !Array.isArray(definition.bands)) {
        throw new TypeError('カリキュラムツリー配置定義の形式が不正です');
      }
      return definition;
    } catch (error) {
      console.warn('公式配置定義を読み込めませんでした。既定の構図を使用します:', error);
      return null;
    }
  };

  const buildRelationsMap = (relations, coursesMap) => {
    const map = new Map();
    const ensure = (id) => {
      if (!map.has(id)) map.set(id, { prerequisites: [], successors: [] });
      return map.get(id);
    };

    (Array.isArray(relations) ? relations : []).forEach((entry) => {
      const prerequisiteId = typeof entry?.prerequisiteId === 'string' ? entry.prerequisiteId.trim() : '';
      const successorId = typeof entry?.successorId === 'string' ? entry.successorId.trim() : '';
      const strength =
        entry?.strength === 'strongly_recommended' || entry?.strength === 'recommended' ? entry.strength : '';
      if (!prerequisiteId || !successorId || prerequisiteId === successorId) return;
      if (!strength) {
        console.warn('不正な強度の関係を除外しました:', entry);
        return;
      }
      if (!coursesMap.has(prerequisiteId) || !coursesMap.has(successorId)) {
        console.warn('存在しない科目IDを含む関係を除外しました:', entry);
        return;
      }

      const prerequisiteRelations = ensure(prerequisiteId);
      const successorRelations = ensure(successorId);
      if (!prerequisiteRelations.successors.some((relation) => relation.id === successorId)) {
        prerequisiteRelations.successors.push({ id: successorId, strength });
      }
      if (!successorRelations.prerequisites.some((relation) => relation.id === prerequisiteId)) {
        successorRelations.prerequisites.push({ id: prerequisiteId, strength });
      }
    });

    return map;
  };

  const sortCourseData = (data) => {
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
    return data;
  };
  return {
    normalizeClass,
    loadDifficultyData,
    loadGraduationDefinitionData,
    loadCourseRelationsData,
    loadCurriculumLayoutDefinition,
    buildRelationsMap,
    sortCourseData,
  };
});
