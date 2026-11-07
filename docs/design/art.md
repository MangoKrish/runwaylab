# RunwayLab artwork

Hand-written SVG in `src/art/`, drawn on 7 November 2026 for the redesign. Everything is original: no stock, no
logos, no copies. One idea runs through all of it: **the picture the tracker sees**. A runway drawn as a pinhole
camera would see it (one vanishing point, a lit doorway at the far end, edge lights that shrink with distance), a
walker drawn as the 26 tracked points and the bones between them, and the small marks of a measurement (a plumb
line, a shoulder level, a bracket round the head, two ticks on a foot line). Lines are thin and round-capped; the
only solid colour is the accent, used for light: the doorway, the beams, the bones of the walker.

Preview everything at `http://127.0.0.1:4700/docs/design/art-sheet.html` under `npm run dev`, in light and dark.

## How the colours work

Every file is drawn with two colours only:

- `currentColor` for ink: joints, runway edges, rig bars, tracking marks, the far-end lights.
- `var(--accent)` for light: bones, the doorway, beams, glow, the one filled point in each icon.

Which means the page decides the palette. Inlined, a file takes the `color` and `--accent` in force where it sits,
so the same hero is cream-on-dark on the stage and ink-on-cream on the page, and a dark theme needs no second file.
Each themed file also carries a fallback `<style>` scoped to `svg:root` (light ink and violet, swapping to cream
and lavender under `prefers-color-scheme: dark`). That rule only matches when the SVG is its own document, so a
plain `<img src="src/art/hero.svg">` follows the OS theme by itself and an inlined copy ignores it.

Three ways to place a file:

1. `<img src="src/art/x.svg" alt="...">`: simplest, follows the OS theme, cannot follow the page's own accent or sit
   on the dark stage inside a light page. Fine for the hero if it sits on the page background.
2. Inline through `src/art/inline.mjs`: `const svg = await artSvg('hero.svg', { className: 'rw-hero__art' })` returns
   the `<svg>` element, fetched once and cached. Pass `{ decorative: true }` when the words beside it already say
   what it shows, or `{ label }` to replace the file's own title. Gradient and mask ids are global once inlined
   (prefixed `rl-hero-`, `rl-empty-`, `rl-og-`, so different files never collide), so when the same file appears
   twice on one page give each extra copy `{ copy: 2 }` and its ids are suffixed. Without that, Chrome draws the
   second copy against the first copy's masks and can drop parts of it. The content security policy already allows
   the fetch (`connect-src 'self'`).
3. Icons through the sprite: `icon('camera')` from `inline.mjs`, or by hand
   `<svg aria-hidden="true" width="24" height="24"><use href="src/art/icons.svg#rl-icon-camera"/></svg>`.
   Lines take `currentColor`, the dot takes `--accent`, both from the element the `<use>` sits in.

To recolour, set `color` and `--accent` on the container. The hero on the dark stage, for example:
`.rw-hero__art { color: var(--stage-ink); --accent: var(--stage-accent); }`. Nothing inside the files is hard-coded
except the share picture, which is meant to be a fixed picture.

## The files

