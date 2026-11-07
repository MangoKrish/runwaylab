# RunwayLab redesign: build spec

Lead design spec, 7 November 2026 (demos Sunday 8 November 2026). This document merges `ux.md` (what goes where and
why), `direction.md` (the "Lit line" visual system) and `art.md` (the drawn files in `src/art/`) into one build that
four people implement in parallel. Where the three disagree, this document decides, and it wins. When this spec is
silent, follow `direction.md`, then `ux.md`.

The stylesheet before the redesign is in git history.

## Contents

0. Decisions that settle conflicts
1. Tokens: colour, type, space, shape, elevation, motion
2. Shared components (class names, states)
3. Screens
   3.1 Shell: header, footer, screen enter
   3.2 Home
   3.3 Studio
   3.4 Results (review and sample)
   3.5 Saved walks
   3.6 The wall and a wall post
4. Copy changes (and the strings that must not change)
5. File ownership, order of work, hand-off rules
6. Done means

---

## 0. Decisions that settle conflicts

| Question | Inputs said | Decision |
|---|---|---|
| Palette | ux: unspecified. direction: chalk `#F4F3F6` / stage `#0E0C14`, accent `#4E38B5` / `#B3A1FF`. | Direction's palette, exactly. No cream anywhere (that is Annontrix). |
| Focus ring | direction: 2 px ring, 3 px offset (box-shadow). ux and brief: 3 px accent. | `outline: 3px solid var(--focus); outline-offset: 2px`. Outline, not box-shadow, so it survives `overflow:hidden` parents and follows radius. `--focus` is `--accent` on paper and `--stage-ink` on the stage and dark bands. |
| Icons | direction: new `src/ui/icons.mjs`. art: sprite `src/art/icons.svg` + `icon()` in `src/art/inline.mjs`. | Art's sprite is the only icon source. No `icons.mjs`. FOUNDATION adds the missing symbols to the sprite (section 2.14). Display size 20 px. |
| Opinion colour | direction: `--data-opinion` = ink. ux: "a second neutral colour". | Ink. Same thing. Measured = accent, opinion = ink, everywhere (home split, home points, breakdown, ribbon turn). |
| Stage prompt size | direction: `--t-title` on a band. ux: 32 to 72 px. | New token `--t-prompt: clamp(2rem, 1rem + 3.6vw, 4.5rem)` on a scrim band (not a full-height gradient). |
| Countdown digit | direction: `--t-score` x2. ux: about 45% of stage height. | `font-size: min(45cqh, 22rem)` using a container query unit on `.rw-stage` (`container-type: size` is not possible with aspect-ratio sizing, so use `container-type: inline-size` and `min(34cqw, 22rem)`, which is ~45% of a 4:3 stage). |
| Hero picture | art: `hero.svg` can replace the canvas. direction: keep the live canvas. | The `scene.mjs` canvas stays: it is live, uses the real projection and its numbers come from the real code. `hero.svg` is not used on home. Text callouts move out of the canvas into a DOM readout column (crisper, accessible); the canvas keeps the joint markers and draws leader lines. |
| Camera-off stage | ux: a drawn runway with the button on the stage. | `empty-walks.svg`, inlined with stage colours, fills the stage while the camera is off or waiting; "Turn on camera" sits centred on the stage. |
| Studio layout | ux: 62/38 with sticky rail. direction: 4/4/4 panels, no cards. | ux's layout. Main column + 380 px sticky rail card "Before you walk"; Camera, Music, Upload become three quiet cards below. Cards here are justified: each is a separate object the walker configures. |
| Results phone order | ux: score first via CSS order. | Yes: CSS `order` only; DOM order is unchanged. |
| Insight facts | direction: stacked facts with hairlines. ux: 2x2 tiles. | 2x2 tiles on desktop (`.rw-tiles`), one column under 520 px. Tiles are hairline-bordered, not filled. |
| Where Walk again lives | ux: head and Keep it and a phone sticky bar. | One element. In the head row on desktop; the same element becomes a sticky bottom bar under 760 px. Save / Save changes / Delete move to the Keep it card. |
| Scroll reveals | direction: home only. ux: home sections fade-rise 12 px. | Home only, 16 px, once. Tools (studio, results, wall, history) do not reveal; they get the screen-enter fade only. |
| Header | ux: one row on phone, New walk as primary. | One row at every width. `New walk` is a small ink pill on every route except the studio, where it is the current link with the accent underline. Header is not sticky. |
| Fairness band | direction: stage colours, rounded inside the gutter on desktop, full bleed on phone. | As direction. |
| Fox credit | keep subtle. | Footer, after a runway rule, 24 px fox, `--t-caption` `--ink-3`. Nothing else in the footer except one line on the right: "Built for HackTrent 2026". |

---

## 1. Tokens

FOUNDATION pastes this at the top of `src/styles.css`, replacing the current `:root` and dark block. Page CSS uses
these names only: no raw hex, no raw `font-size`, no raw durations in `src/css/*.css`. The only exceptions are
`scene.mjs`, `overlay.mjs` and canvas drawing in `player.mjs` / `parts.mjs`, which keep their stage colours.

```css
:root {
  color-scheme: light dark;

  /* colour: house lights up */
  --bg: #F4F3F6;
  --surface: #FFFFFF;
  --band: #EBE9F0;
  --ink: #15131C;
  --ink-2: #4E4A5C;
  --ink-3: #66627A;          /* only on --bg and --surface, never on --band; min 13 px */
  --hair: #DDD9E3;
  --hair-strong: #B9B3C6;
  --accent: #4E38B5;
  --accent-hover: #3F2C9C;   /* links on hover, pressed solid buttons */
  --on-accent: #FFFFFF;
  --accent-soft: #E4DFF6;
  --glow: rgba(120, 96, 255, 0.35);
  --ok: #1E7A4C;
  --warn: #8A5300;
  --err: #B3261E;
  --err-soft: #FBEAE8;       /* the error panel's tint, the one allowed status fill */
  --rec: #E5484D;
  --focus: var(--accent);

  /* the stage, in both themes */
  --stage: #0B0A10;
  --stage-2: #15111E;        /* the hero floor, wall card stage gradient end */
  --stage-ink: #F3F0FA;
  --stage-ink-2: rgba(243, 240, 250, 0.78);
  --stage-hair: rgba(255, 255, 255, 0.10);
  --stage-accent: #B3A1FF;
  --stage-scrim: rgba(11, 10, 16, 0.78);

  /* data */
  --data-measured: var(--accent);
  --data-opinion: var(--ink);
  --data-tint: var(--accent-soft);
  --data-none: repeating-linear-gradient(135deg, var(--hair-strong) 0 1.5px, transparent 1.5px 6px);

  /* elevation */
  --shadow-raised: 0 1px 2px rgba(21, 19, 28, 0.04), 0 8px 24px rgba(21, 19, 28, 0.06);
  --shadow-float: 0 12px 40px rgba(21, 19, 28, 0.16);
  --shadow-lit: none;

  /* type */
  --font: 'Be Vietnam Pro', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --t-display: clamp(3.25rem, 1.5rem + 5.4vw, 6.75rem);
  --t-score: clamp(5.5rem, 3rem + 9vw, 9.5rem);
  --t-prompt: clamp(2rem, 1rem + 3.6vw, 4.5rem);
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
  --track-score: -0.06em;
  --track-title: -0.035em;
  --track-h2: -0.02em;
  --track-num: -0.03em;
  --measure: 62ch;
  --measure-lede: 44ch;

  /* space and shape */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 24px; --s-6: 32px;
  --s-7: 48px; --s-8: 64px; --s-9: 96px; --s-10: 128px;
  --space-section: clamp(64px, 24px + 6vw, 128px);
  --space-block: clamp(32px, 16px + 3vw, 64px);
  --container: 1280px;
  --gutter: clamp(16px, 4vw, 48px);
  --gap: clamp(16px, 2.4vw, 32px);
  --r-xs: 6px; --r-s: 10px; --r-m: 16px; --r-l: 24px; --r-full: 999px;
  --rule: linear-gradient(90deg, var(--accent) 0 40px, var(--hair) 40px);
  --tap: 44px;

  /* motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --ease-line: cubic-bezier(0.4, 0, 0.2, 1);
  --d-micro: 120ms; --d-short: 200ms; --d-medium: 320ms; --d-long: 560ms; --d-score: 1100ms;
  --stagger: 40ms;
}

/* house lights down: write the block twice (system setting, and explicit data-theme) */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0E0C14; --surface: #16131E; --band: #1E1A29;
    --ink: #F3F0FA; --ink-2: #B4AEC4; --ink-3: #8A849C;
    --hair: #2A2537; --hair-strong: #3E3850;
    --accent: #B3A1FF; --accent-hover: #CBBEFF; --on-accent: #0E0C14; --accent-soft: #2A2448;
    --glow: rgba(179, 161, 255, 0.28);
    --ok: #6FCF9B; --warn: #E8B35A; --err: #FF8A80; --err-soft: #2B1719; --rec: #FF5C5C;
    --data-tint: rgba(179, 161, 255, 0.18);
    --shadow-raised: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
    --shadow-float: 0 12px 40px rgba(0, 0, 0, 0.5);
    --shadow-lit: 0 0 0 1px var(--accent), 0 0 32px var(--glow);
  }
}
:root[data-theme='dark'] { /* identical values to the block above */ }

@media (prefers-reduced-motion: reduce) {
  :root { --d-micro: 0ms; --d-short: 0ms; --d-medium: 120ms; --d-long: 150ms; --d-score: 0ms; --stagger: 0ms; }
}
```

