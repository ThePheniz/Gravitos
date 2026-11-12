// Startup animation renderer, concept A "Event Horizon": a restrained, physically inspired black
// hole. A sliver of light wraps the photon ring like an eclipse, the accretion disk ignites from
// its hot inner edge outward while the camera dollies back and orbits up into the Gravitos mark's
// tilt; gravity bends the disk's far side over the top of the shadow and under it, the
// approaching side burns brighter (Doppler beaming), and faint stars slide behind the hole and
// smear into an Einstein ring. On the way out the camera falls through the horizon into black.
// Pipeline per frame: scene (1 pass) -> bloom down/up chain in small textures -> one horizontal
// anamorphic streak pass -> composite (ACES, vignette, chromatic fringe, film grain).
// The disk texture and the star field are baked once at start. Quality knob: ?q= (page URL, main
// thread only) or QUALITY below; default 1 on PC, .5 on the TV (see README.md).
(function () {
  const QUALITY = null; // force a level: 0 = single scene pass, .25, .5 (TV), 1 (PC)

  const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;
  const NOISE = `
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; } return v; }
uniform vec2 uSize;
`;

  // Baked once: the disk's gas in polar form (x = angle, wraps; y = 0 inner edge .. 1 outer edge).
  // Soft concentric lanes plus slow clumps; kept low-frequency so the edge-on squeeze can't alias.
  const DISK = HEAD + NOISE + `
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  float a = f.x * 6.28318, x = f.y;
  vec2 c = vec2(cos(a), sin(a));
  float lanes = fbm(c * .9 + vec2(0., x * 9.));
  float fine = noise(c * 1.5 + vec2(3., x * 26.));
  float clump = fbm(c * 3.2 + vec2(x * 3., -x * 2.));
  float n = lanes * lanes * 1.6 + fine * .2 + clump * clump * 1.1;
  gl_FragColor = vec4(vec3(n * .5), 1.);
}`;

  // Baked once: a sparse, tiling star field (2.4 x 1.2 screen heights), sqrt-encoded so faint
  // stars keep their precision in 8 bits. Mostly barely-there points, a rare brighter one.
  const SKY = HEAD + NOISE + `
vec3 layer(vec2 f, vec2 cells, float thr, float gain, float psf) {
  vec2 g = f * cells, id = mod(floor(g), cells), q = fract(g) - .5;
  float on = step(thr, h21(id));
  vec2 o = (vec2(h21(id + 3.1), h21(id + 7.7)) - .5) * .6;
  float d = length((q - o) * uSize / cells);           // distance in texels
  float b = pow(h21(id + 5.3), 5.) * gain;
  vec3 tint = mix(vec3(.8, .86, 1.), vec3(1., .85, .68), h21(id + 1.3));
  return tint * on * b * exp(-d * d / psf);
}
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  vec3 c = layer(f, vec2(180., 90.), .975, .35, .4) + layer(f, vec2(48., 24.), .9, .8, .6);
  gl_FragColor = vec4(sqrt(min(c, 1.)), 1.);
}`;

  // The scene, in "hole units" (shadow radius = 1). Lensing is a point-mass lens: a ray passing
  // at d looks back at d(1 - E^2/|d|^2). The disk's far half is seen through the full lens (so it
  // rises over the shadow and its secondary image hugs the shadow's underside); the near half,
  // which is in front of the hole, only through a weak one. Output: sqrt(c/(1+c)) in RGBA8.
  const SCENE = HEAD + `
uniform sampler2D uDisk, uSky;
uniform vec2 uRes, uC, uOrbit, uRS;
uniform float uU, uCi, uSpin, uReveal, uArc, uExpo, uSkyAmt, uE2, uGlint;
const float RI = 1.2, RO = 2.7;

// Disk emission seen at the (lensed) point s; cov = coverage, side > 0 on the far half.
vec3 disk(vec2 s, out float cov, out float side) {
  vec2 u = mat2(uRS.x, -uRS.y, uRS.y, uRS.x) * s;   // roll (cos, sin) from JS
  vec2 q = vec2(u.x, u.y / uCi);
  float r = length(q) + 1e-4;
  vec2 n = q / r;
  side = n.y;
  float x = (r - RI) / (RO - RI);
  float rr = RI / r;
  float g = texture2D(uDisk, vec2(atan(q.y, q.x) * .159155 + uSpin * rr * sqrt(rr), clamp(x, 0., 1.))).r;
  float ign = smoothstep(uReveal, uReveal - .35, x);                    // ignites inside-out
  cov = smoothstep(0., .04, x) * (1. - smoothstep(.05, .85, x)) * ign;
  float dop = 1. / (1. + .3 * sqrt(rr) * n.x);                          // left side approaches
  float I = cov * rr * rr * rr * (.3 + 1.5 * g) * dop * dop * dop;
  float T = clamp((1. - x * 1.6) * .8 + (dop - 1.) * .9, 0., 1.);     // temperature
  vec3 col = mix(vec3(.6, .17, .04), vec3(1., .5, .2), smoothstep(0., .45, T));
  col = mix(col, vec3(1., .78, .5), smoothstep(.35, .75, T));
  col = mix(col, vec3(1., .95, .86), smoothstep(.7, 1., T));
  return col * I * .8;
}

void main() {
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float px = 1. / (uRes.y * uU);                       // one pixel in hole units
  vec2 d = (p - uC) / uU;
  float r2 = max(dot(d, d), .25), r = sqrt(r2);
  float out_ = smoothstep(1. - px * .5, 1. + px, r);   // outside the shadow

  float cF, sF, cN, sN;
  vec3 far = disk(d * (1. - uE2 / r2), cF, sF);
  vec3 near = disk(d * (1. - uE2 * .25 / max(r2, 1.)), cN, sN);   // in front: barely bent
  float wF = smoothstep(-.3, .3, sF), wN = 1. - smoothstep(-.3, .3, sN);

  // Background stars through the same lens, drifting with the camera's orbit.
  vec2 sp = p - d * (uE2 / r2) * uU + uOrbit;
  vec3 sky = texture2D(uSky, sp / vec2(2.4, 1.2) + .5).rgb;
  sky *= sky * uSkyAmt;

  // Photon ring: the light that orbits the hole, hairline-thin, beamed like the disk; at the
  // opening only an arc of it is lit, growing round from the upper left.
  float w = max(.009, px * .75);
  float ring = exp(-pow((r - 1.025) / w, 2.)) * .3 + exp(-pow((r - 1.025) / (w * 4.), 2.)) * .08 + exp(-(r - 1.) / .05) * .06;
  vec2 dn = d / r;
  vec2 limb = normalize(vec2(-.85, .5));
  float arc = exp(-(1. - dot(dn, limb)) / max(uArc * 2.5, .02));
  ring *= (1. - .65 * dn.x) * mix(arc, 1., uReveal * uReveal);
  vec2 gd = d - limb * 1.03;
  float glint = (exp(-dot(gd, gd) / .0025) * 5. + exp(-length(gd) / .12) * .25) * uGlint;

  vec3 col = (sky + far * wF + vec3(1., .86, .66) * ring * mix(.5, 1., uReveal)) * out_;
  col += vec3(.03, .014, .005) * exp(-r * 1.1) * uReveal * out_ + vec3(1., .9, .76) * glint;            // warm air around it
  col = col * (1. - min(cN * 1.6, 1.) * wN) + near * wN;
  col *= uExpo;
  col = col / (1. + col);
  gl_FragColor = vec4(sqrt(col), 1.);
}`;

  // Bloom: the first step decodes the scene and keeps only what is bright (soft knee); every
  // level stores sqrt(c/4) so faint halo tails don't band in 8 bits.
  const DOWN = HEAD + `
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uFirst;
vec3 dec(vec2 uv) {
  vec3 e = texture2D(uSrc, uv).rgb; e *= e;
  if (uFirst > .5) {
    vec3 c = e / max(1. - e, .002);
    float l = dot(c, vec3(.3, .55, .15));
    return c * clamp((l - .35) / 1.2, 0., 1.);
  }
  return e * 4.;
}
void main() {
  vec3 c = dec(v + uTexel * vec2(-1, -1)) + dec(v + uTexel * vec2(1, -1)) + dec(v + uTexel * vec2(-1, 1)) + dec(v + uTexel * vec2(1, 1));
  gl_FragColor = vec4(sqrt(c * .0625), 1.);
}`;
  const UP = HEAD + `
uniform sampler2D uSrc, uLow; uniform vec2 uTexel; uniform float uMix;
vec3 dec(sampler2D t, vec2 uv) { vec3 e = texture2D(t, uv).rgb; return e * e * 4.; }
void main() {
  vec3 lo = dec(uLow, v + uTexel * vec2(-.75, -.75)) + dec(uLow, v + uTexel * vec2(.75, -.75)) + dec(uLow, v + uTexel * vec2(-.75, .75)) + dec(uLow, v + uTexel * vec2(.75, .75));
  vec3 c = dec(uSrc, v) + lo * .25 * uMix;
  gl_FragColor = vec4(sqrt(min(c * .25, 1.)), 1.);
}`;
  // Anamorphic streak: a long horizontal blur of the brightest light, read from a bloom level.
  const STREAK = HEAD + `
uniform sampler2D uSrc; uniform vec2 uTexel;
vec3 dec(vec2 uv) { vec3 e = texture2D(uSrc, uv).rgb; e = e * e * 4.; return e * smoothstep(.2, 1.2, dot(e, vec3(.33))); }
void main() {
  vec3 c = dec(v) * .2;
  for (int i = 1; i <= 8; i++) {
    float o = float(i) * 2.2, w = exp(-float(i) * .37);
    c += (dec(v + vec2(uTexel.x * o, 0.)) + dec(v - vec2(uTexel.x * o, 0.))) * w * .2;
  }
  gl_FragColor = vec4(sqrt(min(c * .25, 1.)), 1.);
}`;
  const COMP = HEAD + `
uniform sampler2D uScene, uBloom, uStreak;
uniform vec2 uRes; uniform float uT, uFade, uCA, uBloomAmt, uStreakAmt;
vec3 decS(vec3 e) { e *= e; return e / max(1. - e, .002); }
vec3 aces(vec3 x) { return clamp(x * (2.51 * x + .03) / (x * (2.43 * x + .59) + .14), 0., 1.); }
void main() {
  vec2 c = v - .5;
  vec3 sc;
  if (uCA > 0.) {              // a whisper of lateral colour toward the edges
    vec2 o = c * dot(c, c) * .006;
    sc = decS(vec3(texture2D(uScene, v + o).r, texture2D(uScene, v).g, texture2D(uScene, v - o).b));
  } else sc = decS(texture2D(uScene, v).rgb);
  vec3 bl = texture2D(uBloom, v).rgb; bl = bl * bl * 4.;
  vec3 st = texture2D(uStreak, v).rgb; st = st * st * 4.;
  vec3 col = sc + bl * uBloomAmt + st * uStreakAmt * vec3(1., .82, .62);
  c.x *= uRes.x / uRes.y;
  col *= 1. - .45 * smoothstep(.25, 1.1, dot(c, c) * 1.6);
  col = pow(aces(col * .9), vec3(1. / 2.2));
  // Film grain, strongest in the mid-tones, and a dither so gradients never band.
  float n = h21(gl_FragCoord.xy + fract(uT * 7.31) * 113.) + h21(gl_FragCoord.yx * 1.37 + fract(uT * 3.17) * 71.) - 1.;
  float l = dot(col, vec3(.33));
  col += n * (.012 + .05 * l * (1. - l));
  gl_FragColor = vec4(max(col * uFade, 0.), 1.);
}`;

  // Beat times in ms. The rest beat holds (up to MAX) until the app says Home is ready.
  const READY_AT = 4300, MAX = 8600, OUT = 1100, SKIP_OUT = 700, FLASH_AT = .8;

  const clamp = x => Math.min(1, Math.max(0, x));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const mix = (a, b, x) => a + (b - a) * x;
  const easeOut = (x, k = 3) => 1 - Math.pow(1 - x, k);
  const easeInOut = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const sine = x => .5 - .5 * Math.cos(Math.PI * x);

  function quality(canvas) {
    const m = typeof location !== 'undefined' && /[?&]q=([\d.]+)/.exec(location.search);
    if (m) return +m[1];
    if (QUALITY !== null) return QUALITY;
    const tv = (typeof navigator !== 'undefined' && /tizen/i.test(navigator.userAgent)) || canvas.height <= 600;
    return tv ? .5 : 1;
  }

  // Returns a function taking 'go' (Home is ready) or 'skip' (a key was pressed), or null
  // when WebGL isn't available. emit() reports 'swallow' (exit begins), 'flash' and 'done'.
  function start(canvas, emit) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return null;
    const Q = quality(canvas);
    const W = canvas.width, H = canvas.height;

    function program(frag) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, 'attribute vec2 a; varying vec2 v; void main() { v = a * .5 + .5; gl_Position = vec4(a, 0., 1.); }'], [gl.FRAGMENT_SHADER, frag]].forEach(([type, src]) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      });
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      const loc = {};
      return { p, u: n => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n))) };
    }
    function target(w, h, wrap) {
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap === 2 ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb, w, h };
    }
    // Draw prog into target (null = the canvas) with uniforms (numbers / arrays) and textures.
    function draw(P, T, uni, tex) {
      gl.useProgram(P.p);
      gl.bindFramebuffer(gl.FRAMEBUFFER, T ? T.fb : null);
      gl.viewport(0, 0, T ? T.w : W, T ? T.h : H);
      for (const n in uni) {
        const x = uni[n];
        if (typeof x === 'number') gl.uniform1f(P.u(n), x);
        else gl.uniform2f(P.u(n), x[0], x[1]);
      }
      Object.keys(tex || {}).forEach((n, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, tex[n].tex);
        gl.uniform1i(P.u(n), i);
      });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const diskT = target(512, 256, 1), skyT = target(1024, 512, 2);
    draw(program(DISK), diskT, { uSize: [512, 256] });
    draw(program(SKY), skyT, { uSize: [1024, 512] });

    const scene = program(SCENE), down = program(DOWN), up = program(UP), streak = program(STREAK), comp = program(COMP);
    const sceneT = target(W, H);
    // Bloom levels: PC from 1/2 res down to 1/32; TV from 1/4. q = 0 skips bloom entirely.
    const nLev = Q >= 1 ? 5 : Q >= .5 ? 4 : Q > 0 ? 3 : 0;
    const f0 = Q >= 1 ? 2 : 4;
    const L = [], U = [];
    for (let i = 0; i < nLev; i++) { L.push(target(W / (f0 << i), H / (f0 << i))); U.push(i < nLev - 1 ? target(W / (f0 << i), H / (f0 << i)) : L[i]); }
    const streakT = nLev && Q >= .5 ? target(L[0].w, L[0].h) : null;
    const black = target(1, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, black.fb); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
    let t0 = null, last = 0, spin = 0, outAt = null, outLen = OUT, ready = false, skip = false, flashed = false;

    // The camera and light at time t (s) of the opening, and how far into the exit (0..1).
    function look(t, x) {
      const c0 = span(t, .1, 4.6), cam = mix(c0 * c0 * c0 * (c0 * (c0 * 6 - 15) + 10), easeOut(c0, 3), .55); // dolly back: eased in, long settle
      const breathe = Math.sin(t * .7) * span(t, 3, 5);       // the hold keeps living
      let U = .066 * mix(2.3, 1, cam) * (1 + .012 * breathe);
      const k = {
        C: [mix(-.05, 0, cam), mix(.0, .03, cam) + .003 * breathe],
        roll: mix(.1, .314, cam) + .006 * breathe,
        ci: mix(.07, .3, easeInOut(span(t, .2, 4.2))),
        orbit: [mix(-.18, 0, cam) + t * .004, mix(.04, 0, cam)],
        reveal: mix(-.1, 1.45, easeInOut(span(t, .55, 3.))),
        arc: easeInOut(span(t, .2, 2.3)),
        glint: easeOut(span(t, .15, .7)) * (1 - sine(span(t, .8, 2.1))),
        expo: easeOut(span(t, 0, 1.3), 2),
        sky: sine(span(t, 1.4, 3.8)),
        fade: 1, spinRate: .06,
      };
      if (x > 0) {
        // Falling in: the push accelerates until the shadow fills the frame; the disk whips past.
        const push = Math.pow(x, 2.2);
        U *= Math.exp(3.6 * push);
        k.C = [k.C[0] * (1 - push), k.C[1] * (1 - push)];
        k.roll += .5 * push;
        k.spinRate = .06 + .5 * push;
        k.glint *= 1 - x;
        k.fade = 1 - sine(span(x, .82, 1));
      }
      k.U = U;
      return k;
    }

    function frame(now) {
      if (t0 === null) t0 = now;
      const t = now - t0;
      if (outAt === null && (skip || t >= MAX || (ready && t >= READY_AT))) {
        outAt = t;
        outLen = skip && t < READY_AT ? SKIP_OUT : OUT;
        emit('swallow');
      }
      const x = outAt === null ? 0 : clamp((t - outAt) / outLen);
      if (x >= FLASH_AT && !flashed) { flashed = true; emit('flash'); }
      const k = look((outAt === null ? t : outAt) / 1000, x);
      spin += k.spinRate * Math.min(t - last, 100) / 1000; last = t;

      draw(scene, sceneT, {
        uRes: [W, H], uC: k.C, uOrbit: k.orbit, uU: k.U, uRS: [Math.cos(k.roll), Math.sin(k.roll)], uCi: k.ci, uSpin: spin,
        uReveal: k.reveal, uArc: k.arc, uGlint: k.glint, uExpo: k.expo, uSkyAmt: k.sky, uE2: 1.45,
      }, { uDisk: diskT, uSky: skyT });
      for (let i = 0; i < nLev; i++) {
        const src = i ? L[i - 1] : sceneT;
        draw(down, L[i], { uTexel: [1 / src.w, 1 / src.h], uFirst: i ? 0 : 1 }, { uSrc: src });
      }
      for (let i = nLev - 2; i >= 0; i--) draw(up, U[i], { uTexel: [1 / U[i + 1].w, 1 / U[i + 1].h], uMix: 1 }, { uSrc: L[i], uLow: U[i + 1] });
      if (streakT) draw(streak, streakT, { uTexel: [4 / f0 / L[0].w, 1 / L[0].h] }, { uSrc: L[0] }); // same reach on PC and TV
      draw(comp, null, {
        uRes: [W, H], uT: t / 1000, uFade: k.fade, uCA: Q >= 1 ? 1 : 0, uBloomAmt: 1.1, uStreakAmt: .5,
      }, { uScene: sceneT, uBloom: nLev ? U[0] : black, uStreak: streakT || black });
      if (x >= 1) return emit('done');
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
