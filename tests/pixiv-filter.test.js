import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const courses = JSON.parse(fs.readFileSync(new URL('../courses.json', import.meta.url), 'utf8'));
const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

const expectedPixivIds = [
  'digital_image_tech_1',
  'digital_image_tech_2',
  'digital_image_tech_3',
  'digital_image_creation_1',
  'digital_image_creation_2',
  'digital_image_creation_3',
  'digital_image_apps_1',
  'digital_image_apps_2',
  'illustration_entertainment_a',
  'illustration_entertainment_b',
  'illustration_entertainment_c',
  'illustration_entertainment_d',
  'illustration_design_a',
  'illustration_design_b',
  'illustration_design_c',
  'illustration_design_d',
  'illustration_apps_a',
  'illustration_apps_b',
  'illustration_apps_c',
  'illustration_apps_d'
].sort();

test('pixiv provider is assigned to exactly the confirmed 20 courses', () => {
  const providerIds = courses
    .filter((course) => course.provider === 'pixiv')
    .map((course) => course.id)
    .sort();

  assert.equal(courses.length, 275);
  assert.deepEqual(providerIds, expectedPixivIds);
  assert.equal(new Set(providerIds).size, 20);
});

test('pixiv filtering is based on provider metadata, not a credit heuristic', () => {
  assert.match(appSource, /item\.provider !== ['"]pixiv['"]/);
  assert.doesNotMatch(appSource, /credits\s*===\s*1/);
  assert.doesNotMatch(appSource, /category\s*===\s*['"]自由科目['"][^;]*credits/);
});
