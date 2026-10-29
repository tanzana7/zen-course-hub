const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=require('../data/zen_exam_schedule_2027_feb.json');
const data=require('../exam-schedule-catalog.json');
const courses=require('../courses.json');
test('exam schedule preserves source identity and leaves three unmatched subjects separate',()=>{
 assert.equal(source.courses.length,62);assert.equal(source.courses.reduce((n,c)=>n+c.examSlots.length,0),186);
 assert.equal(data.matched.length,59);assert.equal(data.unmatched.length,3);assert.equal(new Set(data.matched.map(c=>c.courseId)).size,59);
 for(const entry of data.matched){const matches=courses.filter(c=>c.subject===entry.courseName);assert.equal(matches.length,1);assert.equal(matches[0].id,entry.courseId);const original=source.courses.find(c=>c.courseCode===entry.universityCourseCode);assert.equal(original.courseName,entry.courseName);assert.deepEqual(entry.examSlots,original.examSlots);}
 assert.deepEqual(data.unmatched.map(c=>c.courseName),['日本文学Ⅱ','文化人類学Ⅱ','人生設計とお金の管理']);
 assert.ok(data.unmatched.every(c=>!c.courseId));assert.equal(courses.length,275);
});
test('static Netlify form and runtime schedule are included in public build without enrollment fields',()=>{
 const {publicFiles}=require('../scripts/build-public.cjs');for(const f of ['exam-schedule-catalog.json','exam-feedback.js','exam-schedule.js','feedback.html','feedback.js'])assert.ok(publicFiles.includes(f));
 const html=fs.readFileSync('feedback.html','utf8');assert.match(html,/method="POST" data-netlify="true"/);assert.match(html,/name="form-name" value="feedback"/);assert.doesNotMatch(html,/name="(?:myClasses|completedClasses|fourYearSimulatorPlanV1)"/);
});
