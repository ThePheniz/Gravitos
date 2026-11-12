// Worker side of the synthetic tests: {canvas, spec} -> runs Bench.run on the OffscreenCanvas.
// {probe:true} -> reports what a worker can do (WebGL on an OffscreenCanvas, rAF).
importScripts('gpu.js');
onmessage = e => {
  const m = e.data;
  if (m.probe) {
    const r = { raf: typeof requestAnimationFrame === 'function', offscreen: typeof OffscreenCanvas === 'function' };
    try { const c = new OffscreenCanvas(64, 64); const gl = c.getContext('webgl'); r.webgl = !!gl; if (gl) r.renderer = gl.getParameter(gl.RENDERER); } catch (err) { r.err = String(err); }
    try { r.webgl2 = !!new OffscreenCanvas(64, 64).getContext('webgl2'); } catch (err) { r.webgl2 = false; }
    try { const gl = m.canvas && m.canvas.getContext('webgl'); r.transferredWebgl = !!gl; } catch (err) { r.transferErr = String(err); }
    return postMessage(r);
  }
  Bench.run(m.canvas, m.spec, r => postMessage(r));
};
