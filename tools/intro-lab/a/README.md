# Concept A — "Event Horizon, cinematic"

Drop-in replacement for `js/splash-gl.js` (same `start(canvas, emit)` API, worker boilerplate,
READY_AT 4.3 s / MAX 8.6 s, swallow / flash / done). Uses the app's existing word styling (no words.css).

Preview: `tools/intro-frames.html?src=intro-lab/a/splash-gl.js` (add `&tv` for the TV render, `&q=0..1` for quality).

## Timeline
| t | beat |
|---|------|
| 0–0.7 s | Black, then one point of light catches on the hole's upper-left limb ("diamond ring" eclipse glint) with a faint anamorphic streak. Camera close (2.3x). |
| 0.2–2.3 s | Light leaks round the photon ring from the glint, dim on the receding side. The glint fades out by 2.1 s. |
| 0.55–3.0 s | The disk ignites from its hot inner edge outward, seen almost edge-on: the far side is lensed up over the shadow and under it. |
| 0.1–4.6 s | One continuous camera move: dolly back 2.3x→1x, orbit up (edge-on → the mark's 0.3 aspect), roll to the mark's −18°. Eased in, with a long settle. Faint stars fade in at 1.4–3.8 s and slide behind the hole through the lens (parallax). |
| 2.7 / 3.5 s | GRAVITOS, then the credit (existing CSS). |
| hold → 8.6 s | It keeps moving: differential rotation of the gas (inner edge faster), a slow breathing dolly and roll, stars drifting through the lens. |
| exit 1.1 s | "Crossing the horizon": the push accelerates (×36), the disk spins up and sweeps past the frame, and the shadow fills the screen. `flash` fires at 0.8, so Home fades in out of the black. A skip before 4.3 s runs the same move in 0.7 s. |

## Pipeline per frame
1. **Scene**, canvas res: an analytic point-mass lens. The far half of the disk goes through the full lens, which gives the arc over the top and the secondary image under the shadow. The near half goes through a weak lens. Also Doppler beaming (g³, left side approaching), temperature colour, the photon ring, and lensed stars. Output is `sqrt(c/(1+c))` in RGBA8 (HDR without float textures).
2. **Bloom**: 4-tap downsample chain with a soft-knee bright pass, then a tent upsample/accumulate. Every level stores sqrt(c/4), so halo tails don't band.
3. **Streak**: one horizontal pass, 17 taps, on the 1st bloom level.
4. **Composite**, canvas res: scene, bloom and streak; vignette; ACES (Narkowicz); gamma; luminance-weighted film grain plus a dither. On PC only, 3-tap lateral chromatic fringe.

Baked once at start: the disk gas texture, 512×256 polar (wraps in angle), and a sparse star field, 1024×512 (tiles).

## Estimated TV cost (q = .5, canvas 960×540 = 518k px)
| pass | size | px | fetches/px | notes |
|---|---|---|---|---|
| scene | 960×540 | 518k | 3 (disk ×2, sky ×1) | ~2 atan, 2 sqrt, ~2 pow, ~8 exp, 2 small mat2. No loops. |
| down ×4 | 240×135 → 30×17 | 43k | 4 | |
| up ×3 | 120×68 → 240×135 | 41k | 5 | |
| streak | 240×135 | 32k | 17 | |
| composite | 960×540 | 518k | 3 | ACES, 2 hashes, vignette |

That is about **1.15 M fragments** and **~4.3 M texel fetches** per frame, in 10 draw calls. Two full-screen passes do almost all the work. Render targets are RGBA8 only, with no extensions, and stay under ~3 MB in total.
The bloom, streak and composite cost is fixed. The scene pass carries the ALU.

## Quality knob
- `?q=` on the page URL. This works on the main thread and in the frame harness; a worker can't see the page's query.
- Otherwise the `QUALITY` constant at the top of the file.
- Default: TV (UA contains "Tizen", or canvas height ≤ 600) = .5; PC = 1.

| q | what it does |
|---|---|
| 1 | Bloom from 1/2 res, 5 levels, plus streak and chromatic fringe |
| .5 | Bloom from 1/4 res, 4 levels, plus streak |
| .25 | 3 bloom levels, no streak |
| 0 | Scene + composite only (2 passes). The look holds up, just without halo. |

## Known weak spots
See the report; in short:
- The lensing is a point-lens approximation, not GR.
- The disk texture is soft at the extreme zoom of the exit.
- The look at the start of the exit depends on the CSS fade timing.
