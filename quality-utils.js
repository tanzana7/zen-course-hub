/**
 * Quality Pass V1 utilities.
 *
 * Enrollment data intentionally keeps the legacy `myClasses` and
 * `completedClasses` array format.  A separate schema key lets future
 * versions refuse an unsafe overwrite without forcing a destructive migration
 * when an existing user opens the app.
 */
(function exposeQualityUtils(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ZenQualityUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const CURRENT_STORAGE_SCHEMA_VERSION = 1;

  const normalizeIdArray = (value) => {
    if (!Array.isArray(value)) return { valid: false, ids: [] };
    const ids = [];
    const seen = new Set();
    for (const item of value) {
      const candidate =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object' && typeof item.id === 'string'
            ? item.id
            : null;
      if (candidate === null || !candidate.trim()) return { valid: false, ids: [] };
      const id = candidate.trim();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return { valid: true, ids };
  };

  const parseIdList = (raw) => {
    if (raw === null) return { status: 'missing', ids: [] };
    if (raw === 'undefined' || raw === 'null') return { status: 'corrupt', ids: [] };
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const normalized = normalizeIdArray(parsed);
        return normalized.valid ? { status: 'legacy', ids: normalized.ids } : { status: 'invalid', ids: [] };
      }
      if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.schemaVersion)) {
        if (parsed.schemaVersion > CURRENT_STORAGE_SCHEMA_VERSION) {
          return { status: 'future', ids: [] };
        }
        const normalized = normalizeIdArray(parsed.ids);
        return normalized.valid ? { status: 'valid', ids: normalized.ids } : { status: 'invalid', ids: [] };
      }
      return { status: 'invalid', ids: [] };
    } catch (error) {
      return { status: 'corrupt', ids: [] };
    }
  };

  const readSchemaVersion = (storage, key) => {
    try {
      const raw = storage.getItem(key);
      if (raw === null) return { status: 'legacy', version: 0 };
      const version = Number(raw);
      if (!Number.isInteger(version) || version < 1) return { status: 'corrupt', version: null };
      if (version > CURRENT_STORAGE_SCHEMA_VERSION) return { status: 'future', version };
      return { status: 'valid', version };
    } catch (error) {
      return { status: 'unavailable', version: null };
    }
  };

  const readEnrollmentState = (storage, keys) => {
    try {
      const registeredRaw = storage.getItem(keys.registered);
      const completedRaw = storage.getItem(keys.completed);
      const registered = parseIdList(registeredRaw);
      const completed = parseIdList(completedRaw);
      const schema = readSchemaVersion(storage, keys.schemaVersion);
      const statuses = [registered.status, completed.status, schema.status];
      const writable = !statuses.some((status) =>
        ['corrupt', 'invalid', 'future', 'unavailable'].includes(status),
      );
      return { registered, completed, schema, writable };
    } catch (error) {
      return {
        registered: { status: 'unavailable', ids: [] },
        completed: { status: 'unavailable', ids: [] },
        schema: { status: 'unavailable', version: null },
        writable: false,
        error,
      };
    }
  };

  const rollback = (storage, previous, keys) => {
    const rollbackErrors = [];
    for (const key of [keys.registered, keys.completed, keys.schemaVersion]) {
      try {
        if (previous[key] === null) storage.removeItem(key);
        else storage.setItem(key, previous[key]);
      } catch (error) {
        rollbackErrors.push({ key, error });
      }
    }
    return { succeeded: rollbackErrors.length === 0, errors: rollbackErrors };
  };

  const saveEnrollmentState = (storage, keys, registeredIds, completedIds) => {
    const current = readEnrollmentState(storage, keys);
    if (!current.writable) {
      return {
        saved: false,
        rollbackSucceeded: true,
        error: new Error('保存データの形式またはスキーマを確認できないため上書きしません'),
      };
    }
    const registered = normalizeIdArray(Array.from(registeredIds || []));
    const completed = normalizeIdArray(Array.from(completedIds || []));
    if (!registered.valid || !completed.valid) {
      return { saved: false, rollbackSucceeded: true, error: new TypeError('履修データの形式が不正です') };
    }

    const next = {
      [keys.registered]: JSON.stringify(registered.ids),
      [keys.completed]: JSON.stringify(completed.ids),
      [keys.schemaVersion]: String(CURRENT_STORAGE_SCHEMA_VERSION),
    };
    const previous = {};
    try {
      for (const key of Object.keys(next)) previous[key] = storage.getItem(key);
    } catch (error) {
      return { saved: false, rollbackSucceeded: true, error };
    }

    try {
      for (const key of [keys.registered, keys.completed, keys.schemaVersion]) {
        storage.setItem(key, next[key]);
        if (storage.getItem(key) !== next[key]) throw new Error(`保存内容を検証できませんでした: ${key}`);
      }
      return { saved: true, rollbackSucceeded: true };
    } catch (error) {
      const restored = rollback(storage, previous, keys);
      return {
        saved: false,
        rollbackSucceeded: restored.succeeded,
        rollbackErrors: restored.errors,
        error,
      };
    }
  };

  const escapeHTML = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );

  const sanitizeExternalUrl = (value) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const parsed = new URL(trimmed);
      return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
    } catch (error) {
      return null;
    }
  };

  // The curriculum canvas may be much larger than a phone viewport. Fit mode
  // is intentionally allowed below the ordinary 25% manual-zoom floor so the
  // complete map remains discoverable without changing the user's normal zoom
  // controls.
  const calculateCurriculumFit = ({
    viewportWidth,
    viewportHeight,
    contentWidth,
    contentHeight,
    padding = 28,
    maxScale = 1,
    minScale = 0.05,
  }) => {
    const width = Number(viewportWidth);
    const height = Number(viewportHeight);
    const contentW = Number(contentWidth);
    const contentH = Number(contentHeight);
    if (
      ![width, height, contentW, contentH].every(Number.isFinite) ||
      width <= 0 ||
      height <= 0 ||
      contentW <= 0 ||
      contentH <= 0
    ) {
      return { scale: 1, panX: 0, panY: 0, availableWidth: 0, availableHeight: 0 };
    }
    const availableWidth = Math.max(1, width - Math.max(0, Number(padding) || 0));
    const availableHeight = Math.max(1, height - Math.max(0, Number(padding) || 0));
    const rawScale = Math.min(availableWidth / contentW, availableHeight / contentH, Number(maxScale) || 1);
    const scale = Math.max(Number(minScale) || 0.05, Math.min(Number(maxScale) || 1, rawScale));
    return {
      scale: Number(scale.toFixed(4)),
      panX: Number(((width - contentW * scale) / 2).toFixed(2)),
      panY: Number(((height - contentH * scale) / 2).toFixed(2)),
      availableWidth,
      availableHeight,
    };
  };

  return {
    CURRENT_STORAGE_SCHEMA_VERSION,
    normalizeIdArray,
    parseIdList,
    readEnrollmentState,
    saveEnrollmentState,
    escapeHTML,
    sanitizeExternalUrl,
    calculateCurriculumFit,
  };
});