| File | Size | What it is | Where it goes |
| --- | --- | --- | --- |
| `hero.svg` | 8 KB, 960 x 720 | The walker on the runway: skeleton figure mid-stride, glow under the bones, joints in accent, reflection fading into the floor, lit doorway, three overhead rigs with beams, perspective floor lines, edge lights, faint rays, tracking marks. `role="img"`, titled. | Home hero, beside or behind the headline. The figure is centred and the vanishing point sits at 480, 352, so `preserveAspectRatio="xMidYMid slice"` crops safely to a phone portrait: the walker, door and near runway stay in frame (checked at 390 x 520). Use `meet` when the whole picture should show. Can also stand in for the live canvas when `prefers-reduced-motion` is on. |
| `icons.svg` | 3 KB sprite | Eight 24-grid line icons as `<symbol>`s: `rl-icon-camera`, `-walk`, `-turn`, `-score`, `-judge`, `-wall`, `-download`, `-socials`. Stroke 1.75, round caps, 2 px inner padding, and **one filled accent point in each**: the lens, the hip, the pivot, the top score, the middle of the opinion, the top brick, the head of the arrow, the centre of the @. | Nav links, the "how it works" steps (camera, walk, turn, score, judge), the wall link, "Download all videos", the socials field. Keep them beside words and `aria-hidden`; label them only when alone. |
| `icon-*.svg` | under 0.6 KB each | The same eight icons as single files, for `<img>` or inlining. | Same as above, where a sprite is awkward. |
| `empty-walks.svg` | 4.6 KB, 320 x 200 | The runway with nobody on it: lights on, doorway lit, a pool of light on the floor and, inside the doorway, a dotted ghost of a standing figure made of the tracked points. Titled "An empty runway with the lights on, waiting for a walk". | The "Nothing saved yet" state in Saved walks and the "The runway is empty" block on the home page. Suggested 240 to 320 px wide, centred above the words, `decorative: true` since the heading says it. Also fits "No saved walks match this filter" at a smaller size. |
| `divider.svg` | 0.4 KB, 240 x 24 | Two hairlines with a small runway between them: converging edges, a short far edge, one accent light above. `aria-hidden`. | Between home sections, or under a page heading. Stretch to any width with `preserveAspectRatio="xMidYMid meet"`, or set `none` to let the hairlines reach the edges. |
| `mark.svg` | 0.7 KB, 64 x 64 | A small mark: rounded plate in ink, runway in accent with a dashed centre line and a bar of light at the far end. It happens to read as a flask too, which suits the name. Titled "RunwayLab". | Beside the wordmark in the header at 28 to 32 px, or wherever a square mark is needed (app icons, the wall's cards). The favicon can be regenerated from it if wanted; `favicon.svg` itself is untouched. |
| `figure.svg` | 2 KB, 64 x 128 | One standing figure from the tracked points, bones in accent with a soft glow, joints in ink, the same way `overlay.mjs` draws a live skeleton. Titled. | The standing skeleton mark the direction doc asks for above empty-state titles (48 px wide), on wall cards with no thumbnail, or as a bullet beside "Stand tall". `decorative: true` next to a title. |
| `og.svg` | 7.7 KB, 1200 x 630 | The share picture: wordmark, "Walk up. Turn. Get judged.", the walker and runway, on a dark stage. Colours are fixed on the root (`style="color:#F5F0E8;--accent:#B3A1FF"`) on purpose. | Source for the share picture only. Sharing sites do not read SVG. |
| `og.jpg` | 82 KB, 1200 x 630 | `og.svg` rendered with Be Vietnam Pro, for `<meta property="og:image">` and `twitter:image` (give an absolute URL, and `og:image:width` 1200, `og:image:height` 630). | `index.html` head. To re-render after changing `og.svg`: open `docs/design/og.html` on the dev server and screenshot the page at 1200 x 630 (headless Chrome with `Emulation.setDeviceMetricsOverride` 1200 x 630 and `Page.captureScreenshot`), then save as JPEG quality 90. The page waits for the font before setting `data-ready`. |
| `inline.mjs` | 2.8 KB | `artSvg(name, options)` and `icon(name, options)`, described above. No dependencies. | Any screen that inlines art. |

Also here, not art: `docs/design/art-sheet.html` (the contact sheet) and `docs/design/og.html` (the render page).

## Fitting the direction doc

- `direction.md` asks for icons on a 20 px grid with a 1.5 px stroke. These are drawn on a 24 grid with a 1.75
  stroke, so shown at 20 px the stroke is 1.46 px: set `width`/`height` 20 and they match. Their names cover the
  nav, the steps and the actions; play, pause, check, chevron, close and upload are not here and can be added to
  the sprite in the same style (24 grid, 1.75 stroke, round caps, one accent point).
- The skeleton convention is the live overlay's: bones in the accent, joints in ink. The hero, the share picture
  and `figure.svg` all follow it, so the drawn walker and a tracked walker look like the same thing. Under each
  accent bone sits a wider ink stroke at 45 %, so the bones still read where they cross the lit doorway (violet on
  violet, on the light theme) and look like lit lines with a bright edge on the stage.
- The hero in `hero.svg` is the still version of `scene.mjs`: same camera, same runway width, same doorway. It can
  replace the canvas under `prefers-reduced-motion`, or stand behind the headline on pages that have no canvas.

## Rules for adding more

- Keep the two-colour discipline. If something needs a third tone, use opacity on one of the two.
- Everything geometric follows the same camera: floor height `y = 352 + 368 / d` in the hero's coordinates (d in
  metres), horizon at hip height, runway 1.84 m wide. New props placed with that rule will sit on the same floor.
- Thin lines (1.25 to 2.5 units at 960 wide), round caps, no filters. Glow is a wider stroke of the accent at low
  opacity, never a blur, so it stays cheap on a phone.
- Faces stay blank. The app pixelates faces before anything leaves the device, and the art should not show one.
- No text inside art except the share picture, so nothing has to be translated or kept in step with copy.
- Every meaningful picture gets `role="img"` and a `<title>` (and `aria-labelledby` pointing at it); decoration gets
  `aria-hidden="true"`. Hard-coded colours only in the share picture.
- Check `xmllint --noout src/art/*.svg` and the contact sheet in both themes before shipping.
