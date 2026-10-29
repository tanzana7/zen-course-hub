const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createStaticServer } = require('../../lib/static-server.cjs');
const { publicFiles } = require('../../build-public.cjs');
const net = require('node:net');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

/** One disposable profile per run; never connects to a user's browser or production host. */
async function createBrowserSession({ root, out, port, evidence }) {
  const servedRoot = process.env.ZEN_MAP_QA_SERVE_DIST === '1' ? path.join(root, 'netlify-dist') : root;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zen-browser-'));
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  fs.mkdirSync(out, { recursive: true });
  const server = createStaticServer({
    root: servedRoot,
    assets: publicFiles,
    mapPath: (pathname) => pathname.replace(/^\/(?:public|off)\//, '/'),
    transform: (file, bytes, pathname) =>
      pathname.startsWith('/off/') && file === 'curriculum-config.js'
        ? Buffer.from(
            bytes
              .toString()
              .replace(
                'const CURRICULUM_TREE_PUBLIC_ENABLED = true;',
                'const CURRICULUM_TREE_PUBLIC_ENABLED = false;',
              ),
          )
        : bytes,
  });
  let chrome, socket, debugPort;
  const pending = new Map();
  const freePort = () =>
    new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const port = probe.address().port;
        probe.close(() => resolve(port));
      });
    });

  async function close() {
    for (const task of pending.values()) {
      clearTimeout(task.timeout);
      task.reject(new Error('Browser session closed'));
    }
    pending.clear();
    socket?.close();
    server.close();
    if (chrome && chrome.exitCode === null) chrome.kill();
    await pause(800);
    // Only the exact directory created by mkdtemp above may be removed recursively.
    if (path.dirname(profile) !== os.tmpdir() || !path.basename(profile).startsWith('zen-browser-'))
      throw Error('Invalid browser profile cleanup path');
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    debugPort = await freePort();
    const executable =
      process.env.CHROME_PATH ||
      (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : '/usr/bin/google-chrome');
    if (!fs.existsSync(executable))
      throw new Error('Chromeが見つかりません。CHROME_PATHに実行ファイルを指定してください。');
    let launchError;
    chrome = spawn(
      executable,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--no-proxy-server',
        `--remote-debugging-port=${debugPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        'about:blank',
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    chrome.once('error', (error) => {
      launchError = error;
    });
    let targets;
    for (let i = 0; i < 40; i++) {
      if (launchError) throw launchError;
      try {
        targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        break;
      } catch {
        await pause(250);
      }
    }
    assert.ok(targets?.length, 'Chrome debugging target');
    socket = new WebSocket(targets.find((target) => target.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Network.responseReceived') {
        const { status, url } = message.params.response;
        const parsed = new URL(url);
        if (
          status >= 400 &&
          (parsed.hostname === '127.0.0.1' || parsed.hostname.endsWith('.localhost')) &&
          parsed.pathname !== '/favicon.ico'
        ) {
          evidence.failedRequests.push(`HTTP ${status}: ${url}`);
        }
      }
      if (message.method === 'Runtime.exceptionThrown')
        evidence.exceptions.push(message.params.exceptionDetails);
      // Navigation deliberately cancels previous requests; only actual failures belong in QA results.
      if (message.method === 'Network.loadingFailed' && message.params.errorText !== 'net::ERR_ABORTED')
        evidence.failedRequests.push(message.params.errorText);
      if (pending.has(message.id)) {
        const task = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(task.timeout);
        message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }, 15000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const wait = async (expression) => {
      for (let i = 0; i < 70; i++) {
        if (await evaluate(expression)) return;
        await pause(100);
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const nav = async (url, ready) => {
      await send('Page.navigate', { url });
      await wait(ready);
      await pause(200);
    };
    const size = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await pause(150);
    };
    const click = async (selector) => {
      const point = await evaluate(
        `(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw Error('missing element');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
      );
      await send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        button: 'left',
        clickCount: 1,
        ...point,
      });
      await send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        button: 'left',
        clickCount: 1,
        ...point,
      });
      await pause(120);
    };
    const capture = async (name) => {
      await pause(150);
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'));
    };
    const storage = () =>
      evaluate(
        `Object.fromEntries(Object.keys(localStorage).sort().map(key=>[key,localStorage.getItem(key)]))`,
      );
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    return { send, evaluate, wait, nav, size, click, capture, storage, pause, close };
  } catch (error) {
    await close();
    throw error;
  }
}
module.exports = { createBrowserSession };