Contrast (all checked by direction.md's script, at least 4.75:1): every `--ink*` on `--bg` and `--surface`, `--accent`
on `--bg`/`--surface`, `--on-accent` on `--accent`, status colours on `--bg`/`--surface`, `--err` on `--err-soft`
(light 5.6:1, dark 7.9:1), `--stage-ink-2` on `--stage` (12:1). Any new pair: check it before using it.

### 1.1 Type roles

One family, Be Vietnam Pro 400/500/600/700 (and 400 italic). Weight carries hierarchy, colour carries status.

| Role | Token | Weight | Line height | Tracking | Colour |
|---|---|---|---|---|---|
| Hero headline | `--t-display` | 700 | 0.96 | `--track-display` | stage-ink, last line stage-accent |
| Score, countdown | `--t-score` | 700 | 0.9 | `--track-score` | ink (light), accent + glow (dark) |
| Stage prompt | `--t-prompt` | 700 | 1.05 | -0.03em | stage-ink |
| Page / section title (`h1`, `.rw-title`) | `--t-title` | 700 | 1.04 | `--track-title` | ink |
| `h2`, empty-state title | `--t-h2` | 600 | 1.2 | `--track-h2` | ink |
| `h3`, bar labels, card heads | `--t-h3` | 600 | 1.3 | -0.01em | ink |
| Lede, verdict | `--t-lede` | 400 (verdict 500) | 1.5 | 0 | ink-2 |
| Body | `--t-body` | 400 | 1.6 | 0 | ink |
| Small (notes, checklists, legends) | `--t-small` | 400 | 1.5 | 0 | ink-2 |
| Caption (units, meta, dates) | `--t-caption` | 500 | 1.4 | 0.01em | ink-3 |
| Eyebrow | `--t-eyebrow` | 600 | 1.3 | 0 | accent (light and dark) |
| Big number | `--t-num-xl` | 700 | 1.1 | `--track-num` | ink |
| Number | `--t-num` | 600 | 1.2 | -0.01em | ink |
| Raw data (numbers disclosure only) | `--t-mono` + `--font-mono` | 400 | 1.5 | 0 | ink-2 |

Rules: `font-variant-numeric: tabular-nums` on `body` (globally; it costs nothing in this face). Units and maxima
(`/100`, `/70`, `fps`, `% of height`, `°` labels) are `.rw-unit`. Sentence case everywhere. No uppercase, no
letter-spaced micro labels, no mono labels. Prose `max-width: var(--measure)`, ledes `var(--measure-lede)`.

### 1.2 Layout

- `.rw-app` keeps its role (container + gutter): `max-width: calc(var(--container) + 2 * var(--gutter)); padding-inline: var(--gutter)`.
- Full-bleed bands use the existing `width: 100vw; margin-left: calc(50% - 50vw)` trick. `html { overflow-x: clip }` stays.
- Breakpoints, used by everyone, no others: `1000px` (two columns collapse to one), `760px` (phone layout: sticky bars, one-line tracker, score-first), `520px` (2x2 tiles and 2-up grids go 1-up).
- Grid splits: home score guide 5/7, home proof 5/7, results 7/5 (media / summary), results analysis 7/5, studio `minmax(0,1fr) 380px`, wall `repeat(auto-fill, minmax(300px, 1fr))`.
- Tap targets at least `--tap` (44 px) on every control at every width.

### 1.3 Motion (exact)

| Motion | Spec | Owner |
|---|---|---|
| Screen enter | `app.mjs` adds `rw-screen--enter` to `main` on each mount (remove, force reflow, add). `.rw-screen--enter > *` runs `rw-enter` (opacity 0 → 1, translateY 8px → 0) over `--d-medium` `--ease-out`, `animation-delay: calc(var(--i, 0) * var(--stagger))` for the first six children (`:nth-child(n)` sets `--i`). | FOUNDATION |
| Hover / press | Colour, background, border over `--d-short`; `:active { transform: scale(0.98) }` over 100 ms on `.rw-btn`. Focus ring has no transition. | FOUNDATION |
| Card raise | `.rw-card--link:hover`: `translateY(-2px)` + `--shadow-raised` over `--d-short` `--ease-out`. | FOUNDATION |
| Bar fill | `.rw-bar__fill`: `transform-origin: left; transition: transform var(--d-long) var(--ease-line)` and `@starting-style { .rw-bar__fill { transform: scaleX(0) } }`. The inline width stays the source of truth. Stagger with `transition-delay: calc(var(--i, 0) * 80ms)` where the page sets `--i`. | FOUNDATION (pages may set `--i`) |
| Scroll reveal | Home only. `[data-reveal]` elements start `opacity:0; translateY(16px)`; an IntersectionObserver (threshold 0.15, once) adds `.is-revealed`; transition `--d-long` `--ease-out`; grid children stagger 60 ms via `--i`. If `IntersectionObserver` is missing or reduced motion is on, add `.is-revealed` immediately. Content must be visible without JS: only apply the hidden start state under `.rw-js-reveal` set by home.mjs on its root. | HOME |
| Score count-up | 1100 ms quart-out `1 - (1 - p) ** 4` (replace the 900 ms cubic in `review.mjs`); grade fades in over `--d-short` after, verdict 120 ms later; on dark the glow behind the number fades in with it. Reduced motion: final value at once (keep the existing `reducedMotion()` check). | RESULTS |
| Countdown | Each digit: keyframe `scale(1.12), opacity .6 → scale(1), opacity 1` over `--d-medium` (re-trigger by toggling a class per digit). A 3 px conic ring around the stage drains over 3 s (`@property --sweep` animated 360deg → 0deg, `--ease-line`). Reduced motion: digit only, no ring. | STUDIO |
| Stage prompt | Text swap: 200 ms crossfade (`opacity`) `--ease-in-out`; urgent band tint over `--d-short`. | STUDIO |
| Recording dot | `opacity 1 → .35 → 1`, 1.2 s linear infinite. The only loop. Solid under reduced motion. | STUDIO |
| Judging card | 1 px accent border segment travelling around the card (conic `@property` sweep, 2.4 s linear). Static accent border under reduced motion. | RESULTS |
| Skeleton loading | `.rw-skel` shimmer (background-position over 1.4 s); flat `--band` under reduced motion. | FOUNDATION |
| Ribbon playhead | 2 px `--ink` line, `transition: left 120ms var(--ease-line)`, none while dragging. | RESULTS |
| Never | No bounce, no slide-in from the side, no parallax, no scroll-jacking, nothing moving on the stage while recording except the prompt and the dot. | all |

---

## 2. Shared components (FOUNDATION, in `src/styles.css`)

Page agents use these and do not restyle them in their own files except through the listed modifiers. If a page
needs a variant, it adds a page-scoped modifier in its own CSS (`.rw-studio .rw-btn--big {...}`), never edits the
shared rule.

### 2.1 Base

`body { background: var(--bg); color: var(--ink); font: 400 var(--t-body)/1.6 var(--font); font-variant-numeric: tabular-nums; -webkit-font-smoothing: antialiased; }`
Headings per 1.1. `a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px }`, hover
`--accent-hover`. `:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }` (no border-radius
hack). `::selection { background: var(--accent-soft) }`. Utilities kept: `.rw-sr`, `.rw-muted` (ink-2), `.rw-small`,
`.rw-accent`, `.rw-stack`, `.rw-skip` (visible on focus, `--surface`, `--shadow-float`, `--r-s`).

Stage scope: `.rw-on-stage` sets `--focus: var(--stage-ink); color: var(--stage-ink)` and is applied to the hero,
the stage, the player, the fairness band and the wall card thumbnails.

### 2.2 Text helpers

- `.rw-eyebrow`: `--t-eyebrow` 600 accent, margin-bottom `--s-3`.
- `.rw-title`: `--t-title` per 1.1 (also `.rw-section__title`, kept as an alias for home).
- `.rw-lede`: `--t-lede`, ink-2, `max-width: var(--measure-lede)`.
- `.rw-caption`: `--t-caption` 500 ink-3.
- `.rw-num`: tabular, 700, `--track-num`. `.rw-num--xl` uses `--t-num-xl`.
- `.rw-unit`: `--t-caption` 400 ink-3, `margin-left: 0.15em`, letter-spacing 0.
- `.rw-rule`: `height:1px; background: var(--rule)`; `.rw-ruled` puts the same rule on an element's top edge
  (`background: var(--rule) top / 100% 1px no-repeat; padding-top: var(--s-5)`).

### 2.3 Section header

```
.rw-sechead            grid, gap --s-3, max-width 62ch, margin-bottom --space-block; carries .rw-ruled
  .rw-eyebrow          "Scoring"
  h2.rw-title          "Most of your score is measured"
  p.rw-lede            optional
```
Variant `.rw-sechead--row`: title left, one action right (desktop), stacks under 760 px.

### 2.4 Buttons

Base `.rw-btn`: inline-flex, gap `--s-2`, `min-height: 48px`, padding `10px 20px`, `--r-s`, 600, `--t-body`,
`border: 1.5px solid var(--hair-strong)`, transparent background, ink text. Icon inside: 20 px, `currentColor`.

| Modifier | Rest | Hover | Disabled |
|---|---|---|---|
| (default, secondary) | hair-strong border, ink | border ink, background `--band` | opacity .5, `cursor: not-allowed`, no hover |
| `--solid` (primary) | background ink, text `--bg`, border ink | background accent, border accent, text on-accent | same |
| `--big` | `min-height: 56px`, padding `14px 28px`, `--t-h3` size | per kind | |
| `--small` | `min-height: var(--tap)`, padding `6px 14px`, 1 px hair border, 500, `--t-small` | border ink-2 | |
| `--quiet` | no border, ink-2, 500, underline offset 3 px | ink | |
| `--danger` (Delete) | quiet look, text `--err` | background `--err-soft` | |
| `--chip` | `min-height: 36px` (inside a 44 px hit area via padding-block on parent), padding `4px 12px`, `--r-full`, 1 px hair, accent text, tabular | background `--accent-soft` | |
| on stage (`.rw-on-stage .rw-btn`) | border `rgba(255,255,255,.4)`, stage-ink | background `rgba(255,255,255,.12)` | |
| on stage `--solid` | background stage-accent, text `--stage`, border stage-accent | background `#FFFFFF` | |

`:active { transform: scale(0.98) }`. `label.rw-btn` behaves the same (the upload button is a label).
`.rw-actions` (flex wrap, gap `--s-3`, margin-top `--s-5`), `--top` (no margin), `--center`, and new `--split`
(two equal half-width buttons under 760 px).

### 2.5 Pills and status chips

- `.rw-pill`: inline-flex, gap 6 px, `min-height: 28px`, padding `4px 12px`, `--r-full`, `--t-caption` 500,
  background `--band`, ink-2 (on band use ink-2, not ink-3). An 8 px dot (`::before`, currentColor) when modified:
  `--saved` (ok), `--temp` (warn; add the class when the walk is temporary), `--sample` (accent, no dot, quieter:
  border 1 px hair, transparent background).
- `.rw-status`: one line with an 8 px dot then text, `--t-small`. Modifiers `--ok`, `--warn`, `--err`, `--busy`
  (dot pulses like the recording dot but 1.6 s; solid under reduced motion). Used for the tracker line ("Tracking
  with ..."), wall/judge connection lines, upload status.

### 2.6 Cards and panels

- `.rw-card`: `--surface`, 1 px hair, `--r-m`, padding `clamp(20px, 2.4vw, 28px)`, grid gap `--s-4`.
- `.rw-card--quiet`: transparent background, hair border (studio camera/music/upload cards).
- `.rw-card--link`: whole card is a link; hover raises (1.3), border hair-strong.
- `.rw-card__head`: `h2` at `--t-h3` size + optional icon (20 px, accent dot shows) + optional right-aligned meta.
- `.rw-note`: `--band`, `--r-m`, padding `clamp(24px, 3vw, 40px)`; text inside uses ink and ink-2 only.
- `.rw-banner` (sample, local-test): `--band`, `--r-s`, padding `12px 16px`, `--t-small`, a 3 px accent bar on the
  left inside the radius (`box-shadow: inset 3px 0 0 var(--accent)`). One line where it fits.
- `.rw-error` (now a panel): grid `20px 1fr`, gap `--s-3`, padding `--s-4`, `--err-soft` background, `--r-s`,
  `--err` text 500, an alert icon in the first column (CSS mask from the sprite is not possible, so pages that show
  errors prepend `icon('alert')`; if they do not, the panel still reads fine). The recovery button follows inside
  `.rw-actions`.
- `.rw-empty`: dashed 1.5 px `--hair-strong`, `--r-m`, padding `clamp(40px, 6vw, 72px) 24px`, centred grid, gap
  `--s-3`. `.rw-empty__art` (the inlined `empty-walks.svg`, 240 to 320 px wide, or `figure.svg` 48 px) above
  `.rw-empty__title` (`--t-h2`). `.rw-empty--wide` spans a grid.

### 2.7 Form fields

- `.rw-field`: label above control, gap 6 px, label `--t-small` 600 ink. Help text `.rw-field__help`
  `--t-caption` 400 ink-3.
- `.rw-field--inline`: label left, control right, gap `--s-3`.
- `select, .rw-input`: `min-height: 48px`, padding `10px 14px`, 1.5 px `--hair-strong`, `--r-s`, `--surface`;
  hover border ink-2; focus: the global outline plus `border-color: var(--accent)`; disabled: `--band`, ink-3.
  Selects get a drawn chevron (`appearance: none` + inline SVG background as a `data:` URL in two colours, one per
  theme, allowed by the CSP `img-src data:`).
- `.rw-input--handle`: `@` icon inside at left (padding-left 40 px, icon absolutely placed by the page as
  `icon('socials')`).
- `.rw-check`: 22 px box with `accent-color: var(--accent)`, label text to the right, the whole row clickable,
  `min-height: var(--tap)`. `.rw-check--plain` (player skeleton toggle; test hook) stays inline and nowrap.
- `.rw-toggle-row`: a `.rw-check` laid out as a row with a bold title line and a small description line under it
  (used for "Stop by itself" and "Judge my walk").
- Range inputs: `accent-color: var(--accent)`, height 28 px.
- `.rw-upload__input` stays visually hidden; its focus shows the ring on the following label.

### 2.8 Progress bar (for `.rw-progress` and `.rw-judging`)

`progress` elements stay. Shared style for `progress.rw-meter` and every `progress` inside `.rw-progress` /
`.rw-judging`: `appearance: none; height: 6px; border: 0; border-radius: var(--r-xs); background: var(--band)`;
`::-webkit-progress-bar { background: var(--band) }`, `::-webkit-progress-value` and `::-moz-progress-bar
{ background: var(--accent); border-radius: var(--r-xs); transition: width var(--d-short) var(--ease-line) }`.

### 2.9 Data bars (the one vocabulary)

```
.rw-bar                         row; grid gap --s-2
  .rw-bar__head                 label left, number right, one baseline
    .rw-bar__label              --t-h3
    .rw-bar__num                --t-num, ink; "/max" part in .rw-unit
  .rw-bar__track                6 px, --band, --r-xs, overflow hidden
    .rw-bar__fill               --data-measured; ::after 2 px --ink end tick
  .rw-bar__note                 --t-small ink-2
```
Modifiers: `.rw-bar--opinion` (fill `--data-opinion`, end tick `--accent`), `.rw-bar--none` (track `--data-none`,
number replaced by "Not seen" in `--warn`). `.rw-bar--compact` (home points list: no head, 4 px track). The home
split bar, the home points bars, the breakdown bars, the metric scales and the wall measures all use these.

### 2.10 Chips and tiles

- `.rw-chip`: static (non-button) label, `--r-full`, 1 px hair, padding `2px 10px`, `--t-caption` 600, ink-2.
  `.rw-chip--ghost` (dashed border, accent text) is the "+?" after "Measured so far".
- `.rw-tiles`: grid, 2 columns (1 under 520 px), gap 1 px on a `--hair` background with `--r-m` overflow hidden,
  so tiles are separated by hairlines. `.rw-tile`: `--surface`, padding `--s-5`, grid gap `--s-2`; label
  `.rw-eyebrow` in ink-3 (`.rw-tile .rw-eyebrow { color: var(--ink-3) }`), value `--t-h3` or `--t-num-xl`, note
  `--t-small`.

### 2.11 Skeleton placeholders

`.rw-skel`: `--band` block, `--r-m`, shimmer per 1.3. `.rw-skel--card` (wall card height 360), `.rw-skel--row`
(saved walk row height 96), `.rw-skel--line` (16 px tall text line). Always `aria-hidden="true"`, with a separate
`.rw-sr` status line saying what is loading.

### 2.12 Header (`app.mjs`)

```
header.rw-top
  a.rw-brand              [mark.svg 28 px inlined via artSvg('mark.svg', { decorative: true })] "RunwayLab"
  nav.rw-top__nav         "New walk" (.rw-top__cta) · "The wall" · "Saved walks"
```
- One row at all widths: brand left, nav right, height 72 px (64 px under 760 px). Under 400 px the brand mark
  stays and the word "RunwayLab" stays; nav links shrink to `--t-small` with `gap: --s-4`.
- Links: 500, ink-2, `min-height: var(--tap)`, `aria-current="page"` = ink + 2 px accent underline 6 px below.
- `.rw-top__cta` ("New walk"): small solid pill (`--r-full`, ink background, `--bg` text, padding `8px 16px`),
  except when `aria-current="page"` (studio), where it is a plain current link.
- Home: header sits over the hero (existing `.rw-app[data-route='home'] .rw-top` absolute rule) with stage colours;
  the CTA pill becomes stage-accent with `--stage` text.
- The header is not sticky.

### 2.13 Footer (`app.mjs`)

```
footer.rw-foot          margin-top --space-block; .rw-ruled; flex, space-between, wrap; padding-block --s-6
  a.rw-foot__credit     fox 24 px + "Made by Annontrix", --t-caption ink-3, hover ink-2 + underline
  p.rw-foot__meta       "Built for HackTrent 2026", --t-caption ink-3
```
The fox keeps its own colours (it is a mark). On phone both lines stack left-aligned.

### 2.14 Icons

Use `icon(name)` from `src/art/inline.mjs`, shown at 20 px via `.rw-icon { width: 20px; height: 20px; flex: none }`.
Existing symbols: camera, walk, turn, score, judge, wall, download, socials. FOUNDATION adds to `src/art/icons.svg`
in the same style (24 grid, 1.75 stroke, round caps, one filled accent point, colours as attributes, no `--` inside
comments): `check`, `chevron` (down), `play`, `pause`, `close`, `upload`, `pencil`, `alert`, `device` (a phone
outline, for privacy and "On this device"), `clap`. Icons always sit beside a word and are `aria-hidden`.

### 2.15 Toast

`.rw-toast`: fixed, bottom `--s-5` centred (bottom `calc(--s-5 + 72px)` when a sticky phone bar is present: pages
set `body.has-sticky-bar` via their own container `:has()` rule), `--ink` background, `--bg` text, `--r-full`,
padding `10px 18px`, `--shadow-float`, `role="status"`. Enters with opacity + translateY(8px) over `--d-short`, stays
2.4 s, leaves over `--d-short`. FOUNDATION exports `toast(text)` from `dom.mjs`. Used for "Link copied" on a wall
post and "Saved on this device" after Save (in addition to the pill, which stays and stays tested).

### 2.16 New helpers in `src/ui/dom.mjs` (FOUNDATION ships these first, within the first few minutes)

```js
export function sectionHead({ eyebrow, title, lede, level = 'h2', id, action }) // -> div.rw-sechead[.rw-sechead--row]
export function num(value, unit)        // -> span.rw-num with optional span.rw-unit
export function toast(text)             // -> shows .rw-toast, returns nothing
export { icon, artSvg } from '../art/inline.mjs';  // re-export so screens import from one place
```
`button()` and `h()` keep their signatures. Page agents may define private helpers in their own files.

---

## 3. Screens

### 3.1 Shell

- `index.html`: add `<link rel="stylesheet" href="src/css/home.css">`, `studio.css`, `results.css` after
  `styles.css`; add `<meta name="theme-color" content="#F4F3F6" media="(prefers-color-scheme: light)">` and
  `#0E0C14` for dark; add `og:title`, `og:description`, `og:image` (`src/art/og.jpg`, width 1200, height 630) and
  `twitter:card` `summary_large_image`. Favicon unchanged. CSP unchanged.
- `#rw-boot` while loading: centred, `--t-small` ink-2, with a 1 px runway rule under it that fills (only animation
  before JS: none; keep it static).
- Screen enter per 1.3.

### 3.2 Home (HOME: `home.mjs`, `scene.mjs`, `css/home.css`)

Section order (top to bottom), each section after the hero has `data-reveal`:

1. **Hero** (`.rw-hero.rw-on-stage`, full bleed, `min-height: max(640px, min(100svh, 960px))`).
   - Desktop: 12-column inner grid. Left 6 columns: eyebrow "The AI runway judge" (stage-accent), `h1` three lines
     "Walk up. / Turn. / Get judged." (`--t-display`, last line stage-accent), lede (`--t-lede`, `--stage-ink-2`,
     max 34ch), actions: Start a walk (`--solid --big`), See a sample, See the wall (`--big`). Right 3 columns:
     **readout column** `dl.rw-hero__readouts` right-aligned, vertically centred: for each callout from
     `sceneCallouts()` a `dt` (`--t-caption` `--stage-ink-2`) over a `dd` (`--t-num` stage-ink, unit in
     `.rw-unit` at 70% stage-ink). Hairline `--stage-hair` between items. The canvas (`scene.mjs`) stops painting
     the text labels (add an option `labels: false`; keep the joint dots) and instead paints a 1 px leader
     (`rgba(243,240,250,.35)`) from each joint to the readout column's left edge, ending in a 4 px dot on the
     joint. `scene.mjs` gets the column's x from a new `setReadoutX(px)` method called on resize; when unknown it
     draws no leaders. If leaders prove fiddly, ship without them: the column alone is acceptable.
   - Scrim: left-to-right darkening for the text (as now), a top band for the header, and a bottom fade to `--bg`
     over the last 96 px (`linear-gradient(to bottom, transparent, var(--bg))` on a `::after`).
   - Caption bottom-right, `--t-caption` italic `--stage-ink-2`: "Illustration. A made-up figure, not a real person."
   - Phone (< 760): canvas fills the top ~58svh, figure framed waist-up; text block below on the stage colour:
     eyebrow, `h1` (~52 px from the token), lede, Start a walk full width, then See a sample + See the wall as
     `.rw-actions--split` half-width buttons (do **not** hide See the wall). Readouts become one row of four
     `.rw-chip`-style stage chips, horizontally scrollable inside the hero only (`overflow-x: auto`,
     `scrollbar-width: none`) and never wider than the viewport. Caption under the actions.
2. **How it works** (`.rw-sechead`: eyebrow "How it works", title "Two minutes, three steps"). Three columns
   (`ol.rw-steps`): each step has an icon (`walk`, `score`, `wall` in that order), the numeral in
   `--t-num-xl` accent with a 24 px accent rule under it, `h3`, text. Then "Before you start" (`h3`) as four items
   in a row with icons (camera, walk, turn, socials as fits), hairline above each. Phone: one column, needs 1-up.
3. **Most of your score is measured** (`.rw-score-guide`, 5/7). Left (sticky top 32 px on desktop): eyebrow
   "Scoring", title, lede, the **split line**: one 8 px bar, 70% accent and 30% ink with a 2 px `--bg` gap, numbers
   below as `num('70', 'measured')` and `num('30', 'opinion')` at `--t-num-xl`. Right: two lists ("Measured, 70",
   "Gemini's opinion, 30") with `.rw-points__head` carrying `.rw-ruled`; each row: number left (`--t-num-xl`),
   label `h3`, about text, and a `.rw-bar--compact` (opinion rows use `.rw-bar--opinion`). Bars fill on reveal.
4. **Checked against real walks** (`.rw-proof`, 5/7). Left text; right `figure.rw-card` with the dot chart per
   direction (track 6 px `--band`, earned zone `--data-tint` with a 1 px accent tick at full marks, pros = 14 px
   filled accent, everyone = 14 px hollow 2 px ink-2). Values `--t-caption` 600.
5. **The same rules for every body** (`.rw-band.rw-on-stage`): `--stage` background, `--r-l` corners inside the
   gutter on desktop (not full bleed; `margin-inline: 0; width: auto`), full bleed on phone. Four principles,
   each with a 2 px stage-accent top rule; sources disclosure under a `--stage-hair` rule; links stage-accent.
6. **Where your walk goes** (`.rw-note` with `icon('device')` in the head): the existing privacy copy.
7. **Your saved walks**: only when there are saved walks: `.rw-sechead--row` ("Your saved walks", action "See all"
   quiet link) + up to 3 `.rw-row` items. When there are none: one line, ink-2, "Walks you save appear in
   [Saved walks]." (link). The full empty state with art lives on the Saved walks page, not here.
8. **Closing band** (`.rw-cta`): centred, `--space-section` padding, `divider.svg` inlined decoratively above,
   title "Ready? It takes two minutes." (`--t-title`), Start a walk (`--solid --big`). On phone the button is full
   width.
9. Footer (shell).

Motion: hero text enters with the screen enter; sections reveal; bars fill after reveal; the scene keeps running
(under reduced motion `scene.mjs` drops sweep and sparkle layers, per direction).

### 3.3 Studio (STUDIO: `studio.mjs`, `music.mjs`, `overlay.mjs`, `css/studio.css`)

DOM change in `studio.mjs` (allowed; behaviour unchanged):

```
h1.rw-sr "Walk studio"
div.rw-studio[data-phase=<mirror of stage phase>]
  div.rw-studio__main
    div.rw-stage.rw-on-stage  (video, canvas, .rw-stage__art, timer, count, prompt, .rw-stage__cta)
    div.rw-takeslot
    ol.rw-flow
    p[role=status].rw-sr (announce)
    div.rw-studio__primary   (existing `primary` actions)
    p.rw-error[role=alert]
  aside.rw-studio__rail       (sticky)
    section.rw-card  "Before you walk"
      .rw-toggle-row  Stop by itself
      .rw-field--inline  Score me on #rw-laps (+ help text)
      consentBox (Judge my walk toggle row + legal small print)
    details.rw-card.rw-setup  "Set up the runway" (open while camera is off or waiting; closed once live; the
                               user's own toggle wins after they touch it)
      ol.rw-checklist (5 steps, numbered marks)
  div.rw-studio__panels       (3 quiet cards: Camera, Music to walk to (music.el), Or upload a clip)
```

- **Desktop** (> 1000): `.rw-studio` grid `minmax(0, 1fr) 380px`, gap `--gap`; rail `position: sticky; top: 24px`.
  Panels row spans both columns, `repeat(3, minmax(0, 1fr))`. 1000 to 760: rail moves under the main column
  (2-column grid of the two rail cards), panels 2-up then upload full.
- **Stage**: `--r-l`, `--stage`, inset `0 0 0 1px var(--stage-hair)`, width rule as now (fits 74dvh),
  `container-type: inline-size`. Phase looks via the existing `data-phase` / `data-urgent`:
  - `off` / `waiting` (camera not live): `.rw-stage__art` = `empty-walks.svg` inlined with
    `{ decorative: true }`, `color: var(--stage-ink); --accent: var(--stage-accent)`, covering the stage at 70%
    opacity; the prompt band reads "Your camera is off" (existing text); `.rw-stage__cta` holds the existing "Turn
    on camera" button moved onto the stage centre (`--solid --big`, stage variant). The same button element must
    remain the one that `renderControls` manages; the test clicks it by its text. Permission wait: add the small
    line "Allow the camera in your browser's bar above" under the button.
  - `live`: hairline ring. Framing guides drawn by `overlay.mjs` on the stage canvas: dashed 2 px lines at head
    (top 6%) and feet (bottom 6%) across the middle 60%, `#B3A1FF` when framed ("You are in frame. Press Start"),
    `#E8B35A` when not. Colour change fades over 200 ms (lerp in the draw loop).
  - `countdown`: 2 px accent ring + draining conic ring (1.3), the digit `.rw-stage__count` at `min(34cqw, 22rem)`
    with a radial `--glow`-coloured halo (`rgba(179,161,255,.28)`) behind it.
  - `recording`: 2 px `--rec` ring; `.rw-stage__timer` top-right as a floating pill (stage-scrim, 1 px
    stage-hair, blur 8 px) with the pulsing `--rec` dot; prompt stays.
  - `take`: no ring.
  - On dark theme, `live` and `recording` add `--shadow-lit`.
- **Prompt** `.rw-stage__prompt`: bottom band, `--stage-scrim`, 1 px stage-hair top edge, padding
  `clamp(14px, 2vw, 28px) 24px`, `--t-prompt` 700, centred. Urgent: band `color-mix(in srgb, #B3A1FF 92%,
  transparent)` with `--stage` text. Crossfade on text change (studio adds `.is-swapping` for 200 ms).
- **Flow** `.rw-flow` as the runway track: one 1 px hairline across, marks on it evenly spaced; `.rw-flow__dot`
  28 px: done = ink fill + `icon('check')` in `--bg`, current (`aria-current="step"`) = accent fill, on-accent
  number, 4 px `--accent-soft` halo; upcoming = `--surface` with hair border, ink-3 number. Labels under marks in
  `--t-caption` (current label ink 600). Hooks `li`, `is-done`, `aria-current` unchanged.
  Phone (< 760): marks only (24 px, no labels visible, labels `.rw-sr`-clipped not `display:none`), and one visible
  line above: "Step 2 of 6 · Stand tall" (`.rw-flow__now`, `aria-hidden="true"` because the list already says it).
- **Primary action**: centred under the flow, `--solid --big`, min-width 320 px. Phone: full width, 56 px, and
  while phase is `live`, `countdown` or `recording` the `.rw-studio__primary` becomes a sticky bottom bar
  (`position: sticky; bottom: 0`, padding `12px 16px calc(12px + env(safe-area-inset-bottom))`, `--surface` at 92%
  with a top hairline; on dark the same tokens).
- **Recording focus**: `.rw-studio[data-phase='countdown'|'recording']` dims `.rw-studio__rail`,
  `.rw-studio__panels` and, via `.rw-app:has(.rw-studio[data-phase='recording']) .rw-top, ... .rw-foot`, the header
  and footer to `opacity: .35` over `--d-medium`. Still focusable. On entering countdown, studio scrolls the stage
  into view (`scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' })`).
- **Rail card "Before you walk"**: head with `icon('walk')`. Toggle rows:
  - "Stop by itself." (bold) + "Recording ends after the last walk. It always starts only when you press Start."
  - "Score me on" `#rw-laps` + help "You stand tall for a moment so we can calibrate to you, then walk up and back
    this many times. One stumble will not sink your score."
  - Consent (`consentBox`, rendered in `renderControls`): title line **"Judge my walk"** + "Adds Gemini's opinion,
    up to 30 points." then the existing legal sentence unchanged in `--t-caption` ink-2. When Gemini is not
    connected, the existing muted line replaces it.
- **Setup card**: `details` styled as a card; summary is the head ("Set up the runway", chevron rotating 180° on
  open over `--d-short`); list items get 24 px numbered marks (ink-3 numbers on `--band` circles).
- **Panels** (quiet cards, `--t-h3` heads; Camera gets `icon('camera')`, Upload gets `icon('upload')`, Music has
  no icon):
  - Camera: "Which camera" select; `.rw-fps` as three cells, `dt` `--t-caption`, `dd` `--t-num` with unit
    caption; tracker line rendered as `.rw-status` (`--busy` "Loading the pose tracker.", `--ok` "Tracking with
    ...", `--err` on failure; text unchanged); Rotate picture (`--small`) + help.
  - Music (`music.mjs`): Track select `#rw-music`, Volume range, Preview + Use my own track (`--small`), credit
    line `--t-caption`.
  - Upload: copy, "Choose a video" (`label.rw-btn` with `icon('upload')`, full width of the card), `#rw-upload`,
    status as `.rw-status`.
- **Take** (after recording): the take player fills the stage slot, "Use this walk" primary, re-record quiet.

### 3.4 Results (RESULTS: `review.mjs`, `parts.mjs`, `player.mjs`, `css/results.css`)

DOM after this change (review.mjs; the order of the first-level children may change, ids/classes must not):

```
p.rw-banner                       (sample only)
div.rw-reviewhead
  div.rw-reviewhead__name         statusPill, h1.rw-sr, label.rw-name-wrap > nameInput.rw-name + icon('pencil')
  div.rw-reviewhead__next         "Walk again" (sample: "Try it for real")    <- sticky bar on phone
div.rw-result                     7/5 on desktop
  div.rw-result__media            playerSlot (+ analysis overlay), ribbon, ribbonKey, announce
  div.rw-result__summary          score block, then verdict / judge card, then .rw-tiles
div.rw-analysis                   7/5 grid
  breakdownPanel (.rw-breakdown, display: contents on desktop so its two groups are grid items)
  div.rw-analysis__aside          momentsPanel (timeline), stills section ("What Gemini saw")
section.rw-keep                   "Keep it", two cards
  div.rw-card.rw-keep__device     "On this device": socialsField, Save changes / Save to this device, Delete,
                                  "All changes saved" line, the hint line
  wallPanel (section.rw-card.rw-wallpost)   "Post it to the wall"  (must stay a <section>; its first checkbox
                                  must stay the post consent: the e2e test relies on closest('section'))
detailsPanel                      "The numbers behind this" (coverage, metrics, Save the video file, Rotate video...)
```

Sample walk: `.rw-keep` shows one card only: "Try your own" with "Try it for real" (solid). No save, no socials.

- **Head**: pill above the name. `.rw-name`: `--t-title` 700, transparent, 2 px underline `--hair` at rest,
  `--ink-2` dotted on hover, accent on focus plus the global outline; pencil icon 20 px ink-3 to the right
  (becomes accent on focus-within); placeholder "Name this walk". Readonly (sample): no underline, no pencil.
  Walk again: `--solid` on desktop at the right of the head.
- **Media column**: player `--r-l`, `.rw-on-stage`; badge top-left floating pill (sample badge quieter: same pill,
  no extra colour); controls row beneath: Play/Pause `--small` with icon, range, time `--t-small` tabular, speed
  `--small`, Skeleton `.rw-check--plain`. Desktop media column sticky (top 24 px) as now.
  - **Analysis overlay**: while analysing, `.rw-progress` renders inside the player box as an overlay
    (`position:absolute; inset:auto 16px 16px 16px`, `--stage-scrim`, blur 8 px, `--r-m`, padding `--s-5`,
    stage-ink): stage label `--t-h2`, percent `--t-num` stage-accent, "About N seconds left" caption, the 6 px meter,
    Cancel `--small` stage variant. The `.rw-progress` element keeps its class and must disappear when done (the
    test waits for its absence). On phone the overlay sits under the player instead of over it if the player is
    shorter than 260 px.
  - **Ribbon** `.rw-ribbon`: 40 px, `--band`, `--r-s`; segments `toward` accent with on-accent text, `turn` ink with
    `--bg` text, `back` `--data-tint` with ink text and a 1 px hair inset; 2 px `--bg` gaps; playhead 2 px ink.
    Moment ticks: 2 x 10 px accent marks above the ribbon at each moment's time (`.rw-ribbon__tick`, decorative).
    Key below: 14 x 10 swatches, `--t-caption`.
- **Summary column** (order is fixed):
  1. Score block `.rw-score`: eyebrow (existing label text: "Your score" / "Measured so far" / sample label), the
     number `.rw-score__num` (`--t-score`; dark: accent with `text-shadow: 0 0 48px var(--glow)`), `.rw-score__max`
     as `.rw-unit` at `--t-h2` size, `.rw-chip--ghost` "+?" after the max while judging or while the judge is
     still offered. Grade `.rw-grade` `--t-h2` accent; grade line `--t-small` ink-2. Per-walk caption: "Based on 2
     of 2 walks" (keep text) followed by `.rw-chip`s "Walk 1 · 70/70".
  2. Verdict `.rw-verdict` (`--t-lede` 500, 2 px accent left rule, padding-left `--s-5`), or the judge card:
     - offered, not consented: `.rw-card` titled "30 points still open" with the existing explanation text and the
       button "I agree, judge my walk" (`--solid`).
     - judging: `.rw-judging` as a `.rw-card` with the travelling accent border (1.3), stage line, percent, meter,
       time left, Cancel.
     - failed: `.rw-error` panel + "Ask the judge again".
     - not connected: one muted line (existing copy containing "not connected to this server").
  3. `.rw-tiles` 2x2: Closest walk (`.rw-match`: name `--t-h3`, tag accent 500, note `--t-small`), Strongest part,
     Biggest win (the existing focus text), The judge suggests. Missing tiles collapse; an odd count leaves the
     last tile spanning both columns.
  - Not scorable: no number; `.rw-noscore` "We could not score this one" at `--t-h2`, reason, Walk again
    (`--solid`), in a `.rw-card`.
- **Analysis grid** `.rw-analysis` (7/5, collapses at 1000):
  - Measured group `.rw-breakdown__group` (first): head `.rw-breakdown__head` with `.rw-ruled`: `h2` "Measured from
    your movement" (or the sample variant) and `.rw-breakdown__sum` `--t-num-xl`; the calibration note
    `--t-small`. Each `.rw-bar` row: the head + track + note are visible; `details.rw-why` follows with summary
    "Why this score" + chevron, styled as a quiet row link (accent 500 `--t-small`). The whole bar row gets a hover
    background `--band` at `--r-s` with -12 px inline padding compensation. Open state: content in a `--band`
    inset block. (Do not wrap the bar inside `summary`: the test counts 7 `.rw-bar` and 7 `.rw-why` in
    `.rw-breakdown`.) Bars stagger-fill via `--i`.
  - Gemini group (second, right column): same head, bars `.rw-bar--opinion`, the opinion disclaimer `--t-caption`.
  - `.rw-analysis__aside` (right column, under the Gemini group): "Moments" `h3` and `.rw-moments` as a vertical
    timeline (1 px hair line on the left, each item: the existing time button as `.rw-btn--chip`, then the note);
    then "What Gemini saw": `.rw-stills` 3 columns (4:5 thumbs, `--r-s`, time caption), moved here from the
    numbers disclosure (keep `.rw-still` buttons and their seek behaviour).
  - Phone: measured, then Gemini, then moments, then stills.
- **Keep it** `section.rw-keep` (`.rw-sechead` eyebrow "Keep it", title "Save it, post it, walk again"): two
  `.rw-card`s side by side (1 column under 1000). Device card: head with `icon('device')` "On this device"; socials
  field ("Your socials, to be tagged", placeholder "@yourhandle", `.rw-input--handle`); actions "Save changes" /
  "Save to this device" (`--solid`), "Delete" (`--danger`); status ("All changes saved" in `.rw-status--ok`); hint
  line `--t-caption` (see section 4). Wall card: head with `icon('wall')` "Post it to the wall"; all wall states
  (checking, not connected, needs judging, form, posting, posted, failed) inside it; the posted state shows a link
  button to `#/wall/<id>` (keep `a[href^="#/wall/"].rw-btn`).
- **Numbers disclosure** `.rw-details`: summary `--t-h3` with chevron and `.rw-ruled` top; coverage block `.rw-note`;
  `.rw-metrics` grid `auto-fill minmax(240px, 1fr)`; `.rw-metric` = `.rw-card` with `h3` label `--t-caption`
  (keep `h3` and first `p` for the test), value `--t-num-xl` + unit; "How this is measured" small disclosure.
  Raw numbers in `--font-mono` only here. Save the video file / Rotate video and analyze again as `--small`
  buttons.
- **Phone order** (< 760): `.rw-result { display:flex; flex-direction:column }`, `.rw-result__summary { order:-1 }`
  so the score leads; the number is ~88 to 96 px from the token. `.rw-reviewhead__next` becomes a sticky bottom bar
  (`position: fixed` is not allowed to cover content: use `position: sticky; bottom: 0` placed via `order` at the
  end of the screen, or fixed with `padding-bottom` on `.rw-screen` equal to its height; choose fixed + padding,
  shown only after the score has scrolled out of view via an IntersectionObserver on `.rw-score`). It holds "Walk
  again" (full width minus a score chip `num(total, '/100')` at left).
- **Missing walk**: `.rw-empty` with `figure.svg`, "This walk is not here" title (keep), text, two buttons.

### 3.5 Saved walks (RESULTS: `history.mjs`)

- Head `.rw-pagehead`: `h1` "Saved walks" + lede "On this device only..." (existing) left; Start a walk (`--solid`)
  right; phone: full width under the lede. `.rw-ruled` under the head.
- Toolbar `.rw-toolbar`: Show and Sort by selects left (the Show select must remain the first `select` on the
  page), "Download all videos" (`icon('download')`, secondary) right; phone: the two selects as a 2-column grid,
  download full width below. The `[role=status]` count line ("N of M saved walks") sits under the toolbar,
  `--t-small` ink-2.
- Rows `.rw-row.rw-card--link`: 64 x 80 thumb at left (`.rw-thumb` from `parts.mjs` when the saved walk carries a
  pose; otherwise `figure.svg` on a `--stage` tile), name `--t-h3`, meta `--t-caption` ("date · status"), socials
  accent 500, score right `--t-num-xl` with `/100` unit; the quiet Delete stays beside the row as now. Phone:
  thumb 48 x 60, score right, Delete under the text.
- Loading: three `.rw-skel--row`. Empty: `.rw-empty` with `empty-walks.svg`, title "Nothing saved yet." and text
  (section 4). No match: `.rw-empty` smaller (art 160 px), "No saved walks match this filter." (keep "No saved
  walks match"). Error: `.rw-error`.

### 3.6 The wall and a wall post (RESULTS: `wall.mjs`)

- Head as Saved walks: `h1` "The wall", one-line description, Start a walk. Local-test banner `.rw-banner`.
- `.rw-stats` (4 tiles, hairline separated, label `--t-caption`, value `--t-num-xl`, "None yet" `--t-h2` ink-3):
  rendered **only when at least one walk is posted** (keep it empty otherwise; `.rw-stats:empty` hides it). Phone
  2x2. The test reads "Walks posted 1" from it, so keep the label "Walks posted".
- Toolbar: Sort by select.
- Grid `.rw-wallgrid`: cards `.rw-wallcard.rw-card--link` (keep `.rw-wallcard__link`). Thumbnail stage
  `.rw-wallcard__stage.rw-on-stage` with a `--stage` to `--stage-2` vertical gradient, the skeleton `.rw-thumb`
  (bones stage-accent), rank top-left `--t-num-xl` stage-ink at 60%; body: name `--t-h3`, score `--t-num-xl` +
  `/100`, match accent 500, verdict `--t-small` ink-2 clamped to 3 lines; foot: date caption and the clap chip
  (`icon('clap')`, `.rw-btn--chip`; "Clapped" state disabled, accent-soft background).
  **Podium**: the first three cards (only when sorted by score) get `.rw-wallcard--podium`: stage 280 px tall,
  rank in stage-accent at full opacity, `--shadow-lit` on dark. Rest of the grid as normal. Phone: podium cards
  stay vertical; the rest become horizontal rows (96 px thumb left, text right).
- Loading: three `.rw-skel--card`. Empty: `.rw-empty--wide` with `empty-walks.svg`, "The wall is empty." (keep) +
  "Be the first one up." + Start a walk. Not connected: muted line (existing copy).
- **Wall post** `#/wall/<id>`: back link (`←` stays as a CSS `::before`), the same 7/5 `.rw-result` layout as
  results: skeleton replay player left (no video element), score block + verdict + closest walk tiles right; the
  measures `.rw-measures` as tiles; "Copy link" (shows `toast('Link copied')`) and "Remove from the wall"
  (`--danger`) in `.rw-actions`. Moments work as on results.

---

## 4. Copy

### 4.1 Protected strings (never change, never split across elements in a way that changes `innerText`)

"Turn on camera", "Start, with a 3 second countdown", "Cancel", "Run the analysis again", "I agree, judge my walk",
"Save changes", "Delete", "Walk again", "Download all videos", "Saved on this device", "All changes saved", "Your
score", "Measured so far", "We could not score this one", "Measured from your movement", "Gemini's opinion", "Why
this score", "No saved walks match", "This walk is not here", "not connected to this server", "You are in frame.
Press Start", "Your socials, to be tagged", "@yourhandle", "Tracking with", plus every string `test/e2e.mjs`
reads: "Sample: synthetic data", "Synthetic figure", "written by hand", "Based on 2 of 2 walks", "Save to this
device" (must be absent on the sample), "The judge suggests", "Walks posted", "Clapped", "Remove from the wall",
"Kevin MacLeod", "Camera reports", "Measured here", "left out rather than marked down", "Judged", "could not find a
person", "damaged" / "cannot play", the grade names, and the "N of M saved walks" status. Run `grep -n "includes\|test(" test/e2e.mjs` before
renaming anything at all.

### 4.2 Changes (not tested; make them)

| Where | Now | New |
|---|---|---|
| Home hero lede | "We follow 26 points on your body to measure how you really move" | "We track 26 body landmarks to measure how you really move" (rest of the sentence unchanged) |
| Home step 1 | "up to three times" | "two or three times" (and everywhere on home) |
| Home how-it-works title | "How it works" | eyebrow "How it works", title "Two minutes, three steps" |
| Home saved walks, none | "The runway is empty." block | one line: "Walks you save appear in Saved walks." with a link |
| Home closing band | none | "Ready? It takes two minutes." + Start a walk |
| Studio consent | "Judge my walk. I am 18 or older..." | Title "Judge my walk", line "Adds Gemini's opinion, up to 30 points.", then the legal sentence unchanged |
| Studio permission wait | (prompt only) | add "Allow the camera in your browser's bar above" under the button |
| Results judge offer | heading-less text | card title "30 points still open"; body text and button unchanged |
| Results Keep it | none | eyebrow "Keep it", title "Save it, post it, walk again" |
| Results hint (under Save) | none | "Save keeps it in this browser. The video file itself is also kept on this device." |
| Saved walks empty | "Every walk you record is kept here automatically." | Title "Nothing saved yet." Text "Walks appear here when you press Save on a result. Only on this device." |
| Wall empty | "The wall is empty." | keep, add "Be the first one up." |
| Footer | credit only | credit + "Built for HackTrent 2026" |
| Name placeholder | (current) | "Name this walk" |

---

## 5. File ownership and order of work

| Owner | Files (only these) |
|---|---|
| FOUNDATION | `src/styles.css`, `index.html`, `src/app.mjs`, `src/main.mjs`, `src/ui/dom.mjs`, `src/ui/fox.mjs`, `src/art/*` (sprite additions only), and creates empty `src/css/home.css`, `src/css/studio.css`, `src/css/results.css` linked after `styles.css` |
| HOME | `src/ui/home.mjs`, `src/ui/scene.mjs`, `src/css/home.css` |
| STUDIO | `src/ui/studio.mjs`, `src/ui/music.mjs`, `src/ui/overlay.mjs`, `src/css/studio.css` |
| RESULTS | `src/ui/review.mjs`, `src/ui/parts.mjs`, `src/ui/player.mjs`, `src/ui/history.mjs`, `src/ui/wall.mjs`, `src/css/results.css` |

Nobody edits `src/lib`, `src/pose`, `src/capture`, `src/judge`, `src/store`, `src/wall`, `api`, `scripts`, `test`.
Nobody edits another owner's files. If you need something from another owner, write it in your hand-back notes; the
lead integrates.

What lives where:
- `styles.css`: tokens, base, utilities, and every component in section 2 (`rw-btn*`, `rw-actions*`, `rw-pill*`,
  `rw-status*`, `rw-card*`, `rw-note`, `rw-banner`, `rw-error`, `rw-empty*`, `rw-field*`, `select`, `rw-input*`,
  `rw-check*`, `rw-toggle-row`, progress, `rw-bar*`, `rw-chip*`, `rw-tiles`/`rw-tile`, `rw-skel*`, `rw-sechead*`,
  `rw-title`, `rw-section__title`, `rw-lede`, `rw-eyebrow`, `rw-caption`, `rw-num`, `rw-unit`, `rw-rule`,
  `rw-ruled`, `rw-icon`, `rw-toast`, `rw-top*`, `rw-brand`, `rw-foot*`, `rw-skip`, `rw-sr`, `rw-boot`,
  `rw-screen*`, `rw-on-stage`, `rw-pagehead`, `rw-toolbar`, `rw-list`, `rw-row*`, `rw-thumb`, `rw-details`).
- `home.css`: `rw-hero*`, `rw-section`, `rw-steps`/`rw-step*`, `rw-needs*`, `rw-score-guide*`, `rw-split*`,
  `rw-points*`, `rw-proof*`, `rw-legend`, `rw-dots*`, `rw-band*`, `rw-fair*`, `rw-sources*`, `rw-block*`, `rw-cta`,
  reveal rules.
- `studio.css`: `rw-studio*`, `rw-stage*`, `rw-takeslot`, `rw-flow*`, `rw-panel`, `rw-setup`, `rw-checklist`,
  `rw-fps`, `rw-camera`, `rw-rotation`, `rw-laps`, `rw-upload`, `rw-music*`, the recording-dim `:has()` rules.
- `results.css`: `rw-reviewhead*`, `rw-name*`, `rw-result*`, `rw-playerbox`, `rw-player*`, `rw-ribbon*`,
  `rw-score*`, `rw-grade`, `rw-noscore`, `rw-verdict`, `rw-match*`, `rw-focus`, `rw-working`, `rw-progress*`,
  `rw-judging*`, `rw-analysis*`, `rw-breakdown*`, `rw-why*`, `rw-moments`, `rw-stills`/`rw-still`, `rw-keep*`,
  `rw-socials*`, `rw-wallpost`, `rw-coverage`, `rw-counts`, `rw-metrics`/`rw-metric*`, `rw-stats`/`rw-stat*`,
  `rw-wallgrid`, `rw-wallcard*`, `rw-backlink`, `rw-measures`/`rw-measure`.

Order of work:
1. FOUNDATION, first 10 minutes: tokens, base, `dom.mjs` helpers (2.16), the three empty CSS files linked from
   `index.html`. Then the shared components, header, footer, screen enter, sprite additions. FOUNDATION **removes
   the page-specific blocks** (Home, Studio, Result, The wall sections and their media-query lines) from
   `styles.css` once the page agents have started; page agents rebuild those rules in their own files using the
   legacy copy linked at the top of this spec. Until removed, page rules in their own files win by load order.
2. HOME, STUDIO, RESULTS start immediately in parallel against this spec and the token names; they do not wait for
   FOUNDATION's components to look right, only for the token block.
3. Each agent hands back with shots (section 6) and a short list of anything they needed from another owner.

---

## 6. Done means (each agent, for its own screens)

1. Shots in light and dark at 1440 and 390 via `shots.mjs` (`DARK=1` for dark), under
   `.../scratchpad/redesign/<agent>-after/`; you looked at every PNG.
2. No sideways scroll at 360 px (`document.documentElement.scrollWidth === innerWidth`).
3. `npm test` and `npm run e2e` pass; every hook and string in 4.1 untouched.
4. Every new text/background pair is at least 4.5:1; status colours only on text and 8 px marks.
5. Tab through once: every control shows the ring (stage-ink on the stage and dark bands); decorative SVG is
   `aria-hidden`; the stage prompt is still announced through the existing `[role=status]`.
6. Reduced motion: nothing moves except the hero scene and video; the score shows at once; bars render full.
7. Be Vietnam Pro only; no external requests.
