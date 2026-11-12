// Startup animation, Concept B "Liquid light": ribbons of warm liquid light sweep in through
// depth, spiral down and wrap into the tilted ring of the Gravitos mark while the black disc opens
// as negative space and its rim ignites. On the way out the ribbons peel off the ring and stream
// past the camera. Drop-in for js/splash-gl.js (same start(canvas, emit) -> send(msg) API).
//
// Cheap by construction: ribbons are triangle strips and dust is GL points (additive), so the
// per-pixel work is one tiny shader where something is actually drawn. Depth of field is faked
// per vertex (a ribbon out of focus gets wider and dimmer, same energy). One HDR scene pass, a
// two-level bloom in 1/4 and 1/8 size buffers, and one filmic composite with baked grain.
// Quality: ?q=0 (low) / 1 (default) / 2 (high) on the page URL, else Q_DEFAULT.
(function () {
  const Q_DEFAULT = 1;

  const VS_RIB = `
attribute vec2 a;              // x: 0 tail .. 1 head, y: side -1/1
uniform mat3 uB;               // ring frame in view space: major axis, depth axis, normal
uniform vec4 uR;               // radius scale, inbound height, inbound depth, phase
uniform vec4 uR2;              // head u, length, half width, energy
uniform vec4 uR3;              // outbound height, outbound depth, twist turns, seed
uniform vec4 uG;               // uIn, uOut, perspective, scale K
uniform vec4 uG2;              // centre x, y, aspect, pixel size (screen-height units)
uniform vec4 uG3;              // time s, rest 0..1, defocus, glint angle
uniform float uMode;           // 0 ribbon on the orbit, 1 rim of the disc
varying vec3 vCol; varying vec2 vS; varying float vZ, vV, vStr, vSeed;

vec3 path(float u) {
  float phi = uR.w + u;
  if (uMode > .5) return vec3(cos(phi), sin(phi), 0.) * uR.x;
  float xi = max(uG.x - u, 0.) / 2.2, ain = xi * xi / (1. + .6 * xi);
  float xo = max(u - uG.y, 0.) / 1.6, aout = xo * xo / (1. + .3 * xo);
  float r = uR.x * (1. + 1.5 * ain + 1.3 * aout);
  vec3 p = r * (cos(phi) * uB[0] + sin(phi) * uB[1]);
  // A slow liquid wobble out of the ring's plane; it all but settles at rest.
  float wob = sin(phi * 3. + uG3.x * .9 + uR3.w * 6.) * (.05 * ain + .012 * (1. - uG3.y) + .004);
  p += uB[2] * (uR.y * ain + uR3.x * aout + wob);
  p.z += uR.z * 2.2 * (1. - exp(-ain * .45)) + uR3.y * 2.4 * (1. - exp(-aout * .5));
  return p;
}
vec3 proj(vec3 p) { float w = max(1. - p.z * uG.z, .12); return vec3(uG2.xy + uG.w * p.xy / w, w); }

void main() {
  float s = a.x;
  float u = uR2.x - uR2.y * (1. - s);
  vec3 p0 = path(u), p1 = path(u + .004);
  vec3 q0 = proj(p0), q1 = proj(p1);
  vec2 t = q1.xy - q0.xy;
  t = t / max(length(t), 1e-6);
  vec2 n = vec2(-t.y, t.x);
  float px = uG2.w;
  // A flat ribbon twisting along its length: narrow and hot where it turns edge-on.
  float tw = s * uR3.z + uG3.x * .8 + uR3.w * 9.;
  float face = mix(abs(cos(tw)), 1., uG3.y * .85 + uMode);
  float hw0 = uR2.z * (.25 + .75 * face) / q0.z;
  float coc = uMode > .5 ? 0. : min(uG3.z * abs(p0.z) * uG.w / q0.z, .05);
  // Ends pinch to a point like a brush stroke (the head a little sharper than the tail).
  float pinch = uMode > .5 ? 1. : sqrt(smoothstep(0., .18, s) * smoothstep(1., .9 - .06 * uG3.y, s));
  hw0 *= .15 + .85 * pinch;
  float hw = clamp(hw0 + coc, px * 1.1, .045);       // capped: ribbons passing the lens stay cheap
  float e = uR2.w * (hw0 + px * .6) / hw;           // same light spread wider when defocused
  e *= 1. + 1.6 * pow(1. - face, 6.) * (1. - uG3.y * .7);

  float phi = uR.w + u;
  vec3 col;
  if (uMode > .5) {
    // Rim: drawn on from the tail; ends overlap with linear ramps so the closed circle is seamless.
    float d = .35;
    float ramp = clamp((u - (uR2.x - uR2.y)) / d, 0., 1.) * clamp((uR2.x - u) / d + .0, 0., 1.);
    float spark = exp(-(uR2.x - u) * 9.) * uR3.x;
    float lit = .55 + .45 * cos(phi - 2.2);         // brighter toward the top left
    col = vec3(1., .86, .68) * (ramp * lit + spark * 3.);
  } else {
    // Ends taper; while flying the head leads like a comet.
    float fly = 1. - uG3.y;
    float taper = mix(smoothstep(0., .45, s) * smoothstep(1., .8, s),
                      pow(s, 1.4) * smoothstep(1., .93, s) * (1. + 1.8 * exp(-pow((.955 - s) * 22., 2.))), fly);
    // The mark's gradient along the major axis: deep orange left, white-hot left of centre, amber right.
    float g = (cos(phi) + 1.) * .5;
    float bell = exp(-pow((g - .42) / .26, 2.));
    vec3 grad = mix(mix(vec3(1., .45, .15) * .3, vec3(1., .62, .32) * .42, g), vec3(1., .9, .76) * 1.15, bell);
    vec3 warm = mix(vec3(1., .62, .3), vec3(1., .8, .58), .5 + .5 * sin(uR3.w * 20. + s * 3.));
    col = mix(warm, grad, uG3.y);
    col *= 1. + .18 * max(sin(phi), 0.) * uG3.y;     // the near half is a touch bolder
    // A specular glint travels round the ring.
    float da = mod(phi - uG3.w + 3.14159, 6.28318) - 3.14159;
    col *= 1. + 1.6 * exp(-da * da * 9.) * uG3.y;
    col *= taper;
  }
  vCol = col * e;
  vec2 sp = q0.xy + n * a.y * hw * 1.4;
  vS = sp; vZ = p0.z; vV = a.y;
  vStr = smoothstep(3. * px, 9. * px, hw) * (1. - uMode);
  vSeed = uR3.w * 40.;
  gl_Position = vec4((sp.x - .0) * 2. / uG2.z, sp.y * 2., 0., 1.);
}`;

  const FS_RIB = `
precision mediump float;
uniform float uPx;
uniform vec3 uHole;             // centre x, y, radius
varying vec3 vCol; varying vec2 vS; varying float vZ, vV, vStr, vSeed;
void main() {
  float v = vV;
  float prof = exp(-v * v * 4.4);
  // Fine strands inside a wide ribbon, so it reads as woven light, not a flat stroke.
  float st = .5 + .5 * cos(v * 13.3 + vSeed);
  st *= st; st *= st;
  prof *= mix(1., .45 + 1.6 * st, vStr);
  // Behind the disc = hidden: the disc is negative space in front of anything further away.
  float d = length(vS - uHole.xy);
  float hid = (1. - smoothstep(uHole.z - uPx * 1.5, uHole.z + uPx * 1.5, d)) * smoothstep(-.005, -.06, vZ);
  gl_FragColor = vec4(vCol * prof * (1. - hid), 1.);
}`;

  // Dust: a sparse field of motes in the same 3D space, rendered as lens bokeh.
  const VS_DUST = `
attribute vec4 a;              // radius, angle, height, seed
uniform mat3 uB;
uniform vec4 uG, uG2, uG3;
uniform float uDust;
varying vec3 vCol; varying vec2 vS; varying float vZ;
void main() {
  float sd = a.w;
  float th = a.y + uG3.x * (.03 + .05 * sd) / max(a.x, .5) + (1. - uG3.y) * .6 / max(a.x, .5);
  vec3 p = a.x * (cos(th) * uB[0] + sin(th) * uB[1]) + uB[2] * a.z;
  float w = max(1. - p.z * uG.z, .12);
  vec2 sp = uG2.xy + uG.w * p.xy / w;
  float px = uG2.w;
  // Diameter in screen units (same look at any resolution); light spreads as it defocuses.
  float dia = .0022 + min(uG3.z * 1.3 * abs(p.z) * uG.w / w, .045);
  float size = clamp(dia / px, 1.5, 64.);
  gl_PointSize = size;
  float tw = .65 + .35 * sin(uG3.x * (.7 + sd) + sd * 40.);
  vCol = mix(vec3(1., .6, .3), vec3(1., .85, .65), fract(sd * 7.)) * uDust * tw * (.35 + .65 * fract(sd * 13.))
       * min(pow(.0026 / (size * px), 2.), 1.) * 1.1;
  vS = sp; vZ = p.z;
  gl_Position = vec4(sp.x * 2. / uG2.z, sp.y * 2., 0., 1.);
}`;
  const FS_DUST = `
precision mediump float;
uniform float uPx;
uniform vec3 uHole;
varying vec3 vCol; varying vec2 vS; varying float vZ;
void main() {
  float d = length(gl_PointCoord - .5) * 2.;
  float b = smoothstep(1., .72, d) * (.75 + .25 * smoothstep(.4, .9, d));   // a lens bokeh, faint bright edge
  float hid = (1. - smoothstep(uHole.z * .97, uHole.z * 1.03, length(vS - uHole.xy))) * step(vZ, 0.);
  gl_FragColor = vec4(vCol * b * (1. - hid), 1.);
}`;

  // The diamond-ring glint: one small additive sprite (core, halo, thin anamorphic streak).
  const VS_GLINT = `
attribute vec2 a;
uniform vec4 uGl;              // centre x, y (screen-height units), half width, half height
uniform float uAsp;
varying vec2 vP;
void main() { vP = a * uGl.zw; vec2 p = uGl.xy + vP; gl_Position = vec4(p.x * 2. / uAsp, p.y * 2., 0., 1.); }`;
  const FS_GLINT = `
precision mediump float;
uniform float uI;
varying vec2 vP;
void main() {
  float r2 = dot(vP, vP);
  float core = exp(-r2 / .000012) * 6. + exp(-r2 / .00025) * .9;
  float streak = exp(-abs(vP.x) / .07) * exp(-vP.y * vP.y / .0000045) * 1.1 * (1. - smoothstep(.15, .3, abs(vP.x)));
  vec3 c = vec3(1., .95, .88) * core + vec3(1., .78, .55) * streak;
  gl_FragColor = vec4(c * uI * (1. - smoothstep(.04, .06, abs(vP.y))), 1.);
}`;

  const VS_QUAD = `attribute vec2 a; varying vec2 vUv; void main() { vUv = a * .5 + .5; gl_Position = vec4(a, 0., 1.); }`;
  // 4 bilinear taps = a 4x4 box when shrinking by 4 (or 2x2 blocks for a halving).
  const FS_DOWN = `
precision mediump float;
uniform sampler2D uT; uniform vec2 uTx; varying vec2 vUv;
void main() {
  gl_FragColor = .25 * (texture2D(uT, vUv + uTx * vec2(-1., -1.)) + texture2D(uT, vUv + uTx * vec2(1., -1.))
    + texture2D(uT, vUv + uTx * vec2(-1., 1.)) + texture2D(uT, vUv + uTx * vec2(1., 1.)));
}`;
  // 9-tap gaussian in 5 bilinear fetches.
  const FS_BLUR = `
precision mediump float;
uniform sampler2D uT; uniform vec2 uTx; varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uT, vUv) * .2270
    + (texture2D(uT, vUv + uTx * 1.3846) + texture2D(uT, vUv - uTx * 1.3846)) * .3162
    + (texture2D(uT, vUv + uTx * 3.2308) + texture2D(uT, vUv - uTx * 3.2308)) * .0703;
}`;
  const FS_COMP = `
precision mediump float;
uniform sampler2D uS, uB1, uB2, uN;
uniform vec4 uG2;               // centre, aspect, px
uniform vec3 uHole;
uniform vec4 uK;                // haze, bloom, exposure, fade
uniform vec4 uK2;               // noise offset xy, decode scale, flare
varying vec2 vUv;
void main() {
  vec2 p = (vUv - .5) * vec2(uG2.z, 1.);
  vec2 dp = p - uHole.xy;
  float r = length(dp);
  float disc = 1. - smoothstep(uHole.z - uG2.w, uHole.z + uG2.w, r);
  vec3 b = texture2D(uB1, vUv).rgb * .55 + texture2D(uB2, vUv).rgb * .75;
  vec3 c = texture2D(uS, vUv).rgb + b * uK.y * (1. - .75 * disc);
  c *= uK2.z;
  // Warm haze behind the mark (the logo's soft glow), absent inside the disc.
  float hz = exp(-r * 4.2) * .9 + exp(-r * 1.4) * .25;
  c += vec3(.075, .036, .014) * hz * uK.x * (1. - disc) + vec3(1., .8, .6) * uK2.w * exp(-r * 6.);
  // Filmic shoulder that runs warm highlights to white, a gentle toe, vignette.
  c = 1. - exp(-c * uK.z);
  c = c * c * (3. - 2. * c) * .35 + c * .65;
  c *= 1. - .35 * dot(p, p) * .8;
  c *= uK.w;
  vec3 n = texture2D(uN, gl_FragCoord.xy / 128. + uK2.xy).rgb - .5;
  gl_FragColor = vec4(c + n * (2.4 / 255.) + n.gbr * .012 * (c.r + .05), 1.);
}`;

  const READY_AT = 4300, MAX = 8600, OUT = 1300, SKIP_OUT = 750;
  const TAU = Math.PI * 2;

  const clamp = x => Math.min(1, Math.max(0, x));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const ease = x => x * x * (3 - 2 * x);
  const easeOut = (x, k = 3) => 1 - Math.pow(1 - x, k);
  const easeIn = (x, k = 3) => Math.pow(x, k);
  const easeInOut = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const mix = (a, b, x) => a + (b - a) * x;

  function start(canvas, emit) {
    const search = typeof location !== 'undefined' ? location.search : '';
    const qm = /[?&]q=(\d)/.exec(search);
    const Q = qm ? +qm[1] : Q_DEFAULT;
    const PH = 5;                                         // orbit phase: measured to keep the flight's light centred
    // WebGL2 + RGBA16F where available (the TV: WebGL1 there has no half float), else WebGL1.
    const opts = { antialias: false, alpha: false, depth: false, premultipliedAlpha: false };
    let gl = canvas.getContext('webgl2', opts);
    const gl2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', opts);
    if (!gl) return null;
    const W = canvas.width, H = canvas.height, asp = W / H;

    function program(vs, fs, attrs) {
      const p = gl.createProgram();
      [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]].forEach(([type, src]) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      });
      gl.bindAttribLocation(p, 0, 'a');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const U = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const nm = gl.getActiveUniform(p, i).name; U[nm] = gl.getUniformLocation(p, nm); }
      return { p, U };
    }

    // HDR when the GPU can render and filter half floats; else 8-bit with the light stored at 1/4.
    let HDR = null;                                       // [internal format, type] of a half-float target
    if (gl2) { if (gl.getExtension('EXT_color_buffer_float')) HDR = [gl.RGBA16F, gl.HALF_FLOAT]; }
    else {
      const hf = gl.getExtension('OES_texture_half_float'), hfl = gl.getExtension('OES_texture_half_float_linear');
      gl.getExtension('EXT_color_buffer_half_float');
      if (hf && hfl) HDR = [gl.RGBA, hf.HALF_FLOAT_OES];
    }
    const LDR = [gl.RGBA, gl.UNSIGNED_BYTE];
    function target(w, h, fmt) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], w, h, 0, gl.RGBA, fmt[1], null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      return ok ? { tex, fb, w, h } : null;
    }
    const sc = Q === 0 ? .75 : 1;                         // scene resolution scale
    const SW = Math.round(W * sc), SH = Math.round(H * sc);
    let type = HDR || LDR;
    let S = target(SW, SH, type);
    if (!S) { type = LDR; S = target(SW, SH, type); }
    const ENC = type === LDR ? .25 : 1;
    const b1w = Math.max(1, Math.round(W / 4)), b1h = Math.max(1, Math.round(H / 4));
    const B1 = target(b1w, b1h, type), T1 = target(b1w, b1h, type);
    const B2 = target(Math.ceil(b1w / 2), Math.ceil(b1h / 2), type), T2 = target(B2.w, B2.h, type);

    // Grain: baked once, tiled and jittered each frame (mediump-safe, unlike a per-pixel hash).
    const noise = gl.createTexture();
    {
      const N = new Uint8Array(128 * 128 * 4);
      for (let i = 0; i < N.length; i++) N[i] = Math.random() * 256 | 0;
      gl.bindTexture(gl.TEXTURE_2D, noise);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, N);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    const rib = program(VS_RIB, FS_RIB), dust = program(VS_DUST, FS_DUST);
    const glintP = program(VS_GLINT, FS_GLINT);
    const down = program(VS_QUAD, FS_DOWN), blur = program(VS_QUAD, FS_BLUR), comp = program(VS_QUAD, FS_COMP);

    // Geometry: one strip shared by every ribbon (shaped in the vertex shader), dust, a quad.
    const SEG = Q === 0 ? 140 : Q === 2 ? 320 : 220;
    const strip = new Float32Array((SEG + 1) * 4);
    for (let i = 0; i <= SEG; i++) strip.set([i / SEG, -1, i / SEG, 1], i * 4);
    const bStrip = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bStrip); gl.bufferData(gl.ARRAY_BUFFER, strip, gl.STATIC_DRAW);

    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ND = Q === 0 ? 70 : Q === 2 ? 220 : 140;
    const dustData = new Float32Array(ND * 4);
    for (let i = 0; i < ND; i++) {
      const r = .35 + Math.pow(rnd(), .7) * 3.2;
      dustData.set([r, rnd() * TAU, (rnd() - .5) * 1.6, rnd()], i * 4);
    }
    const bDust = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bDust); gl.bufferData(gl.ARRAY_BUFFER, dustData, gl.STATIC_DRAW);
    const bSprite = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bSprite); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const bQuad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, bQuad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);

    // The ribbons: radii spread across the ring's stroke width, entering from different sides and
    // depths, staggered, each with its own twist.
    const NR = Q === 0 ? 5 : Q === 2 ? 9 : 7;
    // Launch groups: each pair sits ~180 degrees apart with opposite heights, so the flight stays centred.
    const groups = NR === 5 ? [[0, 3], [1, 4], [2]] : NR === 9 ? [[0, 5], [1, 6], [2, 7], [3, 8], [4]] : [[0, 4], [1, 5], [2, 6], [3]];
    const ribs = [];
    for (let i = 0; i < NR; i++) {
      const f = NR === 1 ? .5 : i / (NR - 1);
      const g = groups.findIndex(gr => gr.includes(i)), second = groups[g].indexOf(i) === 1;
      ribs.push({
        rs: 1 + (((i * .618) % 1) - .5) * .085,
        h: (second ? -1 : 1) * (.35 + .55 * rnd()),
        dz: (rnd() - .3) * 1.3,
        phase: i * TAU / NR + rnd() * .4 + PH,
        w: .0026 + rnd() * .0016,
        e: .75 + rnd() * .5,
        h2: (rnd() - .5) * .9,
        dz2: .9 + rnd() * 1.1,
        twist: 5 + rnd() * 7,
        seed: rnd(),
        delay: g * 300 - 420 + (second ? 90 : 0),
        exitDelay: f * .16,
      });
    }

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
    let t0 = null, outAt = null, outLen = OUT, ready = false, skip = false, flashed = false, warm = true;
    const U_IN = 0, R_SCR = .184, HOLE = .077, CY = .03;
    const ELEV = Math.asin(6.5 / 21.5), ROLL = 18 * Math.PI / 180;

    // Ribbon head position along its path at time t (ms) of the opening.
    function head(r, t) {
      const p = span(t, r.delay, 3900 + r.delay);
      return U_IN - 8.2 + 13.6 * easeOut(p, 2.2) + .22 * t / 1000;
    }

    function frame(now) {
      if (t0 === null) t0 = now;
      const t = now - t0;
      if (outAt === null && (skip || t >= MAX || (ready && t >= READY_AT))) {
        outAt = t;
        outLen = skip && t < READY_AT ? SKIP_OUT : OUT;
        emit('swallow');
        for (const r of ribs) r.uOut = head(r, t) - .2;
      }
      const x = outAt === null ? 0 : clamp((t - outAt) / outLen);
      if (x >= .68 && !flashed) { flashed = true; emit('flash'); }
      const ts = t / 1000;

      // Camera: starts close, wide and steep; dollies back and lengthens the lens while the ring
      // settles into the mark's exact tilt. The exit pushes in again.
      const cam = easeInOut(span(t, 150, 3700));
      const el = mix(.75, ELEV, cam), roll = mix(.62, ROLL, cam) + .012 * Math.sin(ts * .5) * cam;
      const persp = mix(.34, .035, cam) + .25 * easeIn(x, 2);
      const K = R_SCR * (1 + .14 * (1 - easeOut(span(t, 0, 3600)))) * (1 + .2 * easeIn(x, 2.2));
      const dof = mix(.11, .02, easeInOut(span(t, 600, 3400))) + .03 * x;
      const rest = ease(span(t, 2700, 4200));
      const a = [Math.cos(roll), Math.sin(roll), 0], b = [-Math.sin(roll), Math.cos(roll), 0];
      const se = Math.sin(el), ce = Math.cos(el);
      const c = [-se * b[0], -se * b[1], ce];
      const n = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]];
      const B = [...a, ...c, ...n];
      const exitHole = 1 - easeInOut(span(x, 0, .5));
      const hole = HOLE * easeOut(span(t, 1700, 3300), 2.4) * exitHole;
      const px = 1 / H;
      const fade = 1 - ease(span(x, .5, 1));
      const intro = ease(span(t, 0, 700));

      // ---- scene
      gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
      gl.viewport(0, 0, SW, SH);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      const glint = -2.4 + ts * .75;
      const setG = U => {
        gl.uniformMatrix3fv(U.uB, false, B);
        gl.uniform4f(U.uG, U_IN, 99, persp, K);
        gl.uniform4f(U.uG2, 0, CY, asp, px);
        gl.uniform4f(U.uG3, ts, rest, dof, glint);
        if (U.uHole) gl.uniform3f(U.uHole, 0, CY, hole);
        if (U.uPx) gl.uniform1f(U.uPx, px);
      };

      gl.useProgram(dust.p); setG(dust.U);
      gl.uniform1f(dust.U.uDust, ENC * intro * mix(1, .5, rest) * fade);
      gl.bindBuffer(gl.ARRAY_BUFFER, bDust); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
      if (x < .7) gl.drawArrays(gl.POINTS, 0, ND);

      gl.useProgram(rib.p); setG(rib.U);
      gl.bindBuffer(gl.ARRAY_BUFFER, bStrip); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(rib.U.uMode, 0);
      const tOpen = outAt === null ? t : outAt;
      for (const r of ribs) {
        let u = head(r, tOpen) + (outAt === null ? 0 : .22 * (t - outAt) / 1000);
        const p = span(tOpen, r.delay, 3900 + r.delay);
        const len = mix(2.6, 1.75 * Math.PI, easeInOut(p));
        let e = r.e * ease(span(p, .02, .14)) * ease(span(tOpen, 0, 900)) * mix(1.25, .62, rest) * ENC;
        if (outAt !== null) {
          const xe = span(x, r.exitDelay, r.exitDelay + .66);
          u += 11 * easeIn(xe, 1.8);
          e *= 1 - ease(span(xe, .6, 1));
          gl.uniform4f(rib.U.uG, U_IN, r.uOut, persp, K);
        }
        gl.uniform4f(rib.U.uR, r.rs, r.h, r.dz, r.phase);
        gl.uniform4f(rib.U.uR2, u, len, r.w, e);
        gl.uniform4f(rib.U.uR3, r.h2, r.dz2, r.twist, r.seed);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2);
      }
      // Rim of the disc: ignites from the top left and draws itself round.
      const ign = easeInOut(span(t, 2650, 3750));
      if ((ign > 0 && hole > 0) || warm) {
        gl.uniform1f(rib.U.uMode, 1);
        gl.uniform4f(rib.U.uG, U_IN, 99, persp, K);
        gl.uniform4f(rib.U.uR, hole / K, 0, 0, 2.3);
        gl.uniform4f(rib.U.uR2, ign * (TAU + .35), ign * (TAU + .35), .0016, .6 * ENC * exitHole);
        gl.uniform4f(rib.U.uR3, (1 - ign) * 1.2, 0, 0, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, (SEG + 1) * 2);
      }
      // Diamond ring: as the rim's spark ignites at the disc edge, one brilliant point flares and settles.
      const dia = easeOut(span(t, 2600, 2760), 2) * Math.exp(-Math.max(t - 2760, 0) / 420) * (outAt === null ? 1 : 1 - ease(span(x, 0, .3)));
      if ((dia > .003 && hole > 0) || warm) {
        gl.useProgram(glintP.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, bSprite); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.uniform4f(glintP.U.uGl, Math.cos(2.3) * hole, CY + Math.sin(2.3) * hole, .3, .06);
        gl.uniform1f(glintP.U.uAsp, asp);
        gl.uniform1f(glintP.U.uI, dia * ENC);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.disable(gl.BLEND);

      // ---- bloom
      const pass = (prog, src, dst, tx, ty) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform1i(prog.U.uT, 0); gl.uniform2f(prog.U.uTx, tx, ty);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      gl.bindBuffer(gl.ARRAY_BUFFER, bQuad); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      pass(down, S, B1, 1 / SW, 1 / SH);
      pass(blur, B1, T1, 1 / B1.w, 0); pass(blur, T1, B1, 0, 1 / B1.h);
      pass(down, B1, B2, .5 / B1.w, .5 / B1.h);
      pass(blur, B2, T2, 1 / B2.w, 0); pass(blur, T2, B2, 0, 1 / B2.h);

      // ---- composite
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
      gl.useProgram(comp.p);
      [S, B1, B2].forEach((tg, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tg.tex); });
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, noise);
      gl.uniform1i(comp.U.uS, 0); gl.uniform1i(comp.U.uB1, 1); gl.uniform1i(comp.U.uB2, 2); gl.uniform1i(comp.U.uN, 3);
      gl.uniform4f(comp.U.uG2, 0, CY, asp, px);
      gl.uniform3f(comp.U.uHole, 0, CY, hole);
      const haze = ease(span(t, 200, 2600)) * (1 - ease(span(x, .1, .7)));
      gl.uniform4f(comp.U.uK, haze, 1, 1.15, fade);
      gl.uniform4f(comp.U.uK2, Math.random(), Math.random(), 1 / ENC, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (warm) return;
      if (x >= 1) return emit('done');
      raf(frame);
    }
    frame(0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // wait for the warm-up to really run
    warm = false; t0 = null;
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
