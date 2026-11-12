// Drives Gravitos in headless Edge for testing: presses keys and saves screenshots.
//
//   node tools/drive.mjs --profile <dir> --out <dir> [--url <url>] steps...
//
// Steps run in order: a key name (Right, Left, Up, Down, Enter, Back, Space),
// optionally repeated as Right*3; wait:<ms>; shot:<name> saves <out>/<name>.png;
// focus prints the focused element; eval:<js> prints the result of an expression;
// delay:<ms> sets the pause after each key press (default 350; ~40 simulates a held key).
// Mouse (the PC version ignores the keyboard): move:x,y click:x,y rclick:x,y, or
// hover:<selector> click:<selector>, and wheel:dy[,dx].
// Writes to Plex (progress, watched, subtitles) are blocked unless --allow-writes is passed.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf('--' + name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const profile = opt('profile');
const out = opt('out') || '.';
const url = opt('url') || 'http://127.0.0.1:8765/';
const edge = opt('edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
// A fresh port each run, so a browser left over from a crashed run can never answer instead.
const port = 9300 + Math.floor(Math.random() * 90);
const [vw, vh] = (opt('size') || '1920x1080').split('x').map(Number);
mkdirSync(out, { recursive: true });

const KEYS = {
  Right: [39, 'ArrowRight'], Left: [37, 'ArrowLeft'], Up: [38, 'ArrowUp'], Down: [40, 'ArrowDown'],
  Enter: [13, 'Enter'], Back: [8, 'Backspace'], Space: [32, ' '], Escape: [27, 'Escape'],
};

// --gpu renders with the graphics card like a normal window (compositing seams only show there).
const gpu = args.includes('--gpu') && args.splice(args.indexOf('--gpu'), 1);
const browser = spawn(edge, [
  '--headless', ...(gpu ? ['--use-angle=d3d11', '--enable-gpu'] : ['--disable-gpu']), '--hide-scrollbars', '--no-first-run', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${port}`, `--window-size=${vw},${vh}`,
  ...(profile ? [`--user-data-dir=${profile}`] : []), 'about:blank',
], { stdio: 'ignore' });
// Kill the whole process tree: Edge's helper processes otherwise keep the profile locked
// and the next run's browser can't start.
const killTree = () => { try { spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch (e) {} };
process.on('exit', killTree);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await sleep(200);
  }
  throw new Error('Edge did not start');
}

const ws = new WebSocket(await target());
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const requests = new Map();
// --netlog reports failed and non-2xx network requests (CORS problems show up here).
const netlog = args.includes('--netlog') && args.splice(args.indexOf('--netlog'), 1);
const pending = new Map();
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') console.log('PAGE ERROR:', msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') console.log('console.error:', msg.params.args.map(a => a.value ?? a.description).join(' '));
  if (msg.method === 'Network.loadingFailed' && !msg.params.canceled) console.log('NET FAIL:', msg.params.type, msg.params.errorText, JSON.stringify(msg.params.corsErrorStatus || ''), requests.get(msg.params.requestId) || '');
  if (msg.method === 'Network.requestWillBeSent') requests.set(msg.params.requestId, msg.params.request.method + ' ' + msg.params.request.url.split('?')[0]);
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 300 && netlog) {
    const r = msg.params.response, h = r.headers || {};
    console.log('NET', r.status, r.url.split('?')[0], 'server=' + (h.server || h.Server || ''), h['cf-mitigated'] ? 'cf-mitigated=' + h['cf-mitigated'] : '');
  }
});
const send = (method, params = {}) => new Promise(r => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send('Runtime.enable');
// Network must be enabled for setCacheDisabled to take effect; --netlog only controls logging.
await send('Network.enable');
// Always load the current files, never a cached copy from an earlier run.
await send('Network.setCacheDisabled', { cacheDisabled: true });
// Cloudflare (in front of OpenSubtitles) blocks the "HeadlessChrome" user agent as a bot;
// present a normal Edge one, as a real window or the TV would.
const realUa = (await send('Browser.getVersion')).result.userAgent.replace('HeadlessChrome', 'Chrome');
await send('Network.setUserAgentOverride', { userAgent: realUa });
await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
await send('Page.enable');

// Tests must not change the real library: unless --allow-writes is given, every call that
// writes to Plex (playback progress, watched state, subtitle choice/download) becomes a no-op.
// Installed before every page load, so a reload in a test can't drop it.
const allowWrites = args.includes('--allow-writes') && args.splice(args.indexOf('--allow-writes'), 1);
if (!allowWrites) {
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const t = setInterval(() => {
      if (typeof Plex === 'undefined') return;
      clearInterval(t);
      const noop = () => Promise.resolve({});
      for (const k of ['timeline', 'scrobble', 'unscrobble', 'selectSub', 'selectAudio', 'downloadSub', 'removeFromDeck', 'watchlistSet']) Plex.lib[k] = noop;
      window.__writesBlocked = true;
    }, 1);
  })()` });
}

