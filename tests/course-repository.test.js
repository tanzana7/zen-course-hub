const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../src/data/course-repository.js');
const { sanitizeExternalUrl } = require('../quality-utils.js');

test('optional catalog failures recover independently without inventing data', async (t) => {
  t.mock.method(console, 'warn', () => {});
  t.mock.method(console, 'error', () => {});
  const seen = [];
  const repository = create({
    sanitizeExternalUrl,
    fetch: async (file) => {
      seen.push(file);
      return { ok: false, status: 503 };
    },
  });
  assert.equal((await repository.loadDifficultyData()).size, 0);
  assert.deepEqual(await repository.loadCourseRelationsData(), []);
  assert.equal(await repository.loadCurriculumLayoutDefinition(), null);
  assert.equal(await repository.loadGraduationDefinitionData(), null);
  assert.deepEqual(seen, ['difficulty.json', 'course-relations.json', 'curriculum-tree-layout.json']);
});

test('malformed optional payloads are rejected and valid difficulty entries are sanitized', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const repository = create({
    sanitizeExternalUrl,
    fetch: async () => ({
      ok: true,
      json: async () => [
        { id: 'safe', average: 5, votes: 2, sourceUrl: 'https://example.test/' },
        { id: 'unsafe', average: 5, votes: 2, sourceUrl: 'javascript:alert(1)' },
        { id: 'invalid', average: 11, votes: 2, sourceUrl: 'https://example.test/' },
      ],
    }),
  });
  const result = await repository.loadDifficultyData();
  assert.deepEqual([...result.keys()], ['safe']);
  assert.equal(result.get('safe').sourceUrl, 'https://example.test/');
  const invalid = create({ fetch: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(await invalid.loadCourseRelationsData(), []);
});

test('course relations exclude missing IDs and self-links and deduplicate both directions', (t) => {
  t.mock.method(console, 'warn', () => {});
  const repository = create({});
  const catalog = new Map([
    ['a', {}],
    ['b', {}],
  ]);
  const result = repository.buildRelationsMap(
    [
      { prerequisiteId: 'a', successorId: 'b' },
      { prerequisiteId: 'a', successorId: 'b' },
      { prerequisiteId: 'a', successorId: 'unknown' },
      { prerequisiteId: 'a', successorId: 'a' },
    ].map((entry) => ({ ...entry, strength: 'recommended' })),
    catalog,
  );
  assert.deepEqual(
    result.get('a').successors.map((item) => item.id),
    ['b'],
  );
  assert.deepEqual(
    result.get('b').prerequisites.map((item) => item.id),
    ['a'],
  );
  assert.equal(result.size, 2);
});
