const test = require('node:test');
const assert = require('node:assert/strict');
const quality = require('../quality-utils.js');
const rules = require('../src/domain/enrollment-state.js');
const { create } = require('../src/features/enrollment/controller.js');

function fixture(fail = () => false) {
  const initial = {
    myClasses: '["a","unknown"]',
    completedClasses: '["b"]',
    zenCourseHubStorageSchemaVersion: '1',
  };
  const values = new Map(Object.entries(initial));
  let redraws = 0;
  const state = {
    registeredClasses: new Set(['a', 'unknown']),
    completedClasses: new Set(['b']),
    storageWritable: true,
  };
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail(key)) throw Error('storage unavailable');
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
  const controller = create({
    state,
    storageWarning: null,
    enrollmentStorageBackend: storage,
    qualityUtils: quality,
    enrollmentRules: rules,
    STORAGE_KEYS: {
      REGISTERED: 'myClasses',
      COMPLETED: 'completedClasses',
      SCHEMA_VERSION: 'zenCourseHubStorageSchemaVersion',
    },
    renderAll: () => {
      redraws++;
    },
  });
  return { initial, values, state, controller, redraws: () => redraws };
}

test('enrollment persists the legacy arrays before exposing an exclusive state transition', () => {
  const f = fixture();
  assert.equal(f.controller.commitStateChange('b', 'REGISTER'), true);
  assert.deepEqual([...f.state.registeredClasses], ['a', 'unknown', 'b']);
  assert.deepEqual([...f.state.completedClasses], []);
  assert.equal(f.values.get('myClasses'), '["a","unknown","b"]');
  assert.equal(f.redraws(), 1);
  assert.equal(f.controller.commitStateChange('a', 'COMPLETE'), true);
  assert.deepEqual([...f.state.completedClasses], ['a']);
});

test('partial storage failure rolls back persisted bytes and leaves live state and UI untouched', () => {
  let failed = false;
  const f = fixture((key) => key === 'completedClasses' && !failed && (failed = true));
  assert.equal(f.controller.commitStateChange('a', 'COMPLETE'), false);
  assert.deepEqual(Object.fromEntries(f.values), f.initial);
  assert.deepEqual([...f.state.registeredClasses], ['a', 'unknown']);
  assert.deepEqual([...f.state.completedClasses], ['b']);
  assert.equal(f.redraws(), 0);
});

test('unrecoverable rollback stops later writes without discarding live enrollment', () => {
  const f = fixture((key) => key === 'completedClasses');
  assert.equal(f.controller.commitStateChange('a', 'COMPLETE'), false);
  assert.equal(f.state.storageWritable, false);
  assert.equal(f.controller.commitStateChange('new', 'REGISTER'), false);
  assert.deepEqual([...f.state.registeredClasses], ['a', 'unknown']);
  assert.equal(f.redraws(), 0);
});

test('pure transitions neither mutate inputs nor accept invalid actions and controller instances are isolated', () => {
  const a = fixture(),
    b = fixture();
  const next = rules.transition(a.state, 'a', 'COMPLETE');
  assert.notEqual(next.registeredClasses, a.state.registeredClasses);
  assert.deepEqual([...a.state.registeredClasses], ['a', 'unknown']);
  assert.equal(rules.transition(a.state, '', 'REGISTER'), null);
  assert.equal(rules.transition(a.state, 'a', 'UNKNOWN'), null);
  a.controller.commitStateChange('b', 'DELETE');
  assert.deepEqual([...b.state.completedClasses], ['b']);
});
