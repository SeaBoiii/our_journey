# Artwork Prompt Library

This library reconciles the site brief with the separate **COUPLE ARTWORK — IMPORTANT LAYERED COMPOSITION** brief. The palette, dawn lighting, painterly edge treatment, atmospheric depth, and perspective must be matched across every generation.

## Authority and continuity

The generated couple asset used the separate couple master prompt. That dedicated prompt is authoritative for the couple, bride, groom, hijab, veil, embrace, hand, ring, and couple lighting. The shorter general-site couple prompt is retained only as background direction and must not override the dedicated prompt.

Generate a high-resolution couple master first. Derive every foreground couple layer from the same approved composition; do not independently reinvent a face, hand, garment, light direction, or pose. Preserve the source master at public/assets/couple/couple-master-chroma.png, the processed transparent master at public/assets/couple/couple-main.png, and serve its optimized WebP derivatives at runtime.

Shared visual language:

- Luxury romantic storybook illustration with refined Korean romance/manhwa and premium wedding-editorial influence.
- Sophisticated semi-realistic adult proportions; soft painterly rendering, never childish or overly anime.
- Pearl, ivory, warm cream, pale powder blue, faint lavender-blue shadows, champagne highlights, and restrained muted gold.
- Early golden dawn, diffused sunlight, very soft volumetric rays, and no harsh shadows.
- No chibi styling, photorealistic people, Disney-like exaggeration, hyper-saturation, video-game concept art, tacky wedding clip art, wings, halos, religious depictions, fantasy castles, or excessive gold.
- Major isolated scene layers require clean alpha. Retain a lossless PNG source and export optimized WebP/AVIF runtime derivatives.

## sky-background

- Preferred file: public/assets/sky/sky-gradient.webp
- Purpose: neutral global background plate with generous invitation-text negative space.
- Composition: vertical 2:3.
- Master: 2048 × 3072.
- Transparency: no.

Prompt:

“An ethereal dawn sky above the clouds, elegant luxury wedding illustration, extremely soft powder-blue atmosphere fading into warm ivory light, subtle lavender shadows, diffused golden sunrise far behind thin clouds, soft painterly rendering, romantic Korean fantasy-drama atmosphere, sophisticated editorial wedding aesthetic, serene, airy, minimal, luminous atmospheric perspective, extremely subtle volumetric rays, no people, no buildings, no text, no birds, no fantasy objects, no strong colours, vertical composition, designed as a background plate for a cinematic scrolling website, generous negative space, seamless feeling.”

Regeneration notes: keep landmarks and high-contrast cloud edges out of the text-safe centre. The plate should tolerate long vertical continuation with CSS gradients.

## distant-cloudscape

- Preferred file: public/assets/sky/distant-cloudscape.webp
- Purpose: slowest horizon/depth layer.
- Composition: landscape 16:9, with a mobile-safe central horizon.
- Master: 3072 × 1728.
- Transparency: no; softly feathered upper/lower transitions are useful.

Prompt:

“Vast soft cloudscape viewed from slightly above cloud level, luminous white and ivory cloud formations extending toward the horizon, subtle morning sunlight, extremely soft powder-blue atmospheric haze, luxury romantic storybook painting, premium wedding editorial aesthetic, sophisticated, airy, elegant, realistic cloud volume but painterly rendering, no people, no structures, no text, no dramatic storm clouds, low contrast, cinematic depth, transparent-edge compatible composition.”

Regeneration notes: match the sky’s sunrise direction and avoid any cloud formation that reads as a repeated stamp.

## sunlight-rays

- Preferred file: public/assets/sky/sunlight-rays.webp
- Purpose: optional low-opacity dawn-light overlay.
- Composition: vertical 2:3.
- Master: 2048 × 3072.
- Transparency: required.

Prompt:

“Extremely subtle warm dawn light rays passing through high translucent cloud haze, soft ivory and champagne illumination, very soft volumetric diffusion, low contrast, painterly luxury wedding atmosphere, isolated over a transparent background, no visible sun disc, no hard beams, no objects, no text, no dramatic god rays.”

Regeneration notes: prefer CSS/SVG gradients when they equal the raster result. The overlay must survive at low opacity without banding.

## background-cloud

