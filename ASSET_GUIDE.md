# Asset Guide

## What matters most

The visual experience succeeds or fails in this order:

1. The couple master and its emotional readability.
2. The bride’s correct hijab, hand anatomy, believable ring, and calibrated glint.
3. A pavilion that frames rather than competes with the couple.
4. A staircase whose perspective leads naturally to that pavilion.
5. Distinct cloud layers with clean edges and consistent dawn lighting.
6. Quiet stationery ornaments that support the invitation without becoming decoration for its own sake.

The couple’s intended focal hierarchy is always faces/eye contact → embrace → bride’s hand → ring → pavilion → cloud world.

## Directory contract

public/assets contains:

- sky — global background, distant cloudscape, and optional sunlight overlays.
- clouds — isolated back, middle, front, small, and mist layers.
- stairs — staircase detail and its separable glow.
- pavilion — distant pavilion, final structure, curtains, and foreground cloud occlusion.
- couple — preserved source and processed PNG masters, optimized transparent runtime derivatives, optional derived body/fabric/hand/light layers, and ring highlight.
- ornaments — original editable monogram, divider, and restrained floral SVGs.

Keep editable/lossless sources. Runtime code should use optimized WebP/AVIF derivatives where practical, except original SVG artwork. Never overwrite public/assets/couple/couple-master-chroma.png; it is the preserved generation source, not a browser asset.

## Couple prompt authority

The couple asset used the separate **COUPLE ARTWORK — IMPORTANT LAYERED COMPOSITION** master prompt. It supersedes the shorter general-site couple prompt for all couple decisions.

The current files are:

- public/assets/couple/couple-master-chroma.png — preserved 853 × 1844 RGB source/intermediate.
- public/assets/couple/couple-main.png — processed 853 × 1844 transparent 32-bit ARGB master.
- public/assets/couple/couple-main.webp — optimized full-size runtime asset.
- public/assets/couple/couple-main-480.webp and couple-main-640.webp — responsive runtime variants.
- public/assets/couple/bride-ring-hand.webp — exact 853 × 1844 pixel-aligned alpha extraction from the approved master, used for the delayed hand reveal, with 480 px and 640 px responsive variants.

If bride/groom separation causes any mismatch, use the intact couple-main composition via its optimized WebP. A coherent flattened couple is preferable to visible seams. When layers are produced, derive them from the processed PNG master so faces, proportions, lighting, pose, hand placement, clothing, and eye lines do not change.

## Couple composition stack

All couple pieces should share one positioned wrapper and one scroll/camera transform so the people remain anchored to the pavilion floor.

| Back to front | Asset | Rule |
| --- | --- | --- |
| 1 | couple-ground-shadow.webp | Align to the final pavilion floor before any body layer. |
| 2 | groom-main.webp and bride-main.webp, or couple-main.webp | Use the intact current composition until derived layers are proven seamless. |
| 3 | bride-hijab-veil.webp | Only trailing veil/loose fabric; never remove the fitted face-framing hijab if seams may show. |
| 4 | couple-embrace-overlay.webp | Restore natural arm/hand occlusion where needed. |
| 5 | bride-ring-hand.webp | Exact master-derived hand and sleeve detail, not a new standalone hand. |
| 6 | ring-shadow.webp | Contact shadow/reflection following finger curvature. |
| 7 | ring-highlight.svg | Centre on the calibrated normalized anchor and animate externally. |
| 8 | couple-light-overlay.webp | Optional very low-amplitude warm-light drift. |

Pavilion haze, curtains, and foreground clouds surround this wrapper and provide the atmospheric reveal. Do not let the couple float independently from the architecture.

## Ring alignment

The normalized ring anchor for the current couple-main composition is:

    { "x": 0.655, "y": 0.279 }

That corresponds to approximately pixel 559, 514 on the 853 × 1844 intrinsic source. Coordinates originate at the artwork’s top-left, before CSS cover cropping. Position the centre of ring-highlight.svg at that point:

    left: 65.5%;
    top: 27.9%;
    transform: translate(-50%, -50%);

Place the highlight inside the same intrinsic-ratio wrapper as the couple image. Apply shared scale/translation to the wrapper, not separate transforms to the image and anchor. If object-fit: cover clips or rescales the image, calculate the rendered image rectangle and anchor within that rectangle; percentages of the viewport are not equivalent.

The SVG root repeats the anchor as data-ring-anchor-x and data-ring-anchor-y, while ARTWORK_MANIFEST.json is the canonical configuration record.

Glint choreography:

- Do not bake sparkle into raster artwork.
- Wait about 1.5–3 seconds after the couple becomes visible.
- Animate opacity 0 → 0.9 → 0 and scale 0.4 → 1 → 0.7.
- Use a 700–1000 ms duration.
- Repeat approximately every 6–10 seconds with slight randomized delay.
- Disable repetition or leave a static ring for reduced-motion visitors.

The ring must already have believable contact shadow and reflection. The SVG supplies only the tiny light event.

## Mobile art direction and safe areas

