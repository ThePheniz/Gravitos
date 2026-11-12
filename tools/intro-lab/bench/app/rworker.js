// Runs a real intro renderer in a worker exactly as js/splash.js does (the renderer file is the
// worker's code), but first wraps rAF and postMessage so every frame is timed and the timings
// are posted back when the renderer emits 'done' (or 'fail').
// rworker.js?r=<renderer file>
(function () {
  importScripts('gpu.js');
  const ts = [], cpu = [], emits = [], gpu = [];
  // Grab the renderer's GL context so each frame can be bracketed by a GPU timer query.
  // Only the canvas handed over by the page counts (renderers may bake on scratch OffscreenCanvases);
  // matched by size: an identity check against e.data.canvas never matched on the TV.
  const q = new URLSearchParams(location.search), TW = +q.get('w'), TH = +q.get('h');
  let T = null;
  const gc = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (type, o) { const c = gc.call(this, type, o); if (c && !T && this.width === TW && this.height === TH && /webgl/.test(type)) T = Bench.timer(c); return c; };
  const post = self.postMessage.bind(self);
  if (typeof self.requestAnimationFrame === 'function') {
    const raf = self.requestAnimationFrame.bind(self);
    self.requestAnimationFrame = f => raf(t => { ts.push(t); const a = performance.now(); if (T) T.begin(); f(t); if (T) { T.end(); T.poll(gpu); } cpu.push(performance.now() - a); });
  }
  self.postMessage = m => {
    emits.push([m, performance.now()]);
    post({ emit: m });
    if (m === 'done' || m === 'fail') post({ final: true, ts, cpu, gpu, emits, setupMs, timer: T ? T.dbg : 'none' });
  };
  let setupMs = null;
  importScripts(q.get('r'));
  const ro = self.onmessage;
  if (ro) self.onmessage = e => {
    if (e.data === 'bench:dump') return post({ final: true, timeout: true, ts, cpu, gpu, emits, setupMs });
    const a = performance.now();
    ro.call(self, e);
    if (e.data && e.data.canvas) { setupMs = performance.now() - a; emits.push(['start', a]); }
  };
})();