- Preferred files: public/assets/clouds/cloud-back-left.webp, cloud-back-right.webp, cloud-mid-left.webp, cloud-mid-right.webp, cloud-small-01.webp, and cloud-small-02.webp.
- Purpose: independent parallax depth layers.
- Composition: isolated organic masses, generally 4:3.
- Master: 2048 × 1536 for large layers; 1280 × 960 for small accents.
- Transparency: required.

Prompt:

“Single elegant luminous cloud formation isolated on transparent background, soft white and pearl cloud volume, gentle powder-blue and lavender shadowing, warm champagne rim light from sunrise, romantic painterly storybook aesthetic, premium wedding illustration, realistic atmospheric softness, irregular organic silhouette, feathered edges, no hard outlines, no objects, no text.”

Negative constraints: no cloned silhouettes, hard cutout edges, storm contrast, flat airbrush blobs, text, birds, or embedded objects.

Regeneration notes: generate each cloud as a genuinely different silhouette while holding light direction, shadow softness, palette, and brush treatment constant.

## foreground-cloud

- Preferred files: public/assets/clouds/cloud-front-left.webp, cloud-front-right.webp, and public/assets/pavilion/pavilion-foreground-clouds.webp.
- Purpose: large cinematic occlusion layers that part during the opening and pavilion reveal.
- Composition: isolated 4:3 or 2:1 banks, art-directed for left/right placement.
- Master: 2560 × 1920 for side banks; 3072 × 1536 for the pavilion bank.
- Transparency: required.

Prompt:

“Large close foreground cloud bank isolated on transparent background, very soft luminous white cloud volume, dreamy pearl highlights, pale lavender-blue shadow depth, gentle golden morning rim light, painterly semi-realistic cloud rendering, luxurious romantic wedding illustration, soft feathered edges, cinematic atmospheric depth, designed to partially obscure a scene before parting during scroll, no objects, no text.”

Regeneration notes: foreground assets need more local detail than distant clouds. Never let a mobile crop obscure faces, the bride’s hand, or critical invitation text.

## mist-overlay

- Preferred file: public/assets/clouds/mist-overlay.webp
- Purpose: atmospheric reveal mask for staircase, pavilion, and couple.
- Composition: seamless square or vertical wisps.
- Master: 2048 × 2048.
- Transparency: required.

Prompt:

“Very subtle translucent atmospheric white mist, soft feathered wisps, nearly transparent, elegant cinematic haze, gentle diffuse texture, seamless, no objects, isolated over transparent background, designed as an atmospheric overlay for a premium wedding website.”

Regeneration notes: CSS gradients are preferred if they avoid a huge transparent texture. The mist must reveal forms rather than read like smoke.

## staircase

- Preferred file: public/assets/stairs/staircase-main.webp
- Purpose: centred hero path for the ascension sequence.
- Composition: portrait 2:3, viewed from lower centre upward.
- Master: 2048 × 3072.
- Transparency: preferred; otherwise supply a clean removable/maskable background.

Prompt:

“Elegant wedding staircase ascending upward through luminous clouds toward the sky, long graceful white stone staircase with pearl-marble texture, restrained fine muted-gold edge detailing, sophisticated romantic fantasy illustration, luxurious wedding editorial atmosphere, viewed from lower centre looking upward, strong natural perspective, stairs gradually disappearing into cloud mist, diffused warm morning sunlight from above, soft blue and lavender atmospheric shadows, serene, ethereal, high-end storybook illustration, subtle Korean fantasy-drama aesthetic, no railings unless extremely delicate, no people, no flowers covering the stairs, no text, no palace, no exaggerated fantasy architecture, vertical composition, centred perspective, isolated scene elements suitable for compositing.”

Regeneration notes: the staircase must feel long, inviting, physically embedded in clouds, and softer toward the horizon. Reject church/palace associations, over-ornament, incorrect perspective, or railings that crowd mobile text.

## staircase-glow

- Preferred file: public/assets/stairs/staircase-glow.webp
- Purpose: separable haze and light bloom around the staircase.
- Composition: match staircase master exactly.
- Master: 2048 × 3072.
- Transparency: required.

Prompt:

“Soft atmospheric dawn glow derived from the approved wedding staircase composition, warm ivory light gathering near the upper steps, faint champagne rim illumination and pale-blue mist around lower steps, extremely diffuse painterly bloom, isolated on transparent background, exact perspective and light direction of the staircase master, no staircase detail, no objects, no text, no hard rays.”

