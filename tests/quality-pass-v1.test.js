const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const quality = require('../quality-utils.js');

const createStorage = (initial = {}, { failOn = null, mismatchOn = null } = {}) => {
  const values = new Map(Object.entries(initial));
  let failuresRemaining = failOn ? 1 : 0;
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (key === failOn && failuresRemaining > 0) {
        failuresRemaining -= 1;
        throw new Error(`write failed: ${key}`);
      }
      if (key === mismatchOn) return;
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    mismatchOn
  };
};

const keys = { registered: 'myClasses', completed: 'completedClasses', schemaVersion: 'zenCourseHubStorageSchemaVersion' };

test('legacy enrollment arrays load without a destructive migration and preserve unknown IDs', () => {
  const storage = createStorage({ myClasses: '["known", "old-course", "known"]', completedClasses: '[]' });
  const loaded = quality.readEnrollmentState(storage, keys);
  assert.deepEqual(loaded.registered.ids, ['known', 'old-course']);
  assert.equal(loaded.registered.status, 'legacy');
  assert.equal(loaded.writable, true);
  assert.equal(storage.values.has(keys.schemaVersion), false);
});

test('malformed and invalid enrollment values are distinguished and cannot be overwritten', () => {
  for (const raw of ['{', 'null', '"not-an-array"', '["ok", 42]']) {
    const storage = createStorage({ myClasses: raw, completedClasses: '[]' });
    const loaded = quality.readEnrollmentState(storage, keys);
    assert.notEqual(loaded.registered.status, 'legacy');
    assert.equal(loaded.writable, false);
    const result = quality.saveEnrollmentState(storage, keys, new Set(['new']), new Set());
    assert.equal(result.saved, false);
    assert.equal(storage.values.get(keys.registered), raw);
  }
});

test('future schema versions are read-only and remain untouched', () => {
  const storage = createStorage({
    myClasses: '["old"]',
    completedClasses: '["done"]',
    [keys.schemaVersion]: '99'
  });
  const loaded = quality.readEnrollmentState(storage, keys);
  assert.equal(loaded.schema.status, 'future');
  assert.equal(loaded.writable, false);
  const result = quality.saveEnrollmentState(storage, keys, new Set(['new']), new Set());
  assert.equal(result.saved, false);
  assert.equal(storage.values.get(keys.schemaVersion), '99');
  assert.equal(storage.values.get(keys.registered), '["old"]');
});

test('successful enrollment save preserves unknown IDs and writes schema metadata', () => {
  const storage = createStorage({ myClasses: '["unknown"]', completedClasses: '[]' });
  const result = quality.saveEnrollmentState(storage, keys, new Set(['unknown', 'known']), new Set(['done']));
  assert.equal(result.saved, true);
  assert.deepEqual(JSON.parse(storage.values.get(keys.registered)), ['unknown', 'known']);
  assert.deepEqual(JSON.parse(storage.values.get(keys.completed)), ['done']);
  assert.equal(storage.values.get(keys.schemaVersion), '1');
});

test('second-key write failure rolls both enrollment keys back', () => {
  const storage = createStorage({ myClasses: '["before"]', completedClasses: '["done"]' }, { failOn: 'completedClasses' });
  const result = quality.saveEnrollmentState(storage, keys, new Set(['after']), new Set());
  assert.equal(result.saved, false);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(storage.values.get(keys.registered), '["before"]');
  assert.equal(storage.values.get(keys.completed), '["done"]');
  assert.equal(storage.values.has(keys.schemaVersion), false);
});

test('first-key write failure leaves both enrollment keys untouched', () => {
  const storage = createStorage({ myClasses: '["before"]', completedClasses: '["done"]' }, { failOn: 'myClasses' });
  const result = quality.saveEnrollmentState(storage, keys, new Set(['after']), new Set());
  assert.equal(result.saved, false);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(storage.values.get(keys.registered), '["before"]');
  assert.equal(storage.values.get(keys.completed), '["done"]');
  assert.equal(storage.values.has(keys.schemaVersion), false);
});

