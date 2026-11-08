# RunwayLab visual direction: the Programme

Art direction for the rebuild of 7 November 2026 (evening). It replaces the "Lit line" direction from the morning. Everything
here is plain CSS with two self-hosted typefaces (`src/fonts.css`): no CDNs, no external images, the CSP in `index.html`
allows only `'self'`.

## 1. The concept: a printed show programme

Every fashion show hands out a programme: thick paper, one serif, the looks numbered, a plate for each picture, notes in
the margin. RunwayLab is that programme for the person walking. The product is still the same three things, the runway,
the light and the measure, but it is set like print, not like software:

- **Paper and ink.** The page is paper. By day it is warm cream with navy ink (the Matinée); by night the same page is navy
  with cream ink (the Evening). One switch in the header, and the system setting decides until it is touched. Nothing is
  a gradient; depth comes from one hard print shadow.
- **Plates.** Anything that is a picture (the runway scene, the camera stage, the replay, a wall card's still) sits in a
  frame: a rule, an inner hairline, and a hard offset shadow, like a plate tipped into a book. The frame is numbered
  (Plate I, II, III) on the pages that carry one.
- **Numbered looks.** Sections are numbered `01`, `02`, `03` in the margin, the way a programme numbers its looks. The
  numeral is set in the serif, italic, and the label beside it in tracked capitals.
- **The light.** One accent, gold: ochre as ink on paper, apricot as light on navy. It marks the start of every rule
  (the start mark on a floor), the measured half of a score, the current step, and nothing decorative.
- **The measure.** Numbers are the hero after the walker. The big ones are serif, with hairline strokes and real
  tabular figures; units are set small and quiet beside them.

Name for the system when talking about it: **the Programme**.

## 2. Type

| Role | Face | Where |
|---|---|---|
| `--f-display` | **Bodoni Moda** (variable, 400–900, optical size 6–96, roman and italic) | The display line, every H1 and H2, the score, section numerals, pull-quotes (the verdict), italic margin notes. |
| `--f-text` | **Be Vietnam Pro** 400 / 400 italic / 500 / 600 / 700 | Everything else: body, labels, buttons, numbers under 32 px. |

Rules: the serif never goes below 1.5 rem (its hairlines vanish); labels are 0.75 rem capitals with 0.14 em of tracking,
never bold serif; body is 1.0625 rem / 1.6. Tabular figures everywhere a number can change.

## 3. Colour

| Role | Matinée (paper) | Evening (navy) | Use |
|---|---|---|---|
| `--bg` | `#F3EEE3` | `#14213D` | the page, with a paper grain |
| `--surface` | `#FBF8F1` | `#1A2A4B` | panels, inputs |
| `--band` | `#E9E2D3` | `#20325A` | recessed areas, tracks, the header mount |
| `--ink` | `#14213D` | `#F4EDE0` | text, frames |
| `--ink-2` | `#4A5470` | `#CFC7B8` | secondary text |
| `--ink-3` | `#6B7489` | `#A9A292` | captions, never under 13 px |
| `--rule` | `#14213D` | `#C9C0AE` | plate frames, strong rules |
| `--hair` | `#D2C9B6` | `#2E4068` | hairlines |
| `--accent` | `#8A5A12` | `#F2C38B` | gold as text: links, current step, measured points |
| `--lamp` | `#D7A24A` | `#F2C38B` | gold as light: fills, bars, the start mark, the glow |
| `--lamp-soft` | `#F1E1BE` | `#3B4160` | the tinted half of a bar, selected chips |
| `--btn` / `--btn-ink` | `#14213D` / `#F7F3EB` | `#F4EDE0` / `#14213D` | the primary button |
| `--plate-shadow` | `#14213D` | `#07101F` | the hard 6 px offset under a plate |
| `--ok` / `--warn` / `--err` | `#2B6B47` / `#8A5A12` / `#A33A2A` | `#8FD1A8` / `#F2C38B` / `#FF9A8F` | status text |
| `--rec` | `#D9372B` | `#FF6B6B` | the recording dot only |

The stage (`--stage #0F1A31`, `--stage-2 #14213D`, cream ink, apricot light) is the same in both settings: the room is
always dark where the runway is.

## 4. Components

- **Rule.** 1 px hairline with a 40 px gold segment at its start. Every section, panel head and page head opens with one.
- **Plate** (`.rw-plate`): 1.5 px rule border, 1 px hairline inset 4 px, `6px 6px 0 var(--plate-shadow)`. Radius 3 px.
  `.rw-plate__label` is the tracked caption in the top-left corner ("Plate II · The stage").
- **Panel** (`.rw-card`): surface, 1 px hairline border, radius 3 px, no shadow. Hover on a linked card lifts it onto the
  print shadow.
- **Button**: rectangular, 3 px radius, 1.5 px ink border. Primary is filled `--btn` with a 3 px hard shadow that collapses
  on press. Secondary is outlined. Quiet is an underlined link.
- **Tag** (`.rw-pill`): a small rectangle in tracked capitals, not a pill.
- **Numbered head** (`.rw-sechead`): numeral column (italic serif numeral over a capitals label), then the title and lede.
- **Verdict**: serif italic pull-quote with a gold rule down its left, like a review clipping.

## 5. Motion

Scroll reveal on the home page (12 px rise, 560 ms, staggered), the score counting up, bars filling from the start mark,
the step track's line drawing, the hero figure walking. Reduced motion turns all of it into a fade or nothing.