Regeneration notes: derive from the approved staircase or build procedurally; never create a second conflicting light source.

## distant-pavilion

- Preferred file: public/assets/pavilion/pavilion-distant.webp
- Purpose: anticipation silhouette during the approach.
- Composition: square with ample transparent atmosphere around a small central pavilion.
- Master: 1536 × 1536.
- Transparency: required or cleanly removable.

Prompt:

“Small elegant white pavilion seen far in the distance above a luminous bed of clouds, subtle Malay and Islamic architectural inspiration, refined arched openings, graceful roof profile, ivory structure, extremely restrained muted-gold accents, soft curtains, warm dawn light, sophisticated romantic wedding illustration, dreamy Korean fantasy-drama atmosphere, gentle atmospheric haze, distant silhouette with soft detail, intimate rather than monumental, no people visible, no mosque dome, no minarets, no palace, no text.”

Regeneration notes: match the final pavilion’s proportions and roof language; this is the same structure at distance, not a separate design.

## final-pavilion

- Preferred file: public/assets/pavilion/pavilion-main.webp
- Purpose: architectural climax and frame around the couple.
- Composition: landscape 4:3 with portrait-safe open space in the centre.
- Master: 3072 × 2304.
- Transparency: preferred; the cloud base and exterior edges must be cleanly removable.

Prompt:

“An intimate elegant wedding pavilion resting above luminous clouds at dawn, refined white and ivory architecture with subtle Malay and Islamic design influence, graceful arches, delicate geometric detailing, soft flowing sheer curtains, restrained champagne-gold accents, tasteful small white floral arrangements, elegant open structure, warm diffused sunlight entering from behind and side, pearl clouds surrounding the base, luxurious romantic storybook illustration, premium wedding editorial aesthetic, sophisticated semi-realistic painterly rendering, subtle Korean fantasy-drama atmosphere, serene, heavenly, intimate, cinematic, symmetrical but organic composition, designed as the climax of an interactive wedding invitation, no people, no text, no giant floral arches, no castle, no mosque, no throne, no excessive ornamentation.”

Regeneration notes: preserve enough centre space for the portrait couple. Use Malay pavilion proportions and Islamic arch geometry as influence only; do not reproduce a religious building.

## curtain

- Preferred files: public/assets/pavilion/pavilion-curtains-left.webp and pavilion-curtains-right.webp.
- Purpose: independent barely moving pavilion fabric.
- Composition: portrait isolated fabric panels aligned to the final pavilion.
- Master: 1536 × 2304 each.
- Transparency: required.

Prompt:

“Elegant sheer ivory pavilion curtain, flowing gently in a light breeze, soft translucent wedding fabric, delicate folds, warm morning backlight, luxury wedding illustration, isolated on transparent background, sophisticated painterly rendering, no structure, no flowers, no text.”

Regeneration notes: align attachment points and light direction to the final pavilion. Left and right should not be mechanically mirrored.

## couple-master

- Preserved source: public/assets/couple/couple-master-chroma.png
- Processed transparent master: public/assets/couple/couple-main.png
- Current runtime asset: public/assets/couple/couple-main.webp, with 480 px and 640 px responsive variants.
- Purpose: emotional focal point and visual source for every derived couple layer.
- Composition: portrait full-body/three-quarter; current output is 853 × 1844.
- Preferred future master: 2048–3072 px on the longest side.
- Transparency: transparent or clean removable background; the runtime PNG has alpha.
- Prompt source: the separate **COUPLE ARTWORK — IMPORTANT LAYERED COMPOSITION** master prompt.

Authoritative prompt used:

“An exceptionally elegant Muslim newlywed couple standing together inside an intimate ivory wedding pavilion above luminous clouds at dawn, gently holding one another and gazing mesmerisingly into each other's eyes, deeply affectionate but modest body language, sophisticated adult proportions, bride wearing a beautifully styled elegant hijab and luxurious modest wedding gown, groom wearing refined formal wedding attire with subtle contemporary Malay-Muslim influence, bride's left hand resting naturally against the groom so her wedding ring is clearly but subtly visible, groom gently holding her waist and partially supporting her ring hand, serene loving expressions, realistic natural anatomy, sophisticated semi-realistic romantic illustration, refined Korean romance manhwa and premium wedding editorial influence without looking childish or overly anime, soft painterly rendering, delicate facial features, warm diffused dawn light, subtle golden rim lighting, pearl-white and champagne colour palette, ivory fabrics, very subtle pale-blue atmospheric shadows, intimate cinematic composition, flowing fabric moving slightly in a gentle breeze, sophisticated luxurious wedding atmosphere, graceful and emotionally warm, no kissing, no exaggerated pose, no exposed bride hair, no revealing clothing, no excessive jewellery, no huge crown, no tiara, no fantasy wings, no chibi proportions, no oversized anime eyes, no text, transparent or clean removable background.”

