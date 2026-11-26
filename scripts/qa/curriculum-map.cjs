const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createBrowserSession } = require('./lib/browser-session.cjs');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/qa/curriculum-map-fullscreen');
const evidence = { viewports: [], exceptions: [], failedRequests: [], allCoursesReachable: 0 };
// Windows reserves dynamic port ranges per boot; QA ports stay overridable.
const qaPort = Number(process.env.ZEN_QA_MAP_PORT) || 8087;
async function run() {
  const browser = await createBrowserSession({ root, out, port: qaPort, evidence });
  const { send, evaluate, wait, nav, size, capture, click, storage, pause } = browser;
  const summary = () =>
    evaluate(
      `({width:innerWidth,height:innerHeight,viewport:document.getElementById('map-viewport').getBoundingClientRect().toJSON(),scrollWidth:document.documentElement.scrollWidth,scale:document.getElementById('map-zoom-value').value,drawerHidden:document.getElementById('map-drawer').hidden,transform:document.getElementById('map-world').style.transform})`,
    );
  try {
    // OFF and local preview use the actual committed release setting.
    await size(1440, 900);
    await nav(
      `http://foo.localhost:${qaPort}/off/curriculum.html?curriculumPreview=1`,
      `document.getElementById('map-loading-message')?.textContent.includes('公開準備')`,
    );
    assert.equal(await evaluate(`document.getElementById('map-app').hidden`), true);
    await nav(
      `http://127.0.0.1:${qaPort}/index.html?curriculumPreview=1`,
      `document.getElementById('curriculum-tree-nav')?.hidden === false`,
    );
    await click('#curriculum-tree-nav');
    await wait(
      `location.pathname === '/curriculum.html' && document.querySelectorAll('.map-course').length === 275`,
    );
    assert.equal(await evaluate(`document.getElementById('map-zoom-value').value`), '100%');
    await capture('preview-1440.png');
    // The home link is a toolbar icon now; it must work with the menu closed.
    assert.equal(await evaluate(`document.getElementById('map-menu').hidden`), true);
    assert.ok(
      await evaluate(
        `(() => {const el=document.getElementById('map-back');const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&el.textContent.includes('⌂')&&el.getAttribute('aria-label')==='ホームに戻る';})()`,
      ),
    );
    await click('#map-back');
    await wait(
      `location.pathname === '/index.html' && document.getElementById('curriculum-tree-nav')?.hidden === false`,
    );
    evidence.backToHub = 'PASS';
    // ON is tested on a host outside the localhost-only preview allowlist.
    await nav(
      `http://foo.localhost:${qaPort}/public/curriculum.html`,
      `document.querySelectorAll('.map-course').length === 275`,
    );
    await click('#map-menu-toggle');
    await evaluate(
      `document.getElementById('map-relation-mode').value='all';document.getElementById('map-relation-mode').dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    assert.equal(await evaluate(`document.querySelectorAll('#map-relations path').length`), 335);
    await evaluate(
      `document.getElementById('map-relation-mode').value='off';document.getElementById('map-relation-mode').dispatchEvent(new Event('change',{bubbles:true}))`,
    );
    await click('#map-menu-toggle');
    evidence.advisoryRelations = 335;
    const seed = {
      myClasses: '["unknown_saved_course"]',
      completedClasses: '["it_literacy"]',
      fourYearSimulatorPlanV1:
        '{"version":1,"placements":[{"courseId":"math_history","year":2,"selectedQuarter":1}]}',
    };
    await evaluate(
      `Object.entries(${JSON.stringify(seed)}).forEach(([key,value])=>localStorage.setItem(key,value))`,
    );
    await send('Page.reload');
    await wait(`document.querySelectorAll('.map-course').length === 275`);
    for (const [width, height] of [
      [1440, 900],
      [1280, 800],
      [390, 844],
    ]) {
      await size(width, height);
      await nav(
        `http://foo.localhost:${qaPort}/public/curriculum.html`,
        `document.querySelectorAll('.map-course').length === 275`,
      );
      const result = await summary();
      assert.equal(result.viewport.width, width);
      assert.equal(result.viewport.height, height);
      assert.equal(result.scrollWidth, width);
      assert.equal(result.scale, '100%');
      assert.equal(result.drawerHidden, true);
      const opening = await evaluate(
        `(() => {const cards=[...document.querySelectorAll('.map-course')].map(node=>node.getBoundingClientRect());return {label:document.getElementById('map-location').textContent,leftClipped:cards.filter(r=>r.right>0&&r.left<0&&r.bottom>64&&r.top<innerHeight).length,visible:cards.filter(r=>r.left>=0&&r.right<=innerWidth&&r.top>=120&&r.bottom<=innerHeight-65).length};})()`,
      );
      assert.equal(opening.label, '1年次 · 文化・思想');
      assert.equal(opening.leftClipped, 0, 'initial cards are not cut off at the left edge');
      assert.ok(opening.visible >= 3, 'initial map shows a cluster of whole readable cards');
      result.opening = opening;
      evidence.viewports.push(result);
      await capture(`initial-${width}.png`);
      // Both drop zones must be fully visible and free of toolbar, location
      // label, and zoom-control overlaps at every width.
      const dropGeometry = await evaluate(
        `(() => {const zones=['map-drop-target','map-drop-completed'].map(id=>document.getElementById(id));zones.forEach(z=>z.hidden=false);const rects=zones.map(z=>z.getBoundingClientRect().toJSON());const others=['.map-toolbar','#map-location','.map-zoom'].map(sel=>document.querySelector(sel).getBoundingClientRect().toJSON());const overlap=(a,b)=>a.left<b.right&&b.left<a.right&&a.top<b.bottom&&b.top<a.bottom;zones.forEach(z=>z.hidden=true);return {conflicts:others.map(o=>rects.some(r=>overlap(r,o))),inside:rects.every(r=>r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight)};})()`,
      );
      assert.deepEqual(
        dropGeometry.conflicts,
        [false, false, false],
        `drop zones must not overlap fixed UI: ${JSON.stringify(dropGeometry.conflicts)}`,
      );
      assert.equal(dropGeometry.inside, true, 'drop zones stay inside the viewport');
      // Year shortcut buttons were removed from the menu; the home link lives
      // in the toolbar and year navigation happens through the field select.
      await click('#map-menu-toggle');
      const menuSpec = await evaluate(
        `(() => {const back=document.querySelector('header.map-toolbar #map-back');return {dataMapYear:document.querySelectorAll('[data-map-year]').length,yearActions:document.querySelectorAll('.year-actions').length,homeIcon:back?.textContent.trim(),homeLabel:back?.getAttribute('aria-label'),homeInMenu:!!document.querySelector('#map-menu #map-back'),feedbackLink:!!document.querySelector('#map-menu a[href="feedback.html"]')};})()`,
      );
      assert.equal(menuSpec.dataMapYear, 0);
      assert.equal(menuSpec.yearActions, 0);
      assert.equal(menuSpec.homeIcon, '⌂');
      assert.equal(menuSpec.homeLabel, 'ホームに戻る');
      assert.equal(menuSpec.homeInMenu, false);
      assert.equal(menuSpec.feedbackLink, true);
      evidence.menuSpec = 'PASS';
      await capture(`menu-${width}.png`);
      await click('#map-menu-toggle');
      await evaluate(
        `document.getElementById('map-field').value='文化・思想';document.getElementById('map-field').dispatchEvent(new Event('change',{bubbles:true}))`,
      );
      await pause(140);
      assert.ok(
        (await evaluate(`document.getElementById('map-location').textContent`)).includes('文化・思想'),
      );
      await capture(`field-culture-${width}.png`);
      // Real drag on uncovered background moves the camera without a drawer.
      const start = { x: 20, y: height - 100 },
        end = { x: 180, y: height - 200 };
      const before = result.transform;
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...start,
      });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', buttons: 1, ...end });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...end,
      });
      await pause(150);
      assert.notEqual((await summary()).transform, before, 'background pan changes camera');
      await send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: width / 2,
        y: height / 2,
        deltaX: 0,
        deltaY: -120,
      });
      await pause(150);
      assert.notEqual((await summary()).scale, '100%');
      await click('#map-normal');
      // Search the actual catalog and check every course's screen geometry. This
      // proves reachability through the UI, not merely DOM-node existence.
      const checks = await evaluate(`(async()=>{
      const courses=await (await fetch('courses.json')).json();
      const results=[];
      for(const course of courses){
        const input=document.getElementById('map-search'); input.value=course.subject;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        const candidate=[...document.querySelectorAll('#map-search-results button')].find(button=>button.textContent===course.subject);
        if(!candidate)throw Error('search missing '+course.id); candidate.click();
        await new Promise(requestAnimationFrame);
        const node=document.querySelector('[data-course-id="'+course.id+'"]');const r=node.getBoundingClientRect();
        const expectedSize=node.classList.contains('is-prominent')?'20px':'17px';
        results.push({id:course.id,year:course.year,inside:r.left>=0&&r.top>=64&&r.right<=innerWidth&&r.bottom<=innerHeight-70,readable:getComputedStyle(node).fontSize===expectedSize&&document.getElementById('map-zoom-value').value==='100%'});
      } return results;
    })()`);
      assert.ok(
        checks.every((course) => course.inside && course.readable),
        JSON.stringify(checks.filter((x) => !x.inside || !x.readable)),
      );
      evidence.allCoursesReachable += checks.length;
      // A real touch pan and pinch are checked at phone width.
      if (width === 390) {
        const toolbarLayout = await evaluate(
          `['map-menu-toggle','map-back','map-search-form','map-enrollment-toggle'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,x:r.x,right:r.right};})`,
        );
        for (let i = 1; i < toolbarLayout.length; i++) {
          assert.ok(
            toolbarLayout[i].x >= toolbarLayout[i - 1].right - 0.5,
            `toolbar item ${toolbarLayout[i].id} overlaps ${toolbarLayout[i - 1].id}`,
          );
        }
        assert.ok(
          toolbarLayout[0].x >= 0 && toolbarLayout.at(-1).right <= width,
          'toolbar items stay inside the viewport at phone width',
        );
        evidence.toolbarLayout = 'PASS';
        const beforeTouch = (await summary()).transform;
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 150, y: 420 }] });
        await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 500 }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await pause(150);
        assert.notEqual((await summary()).transform, beforeTouch);
        const oldScale = (await summary()).scale;
        await send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [
            { x: 110, y: 370, id: 1 },
            { x: 270, y: 370, id: 2 },
          ],
        });
        await send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            { x: 70, y: 390, id: 1 },
            { x: 310, y: 390, id: 2 },
          ],
        });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await pause(150);
        assert.notEqual((await summary()).scale, oldScale);
        evidence.touchPan = evidence.pinch = 'PASS';
        await evaluate(
          `document.getElementById('map-search').value='アカデミックリテラシー';document.getElementById('map-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`,
        );
        await pause(120);
        const tap = await evaluate(
          `(() => { const r=document.querySelector('[data-course-id="academic_literacy"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
        );
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...tap, id: 9 }] });
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await wait(`document.getElementById('map-drawer').hidden === false`);
        await click('#map-drawer-close');
        evidence.touchCourseDetail = 'PASS';
      }
      await click('#map-fit');
      await capture(`overview-${width}.png`);
      await evaluate(
        `const input=document.getElementById('map-search');input.value='アカデミックリテラシー';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#map-search-results button').click()`,
      );
      await pause(150);
      await click('[data-course-id="academic_literacy"]');
      assert.equal(await evaluate(`document.getElementById('map-drawer').hidden`), false);
      await capture(`detail-${width}.png`);
      await click('#map-drawer-close');
    }
    // Preserve completed + plan raw values and unknown enrollment IDs through
    // add/delete/reload, and validate shared Hub reads the same stored state.
    await size(1440, 900);
    await evaluate(
      `document.getElementById('map-search').value='アカデミックリテラシー';document.getElementById('map-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`,
    );
    await pause(150);
    await click('[data-course-id="academic_literacy"]');
    await click('.enrollment-action-planned');
    let saved = await storage();
    assert.deepEqual(JSON.parse(saved.myClasses), ['unknown_saved_course', 'academic_literacy']);
    assert.equal(saved.completedClasses, seed.completedClasses);
    assert.equal(saved.fourYearSimulatorPlanV1, seed.fourYearSimulatorPlanV1);
    await click('.enrollment-action-completed');
    saved = await storage();
    assert.deepEqual(JSON.parse(saved.myClasses), ['unknown_saved_course']);
    assert.deepEqual(JSON.parse(saved.completedClasses), ['it_literacy', 'academic_literacy']);
    await click('.enrollment-action-planned');
    saved = await storage();
    assert.deepEqual(JSON.parse(saved.myClasses), ['unknown_saved_course', 'academic_literacy']);
    assert.deepEqual(JSON.parse(saved.completedClasses), ['it_literacy']);
    evidence.enrollmentTransitions = 'PASS';
    await send('Page.reload');
    await wait(`document.querySelector('[data-course-id="academic_literacy"].is-registered')`);
    await nav(
      `http://foo.localhost:${qaPort}/public/index.html`,
      `document.getElementById('registered-count')?.textContent === '1'`,
    );
    assert.ok(
      await evaluate(`document.getElementById('list').textContent.includes('アカデミックリテラシー')`),
    );
    await capture('hub-synchronized.png');
    // The public artifact must keep the three existing Hub experiences usable.
    await click('#analysis-btn');
    await wait(
      `document.getElementById('analysis-modal').style.display === 'block' && document.getElementById('analysis-result').textContent.length > 0`,
    );
    await click('#close-modal');
    await click('#simulator-btn');
    await wait(
      `document.getElementById('simulator-modal').hidden === false && document.getElementById('simulator-year-grid').children.length > 0`,
    );
    await click('#close-simulator');
    assert.equal(await evaluate(`document.getElementById('simulator-modal').hidden`), true);
    evidence.existingHubViews = 'PASS';
    await click('#curriculum-tree-nav');
    try {
      await wait(`document.querySelectorAll('.map-course').length === 275`);
    } catch (error) {
      console.error(
        'Navigation state:',
        await evaluate(
          `({url:location.href,navHidden:document.getElementById('curriculum-tree-nav')?.hidden,mapMessage:document.getElementById('map-loading-message')?.textContent,curriculumAccess:globalThis.CurriculumAccess})`,
        ),
      );
      throw error;
    }
    await click('#map-enrollment-toggle');
    await capture('enrollment-1440.png');
    await evaluate(
      `[...document.querySelectorAll('.enrollment-row')].find(row=>row.textContent.includes('アカデミックリテラシー')).querySelector('.remove').click()`,
    );
    await send('Page.reload');
    await wait(`document.querySelectorAll('.map-course').length === 275`);
    saved = await storage();
    assert.deepEqual(JSON.parse(saved.myClasses), ['unknown_saved_course']);
    assert.equal(saved.completedClasses, seed.completedClasses);
    assert.equal(saved.fourYearSimulatorPlanV1, seed.fourYearSimulatorPlanV1);
    // Force a write failure in this isolated profile and confirm rollback.
    await evaluate(
      `Storage.prototype.setItem=function(){throw new DOMException('QA quota','QuotaExceededError')};document.querySelector('[data-course-id="academic_literacy"]').click();document.querySelector('.enrollment-action').click()`,
    );
    assert.deepEqual(JSON.parse((await storage()).myClasses), ['unknown_saved_course']);
    assert.ok(await evaluate(`document.getElementById('map-status').textContent.includes('保存')`));
    evidence.enrollment =
      evidence.reload =
      evidence.hubSynchronization =
      evidence.saveFailureRollback =
        'PASS';
    assert.equal(evidence.exceptions.length, 0);
    await send('Page.reload');
    await wait(`document.querySelectorAll('.map-course').length === 275`);
    // Native Chrome drag, not a DOM-only simulated drop. Both drop zones appear
    // during dragstart and disappear after a successful drop.
    const nativeDragTo = async (courseId, courseName, targetId) => {
      await evaluate(
        `document.getElementById('map-search').value=${JSON.stringify(courseName)};document.getElementById('map-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`,
      );
      await pause(150);
      const from = await evaluate(
        `(() => { const r=document.querySelector('[data-course-id="${courseId}"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...from,
      });
      for (let step = 1; step <= 6; step++) {
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          button: 'left',
          buttons: 1,
          x: from.x + step * 8,
          y: from.y + step * 8,
        });
        await pause(40);
      }
      await wait(
        `document.getElementById('map-drop-target').hidden === false && document.getElementById('map-drop-completed').hidden === false`,
      );
      const to = await evaluate(
        `(() => {const r=document.getElementById('${targetId}').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      for (let step = 1; step <= 8; step++) {
        const portion = step / 8;
        await send('Input.dispatchMouseEvent', {
          type: 'mouseMoved',
          button: 'left',
          buttons: 1,
          x: from.x + (to.x - from.x) * portion,
          y: from.y + (to.y - from.y) * portion,
        });
        await pause(35);
      }
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...to,
      });
      try {
        await wait(
          `document.getElementById('map-drop-target').hidden === true && document.getElementById('map-drop-completed').hidden === true`,
        );
      } catch (error) {
        console.error(
          'Drag state:',
          await evaluate(
            `({registeredHidden:document.getElementById('map-drop-target').hidden,completedHidden:document.getElementById('map-drop-completed').hidden,targetAtPoint:document.elementFromPoint(${to.x},${to.y})?.id,stored:localStorage.getItem('myClasses'),storedCompleted:localStorage.getItem('completedClasses'),status:document.getElementById('map-status').textContent})`,
          ),
        );
        throw error;
      }
      await pause(120);
    };
    // Planned drop keeps working as before.
    await nativeDragTo('data_science_intro', 'データサイエンス概論', 'map-drop-target');
    try {
      await wait(`JSON.parse(localStorage.getItem('myClasses')).includes('data_science_intro')`);
    } catch (error) {
      console.error(
        'Drag state:',
        await evaluate(
          `({targetHidden:document.getElementById('map-drop-target').hidden,targetAtPoint:document.elementFromPoint(1000,160)?.id,stored:localStorage.getItem('myClasses'),status:document.getElementById('map-status').textContent})`,
        ),
      );
      throw error;
    }
    assert.equal(await evaluate(`document.getElementById('map-drawer').hidden`), true);
    // Dropping on the completed zone moves the course out of planned into
    // completed (mutual exclusion through the existing toggle).
    await nativeDragTo('data_science_intro', 'データサイエンス概論', 'map-drop-completed');
    await wait(`JSON.parse(localStorage.getItem('completedClasses')).includes('data_science_intro')`);
    assert.deepEqual(JSON.parse((await storage()).myClasses), ['unknown_saved_course']);
    await send('Page.reload');
    await wait(`document.querySelector('[data-course-id="data_science_intro"].is-completed')`);
    assert.ok(
      await evaluate(
        `document.querySelector('[data-course-id="data_science_intro"]').textContent.includes('履修済み ✓')`,
      ),
    );
    assert.deepEqual(JSON.parse((await storage()).completedClasses), ['it_literacy', 'data_science_intro']);
    assert.deepEqual(JSON.parse((await storage()).myClasses), ['unknown_saved_course']);
    // A completed course dropped back on the planned zone returns to planned.
    await nativeDragTo('data_science_intro', 'データサイエンス概論', 'map-drop-target');
    await wait(`JSON.parse(localStorage.getItem('myClasses')).includes('data_science_intro')`);
    assert.deepEqual(JSON.parse((await storage()).completedClasses), ['it_literacy']);
    evidence.nativeDragRegistration = 'PASS';
    await evaluate(`localStorage.clear()`); // This origin exists only inside the disposable QA profile.
    assert.deepEqual(await storage(), {});
    evidence.profileIsolated = true;
    evidence.storageRestored = true;
    assert.deepEqual(evidence.exceptions, [], 'no browser runtime exceptions');
    assert.deepEqual(evidence.failedRequests, [], 'no failed browser resources');
    fs.writeFileSync(path.join(out, 'qa-results.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser.close();
  }
}
run().catch((error) => {
  console.error(error.stack);
  process.exitCode = 1;
});
