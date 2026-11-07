# RunwayLab visual direction

Art direction for the redesign, 7 November 2026. Everything here is buildable in plain CSS with the one self-hosted
typeface (Be Vietnam Pro 400 / 400 italic / 500 / 600 / 700 in `src/fonts.css`). No other fonts, no CDNs, no external
images: the CSP in `index.html` allows only `'self'`.

Before screenshots (light and dark, 1440 and 390) are in
`/private/tmp/claude-501/-Users-krishnas--claude-spares-spare-58bnDs/453d30a5-fffe-4659-aa7b-79190d606b1e/scratchpad/redesign/before-light`
and `.../before-dark`. The current `src/styles.css` is competent and clean. What it lacks is a concept carried through,
one type scale instead of two dozen ad hoc sizes, a dark theme that is the stage rather than a flipped light theme,
one vocabulary for every bar and ribbon, and motion that means something. That is what this document sets.

## 1. The concept: one line of light

A runway is one straight line of light in a dark room. RunwayLab measures what moves along it. The whole interface
is built from three things the product is actually made of:

- **The line.** The runway, the walker's path, the hairline rules, the progress bars, the ribbon, the steps on the
  floor. Every rule in the UI is a runway line: 1 px hairline with a short accent segment at its start, like the
  start mark on a floor. Bars and ribbons are lengths of that same line.
- **The light.** One accent, *ultraviolet*, and it behaves like a stage light, not like paint. It is used as a glow
  on dark, as ink on paper, as the fill of a measured bar, as the current step. It is never a filled panel, never
  a gradient button, never a background wash on the light theme.
- **The measure.** Numbers are the hero after the walker. Tabular figures, units set lighter and smaller, ticks on
  scales, calibration marks. Nothing is decorated that is not a measurement.

The feeling: a quiet venue before the show. Chalk-white walls in daylight (light theme), the same room with the
house lights down and the runway lit (dark theme). Calm, confident, precise, and a little theatrical only where the
product is theatrical: the hero, the countdown, the score.

Name for the system when talking about it: **Lit line**.

## 2. Colour

Roles, not hues. Every screen uses these names; nothing uses a raw hex outside this block, `scene.mjs` and the
canvas overlays (which may keep their hard-coded stage colours, since the stage is always dark).

### Light theme ("house lights up")

| Role | Hex | Use |
|---|---|---|
| `--bg` | `#F4F3F6` | Page. Chalk white with a breath of violet, not Annontrix cream. |
| `--surface` | `#FFFFFF` | Cards, inputs, the figure panel. |
| `--band` | `#EBE9F0` | Recessed areas: notes, bar tracks, pills, the ribbon track. |
| `--ink` | `#15131C` | Primary text, solid buttons, strong rules. Violet-black, not brown-black. |
| `--ink-2` | `#4E4A5C` | Secondary text, ledes, notes. 7.7:1 on bg. |
| `--ink-3` | `#66627A` | Captions, units, meta. 5.3:1 on bg, 4.9:1 on band. The smallest text it may set is 13 px. |
| `--hair` | `#DDD9E3` | Hairline rules, card borders, tracks' edges. |
| `--hair-strong` | `#B9B3C6` | Input borders, secondary button borders. |
| `--accent` | `#4E38B5` | Ultraviolet as ink. Links, current step, measured fills, eyebrow labels, the grade. 7.4:1 on bg. |
| `--on-accent` | `#FFFFFF` | Text on an accent fill. |
| `--accent-soft` | `#E4DFF6` | Tinted fills: ribbon "walking back", selected chip, the zone where points are earned. |
| `--glow` | `rgba(120, 96, 255, 0.35)` | The light itself. Only on dark surfaces (stage ring, score on dark, hero). |
| `--ok` | `#1E7A4C` | Saved, calibrated, done. Text and small marks only. |
| `--warn` | `#8A5300` | Not seen, left out, low quota. Text only. |
| `--err` | `#B3261E` | Failures. Text only. |
| `--rec` | `#E5484D` | The recording dot. Never elsewhere. |

Data colours (same in both themes by role):