Current generation execution: built-in image generation, portrait mobile-first framing, bride at image-left and groom at image-right, full-body/long three-quarter composition, warm dawn key light from upper-left, and a perfectly flat `#00ff00` removable background with no cast shadow, reflection, floor plane, text, or watermark. The approved alpha runtime master was produced locally from that preserved chroma source; the core couple description above remained the authoritative creative prompt.

Non-negotiable checks:

- The couple stands very close, gently embracing, and looks at each other—not the viewer.
- The bride’s ring hand is visible naturally, not pushed toward camera.
- Hijab fully covers hair, neck, and ears; no exposed hairline, loose curls, earrings through fabric, or transparent hair coverage.
- Faces are the primary focal point, embrace second, hand third, ring fourth.
- No kissing, revealing clothing, crown, tiara, fantasy accessories, exaggerated anatomy, idol caricature, or catalogue pose.

Regeneration notes: never regenerate one partner independently after approval. Reject malformed hands, inconsistent eye lines, non-matching light, warped clothing, or any loss of mobile focal points.

## bride-derived

- Preferred file: public/assets/couple/bride-main.webp
- Purpose: optional base layer derived from the master for finer compositing.
- Composition: exact master coordinates.
- Master: match the couple master canvas.
- Transparency: required.

Prompt:

“Elegant Muslim bride in sophisticated modest wedding attire, beautifully wrapped ivory bridal hijab fully covering hair, ears and neck, graceful face framing, absolutely no visible hair, luxurious flowing long-sleeved wedding gown with refined embroidery and delicate pearl details, elegant silhouette, modest neckline and full coverage, optional soft translucent bridal veil flowing from behind the hijab, sophisticated adult woman with natural proportions, serene affectionate expression while looking lovingly toward her groom, refined semi-realistic Korean romance illustration influence, premium luxury wedding editorial styling, soft painterly rendering, luminous warm dawn light, pearl ivory champagne palette, realistic hands and anatomy, graceful posture, sophisticated rather than princess-like, no crown, no tiara, no exposed shoulders, no exposed hair, no excessive jewellery, no exaggerated anime eyes, no chibi styling.”

Regeneration notes: use the master as an image reference or extract/refine in place. Do not change face, pose, scale, sleeve, lighting, or gaze.

## groom-derived

- Preferred file: public/assets/couple/groom-main.webp
- Purpose: optional base layer derived from the master for finer compositing.
- Composition: exact master coordinates.
- Master: match the couple master canvas.
- Transparency: required.

Prompt:

“Elegant Muslim groom standing close to his bride, sophisticated contemporary wedding attire with subtle Malay-Muslim influence, beautifully tailored formal silhouette, ivory cream or complementary neutral palette, understated textured fabric and extremely restrained traditional detailing, natural masculine adult proportions, neat hairstyle, gentle affectionate expression, looking directly into his bride's eyes, one arm naturally around her waist or back, other hand gently interacting with her hand, sophisticated semi-realistic Korean romance illustration influence, luxury wedding editorial aesthetic, soft painterly rendering, warm dawn rim light, graceful and understated, no crown, no royal costume, no exaggerated muscles, no fantasy accessories, no exaggerated anime styling.”

Regeneration notes: use the approved master as reference; do not combine multiple traditions or turn him into a prince/K-pop caricature.

## bride-hijab-veil-derived

- Preferred file: public/assets/couple/bride-hijab-veil.webp
- Purpose: optional trailing veil/outer drape layer for micro-motion.
- Composition: exact master coordinates.
- Master: match the couple master canvas.
- Transparency: required.

Prompt:

“Trailing veil detail derived exactly from the approved Muslim bride composition, extremely light ivory tulle originating naturally behind the structured bridal hijab, delicate translucent edge, long soft fabric flowing behind her in a barely noticeable breeze, optional outer hijab draping only where it separates without seams, warm diffused dawn light and painterly edge treatment matching the couple master, isolated transparent background, no face-framing hijab removal, no exposed hair, neck or ears, no duplicated edge, no hard cutout, no flapping fabric, no text.”

