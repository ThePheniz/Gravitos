// Synthetic GPU scenes + a frame-timing loop. Loaded by the page (main-thread runs) and by
// bworker.js (OffscreenCanvas runs), so both paths draw exactly the same thing.
(function (G) {
  const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
  const VS_FULL = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }';

  function prog(gl, vs, fs, attrs) {
    const p = gl.createProgram();
    [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([t, src]) => {
      const s = gl.createShader(t);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('compile: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    });
    (attrs || ['a']).forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; U[nm] = gl.getUniformLocation(p, nm); }
    p.U = U;
    return p;
  }

  function fullTri(gl) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return () => { gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3); };
  }

  // n "units" of transcendental work per pixel; one unit = 1 sin + 1 exp + a few MADs, dependent so it can't fold.
  const aluFS = n => HEAD + `uniform vec2 uRes; uniform float uT;
void main() { vec2 p = gl_FragCoord.xy / uRes; float a = p.x + uT; vec3 c = vec3(p, .2);
  for (int i = 0; i < ${n}; i++) { a = sin(a * 1.37 + p.y) + exp(-a * a); c += vec3(a, a * .5, a * .25) * .01; }
  gl_FragColor = vec4(c, 1.); }`;

  function texture(gl, size) {
    const t = gl.createTexture(), d = new Uint8Array(size * size * 4);
    for (let i = 0; i < d.length; i++) d[i] = (i * 2654435761 >>> 24) & 255;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return t;
  }

  function target(gl, w, h, fmt) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    if (fmt === 'half' && gl2) {
      if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('no EXT_color_buffer_float');
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      let type = gl.UNSIGNED_BYTE;
      if (fmt === 'half') { const e = gl.getExtension('OES_texture_half_float'); if (!e) throw new Error('no OES_texture_half_float'); type = e.HALF_FLOAT_OES; gl.getExtension('OES_texture_half_float_linear'); gl.getExtension('EXT_color_buffer_half_float'); }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error(fmt + ' target not renderable');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { t, f, w, h };
  }

  // Returns draw(tSeconds) for a scene spec. Specs: {kind:'alu',n} {kind:'tex',n,dep} {kind:'bloom',fmt} {kind:'parts',count,size}
  function scene(gl, s, W, H) {
    const tri = fullTri(gl);
    if (s.kind === 'alu') {
      const p = prog(gl, VS_FULL, aluFS(s.n));
      return t => { gl.useProgram(p); gl.uniform2f(p.U.uRes, W, H); gl.uniform1f(p.U.uT, t); tri(); };
    }
    if (s.kind === 'tex') {
      const tx = texture(gl, 1024);
      const off = s.dep ? 'c.yx * .05' : 'vec2(0.)';
      const p = prog(gl, VS_FULL, HEAD + `uniform vec2 uRes; uniform float uT; uniform sampler2D uTex;
void main() { vec2 p = gl_FragCoord.xy / uRes; vec4 c = vec4(0.);
  for (int i = 0; i < ${s.n}; i++) c += texture2D(uTex, p * 1.7 + vec2(float(i) * .137, uT * .01 + float(i) * .071) + ${off});
  gl_FragColor = c / ${s.n}.; }`);
      return t => { gl.useProgram(p); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform2f(p.U.uRes, W, H); gl.uniform1f(p.U.uT, t); gl.uniform1i(p.U.uTex, 0); tri(); };
    }
    if (s.kind === 'bloom') {
      const L = s.levels || 4, lv = [target(gl, W, H, s.fmt)];
      for (let i = 1; i <= L; i++) lv.push(target(gl, Math.max(1, W >> i), Math.max(1, H >> i), s.fmt));
      const scn = prog(gl, VS_FULL, aluFS(8));
      const down = prog(gl, VS_FULL, HEAD + `uniform sampler2D uSrc; uniform vec2 uTexel, uRes;
void main() { vec2 uv = gl_FragCoord.xy / uRes; vec2 o = uTexel;
  gl_FragColor = (texture2D(uSrc, uv + vec2(-o.x, -o.y)) + texture2D(uSrc, uv + vec2(o.x, -o.y)) + texture2D(uSrc, uv + vec2(-o.x, o.y)) + texture2D(uSrc, uv + o)) * .25; }`);
      const up = prog(gl, VS_FULL, HEAD + `uniform sampler2D uSrc; uniform vec2 uTexel, uRes;
void main() { vec2 uv = gl_FragCoord.xy / uRes; vec2 o = uTexel; vec4 c = texture2D(uSrc, uv) * 4.;
  c += (texture2D(uSrc, uv + vec2(o.x, 0.)) + texture2D(uSrc, uv - vec2(o.x, 0.)) + texture2D(uSrc, uv + vec2(0., o.y)) + texture2D(uSrc, uv - vec2(0., o.y))) * 2.;
  c += texture2D(uSrc, uv + o) + texture2D(uSrc, uv - o) + texture2D(uSrc, uv + vec2(o.x, -o.y)) + texture2D(uSrc, uv + vec2(-o.x, o.y));
  gl_FragColor = c / 16.; }`);
      const comp = prog(gl, VS_FULL, HEAD + `uniform sampler2D uSrc, uBl; uniform vec2 uRes;
void main() { vec2 uv = gl_FragCoord.xy / uRes; vec3 c = texture2D(uSrc, uv).rgb + texture2D(uBl, uv).rgb * .6; gl_FragColor = vec4(1. - exp(-c * 1.2), 1.); }`);
      const pass = (p, src, dst, add) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.f : null);
        const w = dst ? dst.w : W, h = dst ? dst.h : H;
        gl.viewport(0, 0, w, h); gl.useProgram(p);
        gl.uniform2f(p.U.uRes, w, h);
        if (src) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.t); gl.uniform1i(p.U.uSrc, 0); if (p.U.uTexel) gl.uniform2f(p.U.uTexel, 1 / src.w, 1 / src.h); }
        if (add) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); } else gl.disable(gl.BLEND);
        tri();
      };
      return t => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lv[0].f); gl.viewport(0, 0, W, H); gl.disable(gl.BLEND);
        gl.useProgram(scn); gl.uniform2f(scn.U.uRes, W, H); gl.uniform1f(scn.U.uT, t); tri();
        for (let i = 1; i <= L; i++) pass(down, lv[i - 1], lv[i]);
        for (let i = L - 1; i >= 1; i--) pass(up, lv[i + 1], lv[i], true);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lv[1].t);
        gl.useProgram(comp); gl.uniform1i(comp.U.uBl, 1);
        pass(comp, lv[0], null);
        gl.activeTexture(gl.TEXTURE0);
      };
    }
    if (s.kind === 'parts') {
      const N = s.count, d = new Float32Array(N * 6 * 3), C = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
      for (let i = 0, k = 0; i < N; i++) for (let v = 0; v < 6; v++) { d[k++] = C[v * 2]; d[k++] = C[v * 2 + 1]; d[k++] = i; }
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
      const p = prog(gl, `attribute vec2 aC; attribute float aId; uniform float uT, uSize; uniform vec2 uRes; varying vec2 vC;
float h(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
void main() { vec2 c = fract(vec2(h(aId), h(aId + 7.1)) + uT * (vec2(h(aId + 3.), h(aId + 5.)) - .5) * .1);
  vC = aC; gl_Position = vec4(c * 2. - 1. + aC * uSize / uRes * 2., 0., 1.); }`,
      HEAD + 'varying vec2 vC; void main() { float r = dot(vC, vC); gl_FragColor = vec4(vec3(.02, .015, .01) * exp(-r * 4.), 1.); }', ['aC', 'aId']);
      return t => {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(p); gl.uniform1f(p.U.uT, t); gl.uniform1f(p.U.uSize, s.size); gl.uniform2f(p.U.uRes, W, H);
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.TRIANGLES, 0, N * 6);
        gl.disable(gl.BLEND); gl.disableVertexAttribArray(1);
      };
    }
    throw new Error('unknown scene ' + s.kind);
  }

  // Draws spec on canvas for spec.dur ms; calls done({ts: rAF timestamps, cpu: JS ms per frame, setupMs, err}).
  function run(canvas, spec, done) {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
    const out = { ts: [], cpu: [], setupMs: 0, raf: typeof requestAnimationFrame === 'function' };
    let gl, draw;
    try {
      const a = performance.now();
      gl = canvas.getContext(spec.gl2 ? 'webgl2' : 'webgl', { antialias: false, alpha: false, depth: false });
      if (!gl) throw new Error('no webgl');
      draw = scene(gl, spec, canvas.width, canvas.height);
      gl.viewport(0, 0, canvas.width, canvas.height);
      out.setupMs = performance.now() - a;
    } catch (e) { out.err = String(e.message || e); return done(out); }
    const T = timer(gl); out.gpu = [];
    let t0 = null;
    function frame(now) {
      if (t0 === null) t0 = now;
      out.ts.push(now);
      const a = performance.now();
      if (T) T.begin();
      try { draw((now - t0) / 1000); } catch (e) { out.err = String(e.message || e); return done(out); }
      if (T) { T.end(); T.poll(out.gpu); }
      out.cpu.push(performance.now() - a);
      if (now - t0 < spec.dur) return raf(frame);
      const lc = gl.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
      done(out);
    }
    raf(frame);
  }

  // GPU time per frame via EXT_disjoint_timer_query(_webgl2); results arrive a few frames late.
  function timer(gl) {
    const e2 = gl.getExtension('EXT_disjoint_timer_query_webgl2'), e1 = !e2 && gl.getExtension('EXT_disjoint_timer_query');
    if (!e1 && !e2) return null;
    const pend = [];
    let cur = null;
    return {
      dbg: { begun: 0, disjoint: 0, done: 0, err: 0 },
      begin() { if (pend.length > 8) return; this.dbg.begun++; cur = e2 ? gl.createQuery() : e1.createQueryEXT(); e2 ? gl.beginQuery(e2.TIME_ELAPSED_EXT, cur) : e1.beginQueryEXT(e1.TIME_ELAPSED_EXT, cur); },
      end() { if (!cur) return; e2 ? gl.endQuery(e2.TIME_ELAPSED_EXT) : e1.endQueryEXT(e1.TIME_ELAPSED_EXT); pend.push(cur); cur = null; },
      poll(out) {
        let disjoint = null;
        while (pend.length) {
          const q = pend[0];
          const ok = e2 ? gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE) : e1.getQueryObjectEXT(q, e1.QUERY_RESULT_AVAILABLE_EXT);
          if (!ok) break;
          const ns = e2 ? gl.getQueryParameter(q, gl.QUERY_RESULT) : e1.getQueryObjectEXT(q, e1.QUERY_RESULT_EXT);
          if (disjoint === null) disjoint = gl.getParameter((e2 || e1).GPU_DISJOINT_EXT);
          if (!disjoint) out.push(ns / 1e6); else this.dbg.disjoint++;
          this.dbg.done++;
          e2 ? gl.deleteQuery(q) : e1.deleteQueryEXT(q);
          pend.shift();
        }
      },
    };
  }

  // Frame stats from rAF timestamps. P = display period (ms). skip = ms of warm-up to ignore.
  function stats(ts, P, skip) {
    skip = skip || 0;
    const s = ts.filter(t => t - ts[0] >= skip);
    if (s.length < 3) return { n: s.length };
    const d = []; for (let i = 1; i < s.length; i++) d.push(s[i] - s[i - 1]);
    const so = d.slice().sort((a, b) => a - b), q = x => so[Math.min(so.length - 1, Math.floor(x * so.length))];
    const span = s[s.length - 1] - s[0], vs = Math.max(d.length, Math.round(span / P));
    const r = x => Math.round(x * 100) / 100;
    return { n: d.length, avg: r(span / d.length), p50: r(q(.5)), p95: r(q(.95)), max: r(so[so.length - 1]), drop: r(100 * (1 - d.length / vs)), long: d.filter(x => x > P * 1.5).length };
  }

  G.Bench = { run, stats, scene, prog, timer };
})(typeof self !== 'undefined' ? self : this);
