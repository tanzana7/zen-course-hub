import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const appSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const courses = JSON.parse(fs.readFileSync(new URL('../courses.json', import.meta.url), 'utf8'));

const sumCredits = (items) => items.reduce((total, course) => total + Number(course.credits || 0), 0);

test('産業史系の詳細は科目数ではなく単位数を表示する', () => {
  const historyCourses = courses.filter((course) => course.digitalIndustryHistoryRequirement === true);
  const industryHistory = historyCourses.find((course) => course.subject === 'IT産業史');

  assert.ok(industryHistory, 'IT産業史がcourses.jsonに存在すること');
  assert.equal(industryHistory.credits, 2);
  assert.equal(sumCredits([industryHistory]), 2);
  assert.match(
    appSource,
    /const historyCredits = sumCredits\(allSelected\.filter\(cls => cls\.digitalIndustryHistoryRequirement === true\)\);/
  );
  assert.doesNotMatch(appSource, /const historyCount = allSelected\.filter\(cls => cls\.digitalIndustryHistoryRequirement === true\)\.length;/);
});

test('単位数要件は対象科目のcredits合計を使い、重複IDは1回だけ加算できる', () => {
  const history = courses.find((course) => course.subject === 'IT産業史');
  const selectedOnce = [history];
  const selectedWithDuplicate = Array.from(new Map([history, history].map((course) => [course.id, course])).values());

  assert.equal(sumCredits(selectedOnce), 2);
  assert.equal(sumCredits(selectedWithDuplicate), 2);
  assert.match(appSource, /const (literacyCredits|multilingualInfoCredits|globalStudiesCredits|advancedCredits) = sumCredits\(/);
});

test('卒業プロジェクトはcourses.jsonのgraduationRequirement定義を単位集計へ反映する', () => {
  const project = courses.find((course) => course.subject === 'プロジェクト実践');

  assert.ok(project, 'プロジェクト実践がcourses.jsonに存在すること');
  assert.equal(project.graduationRequirement, true);
  assert.equal(project.credits, 4);
  assert.match(appSource, /cls\.graduationRequirement === true/);
});