Regeneration notes: do not separate the fitted face-framing hijab if it risks seams. Allowed idle range is only translateX 1–3 px, translateY 1–2 px, and rotate 0.2–0.5 degrees over long durations.

## bride-ring-hand-derived

- Preferred file: public/assets/couple/bride-ring-hand.webp
- Purpose: exact foreground hero detail for the bride’s left hand and ring.
- Composition: same angle and location as the approved master; a tight transparent crop may retain the master coordinate frame.
- Master: at least 1536 × 1536 before final crop.
- Transparency: required.
- Current status: available as an exact full-canvas, pixel-aligned alpha extraction from the approved processed master; it was not independently regenerated.

Prompt:

“Close detail derived from the same Muslim wedding couple composition: bride's elegant left hand resting naturally against her groom during an intimate embrace, anatomically accurate feminine hand and fingers, realistic relaxed finger spacing, luxurious ivory long-sleeved bridal gown cuff with delicate pearl embroidery, refined wedding ring worn naturally on the ring finger, groom's hand gently touching or supporting hers if composition allows, warm diffused dawn lighting matching the main couple illustration, subtle champagne highlights, sophisticated semi-realistic painterly wedding illustration, premium editorial aesthetic, extremely natural hand anatomy, ring visible but not artificially presented, transparent background, no extra fingers, no distorted fingers, no oversized jewellery, no text.”

Regeneration notes: this must not be a random standalone hand. Match angle, skin tone, light, cuff, finger pose, wrist, and groom interaction exactly. Reject extra/fused fingers, wrong ring finger, warped jewellery, or mismatched sleeve/skin.

## ring-contact

- Preferred file: public/assets/couple/ring-shadow.webp or a procedural equivalent.
- Purpose: make the ring feel physically attached to the finger.
- Composition: exact ring-hand crop.
- Master: 512 × 512 or larger detail.
- Transparency: required.

Prompt:

“Contact shadow and restrained local reflection derived from the approved bride ring-hand crop, following the ring band, finger curvature and existing dawn-light direction exactly, soft realistic occlusion, subtle champagne reflection, isolated transparent background, no ring replacement, no new jewellery, no hard outline, no sparkle, no text.”

Regeneration notes: never place a disconnected SVG ring over the hand. The actual ring remains understated and physically believable.

## procedural-ring-highlight

- Existing file: public/assets/couple/ring-highlight.svg
- Purpose: delayed cinematic reward after the couple reveal.
- Composition: transparent 128 × 128 SVG, centred glint.
- Transparency: required.

The SVG contains editable diffuse glow, horizontal ray, vertical ray, central point, and optional micro-particle groups. The glint is not baked into any raster artwork.

Calibrated anchor for the current 853 × 1844 runtime master:

- Normalized x: 0.655
- Normalized y: 0.279
- Approximate source pixel: 559, 514
- Coordinate origin: top-left of the intrinsic couple image
- Overlay origin: centre; apply translate(-50%, -50%)

Animation specification from the dedicated couple prompt:

- Opacity: 0 → 0.9 → 0
- Scale: 0.4 → 1 → 0.7
- Duration: 700–1000 ms
- Repeat: approximately every 6–10 seconds with slightly randomized delay
- First glint: approximately 1.5–3 seconds after the couple becomes visible

Regeneration notes: the general brief’s 700–1200 ms and 5–9 second ranges are superseded by the dedicated couple prompt. Recalibrate the normalized anchor after every recrop or artwork replacement.

## couple-light-overlay

- Preferred file: public/assets/couple/couple-light-overlay.webp
- Purpose: imperceptibly evolving warm side/back light.
- Composition: exact master coordinates.
- Master: match the couple master canvas.
- Transparency: required.

Prompt:

“Extremely subtle warm dawn illumination derived from the approved Muslim wedding couple master, soft back and side light wrapping the couple with a restrained champagne rim and faint cloud-filtered haze, exact silhouettes and light direction of the master, painterly diffusion, isolated transparent background, no facial repainting, no hard ray, no sparkle, no text.”

Regeneration notes: opacity may drift only about 0.8 → 1 → 0.85 over 10–20 seconds. Prefer CSS/SVG gradients if alignment remains exact.

