// Isolated browser QA. Public-ON is injected only into an in-memory HTTP response.
// No user's Chrome profile, production endpoint or stored enrollment is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const geometry = require('../../curriculum-map.js');
const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'docs/qa/curriculum-map-fullscreen');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-full-map-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = { viewports: [], exceptions: [], failedRequests: [], allCoursesReachable: 0 };
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  let url = new URL(req.url, 'http://localhost');
  let file = decodeURIComponent(url.pathname);
  const publicBuild = file.startsWith('/public/');
  if (publicBuild) file = file.slice(7);
  if (file === '/') file = '/index.html';
  const target = path.resolve(root, '.' + file);
  if (!target.startsWith(root + path.sep) || /\/\.git\//.test(file)) { res.writeHead(403); return res.end(); }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    if (publicBuild && file === '/curriculum-config.js') data = Buffer.from(data.toString().replace('const CURRICULUM_TREE_PUBLIC_ENABLED = false;', 'const CURRICULUM_TREE_PUBLIC_ENABLED = true;'));
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    res.end(data);
  });
});
let chrome, socket;
async function run() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8087, '127.0.0.1', resolve);
  });
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server', '--remote-debugging-port=9229', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9229/json/list')).json(); break; } catch { await pause(250); }
  }
  assert.ok(targets?.length, 'Chrome debugging target');
  socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') evidence.exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Network.loadingFailed') evidence.failedRequests.push(message.params.errorText);
    if (pending.has(message.id)) { const task = pending.get(message.id); pending.delete(message.id); clearTimeout(task.timeout); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => { for (let i = 0; i < 70; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error(`Timed out: ${expression}`); };
  const nav = async (url, ready) => { await send('Page.navigate', { url }); await wait(ready); await pause(200); };
  const size = async (width, height) => { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(150); };
  const click = async (selector) => {
    const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('missing element');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point }); await pause(120);
  };
  const capture = async (name) => { await pause(150); const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64')); };
  const storage = () => evaluate(`Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))`);
  const summary = () => evaluate(`({width:innerWidth,height:innerHeight,viewport:document.getElementById('map-viewport').getBoundingClientRect().toJSON(),scrollWidth:document.documentElement.scrollWidth,scale:document.getElementById('map-zoom-value').value,drawerHidden:document.getElementById('map-drawer').hidden,transform:document.getElementById('map-world').style.transform})`);
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  // OFF and local preview use the actual committed release setting.
  await size(1440, 900);
  await nav('http://foo.localhost:8087/curriculum.html?curriculumPreview=1', `document.getElementById('map-loading-message')?.textContent.includes('公開準備')`);
  assert.equal(await evaluate(`document.getElementById('map-app').hidden`), true);
  await nav('http://127.0.0.1:8087/index.html?curriculumPreview=1', `document.getElementById('curriculum-tree-nav')?.hidden === false`);
  await click('#curriculum-tree-nav');
  await wait(`location.pathname === '/curriculum.html' && document.querySelectorAll('.map-course').length === 275`);
  assert.equal(await evaluate(`document.getElementById('map-zoom-value').value`), '100%');
  await capture('preview-1440.png');
  await click('#map-menu-toggle');
  await click('#map-back');
  await wait(`location.pathname === '/index.html' && document.getElementById('curriculum-tree-nav')?.hidden === false`);
  evidence.backToHub = 'PASS';
  // ON is tested on a host outside the localhost-only preview allowlist.
  await nav('http://foo.localhost:8087/public/curriculum.html', `document.querySelectorAll('.map-course').length === 275`);
  await click('#map-menu-toggle');
  await evaluate(`document.getElementById('map-relation-mode').value='all';document.getElementById('map-relation-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
  assert.equal(await evaluate(`document.querySelectorAll('#map-relations path').length`),335);
  await evaluate(`document.getElementById('map-relation-mode').value='off';document.getElementById('map-relation-mode').dispatchEvent(new Event('change',{bubbles:true}))`);
  await click('#map-menu-toggle');
  evidence.advisoryRelations = 335;
  const seed = { myClasses: '["unknown_saved_course"]', completedClasses: '["it_literacy"]', fourYearSimulatorPlanV1: '{"version":1,"placements":[{"courseId":"math_history","year":2,"selectedQuarter":1}]}' };
  await evaluate(`Object.entries(${JSON.stringify(seed)}).forEach(([key,value])=>localStorage.setItem(key,value))`);
  await send('Page.reload'); await wait(`document.querySelectorAll('.map-course').length === 275`);
  const initialStorage = await storage();
  const layout = geometry.buildLayout(require('../../curriculum-tree-layout.json'), require('../../courses.json'));
  for (const [width, height] of [[1440,900], [1280,800], [390,844]]) {
    await size(width, height);
    await nav('http://foo.localhost:8087/public/curriculum.html', `document.querySelectorAll('.map-course').length === 275`);
    const result = await summary();
    assert.equal(result.viewport.width, width); assert.equal(result.viewport.height, height); assert.equal(result.scrollWidth, width); assert.equal(result.scale, '100%'); assert.equal(result.drawerHidden, true);
    evidence.viewports.push(result);
    await capture(`initial-${width}.png`);
    for (const year of [1, 2, 3, 4]) {
      await click('#map-menu-toggle');
      await click(`[data-map-year="${year}"]`);
      const reached = await evaluate(`(() => { const card=document.querySelector('.map-course.is-selected');const r=card.getBoundingClientRect();return {year:parseInt(card.querySelector('small').textContent,10),visible:r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight};})()`);
      assert.equal(reached.year, year);
      assert.equal(reached.visible, true, `year ${year} must be inside viewport`);
    }
    await capture(`year-4-${width}.png`);
    // Real drag on uncovered background moves the camera without a drawer.
    const start = {x:20,y:height-100}, end = {x:180,y:height-200};
    const before = result.transform;
    await send('Input.dispatchMouseEvent', {type:'mousePressed',button:'left',clickCount:1,...start});
    await send('Input.dispatchMouseEvent', {type:'mouseMoved',buttons:1,...end});
    await send('Input.dispatchMouseEvent', {type:'mouseReleased',button:'left',clickCount:1,...end}); await pause(150);
    assert.notEqual((await summary()).transform, before, 'background pan changes camera');
    await send('Input.dispatchMouseEvent', {type:'mouseWheel', x:width/2,y:height/2,deltaX:0,deltaY:-120}); await pause(150);
    assert.notEqual((await summary()).scale,'100%');
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
        results.push({id:course.id,year:course.year,inside:r.left>=0&&r.top>=64&&r.right<=innerWidth&&r.bottom<=innerHeight-70,readable:getComputedStyle(node).fontSize==='17px'&&document.getElementById('map-zoom-value').value==='100%'});
      } return results;
    })()`);
    assert.ok(checks.every((course)=>course.inside && course.readable),JSON.stringify(checks.filter(x=>!x.inside||!x.readable)));
    evidence.allCoursesReachable += checks.length;
    // A real touch pan and pinch are checked at phone width.
    if(width===390){
      let beforeTouch=(await summary()).transform;
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:150,y:420}]});
      await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:210,y:500}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await pause(150);
      assert.notEqual((await summary()).transform,beforeTouch);
      const oldScale=(await summary()).scale;
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:110,y:370,id:1},{x:270,y:370,id:2}]});
      await send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:70,y:390,id:1},{x:310,y:390,id:2}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await pause(150);
      assert.notEqual((await summary()).scale,oldScale);
      evidence.touchPan = evidence.pinch = 'PASS';
      await evaluate(`document.getElementById('map-search').value='アカデミックリテラシー';document.getElementById('map-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`);
      await pause(120);
      const tap = await evaluate(`(() => { const r=document.querySelector('[data-course-id="academic_literacy"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      await send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...tap,id:9}]});
      await send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await wait(`document.getElementById('map-drawer').hidden === false`);
      await click('#map-drawer-close');
      evidence.touchCourseDetail = 'PASS';
    }
    await click('#map-fit'); await capture(`overview-${width}.png`);
    await evaluate(`const input=document.getElementById('map-search');input.value='アカデミックリテラシー';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#map-search-results button').click()`);await pause(150);
    await click('[data-course-id="academic_literacy"]');
    assert.equal(await evaluate(`document.getElementById('map-drawer').hidden`), false);
    await capture(`detail-${width}.png`);
    await click('#map-drawer-close');
  }
  // Preserve completed + plan raw values and unknown enrollment IDs through
  // add/delete/reload, and validate shared Hub reads the same stored state.
  await size(1440,900);
  await evaluate(`document.getElementById('map-search').value='アカデミックリテラシー';document.getElementById('map-search-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))`); await pause(150);
  await click('[data-course-id="academic_literacy"]'); await click('.enrollment-action');
  let saved = await storage();
  assert.deepEqual(JSON.parse(saved.myClasses), ['unknown_saved_course','academic_literacy']);
  assert.equal(saved.completedClasses,seed.completedClasses); assert.equal(saved.fourYearSimulatorPlanV1,seed.fourYearSimulatorPlanV1);
  await send('Page.reload');await wait(`document.querySelector('[data-course-id="academic_literacy"].is-registered')`);
  await nav('http://foo.localhost:8087/public/index.html', `document.getElementById('registered-count')?.textContent === '1'`);
  assert.ok(await evaluate(`document.getElementById('list').textContent.includes('アカデミックリテラシー')`));
  await capture('hub-synchronized.png');
  await click('#curriculum-tree-nav');
  try { await wait(`document.querySelectorAll('.map-course').length === 275`); }
  catch (error) {
    console.error('Navigation state:', await evaluate(`({url:location.href,navHidden:document.getElementById('curriculum-tree-nav')?.hidden,mapMessage:document.getElementById('map-loading-message')?.textContent,curriculumAccess:globalThis.CurriculumAccess})`));
    throw error;
  }
  await click('#map-enrollment-toggle');await capture('enrollment-1440.png');
  await evaluate(`[...document.querySelectorAll('.enrollment-row')].find(row=>row.textContent.includes('アカデミックリテラシー')).querySelector('.remove').click()`);
  await send('Page.reload');await wait(`document.querySelectorAll('.map-course').length === 275`);
  saved=await storage();assert.deepEqual(JSON.parse(saved.myClasses),['unknown_saved_course']);assert.equal(saved.completedClasses,seed.completedClasses);assert.equal(saved.fourYearSimulatorPlanV1,seed.fourYearSimulatorPlanV1);
  // Force a write failure in this isolated profile and confirm rollback.
  await evaluate(`Storage.prototype.setItem=function(){throw new DOMException('QA quota','QuotaExceededError')};document.querySelector('[data-course-id="academic_literacy"]').click();document.querySelector('.enrollment-action').click()`);
  assert.deepEqual(JSON.parse((await storage()).myClasses),['unknown_saved_course']);
  assert.ok(await evaluate(`document.getElementById('map-status').textContent.includes('保存')`));
  evidence.enrollment = evidence.reload = evidence.hubSynchronization = evidence.saveFailureRollback = 'PASS';
  assert.equal(evidence.exceptions.length,0);
  await send('Page.reload');await wait(`document.querySelectorAll('.map-course').length === 275`);
  // Native Chrome drag, not a DOM-only simulated drop. The target appears
  // during dragstart and disappears after a successful drop.
  const dragStart = await evaluate(`(() => { const r=document.querySelector('[data-course-id="data_science_intro"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  await send('Input.dispatchMouseEvent',{type:'mouseMoved',...dragStart});
  await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...dragStart});
  for (let step = 1; step <= 6; step++) {
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:dragStart.x+step*8,y:dragStart.y+step*8});
    await pause(40);
  }
  await wait(`document.getElementById('map-drop-target').hidden === false`);
  const dragEnd = await evaluate(`(() => {const r=document.getElementById('map-drop-target').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (let step = 1; step <= 8; step++) {
    const portion = step / 8;
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:dragStart.x+(dragEnd.x-dragStart.x)*portion,y:dragStart.y+(dragEnd.y-dragStart.y)*portion});
    await pause(35);
  }
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...dragEnd});
  try { await wait(`JSON.parse(localStorage.getItem('myClasses')).includes('data_science_intro')`); }
  catch(error) {
    console.error('Drag state:',await evaluate(`({targetHidden:document.getElementById('map-drop-target').hidden,targetAtPoint:document.elementFromPoint(${dragEnd.x},${dragEnd.y})?.id,stored:localStorage.getItem('myClasses'),status:document.getElementById('map-status').textContent})`));
    throw error;
  }
  assert.equal(await evaluate(`document.getElementById('map-drawer').hidden`),true);
  evidence.nativeDragRegistration = 'PASS';
  await evaluate(`localStorage.clear()`); // This origin exists only inside the disposable QA profile.
  assert.deepEqual(await storage(),{});
  evidence.profileIsolated = true;
  evidence.storageRestored = true;
  fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
  await send('Browser.close');
}
run().catch((error)=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  socket?.close();server.close();
  if(chrome && chrome.exitCode===null)chrome.kill();
  await pause(800);
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
});
