# Concept B: "Liquid light"

Ribbons of warm liquid light sweep in through real 3D depth, spiral down and wrap into the
tilted ring of the Gravitos mark. The black disc opens as negative space and hides the ring's far
side; the rim ignites with one diamond-ring glint. On exit the ribbons peel off the ring and stream
past the camera while Home dissolves in.

- `splash-gl.js`: drop-in for `js/splash-gl.js`. Same API (`start(canvas, emit)` → `send`;
  'go' / 'skip'; emits 'swallow', 'flash', 'done'; worker boilerplate with 'fail').
- Words: the retiming now lives in css/app.css (integrated), so this folder has no words.css.

Preview: `tools/intro-frames.html?src=intro-lab/b/splash-gl.js[&tv][&q=0]`

## Timeline (ms)
| t | beat |
|---|---|
| 0-900 | Black. The first ribbons (pre-rolled) slide in from off-screen, defocused, close to the lens. |
| 600-2000 | Seven ribbons, launched in near-opposite pairs, arc through depth around the centre. Comet heads; silk-like twist flashes. |
| 1600-2600 | The ribbons spiral into one orbit. The camera dollies back and lengthens the lens while settling to the mark's exact tilt. |
| 1700-3300 | The disc opens as negative space while the ribbons are still spiralling in. |
| 2600-3500 | Diamond ring: one brilliant point with a thin anamorphic streak at the rim's top left (one small additive sprite), which settles. |
| 2650-3750 | The rim draws itself round from that point. |
| 3100 / 3800 | Name / credit (css/app.css). |
| hold (up to 8.6 s) | Alive: the ribbons orbit slowly, a glint circles the ring, dust drifts. |
| exit (1.3 s) | The disc closes, ribbons peel off past the camera, the shader fades to black from 0.5, and 'flash' fires at 0.68 so Home dissolves in under the last streaks. |
| skip | The same exit in 0.75 s. |

## Rendering
- WebGL2 + RGBA16F targets (EXT_color_buffer_float). WebGL1 half float is the fallback, then RGBA8 storing light at 1/4.
- Ribbons are triangle strips and dust is GL points, all additive into one HDR scene; per-vertex depth of field. A two-level bloom at 1/4 and 1/8 size, then one filmic composite with baked grain.
- A hidden warm-up frame inside start() draws every program once, so first-draw driver work is not in the animation.
- Strip half-width is capped (0.045 screen-height), so exit streaks passing the lens stay cheap.

## Measured on the TV (Mali-G52, Tizen 9, `bash tools/intro-lab/bench/bench.sh tools/intro-lab/b/splash-gl.js`)
- GPU 4.0 ms/frame median, 4.1 p95 (budget ~6-7).
- worker: 0% drops in every beat.
- worker-words-busy (real launch): 0.9-1.2% overall. The remaining exit drops (4-5% of exit frames) come
  from the HTML words' `.pull` transition starting while the main thread is busy. A diagnostic run without
  that transition measured ~1.4% exit drops.

## Estimated cost per frame (960x540, q=1)
scene: ~3.5k strip verts + 140 points, FS ~15 ALU, 0 fetches; bloom: 240x135 and 120x68 passes, 4-5
fetches/px; composite: 960x540, 4 fetches/px. About 15 draws/frame.

## Quality knob
`?q=0|1|2` on the page URL, or `Q_DEFAULT` at the top of the file; in a worker, use `new Worker('js/splash-gl.js?q=0')`.
- q=0: 5 ribbons, 140 segments, 70 dust, scene at 0.75x
- q=1: 7 / 220 / 140 / 1x
- q=2: 9 / 320 / 220 / 1x

## Self-critique
- The flight is re-centred by choosing the orbit phase (measured brightness centroid within ~0.05 of centre from 0.9 to 1.8 s), but as a swirl it still sways a little.
- Real-launch exit drops are a CSS/compositor limit of the words layer, not renderer GPU.
- Bench results vary between runs (one run showed 12% exit drops), so compare several runs.
