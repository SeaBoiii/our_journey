# Performance notes

## Baseline profile — 2026-08-06

Profiled the existing invitation before optimization in headless Chrome at 390 × 844, DPR 3, mobile emulation with touch enabled. The existing `scripts/motion-audit.mjs` was also run at 390 × 844 and 1440 × 900.

### Runtime baseline

- 39 CSS/Web Animations were active at first paint on mobile.
- 38 procedural cloud, mist, and particle elements were present across the two full-screen `CloudField` instances.
- 22 elements used CSS masks, 15 used filters, 7 used blend modes, 1 used `backdrop-filter`, and 42 carried non-default `will-change` hints.
- The 390 × 844 ascent trace had a 16.8 ms p95 but an 83.4 ms maximum frame and 2 frames over 34 ms. Pavilion forward/reverse continuity passed, with a maximum measured stair-to-pavilion landing gap below 0.5 px.
- The baseline audit used DPR 1 and did not separately sample the story cloud, final-ascent cloud, or a throttled/high-DPR mobile path, so it could understate real Android GPU and paint cost.
- A separate readback-free DPR 3 / 4× CPU baseline confirmed that risk: story reached 33.4 ms p95 / 50.2 ms max, final ascent reached 50.2 ms p95 / 116.8 ms max with 10 frames over 34 ms and 7 over 50 ms, pavilion reveal reached 33.5 ms p95 / 66.7 ms max, and the parked final state reached 33.5 ms p95 / 83.3 ms max. Cold scene entry was materially worse than a warmed repeat.
- The normal-motion source created 14 ScrollTriggers: progress, two document-wide parallax tracks, opening, seven story beats, ascension, pavilion, and the RSVP reveal. Style recalculation dominated the throttled main-thread sample.

### Main rendering costs found

- `WeddingJourney.astro` adds two document-long scrubbed GSAP tracks: one on `.sky-picture` and one on every far cloud layer. They keep large full-screen surfaces changing across the entire journey.
- `CloudField.astro` continuously animates 3 back clouds, 3 mid clouds, 3 front clouds, 2 mist ribbons, and 8 particles per instance. Individual cloud/mist elements are permanently promoted with `will-change`, even when outside the useful scene.
- Cloud fields are only paused with a very broad `IntersectionObserver` margin (`100% 0px`), so both fields can animate well before their motion contributes to the composition.
- Every arrival and pavilion cloud mass receives a per-element mask in `global.css`; moving edge clouds and pavilion banks add more masks and blur filters.
- `.sky-picture img`, `.sun-wash`, the pavilion curtains, `.couple-light`, the scroll cue, both cloud fields, and their particles all have independent infinite animations. The mobile sun also uses `mix-blend-mode`, and the full-screen grain texture uses another blend layer.
- `.mini-monogram` uses `backdrop-filter`; the staircase image and pavilion assembly use drop shadows/colour filters; several moving haze/fog layers use blur.
- The couple reveal animates `clip-path`, while the couple and ring-hand layers retain filter/clip-related promotion hints outside the brief reveal window.
- The sticky camera uses `100dvh`, which can force visual-surface resizing while Android browser chrome expands or collapses.
- Progress updates call `gsap.set` on every ScrollTrigger update instead of reusing a quick setter.
- Curtain and couple-light animations run from page load, including while the pavilion and couple are fully hidden.

### Optimization direction

- Keep the authored scroll beats, staircase approach, connected pavilion landing, couple reveal, ring moment, final message, reverse behavior, RSVP, and deployment workflow unchanged.
- Stabilize the camera with `100vh`/`100lvh`; retain the fixed sky overscan.
- Remove document-long visual parallax, make the mobile sky treatment static, and reduce full-screen compositing effects.
- Collapse the mobile cloud-field budget to one static back, mid, and foreground mass plus at most one mist layer; disable decorative particles.
- Introduce a small set of pre-rendered transparent WebP sprites for a few section-bound cloud passes. CSS keyframes own each pass; `IntersectionObserver` only activates, pauses, or resets it near the relevant section.
- Make curtain and couple-light animation opt-in around their reveal, replace the mobile couple clip reveal with opacity/translation, and clear transient promotion hints when motion ends.
- Extend the motion audit to DPR 3 mobile/touch, report p50/p95/max and thresholds over 24/34/50 ms, and sample story, final-ascent, pavilion forward, and pavilion reverse windows.

