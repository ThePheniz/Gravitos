// Startup animation (drawn by js/splash-gl.js): a point of light opens into a horizon that
// bends into the Gravitos ring around a black hole, the name settles in beneath, and on the
// way out it all folds back to a point. It holds on the finished mark (up to ~8.6 s in all)
// until the app sets window.gravitosReady, so Home's artwork is cached by the time it shows.
// Any key or click skips to the ending.
(function () {
  const el = document.getElementById('splash');
  if (!el) return;
  const TV = typeof window.tizen !== 'undefined' || /[?&]tv\b/.test(location.search);
  document.documentElement.classList.toggle('tv', TV);
  // PC-only controls (Back / Full screen buttons, row arrows) show under html.pc.
  document.documentElement.classList.toggle('pc', !TV);
  // The TV draws at half size and upscales (its GPU stays relaxed); a PC window draws at the
  // stage's shape (see fit() in app.js), so the black hole isn't squashed.
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  const W = TV ? 960 : Math.round(innerWidth / k), H = TV ? 540 : Math.round(innerHeight / k);
  let cv = el.querySelector('canvas');
  let send = () => {}, worker = null, finished = false, fellBack = false;

  function on(phase) {
    if (phase === 'swallow') el.classList.add('pull');
    // Removed on a timer too: some browsers stop drawing a canvas once it has faded out, so the
    // renderer's 'done' may never come, and an invisible splash would swallow every click and key.
    else if (phase === 'flash') { el.classList.add('out'); setTimeout(finish, 1000); }
    else if (phase === 'done') finish();
    else if (phase === 'fail') mainThread();
  }

  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    removeEventListener('keydown', skip, true);
    if (worker) worker.terminate();
    el.classList.add('out');
    setTimeout(() => el.remove(), 600);
  }

  // The worker path: rendering happens off the main thread, which is busy building Home.
  function inWorker() {
    const off = cv.transferControlToOffscreen();
    worker = new Worker('js/splash-gl.js');
    worker.onmessage = e => on(e.data);
    worker.onerror = () => mainThread();
    worker.postMessage({ canvas: off }, [off]);
    send = m => worker.postMessage(m);
  }

  function mainThread() {
    if (fellBack || finished) return;
    fellBack = true;
    if (worker) { worker.terminate(); worker = null; }
    // A canvas handed to a worker can't be drawn here again.
    const fresh = document.createElement('canvas');
    cv.replaceWith(fresh);
    cv = fresh;
    cv.width = W; cv.height = H;
    const s = document.createElement('script');
    s.src = 'js/splash-gl.js';
    s.onload = () => {
      let fn = null;
      try { fn = window.GravitosSplash(cv, on); } catch (err) { fn = null; }
      // No WebGL: the name stays on black until Home is ready.
      if (fn) send = fn; else send = m => { if (m === 'go' || m === 'skip') finish(); };
    };
    s.onerror = () => { send = m => { if (m === 'go' || m === 'skip') finish(); }; };
    document.head.appendChild(s);
  }

  // Any key skips; the key doesn't reach the app underneath.
  function skip(e) { e.preventDefault(); e.stopImmediatePropagation(); send('skip'); }
  addEventListener('keydown', skip, true);
  el.addEventListener('click', () => send('skip'));
  const poll = setInterval(() => { if (window.gravitosReady) send('go'); }, 100);
  // Whatever happens to the renderer (a hidden window, a lost graphics context), never block the app.
  setTimeout(finish, 15000);

  cv.width = W; cv.height = H;
  try {
    if (cv.transferControlToOffscreen && typeof Worker === 'function') inWorker();
    else mainThread();
  } catch (err) { mainThread(); }
})();
