// Startup animation renderer (driven by splash.js). "Horizon": a point of warm light opens into
// a hairline horizon, the horizon bends into the tilted accretion ring of the Gravitos mark while
// a black hole opens at its centre, and light curves around the hole. On the way out the story
// runs backwards (ring to line, line to a point, a last glint) and Home fades in.
// Everything is drawn analytically in one fragment shader: fine lines, soft bloom, film grain.
// It runs in a worker when the browser can hand the canvas over (OffscreenCanvas), so Home
// loading on the main thread can't make it stutter; otherwise splash.js loads it as a script.
(function () {
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uT, uLine, uBend, uHole, uGlint, uFade, uZoom;

const float PI = 3.14159265;
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

// A hairline: crisp core, then two layers of soft light around it (d = distance in screen units).
float line(float d, float core) {
  return exp(-d * d / (core * core)) + exp(-d / (core * 9.)) * .22 + exp(-d / .06) * .045;
}

void main() {
  float px = 1. / uRes.y;
  vec2 p = (gl_FragCoord.xy - .5 * uRes) * px;
  vec2 C = vec2(0., .03);                  // the mark rests just above the middle
  vec2 d = (p - C) * uZoom;
  float r = length(d);
  float core = max(px * 1.15, .0011);      // about a pixel and a bit, at any size

  // ---- the ring: a flat line (uBend 0) that tilts open into an ellipse (uBend 1)
  // The wide horizon draws in to the logo's proportions as it bends: ring 2.6x the hole, 0.7x tall.
  float A = mix(.44, .2, smoothstep(0., 1., uBend)) * uLine;   // semi-major axis
  float B = max(A * .27 * uBend, .0004);                         // semi-minor
  vec2 q = rot(.3 * uBend) * d;            // tilted like the logo (-17 degrees)
  vec2 e = vec2(q.x / max(A, 1e-4), q.y / B);
  float L = length(e);
  vec2 g = vec2(q.x / max(A * A, 1e-8), q.y / (B * B)) / max(L, 1e-4);
  // (L-1)/|grad| estimates the distance well except past the ends of a very flat ellipse,
  // where it would smear the line across the screen; the true distance is at least |x|-A there.
  float dist = max(abs((L - 1.) / max(length(g), 1e-4)), abs(q.x) - A);
  float cphi = e.x / max(L, 1e-4), sphi = e.y / max(L, 1e-4);
  // Ends of the flat line fade out; once open, the side turning toward us is brighter
  // (Doppler beaming) and a highlight travels round.
  float tx = clamp(q.x / max(A, 1e-4), -1., 1.);
  float taper = mix(pow(max(1. - tx * tx, 0.), .55), 1., smoothstep(.0, .6, uBend));
  float beam = 1. - .5 * cphi * uBend;
  float ang = atan(sphi, cphi);
  float hl = exp(-pow(mod(ang - uT * .55 + PI, 2. * PI) - PI, 2.) / .18) * .9 * uBend;
  float open = smoothstep(.3, .9, uBend);
  // The disk in fine lines: its outer edge, a dimmer inner edge (L = .68), and a faint sheet of
  // light between them with fine grooves, brighter toward the middle.
  float gl1 = max(length(g), 1e-4);
  float dIn = abs((L - .68) / gl1);
  float sheet = smoothstep(.64, .72, L) * (1. - smoothstep(.97, 1.01, L)) * mix(.16, .05, clamp((L - .68) / .32, 0., 1.))
    * open;
  float ring = (line(abs(dist), core) + line(dIn, core * .8) * .2 * open + sheet) * taper * beam * (1. + hl) * step(.0001, uLine);
  vec3 ringCol = mix(vec3(1., .62, .3), vec3(1., .96, .9), clamp(exp(-min(abs(dist), dIn) / (core * 2.5)), 0., 1.));

  // ---- the hole: black disc, a faint photon ring, and the disk's far side lensed over it
  float R = .077 * uHole;
  float inHole = 1. - smoothstep(R - px, R + px, r);
  float back = step(0., q.y);              // the far half of the disk goes behind the hole
  vec3 col = ringCol * ring * (1. - inHole * back);

  // The far side of the disk, bent up over the hole into a band that hugs its top edge (thick at
  // the top, thinning to nothing where it meets the disk), and a thin copy under the hole.
  float a2 = atan(d.y, d.x) - .3 * uBend;
  float tp = max(sin(a2), 0.), bt = max(-sin(a2), 0.);
  float r0 = R * 1.04, r1 = R * (1.04 + .42 * pow(tp, .8));
  float inBand = smoothstep(r0, r0 + px * 2., r) * (1. - smoothstep(r1 - px * 2., r1, r));
  float band = line(abs(r - r1), core * 1.8) * .5 * pow(tp, .6) + inBand * mix(.3, .06, (r - r0) / max(r1 - r0, 1e-4)) * tp
    + line(abs(r - R * 1.05), core * .8) * .4 * bt * bt;
  float photon = line(abs(r - R * 1.02), core * .8) * .45;
  col += (vec3(1., .82, .6) * band * open + vec3(1., .9, .78) * photon) * uHole * (1. - inHole) * mix(1., .6, back * 0.);

  // ---- the first and last moment: a single point of light
  col += vec3(1., .93, .84) * (exp(-r * r / (core * core * 6.)) * 2. + exp(-r / .02) * .5 + exp(-r / .12) * .08) * uGlint;

  // ---- the room: warm haze around the mark, a few faint stars, film grain
  col += vec3(.05, .028, .015) * exp(-r * 2.6) * uBend;
  // Stars on a grid in screen units (not pixels), so the TV's half-size render matches the PC's.
  vec2 sg = p * 150.;
  float s = h21(floor(sg));
  vec2 so = (fract(sg) - .5) * (1. / 150.) / max(px, .0009);
  col += vec3(.9, .85, .8) * step(.996, s) * exp(-dot(so, so) * 1.6) * (.14 + .1 * sin(uT * 1.3 + s * 60.)) * uBend * (1. - inHole);

  col = (1. - exp(-col * 1.25)) * uFade;
  col += (h21(gl_FragCoord.xy + fract(uT * 7.3) * 100.) - .5) * .018;
  gl_FragColor = vec4(max(col, 0.), 1.);
}`;

  // Beat times in ms. The rest beat holds (up to MAX) until the app says Home is ready.
  const READY_AT = 4300, MAX = 8600, OUT = 1300, SKIP_OUT = 700;

  const clamp = x => Math.min(1, Math.max(0, x));
  const span = (t, a, b) => clamp((t - a) / (b - a));
  const ease = x => x * x * (3 - 2 * x);
  const easeOut = x => 1 - Math.pow(1 - x, 3);
  const easeInOut = x => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  // Returns a function taking 'go' (Home is ready) or 'skip' (a key was pressed), or null
  // when WebGL isn't available. emit() reports 'swallow' (exit begins), 'flash' and 'done'.
  function start(canvas, emit) {
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return null;
    const prog = gl.createProgram();
    [[gl.VERTEX_SHADER, 'attribute vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }'], [gl.FRAGMENT_SHADER, FRAG]].forEach(([type, src]) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(prog, s);
    });
    gl.bindAttribLocation(prog, 0, 'a');
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uT', 'uLine', 'uBend', 'uHole', 'uGlint', 'uFade', 'uZoom'].forEach(n => U[n] = gl.getUniformLocation(prog, n));
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);

    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : f => setTimeout(() => f(performance.now()), 16);
    let t0 = null, outAt = null, outLen = OUT, ready = false, skip = false, flashed = false;

    // The look at time t (ms) of the opening, and how far into the exit (0..1).
    function look(t, x) {
      const line = easeInOut(span(t, 250, 1750));
      const bend = easeInOut(span(t, 1450, 3150));
      const hole = easeOut(span(t, 1750, 3300));
      // The opening glint: the point blooms, then hands over to the line.
      let glint = ease(span(t, 0, 450)) * (1 - ease(span(t, 500, 1400))) * .9;
      if (x === 0) return { line, bend, hole, glint, fade: 1, zoom: 1 };
      // Exit: ring closes back to a line (0-.45), the line draws in to a point (.35-.75),
      // which glints once and goes out (.7-1), while the view eases in a touch.
      const close = easeInOut(span(x, 0, .45));
      const draw = easeInOut(span(x, .35, .75));
      glint = Math.max(glint, Math.sin(Math.PI * span(x, .62, 1)) * 1.1);
      return {
        line: line * (1 - draw), bend: bend * (1 - close), hole: hole * (1 - close),
        glint, fade: 1 - ease(span(x, .85, 1)), zoom: 1 + .05 * ease(x),
      };
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
      if (x >= .85 && !flashed) { flashed = true; emit('flash'); }
      const k = look(outAt === null ? t : Math.min(t, outAt), x);
      gl.uniform1f(U.uT, t / 1000);
      gl.uniform1f(U.uLine, k.line);
      gl.uniform1f(U.uBend, k.bend);
      gl.uniform1f(U.uHole, k.hole);
      gl.uniform1f(U.uGlint, k.glint);
      gl.uniform1f(U.uFade, k.fade);
      gl.uniform1f(U.uZoom, 1 / k.zoom);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
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