// --init <file>: a script run before the app on every page load (e.g. to point it at a mock server).
const initFile = opt('init');
if (initFile) await send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(initFile, 'utf8') });

await send('Page.navigate', { url });
await sleep(4000);
if (!allowWrites && !(await evaluate('window.__writesBlocked === true'))) console.log('WARNING: Plex writes are NOT blocked');

const focusInfo = `(() => { const c = Nav.current(); if (!c) return 'none';
  const r = c.getBoundingClientRect();
  return c.className + ' "' + (c.textContent || '').trim().slice(0, 40) + '" @' + Math.round(r.left) + ',' + Math.round(r.top); })()`;

let keyDelay = 350;
for (const step of args) {
  const [name, rep] = step.split('*');
  if (KEYS[name]) {
    for (let i = 0; i < (Number(rep) || 1); i++) {
      const [code, key] = KEYS[name];
      const base = { windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key };
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      await sleep(keyDelay);
    }
    console.log(step.padEnd(10), '->', await evaluate(focusInfo));
  } else if (/^(move|click|rclick|hover|wheel):/.test(step)) {
    // The PC version is mouse-only. move:x,y / click:x,y / rclick:x,y in screen pixels;
    // hover:<selector> / click:<selector> aim at the middle of the first match; wheel:dy[,dx].
    const [kind, arg] = [step.slice(0, step.indexOf(':')), step.slice(step.indexOf(':') + 1)];
    let x, y;
    if (kind === 'wheel') {
      const [dy, dx = 0] = arg.split(',').map(Number);
      await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: vw / 2, y: vh / 2, deltaX: dx, deltaY: dy });
    } else {
      if (/^-?\d+,-?\d+$/.test(arg)) [x, y] = arg.split(',').map(Number);
      else {
        const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(arg)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
        if (!r) { console.log(step.padEnd(10), '-> no such element'); continue; }
        [x, y] = r;
      }
      // Two moves: the app ignores a "move" to where the pointer already is.
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 1, y });
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      if (kind === 'click' || kind === 'rclick') {
        const button = kind === 'click' ? 'left' : 'right';
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, clickCount: 1 });
      }
    }
    await sleep(keyDelay);
    console.log(step.padEnd(10), '->', await evaluate(focusInfo));
  } else if (step.startsWith('delay:')) {
    keyDelay = Number(step.slice(6));
  } else if (step.startsWith('wait:')) {
    await sleep(Number(step.slice(5)));
  } else if (step.startsWith('shot:')) {
    // shot:<name> or shot:<name>@x,y,w,h[,scale] to capture a zoomed region.
    const [name, region] = step.slice(5).split('@');
    const params = { format: 'png' };
    if (region) {
      const [x, y, width, height, scale = 2] = region.split(',').map(Number);
      params.clip = { x, y, width, height, scale };
    }
    const shot = await send('Page.captureScreenshot', params);
    const file = join(out, name + '.png');
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log('saved', file);
  } else if (step === 'focus') {
    console.log('focus      ->', await evaluate(focusInfo));
  } else if (step.startsWith('evalfile:')) {
    // Runs a script file in the page and prints what its last expression returns.
    const file = step.slice(9);
    console.log(file, '=>', JSON.stringify(await evaluate(readFileSync(file, 'utf8'))));
  } else if (step.startsWith('eval:')) {
    console.log(step.slice(5), '=>', JSON.stringify(await evaluate(step.slice(5))));
  }
}

await Promise.race([send('Browser.close'), sleep(2000)]);
ws.close();
process.exit(0);
