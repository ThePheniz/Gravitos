// Startup animation renderer (driven by splash.js): a black hole drifts over a galaxy, lenses
// it, swallows the screen, and a ring of light bursts out as Home appears.
// It runs in a worker when the browser can hand the canvas over (OffscreenCanvas), so Home
// loading on the main thread can't make it stutter; otherwise splash.js loads it as a script.
// The star field and the disk's texture are drawn once into textures, so each frame is cheap.
(function () {
  const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
`;
  const NOISE = `
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
uniform vec2 uSize;
`;

  // The sky, covering x -2..2 and y -1..1 (screen height = 1). Stored at half brightness so
  // bright stars survive 8-bit storage.
  const SKY = HEAD + NOISE + `
vec3 stars(vec2 p, float scale, float thr) {
  vec2 g = p * scale, id = floor(g), f = fract(g) - .5;
  float r = h21(id);
  vec2 o = (vec2(h21(id + 3.1), h21(id + 7.7)) - .5) * .7;
  float d = length(f - o);
  vec3 tint = mix(vec3(.75, .82, 1.), vec3(1., .86, .7), h21(id + 1.3));
  return tint * smoothstep(thr, 1., r) * (exp(-d * d * 300.) * 2.2 + exp(-d * 9.) * .12);
}
// The "something" it passes over: a tilted spiral galaxy where the hole comes to rest.
vec3 galaxy(vec2 p) {
  vec2 q = rot(.5) * (p - vec2(.035, .075)); q.y *= 2.4;
  float r = length(q), a = atan(q.y, q.x);
  float arms = .5 + .5 * sin(a * 2. - log(r + 1e-3) * 6.);
  return vec3(1., .9, .78) * exp(-r * 38.) * 1.5 + vec3(.55, .66, 1.) * exp(-r * 8.) * (.3 + .7 * arms) * .45;
}
void main() {
  vec2 p = gl_FragCoord.xy / uSize * vec2(4., 2.) - vec2(2., 1.);
  float n = fbm(p * 1.6 + vec2(3., 1.));
  vec3 c = mix(vec3(.008, .01, .025), vec3(.16, .05, .13), smoothstep(.45, .85, n));
  c += vec3(.03, .08, .14) * smoothstep(.5, .9, fbm(p * 2.6 - 2.));
  c += stars(p, 70., .9) + stars(p, 150., .88) * .55 + galaxy(p);
  gl_FragColor = vec4(c * .5, 1.);
}`;

  // The disk's streaky texture in polar form: x = angle, y = radius. Noise is sampled on a
  // circle so it wraps without a seam.
  const DISK = HEAD + NOISE + `
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  float a = f.x * 6.28318, k = .85 + f.y * 2.6;
  float n = fbm(vec2(cos(a), sin(a)) * 4. + vec2(k * 2.3, -k * 1.7));
  gl_FragColor = vec4(n, n, n, 1.);
}`;

  const MAIN = HEAD + `
uniform sampler2D uSky, uDisk;
uniform vec2 uRes, uC;
uniform float uT, uS, uFlash, uFade;

vec3 sky(vec2 p) { return texture2D(uSky, (p + vec2(2., 1.)) / vec2(4., 2.)).rgb * 2.; }

// Accretion disk seen face-on (q in the disk's own plane); inner rings turn faster.
vec3 disk(vec2 q, float rin, float rout) {
  float rd = length(q), k = rd / rin, ko = rout / rin;
  if (k < .85 || k > ko * 1.05) return vec3(0.);
  float a = atan(q.y, q.x) + uT * 1.7 * pow(1. / k, 1.5);
  float n = texture2D(uDisk, vec2(a / 6.28318, (k - .85) / 2.6)).r;
  float prof = smoothstep(.9, 1.12, k) * (1. - smoothstep(ko * .5, ko, k));
  vec3 c = mix(vec3(1., .96, .88), vec3(1., .6, .26), smoothstep(1., 2., k));
  c = mix(c, vec3(.65, .18, .07), smoothstep(1.8, 3.6, k));
  return c * prof * (.2 + 1.7 * n * n) * (1.5 / k);
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  vec2 d = p - uC;
  float S = uS;
  float grow = 1. + S * S * S * 42.;
  float Rs = .055 * grow, E = .095 * grow;
  float r = length(d);

  // Swallow: the scene spirals in and is drawn from further out, so it falls toward the hole.
  float sw = S * S * 4.5 * (.12 / (r + .04));
  vec2 dd = rot(sw) * d * (1. + S * S * 6.);
  vec3 col = sky(uC + dd - dd * (E * E / max(dot(dd, dd), 1e-6))); // point-mass lens

  float bright = 1. + S * 1.5;
  float rin = Rs * 1.9, rout = Rs * 6.;
  vec2 qs = rot(-.12 + sw * .6) * d;       // slight roll; spins up while swallowing
  vec2 dp = vec2(qs.x, qs.y / .2);         // undo the tilt
  vec3 dc = disk(dp, rin, rout) * (1. - .55 * dp.x / max(length(dp), 1e-4)) * bright;
  if (qs.y > 0. && r > Rs) col += dc;      // far half, behind the hole
  col *= smoothstep(Rs * .97, Rs * 1.01, r);

  // The wing: the far side of the disk bent up over the hole, and a thin copy under it.
  float phi = atan(qs.y, qs.x), top = .5 + .5 * sin(phi);
  float u = (r - Rs * 1.02) / (Rs * mix(.16, .8, top * top));
  if (u > 0. && u < 1.) {
    vec2 s = vec2(cos(phi), abs(sin(phi))) * (rin + u * (rout - rin) * .5);
    col += disk(s, rin, rout) * (1. - .55 * cos(phi)) * smoothstep(0., .08, u) * (1. - smoothstep(.55, 1., u)) * mix(.45, 1.1, top) * bright;
  }
  col += vec3(1., .9, .75) * exp(-pow((r - Rs * 1.025) / (Rs * .03), 2.)) * .8 * bright;
  if (qs.y < 0.) col += dc;                // near half, in front of the hole

  col = (1. - exp(-col * 1.3)) * uFade;
  if (uFlash > 0.) {
    col += vec3(1., .92, .82) * exp(-pow((r - uFlash * 1.3) / (.01 + .06 * uFlash), 2.)) * (1. - uFlash) * 1.3;
    col += vec3(1., .9, .8) * exp(-r * 30.) * (1. - uFlash) * 2.;
  }
  gl_FragColor = vec4(col, 1.);
}`;

  // Beat times in ms. The lens beat holds (up to MAX) until the app says Home is ready.
  const DRIFT = 3200, LENS = 4600, MAX = 8600, SWALLOW = 1800, FLASH_GAP = 150, FLASH = 700;

  // Returns a function taking 'go' (Home is ready) or 'skip' (a key was pressed), or null
  // when WebGL isn't available. emit() reports 'swallow', 'flash' and 'done'.
  function start(canvas, emit) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return null;

    function program(frag) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }'], [gl.FRAGMENT_SHADER, frag]].forEach(([type, src]) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      });
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      return p;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Draw a prep shader once into a texture (sizes are powers of two, so it can wrap).
    function bake(frag, w, h, unit, wrapS, wrapT) {
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const p = program(frag);
      gl.useProgram(p);
      gl.uniform2f(gl.getUniformLocation(p, 'uSize'), w, h);
      gl.viewport(0, 0, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
    }
    // About two texels per screen pixel across the visible sky.
    const skyH = Math.min(canvas.height > 600 ? 2048 : 1024, gl.getParameter(gl.MAX_TEXTURE_SIZE) / 2);
    bake(SKY, skyH * 2, skyH, 0, gl.MIRRORED_REPEAT, gl.MIRRORED_REPEAT);
    bake(DISK, 1024, 128, 1, gl.REPEAT, gl.CLAMP_TO_EDGE);

    const main = program(MAIN);
    gl.useProgram(main);
    const U = {};
    ['uSky', 'uDisk', 'uRes', 'uC', 'uT', 'uS', 'uFlash', 'uFade'].forEach(n => U[n] = gl.getUniformLocation(main, n));
    gl.uniform1i(U.uSky, 0); gl.uniform1i(U.uDisk, 1);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
    const clamp = x => Math.min(1, Math.max(0, x));
    let t0 = null, swallowAt = null, ready = false, skip = false, flashed = false;

    function frame(now) {
      if (t0 === null) t0 = now;
      const t = now - t0;
      if (swallowAt === null && (skip || t >= MAX || (ready && t >= LENS))) { swallowAt = t; emit('swallow'); }
      const k = 1 - Math.pow(1 - clamp(t / DRIFT), 3);
      const s = swallowAt === null ? 0 : clamp((t - swallowAt) / SWALLOW);
      const flash = swallowAt === null ? 0 : clamp((t - swallowAt - SWALLOW - FLASH_GAP) / FLASH);
      if (flash > 0 && !flashed) { flashed = true; emit('flash'); }
      gl.uniform2f(U.uC, -1.25 + 1.25 * k, .16 - .13 * k + .05 * Math.sin(k * Math.PI));
      gl.uniform1f(U.uT, t / 1000);
      gl.uniform1f(U.uS, s * s * (3 - 2 * s));
      gl.uniform1f(U.uFlash, flash);
      gl.uniform1f(U.uFade, clamp(t / 700));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (flash >= 1) return emit('done');
      raf(frame);
    }
    raf(frame);
    return msg => { if (msg === 'skip') skip = true; else if (msg === 'go') ready = true; };
  }

  if (typeof window === 'undefined') {
    let send = null;
    onmessage = e => {
      if (e.data && e.data.canvas) {
        try { send = start(e.data.canvas, p => postMessage(p)); } catch (err) { send = null; }
        if (!send) postMessage('fail');
      } else if (send) send(e.data);
    };
  } else {
    window.GravitosSplash = start;
  }
})();