| Role | Light | Dark | Meaning |
|---|---|---|---|
| `--data-measured` | `--accent` | `--accent` | Points measured by code; "toward the camera"; professional models' dot. |
| `--data-opinion` | `--ink` | `--ink` | Gemini's points; the turn. Solid ink, so opinion is never confused with light. |
| `--data-tint` | `--accent-soft` | `rgba(179,161,255,0.18)` | The faint half: "walking back", earned zone, the track under a dot. |
| `--data-none` | hatched `--hair` | hatched `--hair` | Not seen / left out. A 45° hairline hatch, never a grey bar. |
| `--data-other` | `--ink-2` outline | `--ink-2` outline | Everyday walkers' dot (hollow). |

### Dark theme ("house lights down")

The dark theme is the stage. It shares its blacks with the hero scene (`#08070B` sky, `#15111E` floor), so the
hero no longer looks like a different app from the page beneath it.

| Role | Hex |
|---|---|
| `--bg` | `#0E0C14` |
| `--surface` | `#16131E` |
| `--band` | `#1E1A29` |
| `--ink` | `#F3F0FA` |
| `--ink-2` | `#B4AEC4` (9:1 on bg) |
| `--ink-3` | `#8A849C` (5.4:1 on bg, 4.7:1 on band) |
| `--hair` | `#2A2537` |
| `--hair-strong` | `#3E3850` |
| `--accent` | `#B3A1FF` (8.4:1 on bg; it is already the skeleton colour in `overlay.mjs` and the scene's light) |
| `--on-accent` | `#0E0C14` |
| `--accent-soft` | `#2A2448` |
| `--glow` | `rgba(179, 161, 255, 0.28)` |
| `--ok` | `#6FCF9B` |
| `--warn` | `#E8B35A` |
| `--err` | `#FF8A80` |
| `--rec` | `#FF5C5C` |

### The stage (same in both themes)

Video is always on black. `--stage: #0B0A10`, `--stage-ink: #F3F0FA`, `--stage-accent: #B3A1FF`,
`--stage-scrim: rgba(11, 10, 16, 0.78)`. The hero, the camera stage, the player and the wall thumbnails all use
these, so a walk looks the same wherever it is shown.

### Rules

- One accent. The violet is the only chromatic colour in the chrome. Status colours appear on text and 8 px marks,
  never as fills or borders bigger than a dot.
- Accent as ink on light, accent as light on dark. On light, nothing glows. On dark, the score, the live stage ring
  and the hero may glow (`--glow`), nothing else.
- `--ink-3` only on `--bg` and `--surface`; on `--band` use `--ink-2`.
- Primary buttons are ink, not accent. Accent on hover only. This is what keeps it from reading as SaaS.
- No gradients on the light theme except the scrim over video. On dark, the only gradients are light falloff
  (radial, from `--glow` to transparent).

## 3. Type

One family. The scale is fluid between 360 px and 1440 px and then stops. All sizes are tokens; a screen never
writes its own `font-size`.

| Token | Size | Weight | Line | Tracking | Used for |
|---|---|---|---|---|---|
| `--t-display` | `clamp(3.25rem, 1.5rem + 5.4vw, 6.75rem)` | 700 | 0.96 | -0.045em | The hero headline only. |
| `--t-score` | `clamp(5.5rem, 3rem + 9vw, 9.5rem)` | 700 | 0.9 | -0.06em | The big score, the countdown digit (scaled up on the stage). Tabular. |
| `--t-title` | `clamp(2.25rem, 1.5rem + 2.4vw, 3.5rem)` | 700 | 1.04 | -0.035em | Page `h1`, section titles. |
| `--t-h2` | `clamp(1.5rem, 1.25rem + 0.8vw, 1.875rem)` | 600 | 1.2 | -0.02em | `h2` inside pages, breakdown heads, the empty-state title. |
| `--t-h3` | `1.125rem` | 600 | 1.3 | -0.01em | Card and list heads, bar labels. |
| `--t-lede` | `clamp(1.125rem, 1rem + 0.5vw, 1.375rem)` | 400 | 1.5 | 0 | Ledes under titles, the verdict quote (500). `--ink-2`. |
| `--t-body` | `clamp(1rem, 0.96rem + 0.2vw, 1.0625rem)` | 400 | 1.6 | 0 | Everything else. |
| `--t-small` | `0.9375rem` | 400 | 1.5 | 0 | Notes, checklist, legends. |
| `--t-caption` | `0.8125rem` | 500 | 1.4 | +0.01em | Units, meta, timestamps, figure captions. `--ink-3`. |
| `--t-eyebrow` | `0.875rem` | 600 | 1.3 | 0 | The small line above a title ("Your score", "Closest walk"). Sentence case, `--accent` on light, `--ink-2` on dark. |
| `--t-num-xl` | `clamp(2rem, 1.5rem + 1.6vw, 2.75rem)` | 700 | 1.1 | -0.03em | Stats, metric values, wall card score, row score. Tabular. |
| `--t-num` | `1.25rem` | 600 | 1.2 | -0.01em | Bar numbers, sums, timer. Tabular. |
| `--t-mono` | `0.875rem` `ui-monospace, SFMono-Regular, Menlo, monospace` | 400 | 1.5 | 0 | Raw numbers in "The numbers behind this" only. |

Rules:

- `font-variant-numeric: tabular-nums` on every number. Units and maxima (`/100`, `fps`, `% of height`) are
  `--t-caption` weight 400 in `--ink-3`, set after the number with a 0.15em gap, never the same size as the number.
- Weight carries hierarchy, colour carries status. 700 for titles and numbers, 600 for heads and buttons, 500 for
  captions and nav, 400 for reading. Never 800+ and never faux bold.
- Measure: prose maxes at 62ch (`--measure`), ledes at 40ch, hero at 18ch.
- Headlines are sentence case. No uppercase tracking, no mono micro-labels: that is the Annontrix portfolio language
  and RunwayLab is not it.
- Italic (400) only for the illustration caption on the hero and a judge's quoted phrase.

## 4. Space, grid, radius, elevation

Base 4 px. `--s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px;
--s-9: 96px; --s-10: 128px`.

- Section rhythm: `--space-section: clamp(64px, 24px + 6vw, 128px)` between home sections; inside a page
  `--space-block: clamp(32px, 16px + 3vw, 64px)`.
- Container `--container: 1280px`, gutter `--gutter: clamp(16px, 4vw, 48px)`. Full-bleed bands use the
  `100vw` margin trick already in place.
- Grid: 12 columns, `--gap: clamp(16px, 2.4vw, 32px)`. The result page is 7 / 5 (media / summary); the home
  score guide is 5 / 7 (sticky intro / list); the studio panels are 4 / 4 / 4; the wall is `auto-fill` at 300 px.
  Everything collapses to one column at 1000 px; four-up lists go 2-up at 1000 and 1-up at 720.
- Phone (360 to 430): 16 px gutter, no horizontal scroll, the stage and the player go edge to edge inside the
  gutter, tap targets 44 px minimum, the primary studio action sticks to the bottom while the camera is live.
- Radii: `--r-xs: 6px` (chips, swatches), `--r-s: 10px` (buttons, inputs, pills' inner dot), `--r-m: 16px` (cards,
  notes), `--r-l: 24px` (the stage, the player, the hero's figure panel), `--r-full: 999px` (pills, timer).
- Elevation is almost all hairline. Three levels:
  - flat: `border: 1px solid var(--hair)`.
  - raised (a card on a band, a hovered card): hairline plus `box-shadow: 0 1px 2px rgba(21, 19, 28, 0.04), 0 8px 24px rgba(21, 19, 28, 0.05)`; on dark, `0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.35)`.
  - floating (a badge or timer over video): `background: var(--stage-scrim); border: 1px solid rgba(255,255,255,0.08); backdrop-filter: blur(8px)`.
  - lit (dark theme only, the live stage and the score): `box-shadow: 0 0 0 1px var(--accent), 0 0 32px var(--glow)`.

### The runway rule

The one motif that repeats everywhere. Any rule that separates sections is:

```css
.rw-rule { height: 1px; background: linear-gradient(90deg, var(--accent) 0 40px, var(--hair) 40px); }
```

Breakdown heads, points heads, page heads, the footer top and the home section titles use it. Hairlines inside
lists stay plain `--hair`. Do not put the accent segment on every row; it marks a start, like the start mark on a
floor.

## 5. Iconography and art

- No icon font, no emoji. Inline SVG on a 20 px grid, 1.5 px stroke, round caps and joins, `currentColor`,
  `aria-hidden="true"` next to a visible word. Icons accompany words; they never replace them. The set: play, pause,
  camera, rotate, download, check, chevron, clap, close, upload. Draw them in `src/ui/icons.mjs` as a map of
  path strings.
- Art is drawn in code, in the product's own projection: the hero scene (`scene.mjs`), the skeleton thumbnails,
  the stills. No stock, no illustration packs. Decorative art is `aria-hidden`; informational art has a real `alt`
  or `aria-label` (the hero canvas already has one).
- The skeleton is the logo. Bones `--stage-accent`, joints `--stage-ink`, 3 px on a stage, 2 px as a thumbnail,
  1.5 px as the favicon. A single standing figure drawn this way can serve as the empty-state mark.
- The Annontrix credit stays as it is: the fox at 28 px, "Made by Annontrix" in `--t-small` `--ink-3`, in the
  footer, after a runway rule. Subtle; it is a credit, not a logo lockup.

## 6. Motion

Principles: things move along lines (like the walker along the runway), light fades in and out, nothing bounces,
nothing slides sideways, nothing loops except the recording dot and the countdown ring. Motion carries meaning:
a bar fills because a number was measured; the score counts because it is being added up.

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Everything that enters or settles. |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Crossfades and state swaps. |
| `--ease-line` | `cubic-bezier(0.4, 0, 0.2, 1)` | Progress, bars, ribbon playhead. |
| `--d-micro` | `120ms` | Colour on hover, focus ring. |
| `--d-short` | `200ms` | Buttons, toggles, chips, prompt text swap. |
| `--d-medium` | `320ms` | Details open, cards raise, screen enter. |
| `--d-long` | `560ms` | Scroll reveals, bar fills. |
| `--d-score` | `1100ms` | The score count-up. |

Exact behaviours:

- **Screen enter.** On mount, `main > *` fades from `opacity: 0; translateY(8px)` to rest over `--d-medium`
  `--ease-out`, staggered 40 ms for the first six children. One keyframe, applied by a class the router adds.
- **Scroll reveal (home only).** `IntersectionObserver` at threshold 0.15, once. Reveal: `opacity 0→1`,
  `translateY(16px)→0`, `--d-long` `--ease-out`, children of a grid staggered 60 ms. Bars inside a revealed
  section fill 120 ms after the reveal starts. Nothing reveals on the studio, result, wall or history pages: those
  are tools, they are just there.
- **Buttons.** `background-color, color, border-color` over `--d-short`; `:active` scales to 0.98 over 100 ms;
  focus ring appears in `--d-micro`.
- **Bars.** `.rw-bar__fill` width from 0 to its value over `--d-long` `--ease-line`, delayed 80 ms per bar in a
  group. Width is set inline by the code, so animate with a `transform: scaleX()` from a `data-fill` or with a
  `@starting-style` width transition; keep the inline width as the source of truth.
- **The score count-up.** `--d-score`, quart-out (`1 - (1 - p) ** 4`), tabular so the width never jitters, then
  the grade label fades in over `--d-short` and the verdict 120 ms after. The existing 900 ms cubic in `review.mjs`
  becomes 1100 ms quart. On dark the `--glow` behind the number fades in with it.
- **Countdown.** Each digit enters at `scale(1.12)` and `opacity 0.6`, settles over `--d-medium`; a 2 px
  `conic-gradient` ring around the stage drains over the full 3 s with `--ease-line`.
- **Stage prompt.** Text swaps are a 200 ms crossfade (`--ease-in-out`); the urgent state tints the prompt band to
  the accent over `--d-short`. No bouncing text.
- **Recording.** The timer's dot pulses `opacity 1→0.35→1` over 1.2 s, linear. The only loop in the product.
- **Ribbon playhead.** A 2 px `--ink` line moves with `--ease-line` between frames, no transition during drag.
- **Cards.** Hover raises by `translateY(-2px)` and switches to the raised shadow over `--d-short`.
- **Page change** from the top nav: no transition beyond the screen enter; the hash router already scrolls to top.

`prefers-reduced-motion: reduce`: every transform is removed, every opacity transition is at most 150 ms, the
score shows its final value at once (the code already checks `reducedMotion()`), bars render full, the countdown
ring is replaced by the digit alone, the recording dot stays solid. The scene canvas keeps moving (it is the content,
not decoration) but drops its sweep and sparkle layers.

## 7. The screens

### Hero (home)

The canvas scene stays: it is the signature and it uses the real projection. Changes:

- The headline is three lines, `--t-display`, "Get judged." in `--stage-accent`; the kicker above it in
  `--t-eyebrow` `--stage-accent`; the lede in `--t-lede` at 86% white; the two buttons (solid = `--stage-accent`
  with `--stage` text, secondary = 1px rgba white 0.5).
- The callouts become a **readout column**: right-aligned on the right third of the hero, `--t-caption` label over a
  `--t-num` value, each with a 1 px leader line that ends in a 4 px dot on the figure's joint. They never overlap
  the figure's silhouette; the column sits in the dark beside the runway. On phone, the readouts are a single row
  of four chips under the picture, and the figure is framed from the waist up.
- The scrim is darker at the left for the text (as now) and sharper at the top for the nav; the bottom edge of the
  hero fades to `--bg` over the last 96 px so the page begins without a hard line.
- Caption bottom-right, `--t-caption` italic.

### Home sections

- Section titles `--t-title` with a runway rule above them and the eyebrow (e.g. "Scoring") in accent.
- "How it works": three columns, the numerals `--t-num-xl` in accent as marks on the floor (a short accent rule
  under each numeral rather than a long rule over the column).
- "Most of your score is measured": the split bar becomes one runway line, measured in accent and opinion in ink,
  with the two numbers set `--t-num-xl` beneath. The points list keeps the number-left layout; its bars use the bar
  vocabulary (6 px track, 2 px end tick).
- "Checked against real walks": the figure panel is `--surface` with a hairline, the dots keep their meaning
  (filled accent = pros, hollow ink-2 = everyone), the earned zone is `--data-tint` with a 1 px accent end tick at
  "full marks". The track is 6 px and `--band`.
- The fairness band is the stage: `--stage` background with `--stage-ink`, accent rules, `--r-l` corners inside the
  gutter on desktop (not full bleed), full bleed on phone.
- Saved walks rows and the privacy note as now, restyled with the tokens.

### The camera stage (studio)

- `.rw-stage` radius `--r-l`, background `--stage`, inset ring `0 0 0 1px rgba(255,255,255,0.06)`.
- Phase ring on the stage, driven by the existing `data-phase`: `live` = hairline; `countdown` = 2 px accent ring plus
  the draining conic ring; `recording` = 2 px `--rec` ring and the timer top-right as a floating pill with the
  pulsing dot; `take` = none. On dark, `live` and `recording` get the lit shadow.
- The prompt (`.rw-stage__prompt`) stays bottom-centred and large so it reads from six metres: `--t-title` weight 700
  on a band of `--stage-scrim` with a 1 px top hairline, not a full-height gradient. Urgent (`data-urgent="true"`) tints
  the band to the accent at 90% with `--on-accent` text.
- The countdown digit is `--t-score` scaled by 2 at 1440 and 1.3 on phone, centred, with a soft `--glow` behind.
- The flow (`.rw-flow`) becomes the **runway track**: one hairline across, with a mark for each step on it (`.rw-flow__dot`:
  done = ink with a check, current = accent 28 px with `--on-accent` number, upcoming = `--surface` with hairline), and the
  label under each mark in `--t-caption`. The `li`, `is-done` and `aria-current="step"` hooks stay.
- The primary action is centred under the track, `--btn-big`. On phone it sits in a sticky bottom bar with a
  `--stage-scrim`-style backdrop while the phase is live, countdown or recording.
- The options strip (stop by itself, laps, consent) is a two-column grid between runway rules; the three panels
  (setup, camera, music) and the upload panel are plain columns with `--t-h2` heads and runway rules, no cards.
  The fps readout (`.rw-fps`) uses `--t-caption` labels over `--t-num` values.

### The score (result)

- Summary column, in order: eyebrow ("Your score" / "Measured so far"), the number (`--t-score`, ink on light, accent on
  dark with `--glow`), the `/100` as a caption at the baseline, the grade in `--t-h2` accent, the verdict as a
  `--t-lede` 500 quote with a 2 px accent left rule, then the stacked facts (closest walk, laps, strongest part, the
  judge suggests) separated by hairlines with `--t-eyebrow` labels in `--ink-3`.
- The analysis progress (`.rw-progress`) and judging progress (`.rw-judging`): a 6 px track in `--band`, accent fill,
  the stage label `--t-h2`, the percent `--t-num` accent, the time left `--t-caption`. Replace the native `<progress>`
  styling with `accent-color` plus a custom track where supported; keep the element.
- The name input (`.rw-name`) stays a bare underline field, `--t-title` size; underline `--hair` at rest,
  `--ink-2` on hover, accent on focus.
- The player: `--r-l`, stage black, floating badge top-left, controls in a row beneath with the range input using
  `accent-color`. The ribbon (`.rw-ribbon`): 40 px, `--band` track, segments `toward` = accent with `--on-accent`
  text, `turn` = ink with `--bg` text, `back` = `--data-tint` with a hairline; 2 px `--bg` gaps; a 2 px ink
  playhead. The key under it uses 14 × 10 px swatches of the same three fills.

### Data visualisations

One vocabulary, used by the home points list, the proof chart, the breakdown bars, the stats and the metrics:

- **Track**: 6 px, `--band`, `--r-xs`. **Fill**: `--data-measured` or `--data-opinion`, same radius, with a 2 px
  `--ink` end tick (`::after`) so a full bar still shows where it ends. **Not seen**: the track hatched
  (`repeating-linear-gradient(135deg, var(--hair) 0 2px, transparent 2px 6px)`) and "Not seen" in `--warn`.
- **Bar head**: label `--t-h3` left, number `--t-num` right, both on one baseline; the note `--t-small` `--ink-2`;
  "Why this score" a `--t-small` 500 accent summary with a chevron.
- **Stats** (`.rw-stats`, wall): a row of tiles separated by hairlines, label `--t-caption`, value `--t-num-xl`,
  "None yet" in `--ink-3` at `--t-h2`.
- **Metrics** (`.rw-metric`): `--surface` cards, hairline, `--r-m`; label `--t-caption`, value `--t-num-xl` with the
  unit as a caption; under the value a 4 px scale showing the typical value as a tick where the data gives one.
- **Dots** (home proof): 14 px filled accent for pros, 14 px hollow 2 px `--ink-2` for everyone, values in
  `--t-caption` 600 above and below, the earned zone `--data-tint` ending with a 1 px accent tick.

### The wall and saved walks

- Page head: `--t-title`, lede `--t-lede`, the primary action right-aligned on desktop and full-width under the lede
  on phone. Toolbar selects are `--surface` with `--hair-strong` borders.
- Wall cards: `--surface`, hairline, `--r-m`; the thumbnail area is the stage (`--stage` with the skeleton in
  `--stage-accent`), the rank as `--t-num-xl` `--stage-ink` at 60% in the corner; body with name `--t-h3`, score
  `--t-num-xl`, match in accent 500, verdict `--t-small` `--ink-2`; foot with date caption and the clap chip.
- Saved walk rows: `--surface`, hairline, `--r-m`, score `--t-num-xl` right; hover raises.
- Empty states: dashed `--hair-strong` border, `--r-m`, a standing skeleton mark (48 px) above the `--t-h2` title.

## 8. Do and don't

Do:

- Use the token names. Add a token when a value is needed twice; never a raw hex in a screen's CSS.
- Keep every test hook: the classes and ids listed in the brief (`.rw-stage`, `.rw-stage__prompt`, `.rw-stage__video`,
  `.rw-name`, `.rw-pill`, `.rw-progress`, `.rw-score__num`, `.rw-breakdown`, `.rw-bar`, `.rw-why`, `.rw-still`,
  `.rw-moments`, `.rw-ribbon__seg`, `.rw-metric`, `.rw-fps`, `#rw-upload`, `#rw-laps`, `#rw-music`, `#rw-root`,
  `.rw-player__video`, `[role=status]`, and the others `test/e2e.mjs` queries) and every visible string the tests read.
- Keep the primary button ink, the accent for hover, current and measured.
- Keep hairlines doing the structural work; add a card only where something is an object (a walk, a metric).
- Put the accent segment at the start of a rule, not on every rule.
- Set every number tabular and every unit smaller and lighter.
- Build both themes at once; check each change in dark. Check 390 px before calling anything done.
- Give every interactive thing a visible focus ring (2 px accent, 3 px offset; `--stage-ink` on the stage).
- Animate opacity and transform only, and honour `prefers-reduced-motion`.

Don't:

- No second accent, no rainbow data colours, no coloured status fills, no green or red bars.
- No purple gradients, no glass panels on the light theme, no big drop shadows, no blur on paper.
- No uppercase tracked labels, no monospace outside raw data, no serif, no display face: it is Be Vietnam Pro alone.
- No reskinning as Annontrix: no cream `#F7F3EC` page, no rust, no numbered-section editorial language.
- No SaaS blue, no Tailwind indigo `#4F46E5`, no `#6C5CE7`.
- No full-height gradient over the live video; a band is enough and the walker stays visible.
- No scroll-jacking, no parallax, no sliding carousels, no auto-playing anything but the hero scene.
- No icon without a word beside it, no emoji, no icon fonts, no external images.
- No new fonts, no CDN links, no inline `style` colours.

## 9. Tokens, ready to paste

Replace the current `:root` and the dark `@media` block at the top of `src/styles.css` with this. The dark block
is written three ways so an explicit `data-theme` can override the system setting later without new CSS.

```css
:root {
  color-scheme: light dark;

  /* colour: house lights up */
  --bg: #F4F3F6;
  --surface: #FFFFFF;
  --band: #EBE9F0;
  --ink: #15131C;
  --ink-2: #4E4A5C;
  --ink-3: #66627A;
  --hair: #DDD9E3;
  --hair-strong: #B9B3C6;
  --accent: #4E38B5;
  --on-accent: #FFFFFF;
  --accent-soft: #E4DFF6;
  --glow: rgba(120, 96, 255, 0.35);
  --ok: #1E7A4C;
  --warn: #8A5300;
  --err: #B3261E;
  --rec: #E5484D;

  /* the stage, in both themes */
  --stage: #0B0A10;
  --stage-ink: #F3F0FA;
  --stage-accent: #B3A1FF;
  --stage-scrim: rgba(11, 10, 16, 0.78);

  /* data */
  --data-measured: var(--accent);
  --data-opinion: var(--ink);
  --data-tint: var(--accent-soft);
  --data-none: repeating-linear-gradient(135deg, var(--hair) 0 2px, transparent 2px 6px);

  /* elevation */
  --shadow-raised: 0 1px 2px rgba(21, 19, 28, 0.04), 0 8px 24px rgba(21, 19, 28, 0.05);
  --shadow-lit: none;
  --ring-focus: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);

  /* type */
  --font: 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --t-display: clamp(3.25rem, 1.5rem + 5.4vw, 6.75rem);
  --t-score: clamp(5.5rem, 3rem + 9vw, 9.5rem);
  --t-title: clamp(2.25rem, 1.5rem + 2.4vw, 3.5rem);
  --t-h2: clamp(1.5rem, 1.25rem + 0.8vw, 1.875rem);
  --t-h3: 1.125rem;
  --t-lede: clamp(1.125rem, 1rem + 0.5vw, 1.375rem);
  --t-body: clamp(1rem, 0.96rem + 0.2vw, 1.0625rem);
  --t-small: 0.9375rem;
  --t-caption: 0.8125rem;
  --t-eyebrow: 0.875rem;
  --t-num-xl: clamp(2rem, 1.5rem + 1.6vw, 2.75rem);
  --t-num: 1.25rem;
  --t-mono: 0.875rem;
  --track-display: -0.045em;
  --track-title: -0.035em;
  --track-h2: -0.02em;
  --track-num: -0.03em;
  --measure: 62ch;

  /* space and shape */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px; --s-7: 48px; --s-8: 64px; --s-9: 96px; --s-10: 128px;
  --space-section: clamp(64px, 24px + 6vw, 128px);
  --space-block: clamp(32px, 16px + 3vw, 64px);
  --container: 1280px;
  --gutter: clamp(16px, 4vw, 48px);
  --gap: clamp(16px, 2.4vw, 32px);
  --r-xs: 6px; --r-s: 10px; --r-m: 16px; --r-l: 24px; --r-full: 999px;
  --rule: linear-gradient(90deg, var(--accent) 0 40px, var(--hair) 40px);

  /* motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-line: cubic-bezier(0.4, 0, 0.2, 1);
  --d-micro: 120ms; --d-short: 200ms; --d-medium: 320ms; --d-long: 560ms; --d-score: 1100ms;
}

/* house lights down */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0E0C14;
    --surface: #16131E;
    --band: #1E1A29;
    --ink: #F3F0FA;
    --ink-2: #B4AEC4;
    --ink-3: #8A849C;
    --hair: #2A2537;
    --hair-strong: #3E3850;
    --accent: #B3A1FF;
    --on-accent: #0E0C14;
    --accent-soft: #2A2448;
    --glow: rgba(179, 161, 255, 0.28);
    --ok: #6FCF9B;
    --warn: #E8B35A;
    --err: #FF8A80;
    --rec: #FF5C5C;
    --data-tint: rgba(179, 161, 255, 0.18);
    --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
    --shadow-lit: 0 0 0 1px var(--accent), 0 0 32px var(--glow);
  }
}
:root[data-theme='dark'] {
  --bg: #0E0C14;
  --surface: #16131E;
  --band: #1E1A29;
  --ink: #F3F0FA;
  --ink-2: #B4AEC4;
  --ink-3: #8A849C;
  --hair: #2A2537;
  --hair-strong: #3E3850;
  --accent: #B3A1FF;
  --on-accent: #0E0C14;
  --accent-soft: #2A2448;
  --glow: rgba(179, 161, 255, 0.28);
  --ok: #6FCF9B;
  --warn: #E8B35A;
  --err: #FF8A80;
  --rec: #FF5C5C;
  --data-tint: rgba(179, 161, 255, 0.18);
  --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-lit: 0 0 0 1px var(--accent), 0 0 32px var(--glow);
}

@media (prefers-reduced-motion: reduce) {
  :root { --d-micro: 0ms; --d-short: 0ms; --d-medium: 120ms; --d-long: 150ms; --d-score: 0ms; }
}
```

Base rules that follow from the tokens:

```css
body { background: var(--bg); color: var(--ink); font: 400 var(--t-body) / 1.6 var(--font); -webkit-font-smoothing: antialiased; }
h1, .rw-section__title { font-size: var(--t-title); font-weight: 700; line-height: 1.04; letter-spacing: var(--track-title); }
h2 { font-size: var(--t-h2); font-weight: 600; line-height: 1.2; letter-spacing: var(--track-h2); }
h3 { font-size: var(--t-h3); font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; }
:focus-visible { outline: none; box-shadow: var(--ring-focus); border-radius: var(--r-s); }
.rw-rule, .rw-breakdown__head, .rw-points__head, .rw-pagehead { border: 0; background-image: var(--rule); background-repeat: no-repeat; background-size: 100% 1px; background-position: bottom; }
.rw-num { font-variant-numeric: tabular-nums; font-weight: 700; letter-spacing: var(--track-num); }
.rw-unit { font-size: var(--t-caption); font-weight: 400; color: var(--ink-3); letter-spacing: 0; margin-left: 0.15em; }
.rw-bar__track { height: 6px; background: var(--band); border-radius: var(--r-xs); overflow: hidden; }
.rw-bar__fill { position: relative; height: 100%; background: var(--data-measured); border-radius: var(--r-xs); transition: width var(--d-long) var(--ease-line); }
.rw-bar__fill::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px; background: var(--ink); }
.rw-bar--opinion .rw-bar__fill { background: var(--data-opinion); }
.rw-bar--none .rw-bar__track { background: var(--data-none); }
.rw-stage[data-phase='countdown'] { box-shadow: 0 0 0 2px var(--accent), var(--shadow-lit); }
.rw-stage[data-phase='recording'] { box-shadow: 0 0 0 2px var(--rec), var(--shadow-lit); }
.rw-stage[data-urgent='true'] .rw-stage__prompt { background: color-mix(in srgb, var(--accent) 90%, transparent); color: var(--on-accent); }
```

## 10. What each page agent must check before handing back

1. Both themes, 1440 and 390, through `shots.mjs`; look at the PNGs, do not assume.
2. No horizontal scroll at 360 px (`document.documentElement.scrollWidth === innerWidth`).
3. `npm test` and `npm run e2e` still pass; the hooks and strings in the brief are untouched.
4. Every text/background pair in this document is at least 4.5:1 (the tables above were checked by hand; if a new
   pair is introduced, check it).
5. Tab through the page once: every control shows the focus ring, the stage prompt is announced through the
   existing `[role=status]`, decorative SVG is `aria-hidden`.
6. `prefers-reduced-motion: reduce` in DevTools: nothing moves except the hero scene and the video.