## Post-optimization verification — 2026-08-06

### Resulting render path

- The mobile camera now uses `100vh` followed by `100lvh`; the fixed `.sky-world` retains its `-2px` overscan and compatible fallback colour.
- The two document-long GSAP parallax tracks were removed, reducing the normal-motion ScrollTrigger count from 14 to 12. Page progress now uses `gsap.quickSetter`.
- Mobile first paint dropped from 39 running CSS/Web Animations to 2 (the restrained sky idle and opening cue). In story/final ascent there are 2 running animations, and in the parked final state there is 1.
- Mobile story/final-ascent scenes retain no more than 3 promoted surfaces: the staircase, one grouped sky-cloud field, and the single active raster cloud pass. Pavilion uses 2 promoted scene surfaces. Narrative cloud events are mutually exclusive.
- Mobile removes active particle layers, full-screen grain, blend-mode sunlight, backdrop blur, animated cloud masks, moving image filters, staircase/pavilion drop shadows, haze blur, curtain animation, and couple clip-path animation.
- Curtains and couple light are paused by default and activated only in their intended pavilion progress windows. Reverse scrolling pauses them again.
- Five generated alpha WebP sprites were added under `public/assets/clouds/`: 520px distant (17 KB), 720/760px middle-depth (19/31 KB), and 960/1040px foreground (32/44 KB). The story, doa, final ascent, and static pavilion bank each use a distinct silhouette.

### Frame pacing after changes

Chrome mobile emulation: 390 × 844, DPR 3, touch/mobile enabled.

| Scenario | Normal p50 / p95 / max | 4× CPU p50 / p95 / max | Normal frames >34 / >50 | 4× frames >34 / >50 |
| --- | --- | --- | ---: | ---: |
| Story ambient | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 17.1 ms | 0 / 0 | 0 / 0 |
| Final ascent | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.8 / 17.0 ms | 0 / 0 | 0 / 0 |
| Pavilion reveal | 16.7 / 16.8 / 50.0 ms | 16.7 / 33.3 / 66.8 ms | 1 / 0 | 3 / 2 |
| Final calm | 16.7 / 16.8 / 16.8 ms | 16.7 / 16.9 / 17.0 ms | 0 / 0 | 0 / 0 |

The 4× pavilion sample contains isolated, non-consecutive long frames; it remains below the audit's sustained-regression gate. Compared with the baseline 4× final-ascent result (50.2 ms p95 / 116.8 ms max, 10 frames over 34 ms), the optimized final ascent holds 16.8 ms p95 / 17.0 ms max with no frames over 24 ms.

### Acceptance checks

- `astro check`, static production build, and RSVP persistence/submission smoke test: pass.
- GitHub Pages production build with `PAGES_BASE=/our_journey`: pass; generated cloud and application asset URLs include the repository base path.
- Journey audit at 390 × 844, 393 × 852, 430 × 932, 768 × 1024, 1440 × 900, and 1920 × 1080: pass; maximum stair/pavilion landing gap 0.8 px.
- Reverse audit at 390 × 844 and 1440 × 900, plus reduced motion: pass; all beats return to opacity 1 / Y 0 and document-long sky/far-cloud travel is 0 px.
- Android toolbar-cycle audit at widths 390, 393, and 430 in visible/collapsed states, repeated three times each: pass; no exposed bottom strip, background seam/flash, timeline reset, or restored pavilion/final drift.
- DPR 3 normal and 4× CPU motion audits: pass; expected story/final cloud selectors activate, with a maximum of one narrative cloud event at a time.