Portrait mobile is primary. Test at 390 × 844, 393 × 852, and 430 × 932.

For the final pavilion/couple scene:

- Keep both faces clearly visible near the central upper-middle region.
- Preserve the complete face-framing hijab silhouette; no cloud, curtain, crop, or text may cut across it.
- Keep the bride’s ring hand and glint inside the visible crop.
- The couple should occupy roughly the central 45–60% of the viewport.
- Let pavilion architecture frame the couple rather than crowding their faces.
- Foreground clouds may conceal the scene during reveal but must clear faces and hand at rest.
- Keep RSVP and final-message typography outside the couple silhouette. Reserve a text band above the pavilion or below the visual after it has had room to breathe.
- Do not crop a desktop landscape blindly. Export or use art-directed portrait composition when focal points cannot survive.

For opening and ascent scenes:

- Keep the centre clear enough for the monogram, names, invitation copy, details, and timeline.
- Position clouds asymmetrically around text; never cover essential copy at the animation’s resting state.
- Keep the staircase centred and its vanishing path legible behind floating detail text.
- Avoid placing text over high-contrast marble edges, architectural detail, or bright rays.

On desktop, reveal more sky, stairs, pavilion, clouds, and veil. Do not simply enlarge the couple.

## Recommended masters and delivery formats

| Family | Recommended master | Runtime delivery | Alpha |
| --- | --- | --- | --- |
| Sky background | 2048 × 3072 | WebP/AVIF or CSS gradient | No |
| Distant cloudscape | 3072 × 1728 | WebP/AVIF | Usually no |
| Isolated clouds | 1280–2560 px long side | Alpha WebP/AVIF | Yes |
| Mist and light overlays | 2048 px or procedural | CSS/SVG preferred; alpha WebP fallback | Yes |
| Staircase | 2048 × 3072 | Alpha WebP/AVIF | Preferred |
| Final pavilion | 3072 × 2304 | Alpha WebP/AVIF with responsive variants | Preferred |
| Curtains | 1536 × 2304 each | Alpha WebP/AVIF | Yes |
| Couple future master | 2048–3072 px long side | Lossless PNG source; alpha WebP/AVIF runtime | Yes |
| Ring-hand detail | At least 1536 px before crop | Alpha WebP/AVIF | Yes |
| Ornaments and glint | Native viewBox | SVG | Yes |

The current 853 × 1844 couple master is a valid first-pass portrait asset but below the preferred high-resolution target. Do not upscale it. Replace it with a higher-resolution derivative from the same approved composition when available.

Compress responsibly and inspect transparent edges against both pale-blue and warm-ivory backgrounds. Transparent-image dimensions affect memory even when file size looks small, so avoid full-screen alpha rasters where CSS/SVG can produce the same effect.

## Replacement workflow

1. Read the matching entry in ARTWORK_PROMPTS.md and preserve the shared art bible.
2. Generate or edit a lossless master at the documented composition and resolution.
3. Inspect anatomy, architecture, perspective, light direction, colour temperature, haze, and edge quality alongside adjacent assets.
4. Export responsive optimized derivatives without upscaling.
5. Replace only the named file or update its file field in ARTWORK_MANIFEST.json.
6. Recheck portrait crops at all three target mobile sizes.
7. If the couple image or crop changed, measure the ring centre again and update ARTWORK_MANIFEST.json, the data attributes in ring-highlight.svg, and the runtime configuration together.
8. Verify the reveal and its reduced-motion equivalent before removing the prior approved master.

Do not randomly regenerate the couple between builds. Keep approved source versions separately so identity and styling remain stable.

## Transparency checklist

Transparency is required for isolated clouds, mist, sunlight rays, staircase glow, pavilion curtains, pavilion foreground clouds, all derived couple layers, ring shadow, light overlay, ground shadow, ring highlight, and ornaments.

Transparency is preferred for staircase-main.webp, pavilion-main.webp, pavilion-distant.webp, and the runtime couple master. A clean removable background is acceptable only during source generation.

Before acceptance:

- Inspect for pale or dark matte halos.
- Confirm soft edges retain painterly texture instead of becoming hard cutouts.
- Remove chroma spill from hair, hijab, veil, hands, and ivory clothing.
- Confirm translucent veil and curtains contain real partial alpha.
- Confirm no accidental transparent holes appear inside architecture or clothing.

## Final visual QA

- Light comes from one coherent dawn direction.
- Cloud and contact shadows share pale blue/lavender softness.
- Stair perspective leads to the pavilion.
- Pavilion scale and brushwork belong to the same illustrated world.
- Couple feet and ground shadow meet the floor plane.
- Bride has no visible hair, neck, or ears; the veil originates behind the hijab.
- Faces and gaze are clear before the embrace and ring attract attention.
- The left hand has correct anatomy and ring-finger placement.
- The glint lands exactly on the ring at every responsive size.
- Nothing resembles cloned clouds, malformed architecture, excessive gold, ornate religious architecture, or pasted-on clip art.
