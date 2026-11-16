const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBrowserSession } = require('./lib/browser-session.cjs');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/qa/exam-feedback');
const evidence = { viewports: [], exceptions: [], failedRequests: [], allCoursesReachable: 0 };
async function run() {
  const browser = await createBrowserSession({ root, out, port: 8088, evidence });
  const { send, evaluate, wait, nav, size, capture, click, pause } = browser;

  try {
    for (const width of [1280, 390]) {
      await size(width, 844);
      await nav(
        'http://127.0.0.1:8088/index.html',
        'document.querySelectorAll(".predefined-item").length > 0',
      );
      await evaluate(
        'localStorage.setItem("myClasses",JSON.stringify(["digital_tools_usage","economics_intro"]));localStorage.setItem("completedClasses",JSON.stringify(["data_science_intro"]))',
      );
      await send('Page.reload');
      await wait('document.querySelectorAll(".predefined-item").length > 0');
      await evaluate('document.getElementById("exam-schedule").open=true');
      assert.ok(await evaluate('document.getElementById("exam-list").textContent.includes("同じ日時")'));
      await evaluate('document.getElementById("exam-search").scrollIntoView({block:"center"})');
      await capture('schedule-' + width + '.png');
      await click('#exam-search');
      await send('Input.insertText', { text: '経済入門' });
      assert.ok(
        !(await evaluate('document.getElementById("exam-list").textContent.includes("デジタルツール")')),
      );
      await evaluate('document.querySelector("[data-course-id=digital_tools_usage] .detail-btn").click()');
      assert.ok(
        await evaluate(
          'document.querySelector("[data-course-id=digital_tools_usage]").textContent.includes("2027-02-16")',
        ),
      );
      await capture('exam-' + width + '.png');
      await nav(
        'http://127.0.0.1:8088/curriculum.html',
        'document.querySelectorAll(".map-course").length===275',
      );
      await evaluate(
        'document.getElementById("map-search").value="デジタルツールの使い方";document.getElementById("map-search").dispatchEvent(new Event("input"));document.querySelector("#map-search-results button").click()',
      );
      await pause(400);
      await evaluate('document.querySelector(".map-course[data-course-id=digital_tools_usage]").click()');
      assert.ok(await evaluate('document.getElementById("map-drawer").textContent.includes("2027-02-16")'));
      assert.ok(await evaluate('document.querySelector("a[href*=feedback]")!==null'));
      await capture('map-exam-' + width + '.png');
      await nav(
        'http://127.0.0.1:8088/feedback.html?courseId=digital_tools_usage&category=' +
          encodeURIComponent('試験日程の誤り'),
        'document.forms.feedback.elements.courseId.value === "digital_tools_usage"',
      );
      assert.equal(
        await evaluate('document.forms.feedback.elements.courseName.value'),
        'デジタルツールの使い方',
      );
      await evaluate(
        'document.forms.feedback.elements.message.value="QA test";document.forms.feedback.requestSubmit()',
      );
      assert.ok(
        await evaluate('document.getElementById("feedback-status").textContent.includes("送信できません")'),
      );
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
      await capture('feedback-' + width + '.png');
      evidence.viewports.push({ width, result: 'PASS' });
    }
    assert.deepEqual(evidence.exceptions, [], 'no browser runtime exceptions');
    assert.deepEqual(evidence.failedRequests, [], 'no failed browser resources');
    fs.writeFileSync(path.join(out, 'qa-results.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence));
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
