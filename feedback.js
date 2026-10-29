'use strict';
const form=document.forms.feedback;
// Query values are untrusted text. Verify identity against the catalog before prefill.
fetch('courses.json').then(r=>{if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(courses=>{
 const params=new URLSearchParams(location.search);const course=courses.find(c=>c.id===params.get('courseId'));
 if(course){form.elements.courseId.value=course.id;form.elements.courseName.value=course.subject;}
 const category=params.get('category');if([...form.elements.category.options].some(o=>o.value===category))form.elements.category.value=category;
}).catch(error=>{console.error('報告対象の科目を確認できません:',error);document.getElementById('feedback-status').textContent='科目情報を確認できません。必要な内容を本文に記入してください。';});
// Native POST delegates acceptance and the result page to Netlify. No client-side success is fabricated.
form.addEventListener('submit',event=>{if(['localhost','127.0.0.1'].includes(location.hostname)||location.protocol==='file:'){event.preventDefault();document.getElementById('feedback-status').textContent='この環境では送信できません。公開サイトから送信してください。';}});
