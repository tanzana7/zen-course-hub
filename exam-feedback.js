(function(root){
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let records = [], failed = false, enrolled = [];
  const ready = fetch('exam-schedule-catalog.json').then(r => {if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}).then(data => {
    if(!Array.isArray(data.matched) || data.matched.some(c=> !c.courseId || !Array.isArray(c.examSlots)))throw Error('Invalid exam schedule');
    records=data.matched;
  }).catch(error=> {failed=true;console.error('試験日程を読み込めません:',error);});
  const report = (course,category) => `feedback.html?${new URLSearchParams({courseId:course.id,courseName:course.subject,category})}`;
  const detail = course => {
    const entry=records.find(c=>c.courseId===course.id);
    return `${entry?`<section><h5>試験日程（2027年2月・4Q）</h5><p>日程は変更される可能性があります。</p><ul>${entry.examSlots.map(s=>`<li>${escape(s.date)} ${escape(s.period)}限</li>`).join('')}</ul><a href="${escape(report(course,'試験日程の誤り'))}">試験日程の誤りを報告</a></section>`:failed?'<p>試験日程を読み込めません。再読み込みしてください。</p>':''}<p><a href="${escape(report(course,'科目情報の誤り'))}">この科目の情報を報告</a></p>`;
  };
  function renderEnrollment(ids=enrolled){
    enrolled=[...new Set(ids)]; const host=document.getElementById('exam-list');if(!host)return;
    if(failed){host.textContent='試験日程を読み込めません。再読み込みしてください。';return;}
    const query=document.getElementById('exam-search').value.trim();
    // All three slots are candidates; no official role or duration is inferred from source columns.
    const all=records.filter(c=>enrolled.includes(c.courseId)).flatMap(c=>c.examSlots.map(s=>({...s,courseId:c.courseId,courseName:c.courseName})));
    const rows=all.filter(c=>c.courseName.includes(query)).sort((a,b)=>a.date.localeCompare(b.date)||a.period-b.period||a.courseName.localeCompare(b.courseName,'ja'));
    host.replaceChildren();if(!rows.length){host.textContent='該当する試験日程はありません。';return;}
    let date='';for(const row of rows){if(date!==row.date){date=row.date;const h=document.createElement('h4');h.textContent=date;host.append(h);}const line=document.createElement('p');const collision=new Set(all.filter(s=>s.date===row.date&&s.period===row.period).map(s=>s.courseId)).size>1;line.textContent=`${row.period}限 ${row.courseName}${collision?' — 同じ日時に複数科目の候補があります':''}`;host.append(line);}
  }
  function appendDetail(host,course){
    const add=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;if(tag==='a'){const wrapper=document.createElement('p');wrapper.append(node);host.append(wrapper);}else host.append(node);return node;};
    const entry=records.find(c=>c.courseId===course.id);
    if(entry){add('h4','試験日程（2027年2月・4Q）');add('p','日程は変更される可能性があります。');for(const slot of entry.examSlots)add('p',slot.date+' '+slot.period+'限');const a=add('a','試験日程の誤りを報告');a.href=report(course,'試験日程の誤り');}
    if(failed)add('p','試験日程を読み込めません。再読み込みしてください。');
    const a=add('a','この科目の情報を報告');a.href=report(course,'科目情報の誤り');
  }
  root.ZenExam={ready,detail,renderEnrollment,appendDetail};
  document.addEventListener('DOMContentLoaded',()=>document.getElementById('exam-search')?.addEventListener('input',()=>renderEnrollment()));
})(window);