## couple-ground-shadow

- Preferred file: public/assets/couple/couple-ground-shadow.webp
- Purpose: anchor the couple to the pavilion floor.
- Composition: aligned to the final couple/pavilion composite.
- Master: 1536 × 768 or larger.
- Transparency: required.

Prompt:

“Very soft contact shadow beneath the approved wedding couple’s feet, derived from the final pavilion-floor composite, pale lavender-blue ambient occlusion with restrained warm dawn direction, feathered painterly edges, physically grounding rather than floating, isolated transparent background, no feet, no architecture, no hard outline, no text.”

Regeneration notes: derive only after final couple scale and pavilion floor plane are locked.

## couple-closeup

- Preferred file: public/assets/couple/couple-close-up-desktop.webp
- Purpose: optional large-screen three-quarter alternative.
- Composition: landscape 4:3 or portrait-safe crop.
- Master: 2560 × 1920.
- Transparency: preferred.

Prompt:

“Romantic close three-quarter illustration of an elegant newlywed couple standing inside a luminous pavilion above the clouds, gently holding one another and gazing into each other's eyes, bride's ring hand visible near groom's chest, refined semi-realistic anime-inspired Korean romance illustration, sophisticated adult proportions, premium wedding editorial styling, soft ivory clothing, subtle champagne accents, diffused golden dawn light, gentle painterly rendering, intimate serene expression, cinematic composition, no text, no exaggerated fantasy elements.”

Regeneration notes: use the approved master couple as an identity and pose reference. Do not use on mobile unless both faces, the intact hijab silhouette, embrace, and ring hand remain clear.

## floral-ornament

- Existing files: public/assets/ornaments/floral-accent-left.svg and floral-accent-right.svg
- Purpose: sparse stationery accents.
- Composition: editable transparent vectors, 360 × 260 viewBox.
- Transparency: required.

Original direction:

“Minimal elegant white wedding floral sprig with tiny ivory blossoms and delicate pale greenery, refined botanical wedding illustration, subtle champagne-gold line details, premium stationery aesthetic, isolated on transparent background, graceful asymmetrical composition, understated, no colourful bouquet, no roses dominating composition, no text.”

Regeneration notes: the supplied SVGs are original procedural artwork. Use sparingly; do not turn them into repeated borders or oversized florals.

## monogram-ornament

- Existing file: public/assets/ornaments/monogram.svg
- Purpose: opening A+A identity mark with an abstract Alif–Ain influence.
- Composition: editable transparent vector, 320 × 240 viewBox.
- Transparency: required.

Original direction:

“Original A + A monogram with optional conceptual Alif + Ain influence, elegant intertwined muted-gold calligraphic strokes, balanced negative space, premium wedding-stationery identity, editable vector construction, no copied calligraphy, no font outlines, no text label, no ornate crest, no religious emblem.”

Regeneration notes: all strokes are separated into named SVG groups. The Arabic influence is conceptual geometry, not copied calligraphy or a literal religious mark.

## divider-ornament

- Existing file: public/assets/ornaments/divider.svg
- Purpose: quiet section punctuation.
- Composition: editable transparent vector, 720 × 64 viewBox.
- Transparency: required.

Original direction:

“Extremely fine symmetrical wedding-stationery divider, restrained muted-gold line, tiny pointed-arch geometry, small botanical hints and balanced negative space, subtle Islamic geometric influence, editable vector construction, no complex mandala, no ornate border, no heavy gold, no text.”

Regeneration notes: the supplied SVG is the production-first procedural result. Preserve its thin visual weight.

## Cross-asset approval pass

Before approving replacements, compare all assets together:

1. One consistent light direction and colour temperature.
2. Matching cloud shadow hue and softness.
3. Stair perspective leading naturally to the pavilion.
4. Pavilion scale, brushwork, and architecture matching the staircase world.
5. Couple lighting, edge treatment, haze, and floor contact matching the pavilion.
6. Correct hands, ring finger, ring contact, and believable jewellery scale.
7. Clean transparent edges without halos.
8. No duplicated ornaments, warped architecture, or obvious generation defects.
9. Strong portrait compositions at 390 × 844, 393 × 852, and 430 × 932.
10. Faces, hijab silhouette, embrace, hand, and ring retained in that exact focal hierarchy.
