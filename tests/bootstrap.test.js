const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readHubSource } = require('./helpers/hub-source.cjs');
const courseSorting = require('../course-sorting.js');

test('an unresolved optional exam request cannot block course discovery or bootstrap without simulator rules', () => {
  let ready;
  let requests = 0;
  const document = {
    addEventListener: (name, callback) => {
      if (name === 'DOMContentLoaded') ready = callback;
    },
    getElementById: () => null,
    querySelectorAll: () => [],
  };
  vm.runInNewContext(readHubSource(), {
    document,
    window: {
      addEventListener() {},
      clearTimeout() {},
      setTimeout() {},
      CourseSorting: courseSorting,
      ZenExam: { ready: new Promise(() => {}) },
    },
    localStorage: { getItem: () => null },
    fetch: () => {
      requests++;
      return new Promise(() => {});
    },
    console,
    URL,
    Map,
    Set,
  });
  ready();
  assert.equal(requests, 3);
});