test('rollback failure marks the state uncertain instead of reporting success', () => {
  const values = new Map([
    [keys.registered, '["before"]'],
    [keys.completed, '["done"]']
  ]);
  let completedWrites = 0;
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (key === keys.completed) {
        completedWrites += 1;
        if (completedWrites >= 1) throw new Error('completed write unavailable');
      }
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
  const result = quality.saveEnrollmentState(storage, keys, new Set(['after']), new Set());
  assert.equal(result.saved, false);
  assert.equal(result.rollbackSucceeded, false);
  assert.ok(result.rollbackErrors.length > 0);
  assert.equal(values.get(keys.registered), '["before"]');
});

test('read-back mismatch is treated as a failed save', () => {
  const storage = createStorage({ myClasses: '[]', completedClasses: '[]' }, { mismatchOn: 'completedClasses' });
  const result = quality.saveEnrollmentState(storage, keys, new Set(['next']), new Set(['done']));
  assert.equal(result.saved, false);
  assert.equal(result.rollbackSucceeded, true);
  assert.equal(storage.values.get(keys.registered), '[]');
  assert.equal(storage.values.get(keys.completed), '[]');
});

test('quota and security failures are handled as non-successful writes', () => {
  for (const errorName of ['QuotaExceededError', 'SecurityError']) {
    const storage = createStorage({ myClasses: '[]', completedClasses: '[]' }, { failOn: 'myClasses' });
    storage.setItem = () => { const error = new Error(errorName); error.name = errorName; throw error; };
    const result = quality.saveEnrollmentState(storage, keys, new Set(['next']), new Set());
    assert.equal(result.saved, false);
    assert.equal(result.rollbackSucceeded, false);
    assert.equal(storage.values.get(keys.registered), '[]');
    assert.equal(storage.values.get(keys.completed), '[]');
  }
});

test('a reload-style read preserves a successfully saved state and its schema', () => {
  const storage = createStorage({ myClasses: '[]', completedClasses: '[]' });
  const saved = quality.saveEnrollmentState(storage, keys, new Set(['known', 'unknown']), new Set(['completed']));
  assert.equal(saved.saved, true);
  const reloaded = quality.readEnrollmentState(storage, keys);
  assert.deepEqual(reloaded.registered.ids, ['known', 'unknown']);
  assert.deepEqual(reloaded.completed.ids, ['completed']);
  assert.equal(reloaded.schema.version, 1);
  assert.equal(reloaded.writable, true);
});

test('escapeHTML handles numbers and malicious course text without producing markup', () => {
  assert.equal(quality.escapeHTML(12), '12');
  assert.equal(quality.escapeHTML('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(quality.escapeHTML('"\'&'), '&quot;&#39;&amp;');
});

test('external URL sanitizer allows only http(s) and rejects script, data, and relative URLs', () => {
  assert.equal(quality.sanitizeExternalUrl('https://example.com/syllabus?q=1'), 'https://example.com/syllabus?q=1');
  assert.equal(quality.sanitizeExternalUrl('HTTP://example.com/'), 'http://example.com/');
  for (const value of ['javascript:alert(1)', 'data:text/html,<svg>', '//example.com', '/relative', 'not a url']) {
    assert.equal(quality.sanitizeExternalUrl(value), null);
  }
});

test('app loads courses before optional data and uses sanitized syllabus URLs', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(app, /const coursesRes = await fetch\('courses\.json'\)/);
  assert.match(app, /const difficultyPromise = loadDifficultyData\(\)/);
  assert.match(app, /if \(!state\.coursesReady\) return;/);
  assert.match(app, /授業データの読み込みに失敗しました。ページを再読み込みしてください。/);
  assert.match(app, /const safeSyllabusUrl = sanitizeExternalUrl\(data\.url\)/);
  assert.match(app, /if \(!result\.saved\)/);
  assert.match(index, /授業データを読み込み中…/);
});
