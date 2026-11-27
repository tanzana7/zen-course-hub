const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalog, getEnrollmentRows, reportUrl } = require('../exam-schedule.js');
const record = (courseId, courseName, examSlots) => ({ courseId, courseName, examSlots });
const slot = (date, period) => ({ date, period });

test('schedule search preserves collisions with filtered courses and sorts by date and period', () => {
  const data = {
    matched: [
      record('a', 'Alpha', [slot('2027-02-19', 6), slot('2027-02-16', 4)]),
      record('b', 'Beta', [slot('2027-02-16', 4), slot('2027-02-16', 1)]),
      record('c', 'Gamma', [slot('2027-02-19', 6)]),
    ],
  };
  const original = JSON.stringify(data);
  const catalog = createCatalog(data);
  assert.deepEqual(
    getEnrollmentRows(catalog, ['a', 'a', 'b', 'unknown'], 'Alpha').map((row) => [
      row.date,
      row.period,
      row.collision,
    ]),
    [
      ['2027-02-16', 4, true],
      ['2027-02-19', 6, false],
    ],
  );
  assert.equal(getEnrollmentRows(catalog, ['b'])[0].period, 1);
  assert.equal(getEnrollmentRows(catalog, ['unknown']).length, 0);
  assert.equal(JSON.stringify(data), original);
});

test('duplicate slots in one course never cause a cross-course warning', () => {
  const catalog = createCatalog({
    matched: [record('a', 'Alpha', [slot('2027-02-16', 1), slot('2027-02-16', 1)])],
  });
  assert.ok(getEnrollmentRows(catalog, ['a']).every((row) => !row.collision));
});

test('completed courses stay listed but never trigger collision warnings', () => {
  const catalog = createCatalog({
    matched: [
      record('a', 'Alpha', [slot('2027-02-16', 4), slot('2027-02-19', 6)]),
      record('b', 'Beta', [slot('2027-02-16', 4)]),
    ],
  });
  // 予定同士の重なりは警告される。
  assert.ok(getEnrollmentRows(catalog, ['a', 'b']).some((row) => row.collision));
  // a を履修済みにすると、予定・済みをまたぐ重なりは警告対象外（a の行にも付かない）。
  const rows = getEnrollmentRows(catalog, ['a', 'b'], '', ['a']);
  assert.ok(rows.every((row) => !row.collision));
  // 履修済みの行は completed 付きで列挙が残る。
  assert.deepEqual(
    rows.filter((row) => row.completed).map((row) => row.courseId),
    ['a', 'a'],
  );
  // 予定同士の警告の数え方は変わらない（第4引数なしと同じ）。
  assert.deepEqual(
    getEnrollmentRows(catalog, ['a', 'b']).filter((row) => row.collision).length,
    getEnrollmentRows(catalog, ['a', 'b'], '', []).filter((row) => row.collision).length,
  );
});

test('invalid catalog identities and periods fail without returning partial results', () => {
  assert.throws(() => createCatalog(null), TypeError);
  assert.throws(() => createCatalog({ matched: [record('a', 'Alpha', [slot('2027-02-16', 0)])] }), TypeError);
  assert.throws(
    () => createCatalog({ matched: [record('a', 'Alpha', []), record('a', 'Other', [])] }),
    TypeError,
  );
});

test('report URLs preserve text without turning reserved characters into extra fields', () => {
  const url = new URL(
    reportUrl({ id: 'a&category=other', subject: '<科目> "&' }, '科目情報の誤り'),
    'https://example.test/',
  );
  assert.equal(url.pathname, '/feedback.html');
  assert.equal(url.searchParams.get('courseId'), 'a&category=other');
  assert.equal(url.searchParams.get('category'), '科目情報の誤り');
  assert.equal(url.searchParams.get('courseName'), '<科目> "&');
});
