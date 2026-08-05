# Our Journey

A mobile-first cinematic wedding invitation built with Astro, TypeScript, Tailwind CSS, React, GSAP, and ScrollTrigger. The experience moves from an opening cloud field through an ascending staircase to a layered pavilion, couple reveal, ring glint, final invitation, and RSVP.

## Run locally

```sh
npm install
npm run dev
```

Production checks:

```sh
npm run check
npm run build
npm run preview
```

`npm run smoke -- http://127.0.0.1:4321` runs the personalized RSVP flow in local Chrome/Edge. `npm run capture -- <url> <output> <width> <height> <scroll>` captures a visual checkpoint; `scroll` can be a page fraction such as `0.5` or a section target such as `#pavilion@0.74`.

## Deploy to GitHub Pages

The workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) checks, builds, and deploys the site whenever `main` is pushed, and it can also be run manually from the Actions tab.

In the GitHub repository, open **Settings → Pages** and select **GitHub Actions** as the source, then push to `main`. If the repository uses another default branch, update the branch name in the workflow. The Pages origin and repository base path are detected during deployment, so both account sites and project sites such as `https://username.github.io/repository/` use the correct asset URLs.

## Invitation content

Edit [`src/data/invitation.ts`](src/data/invitation.ts) to replace:

- the partner-name placeholders;
- `VENUE NAME`;
- the supplied date/day copy;
- timeline and RSVP wording;
- invite-code records and guest limits.

The supplied brief says **Saturday, 14 June 2027**, although 14 June 2027 is a Monday. The project deliberately preserves the supplied copy in one configuration file rather than guessing the intended correction.

The sample personalized route is `/invite/ABC123/`. It greets Ivan Tan, limits the RSVP to two guests, and stores the mock submission locally. The RSVP submission boundary is designed so a Supabase, Google Sheets, or serverless handler can replace the local mock without changing the form UI.

## Artwork

Runtime artwork is under `public/assets`. The couple was generated from the separate authoritative **COUPLE ARTWORK — IMPORTANT LAYERED COMPOSITION** prompt, then processed into alpha WebP variants. The ring-hand detail is derived from that exact master and the glint remains an independent SVG.

- [`ARTWORK_PROMPTS.md`](ARTWORK_PROMPTS.md) records prompts, constraints, formats, and regeneration notes.
- [`ARTWORK_MANIFEST.json`](ARTWORK_MANIFEST.json) maps semantic layers to current files and normalized ring coordinates.
- [`ASSET_GUIDE.md`](ASSET_GUIDE.md) explains replacement, responsive safe areas, compositing, and quality control.

Generated alpha assets keep their original chroma and lossless sources alongside optimized runtime variants. Procedural clouds, haze, light, curtains, ornaments, and contact shadows keep the site runnable when raster layers are replaced.

## Accessibility and performance

- The primary compositions are tuned for 390×844, 393×852, and 430×932 viewports.
- `prefers-reduced-motion` removes parallax and idle movement while preserving every story beat.
- Later artwork and the React RSVP island load only when needed.
- Responsive WebP sources, local font files, semantic landmarks, focus states, form validation, and a skip link are included.
