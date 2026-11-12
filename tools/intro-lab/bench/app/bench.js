// On-TV benchmark runner. plan.js (written by bench.sh) sets window.PLAN:
//   { server, k, suite, renderers: [{name, file}], modes, go }
// Every result is POSTed to PLAN.server/r as JSON (text/plain, so no CORS preflight) and logged.
(async function () {
  const P0 = window.PLAN, $ = s => document.querySelector(s), status = $('#status');
  const W = Math.round(1920 * P0.k), H = Math.round(1080 * P0.k);
  const say = t => { status.textContent = t; };
  const post = rec => {
    rec.run = P0.run;
    const body = JSON.stringify(rec);
    console.log('BENCH ' + body.slice(0, 400));
    return fetch(P0.server + '/r', { method: 'POST', body }).catch(() => {});
  };
  const RAF = window.requestAnimationFrame.bind(window);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  window.onerror = (m, src, l) => { post({ type: 'error', msg: String(m), src, l }); };

  // ---- a busy main thread, like Home loading: 30-80 ms of JS, then a short breather
  let busyOn = false;
  function busy(on) {
    busyOn = on;
    if (!on) return;
    (function spin() {
      if (!busyOn) return;
      const end = performance.now() + 30 + Math.random() * 50;
      while (performance.now() < end);
      setTimeout(spin, 5 + Math.random() * 15);
    })();
  }

  function rafFor(ms) {
    return new Promise(res => { const ts = []; RAF(function f(t) { ts.push(t); if (t - ts[0] < ms) RAF(f); else res(ts); }); });
  }

  function freshCanvas() {
    const old = $('#splash canvas'); if (old) old.remove();
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    $('#splash').insertBefore(c, $('#splash').firstChild);
    return c;
  }

  function words(on) {
    const w = $('#splash .splash-words'); if (w) w.remove();
    $('#splash').className = '';
    if (!on) return;
    const d = document.createElement('div');
    d.className = 'splash-words';
    d.innerHTML = '<div class="splash-name">Gravitos</div><div class="splash-by">Developed by ThePheniz</div>';
    $('#splash').appendChild(d);
  }

  // Renderers read a quality knob from location.search (?q=); give the page one too for main-thread runs.
  if (P0.q != null) try { history.replaceState(null, '', location.pathname + '?q=' + P0.q); } catch (e) {}

  // ---- capabilities
  function caps() {
    const c = { ua: navigator.userAgent, dpr: devicePixelRatio, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight],
      cores: navigator.hardwareConcurrency, mem: navigator.deviceMemory, offscreen: typeof OffscreenCanvas === 'function',
      transfer: !!document.createElement('canvas').transferControlToOffscreen };
    const gl = document.createElement('canvas').getContext('webgl');
    c.webgl1 = !!gl;
    if (gl) {
      const g = n => gl.getParameter(gl[n]);
      ['VERSION', 'SHADING_LANGUAGE_VERSION', 'VENDOR', 'RENDERER', 'MAX_TEXTURE_SIZE', 'MAX_RENDERBUFFER_SIZE', 'MAX_VARYING_VECTORS', 'MAX_FRAGMENT_UNIFORM_VECTORS',
        'MAX_VERTEX_UNIFORM_VECTORS', 'MAX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_TEXTURE_IMAGE_UNITS', 'MAX_VERTEX_ATTRIBS'].forEach(n => c[n] = g(n));
      c.MAX_VIEWPORT_DIMS = Array.from(g('MAX_VIEWPORT_DIMS'));
      c.ALIASED_POINT_SIZE_RANGE = Array.from(g('ALIASED_POINT_SIZE_RANGE'));
      const dri = gl.getExtension('WEBGL_debug_renderer_info');
      if (dri) { c.unmaskedVendor = gl.getParameter(dri.UNMASKED_VENDOR_WEBGL); c.unmaskedRenderer = gl.getParameter(dri.UNMASKED_RENDERER_WEBGL); }
      c.ext1 = gl.getSupportedExtensions();
      const pf = (s, p) => { const f = gl.getShaderPrecisionFormat(gl[s], gl[p]); return [f.rangeMin, f.rangeMax, f.precision]; };
      c.precision = { fragHigh: pf('FRAGMENT_SHADER', 'HIGH_FLOAT'), fragMed: pf('FRAGMENT_SHADER', 'MEDIUM_FLOAT'), vertHigh: pf('VERTEX_SHADER', 'HIGH_FLOAT'), fragHighInt: pf('FRAGMENT_SHADER', 'HIGH_INT') };
      const renderable = (type, ext) => {
        if (ext && !gl.getExtension(ext)) return 'no ' + ext;
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, type, null);
        if (gl.getError()) return 'tex fails';
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return ok ? 'renderable' : 'texture only';
      };
      c.halfFloatTarget = renderable(0x8D61, 'OES_texture_half_float');
      c.floatTarget = renderable(gl.FLOAT, 'OES_texture_float');
      c.ctxAttrs = gl.getContextAttributes();
      // highp really highp? A value that mediump (fp16) can't hold distinctly.
      c.highpProbe = probeHighp(gl);
    }
    const gl2 = document.createElement('canvas').getContext('webgl2');
    c.webgl2 = !!gl2;
    if (gl2) { c.gl2Version = gl2.getParameter(gl2.VERSION); c.gl2MaxSamples = gl2.getParameter(gl2.MAX_SAMPLES); c.ext2 = gl2.getSupportedExtensions(); }
    return c;
  }

  function probeHighp(gl) {
    try {
      const p = Bench.prog(gl, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }',
        'precision highp float; uniform float uX; void main() { float v = (uX + 1.) - uX; gl_FragColor = vec4(v, fract(uX * 1.0001) * 10., 0., 1.); }');
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.useProgram(p); gl.uniform1f(p.U.uX, 4096.5);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return { onePlusXMinusX: px[0], note: '255 = highp honoured (fp32); 0 = fp16' };
    } catch (e) { return String(e.message || e); }
  }

  function workerProbe() {
    return new Promise(res => {
      try {
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
        const off = cv.transferControlToOffscreen();
        const w = new Worker('bworker.js');
        const to = setTimeout(() => { w.terminate(); res({ err: 'timeout' }); }, 5000);
        w.onmessage = e => { clearTimeout(to); w.terminate(); res(e.data); };
        w.onerror = e => { clearTimeout(to); res({ err: String(e.message) }); };
        w.postMessage({ probe: true, canvas: off }, [off]);
      } catch (e) { res({ err: String(e.message || e) }); }
    });
  }

  // ---- synthetic test in main thread or worker
  function synth(spec, where) {
    return new Promise(res => {
      const cv = freshCanvas();
      cv.width = spec.w; cv.height = spec.h;
      if (where === 'main') { const to = setTimeout(() => res({ err: 'timeout', ts: [] }), spec.dur + 15000); return Bench.run(cv, spec, r => { clearTimeout(to); res(r); }); }
      const off = cv.transferControlToOffscreen(), w = new Worker('bworker.js');
      const to = setTimeout(() => { w.terminate(); res({ err: 'timeout', ts: [] }); }, spec.dur + 15000);
      w.onmessage = e => { clearTimeout(to); w.terminate(); res(e.data); };
      w.onerror = e => { clearTimeout(to); w.terminate(); res({ err: String(e.message), ts: [] }); };
      w.postMessage({ canvas: off, spec }, [off]);
    });
  }

  // ---- a real renderer through its start(canvas, emit) API
  function renderer(r, mode) {
    return new Promise(res => {
      const inWorker = mode.indexOf('worker') === 0;
      const oldCss = $('#rcss'); if (oldCss) oldCss.remove();
      // A renderer may ship its own words.css (retimed wordmark); load it after app.css like the app would.
      if (r.css) { const l = document.createElement('link'); l.id = 'rcss'; l.rel = 'stylesheet'; l.href = r.css; document.head.appendChild(l); }
      words(/words/.test(mode));
      const cv = freshCanvas(), emits = [], mainTs = [];
      let done = false, send = () => {}, w = null, setupMs = null, t0 = performance.now();
      let mainRaf = true;
      RAF(function mf(t) { mainTs.push(t); if (mainRaf) RAF(mf); });
      const emit = p => {
        emits.push([p, performance.now() - t0]);
        if (p === 'swallow') $('#splash').classList.add('pull');
        else if (p === 'flash') $('#splash').classList.add('out');
      };
      const finish = data => {
        if (done) return; done = true; mainRaf = false;
        busy(false);
        if (w) w.terminate();
        const st = (data.emits || []).find(e => e[0] === 'start');
        res(Object.assign({ emits, mainTs: mainTs.map(t => t - t0), setupMs, startAt: st ? st[1] : t0 }, data));
      };
      if (/busy/.test(mode)) busy(true);
      if (inWorker) {
        const off = cv.transferControlToOffscreen();
        w = new Worker('rworker.js?w=' + W + '&h=' + H + '&r=' + encodeURIComponent(r.file) + (P0.q != null ? '&q=' + P0.q : ''));
        w.onmessage = e => { const m = e.data; if (m && m.emit) emit(m.emit); else if (m && m.final) finish(m); };
        w.onerror = e => finish({ err: 'worker: ' + e.message, ts: [] });
        t0 = performance.now();
        w.postMessage({ canvas: off }, [off]);
        send = m => w.postMessage(m);
      } else {
        const ts = [], cpu = [], gpu = [], raf = window.requestAnimationFrame, gc = HTMLCanvasElement.prototype.getContext;
        let T = null;
        // Grab the renderer's GL context so each frame can be bracketed by a GPU timer query.
        HTMLCanvasElement.prototype.getContext = function (type, o) { const c = gc.call(this, type, o); if (c && !T && this === cv && /webgl/.test(type)) T = Bench.timer(c); return c; };
        window.requestAnimationFrame = f => raf.call(window, t => { ts.push(t); const a = performance.now(); if (T) T.begin(); f(t); if (T) { T.end(); T.poll(gpu); } cpu.push(performance.now() - a); });
        const restore = () => { window.requestAnimationFrame = raf; HTMLCanvasElement.prototype.getContext = gc; };
        const s = document.createElement('script');
        s.src = r.file + '?m' + Math.random();
        s.onerror = () => { restore(); finish({ err: 'script load failed', ts: [] }); };
        s.onload = () => {
          let fn;
          t0 = performance.now();
          try { fn = window.GravitosSplash(cv, p => { emit(p); if (p === 'done') { restore(); finish({ ts, cpu, gpu }); } }); } catch (e) { restore(); return finish({ err: String(e.message || e), ts: [] }); }
          setupMs = performance.now() - t0;
          if (!fn) { restore(); return finish({ err: 'start() returned null', ts: [] }); }
          send = fn;
        };
        document.head.appendChild(s);
        setTimeout(() => { restore(); finish({ ts, cpu, gpu, timeout: true }); }, 16000);
      }
      setTimeout(() => send('go'), P0.go);
      if (inWorker) setTimeout(() => { if (!done) w.postMessage('bench:dump'); setTimeout(() => finish({ err: 'no dump', ts: [] }), 1000); }, 16000);
    });
  }

  // Splits a renderer's frames into the intro's beats (ms from its first frame).
  function beats(ts, P) {
    if (!ts.length) return {};
    const f = ts[0], cut = [['open', 0, 1500], ['bend', 1500, 3300], ['rest', 3300, P0.go], ['exit', P0.go, 1e9]], o = {};
    cut.forEach(([n, a, b]) => { o[n] = Bench.stats(ts.filter(t => t - f >= a && t - f < b), P); });
    o.all = Bench.stats(ts, P);

    return o;
  }
  const med = a => a.length ? Math.round(a.slice().sort((x, y) => x - y)[a.length >> 1] * 100) / 100 : null;
  const p95 = a => a.length ? Math.round(a.slice().sort((x, y) => x - y)[Math.floor(a.length * .95)] * 100) / 100 : null;
  const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 100) / 100 : null;

  // ---------------------------------------------------------------- run
  say('bench: caps');
  await wait(1500);
  const C = caps();
  C.worker = await workerProbe();
  post({ type: 'caps', caps: C, plan: P0 });
  const idle = await rafFor(3000), dd = [];
  for (let i = 1; i < idle.length; i++) dd.push(idle[i] - idle[i - 1]);
  dd.sort((a, b) => a - b);
  const P = dd[dd.length >> 1];
  post({ type: 'refresh', periodMs: Math.round(P * 1000) / 1000, hz: Math.round(1000 / P * 10) / 10, stats: Bench.stats(idle, P, 0) });
  status.style.display = 'none';

  if (P0.suite) {
    const dur = 2500, tests = [];
    [[640, 360], [960, 540], [1280, 720], [1920, 1080]].forEach(([w, h]) => [0, 16, 32, 64, 128, 256].forEach(n => tests.push({ kind: 'alu', n, w, h, grp: 'alu ' + w })));
    // Finer steps where the budget edge is (GPU ~5-11 ms at 960x540).
    [20, 24, 28].forEach(n => tests.push({ kind: 'alu', n, w: 960, h: 540, grp: 'alufine 960' }));
    [40, 48, 56].forEach(n => tests.push({ kind: 'alu', n, w: 640, h: 360, grp: 'alufine 640' }));
    [1, 4, 8, 16, 32, 64].forEach(n => tests.push({ kind: 'tex', n, w: 960, h: 540, grp: 'tex 960' }));
    [8, 32].forEach(n => tests.push({ kind: 'tex', n, dep: true, w: 960, h: 540, grp: 'texdep 960' }));
    [4, 16].forEach(n => tests.push({ kind: 'tex', n, w: 1920, h: 1080, grp: 'tex 1920' }));
    [[960, 540], [1920, 1080]].forEach(([w, h]) => [['rgba8'], ['rgba8', 1], ['half', 1]].forEach(([fmt, gl2]) => tests.push({ kind: 'bloom', fmt, gl2: !!gl2, w, h, grp: 'bloom' + fmt + w })));
    [6].forEach(levels => tests.push({ kind: 'bloom', fmt: 'rgba8', levels, w: 960, h: 540, grp: 'bloom6' }));
    [[4, [1000, 5000, 10000, 20000, 50000]], [16, [1000, 5000, 10000, 20000]]].forEach(([size, cs]) => cs.forEach(count => tests.push({ kind: 'parts', count, size, w: 960, h: 540, grp: 'parts r' + size })));
    // Everything above runs in a worker like the real intro; this group compares threads.
    [0, 16, 32].forEach(n => [['main', false], ['main', true], ['worker', true]].forEach(([where, b]) => tests.push({ kind: 'alu', n, w: 960, h: 540, where, busy: b, grp: 'thread' + where + b })));
    const slow = {};
    for (const t of tests) {
      t.dur = dur;
      if (P0.only && !new RegExp(P0.only).test(t.grp)) continue;
      if (slow[t.grp]) { post({ type: 'synth', spec: t, skipped: 'previous step in group too slow' }); continue; }
      await post({ type: 'progress', spec: t });
      busy(!!t.busy);
      const r = await synth(t, t.where || 'worker');
      busy(false);
      const st = Bench.stats(r.ts || [], P, 500);
      if (st.p50 > 60) slow[t.grp] = 1;
      await post({ type: 'synth', spec: t, stats: st, setupMs: r.setupMs, cpu: avg((r.cpu || []).slice(10)), gpu: med((r.gpu || []).slice(10)), err: r.err });
      await wait(300);
    }
  }

  for (const r of P0.renderers) {
    for (const mode of P0.modes) {
      await wait(800);
      const x = await renderer(r, mode);
      const ts = x.ts || [];
      await post({ type: 'renderer', name: r.name, mode, k: P0.k, size: [W, H], err: x.err, timeout: x.timeout, setupMs: x.setupMs, cpu: avg((x.cpu || []).slice(5)), gpu: med((x.gpu || []).slice(5)), gpuP95: p95((x.gpu || []).slice(5)), timer: x.timer,
        beats: beats(ts, P), firstMs: ts.length ? Math.max(0, Math.round(ts[0] - (x.startAt != null ? x.startAt : 0))) : null, main: Bench.stats(x.mainTs || [], P, 0), emits: x.emits, ts: ts.map(t => Math.round((t - ts[0]) * 10) / 10) });
    }
  }
  words(false);
  status.style.display = ''; say('bench: done');
  await post({ type: 'end' });
})();
