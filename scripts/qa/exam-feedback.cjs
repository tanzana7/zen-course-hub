// Isolated browser QA. Public-OFF is injected only into an in-memory HTTP response.
// No user's Chrome profile, production endpoint or stored enrollment is used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const geometry = require('../../curriculum-map.js');
const root = path.resolve(__dirname, '../..');
const servedRoot = process.env.ZEN_MAP_QA_SERVE_DIST === '1' ? path.join(root, 'netlify-dist') : root;
const out = path.join(root, 'docs/qa/exam-feedback');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-full-map-'));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evidence = { viewports: [], exceptions: [], failedRequests: [], allCoursesReachable: 0 };
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  let url = new URL(req.url, 'http://localhost');
  let file = decodeURIComponent(url.pathname);
  const publicBuild = file.startsWith('/public/');
  const offBuild = file.startsWith('/off/');
  if (publicBuild) file = file.slice(7);
  if (offBuild) file = file.slice(4);
  if (file === '/') file = '/index.html';
  const target = path.resolve(servedRoot, '.' + file);
  if (!target.startsWith(servedRoot + path.sep) || /\/\.git\//.test(file)) { res.writeHead(403); return res.end(); }
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); return res.end(); }
    if (offBuild && file === '/curriculum-config.js') data = Buffer.from(data.toString().replace('const CURRICULUM_TREE_PUBLIC_ENABLED = true;', 'const CURRICULUM_TREE_PUBLIC_ENABLED = false;'));
    const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
    res.setHeader('Content-Type', mime[path.extname(target)] || 'application/octet-stream');
    res.end(data);
  });
});
let chrome, socket, debugPort;
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
async function run() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(8088, '127.0.0.1', resolve);
  });
  debugPort = await freePort();
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-proxy-server', `--remote-debugging-port=${debugPort}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); break; } catch { await pause(250); }
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

  for (const width of [1280,390]) {
    await size(width,844);
    await nav('http://127.0.0.1:8088/index.html', 'document.querySelectorAll(".predefined-item").length > 0');
    await evaluate('localStorage.setItem("myClasses",JSON.stringify(["digital_tools_usage","economics_intro"]));localStorage.setItem("completedClasses",JSON.stringify(["data_science_intro"]))');
    await send('Page.reload');await wait('document.querySelectorAll(".predefined-item").length > 0');
    await evaluate('document.getElementById("exam-schedule").open=true');
    assert.ok(await evaluate('document.getElementById("exam-list").textContent.includes("同じ日時")'));
    await evaluate('document.getElementById("exam-search").value="経済入門";document.getElementById("exam-search").dispatchEvent(new Event("input"))');
    assert.ok(!(await evaluate('document.getElementById("exam-list").textContent.includes("デジタルツール")')));
    await evaluate('document.querySelector("[data-course-id=digital_tools_usage] .detail-btn").click()');
    assert.ok(await evaluate('document.querySelector("[data-course-id=digital_tools_usage]").textContent.includes("2027-02-16")'));
    await capture('exam-'+width+'.png');
    await nav('http://127.0.0.1:8088/curriculum.html','document.querySelectorAll(".map-course").length===275');
    await evaluate('document.getElementById("map-search").value="デジタルツールの使い方";document.getElementById("map-search").dispatchEvent(new Event("input"));document.querySelector("#map-search-results button").click()');
    await pause(400);await evaluate('document.querySelector(".map-course[data-course-id=digital_tools_usage]").click()');
    assert.ok(await evaluate('document.getElementById("map-drawer").textContent.includes("2027-02-16")'));
    assert.ok(await evaluate('document.querySelector("a[href*=feedback]")!==null'));
    await capture('map-exam-'+width+'.png');
    await nav('http://127.0.0.1:8088/feedback.html?courseId=digital_tools_usage&category='+encodeURIComponent('試験日程の誤り'),'document.forms.feedback.elements.courseId.value === "digital_tools_usage"');
    assert.equal(await evaluate('document.forms.feedback.elements.courseName.value'),'デジタルツールの使い方');
    await evaluate('document.forms.feedback.elements.message.value="QA test";document.forms.feedback.requestSubmit()');
    assert.ok(await evaluate('document.getElementById("feedback-status").textContent.includes("送信できません")'));
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await capture('feedback-'+width+'.png');
    evidence.viewports.push({width,result:'PASS'});
  }
  fs.writeFileSync(path.join(out,'qa-results.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));await send('Browser.close');
}
run().catch((error)=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{
  socket?.close();server.close();
  if(chrome && chrome.exitCode===null)chrome.kill();
  await pause(800);
  fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:200});
});
