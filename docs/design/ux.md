# RunwayLab UX audit and plan

Senior UX pass, 7 November 2026, the day before HackTrent demos (Sunday 8 November 2026).
Audited as two people: (1) a first-time visitor walking up to the booth laptop with a queue behind them, and (2) someone
who scanned a QR code and opened it on a 390 px phone. "Before" screenshots: scratchpad `redesign/ux-before/` (home,
studio, sample review, wall, history at 1440 and 390 px).

Constraints this plan respects: every feature and behaviour stays; all test-visible strings, classes and ids stay
(see the brief); only `src/ui/*.mjs`, `src/styles.css` and markup order change. Be Vietnam Pro only.

---

## 1. Information architecture

```
Home  #/                 What is this, is it fair, start
 ├─ Studio  #/studio     Set up -> frame -> countdown -> stand tall -> walk 1..N -> take
 │    └─ Results  #/review/<id>   score -> why -> judge -> moments -> keep it / post it -> numbers
 │          └─ Wall post  #/wall/<id>
 ├─ Sample  #/review/sample      same results layout, clearly synthetic
 ├─ The wall  #/wall             leaderboard of posted skeleton walks
 └─ Saved walks  #/history       this device's saved walks
```

Primary loop at the booth: **Home -> Studio -> Results -> (Post to wall) -> Wall -> next walker**. Everything on screen
should push the next walker into that loop in under 10 seconds of reading.

Navigation: keep three top links (New walk, The wall, Saved walks). Rename nothing. On phones the nav currently wraps
under the brand and costs 60 px; put brand and links on one row (brand left, links right, 15 px links, 44 px tap
height), and let "New walk" read as the primary link (accent underline when current, solid pill when not on studio).

---

## 2. What each screen must say first (the 3-second test)

| Screen | First thing seen | Second | Third |
|---|---|---|---|
| Home | "Walk up. Turn. Get judged." + Start a walk | 70 measured / 30 opinion, fair for every body | How it works, setup needs |
| Studio, camera off | The stage with one big "Turn on camera" and the 4 setup needs beside it | Score me on N walks, Judge my walk | Camera, music, upload |
| Studio, live | The live picture with the prompt ("You are in frame. Press Start") and the Start button directly under it | Step tracker (Get in frame ... Your score) | Options, collapsed |
| Studio, recording | Prompt + timer + current walk "Walk 2 of 3" huge on the stage | Stop recording | nothing else |
| Results, analysing | Progress with stage name and time left, over a still of their own video | "This runs on this device" | Cancel |
| Results, scored | The number, the grade line, and whether Gemini's 30 are in / pending / declined | Breakdown bars | Post to wall, Save, Walk again |
| Wall | Ranked cards (who is on top) | Stats row | Start a walk |
| Saved walks | List of walks with score | Filter, sort, Download all videos | Start a walk |

---

## 3. Prioritized problems and exact fixes

P0 = hurts the demo, fix first. P1 = clearly worse than it should be. P2 = polish.

### P0

1. **Studio hides setup below the fold, and Start sits above it.** A first-timer presses "Start, with a 3 second
   countdown" before reading "Put your iPhone sideways at hip height / mark a turn spot at 2.5 m". Fix: two-column
   studio on desktop. Left (≈62%): stage, step tracker, primary button, problem line. Right rail (≈38%, sticky):
   "Before you walk" card containing *Score me on* (`#rw-laps`), *Stop by itself*, the *Judge my walk* consent, then the
   5-step "Set up the runway" checklist. Camera, Music (`#rw-music`) and Upload (`#rw-upload`) move to a row of three
   quieter cards below the stage. On phone: stage, flow, primary button, then the "Before you walk" card, then setup
   checklist as a `<details>` that is **open while the camera is off and closed once live**.

2. **Consent copy is decided in the wrong place and twice.** Studio has a checkbox "Judge my walk. I am 18 or older...",
   results has "Want the other 30 points? ... I agree, judge my walk". Visitors who skip the studio checkbox get a
   surprise wall of text after the score. Keep both (behaviour), but make the studio one a visible toggle row with a
   short line: **"Judge my walk"** (bold) + "Adds Gemini's opinion, up to 30 points." and the legal line ("I am 18 or
   older, and I agree that about 12 cropped stills with my face pixelated go to Google's Gemini...") in small text
   beneath, unchanged. On results the unconsented state becomes a calm card titled "30 points still open" with the
   existing text and the button "I agree, judge my walk".

3. **The score does not lead on phone.** At 390 px the order is banner, pill, title, Try it for real, video, transport,
   ribbon, *then* the score at y≈1100. Fix for results (sample and real): on phone order is
   score block -> player -> ribbon -> rest. Desktop keeps player left, score right but the score column starts level
   with the top of the video. Implementation: keep DOM order (player then summary) but on `max-width: 760px` use
   `.rw-result { display:flex; flex-direction:column }` with `summary { order:-1 }`.

4. **"Saved" means three different things.** Home empty state: "Walks you choose to save appear here". Saved walks
   empty state: "Every walk you record is kept here automatically." Results pill: "Temporary: not saved anywhere".
   Meanwhile `keepOnDevice` downloads the video file on any non-local host. A visitor cannot tell whether their walk
   is stored. Fix copy (not behaviour):
   - Saved walks empty: "Nothing saved yet." + "Walks appear here when you press Save on a result. Only on this device."
   - Home empty: keep "The runway is empty." + same second line as above.
   - Results pill unsaved: keep "Temporary: not saved anywhere" but add a one-line hint under the actions:
     "Save keeps it in this browser. The video file itself is also kept on this device." (accurate for both the dev
     recordings folder and the download fallback).

5. **Analysis and judging states look like a bare progress bar in a text column.** These are the longest waits at
   the booth (about 1.2x clip length, then Gemini). Fix: put the analysis progress *over the player* as a frosted
   panel (stage name large, percent tabular, "About N seconds left", Cancel as quiet button), with the player's first
   frame visible behind it. The `.rw-progress` element and `progress` stay. Judging state (`.rw-judging`) stays in the
   score column but becomes a card with a thin animated accent border (static under reduced motion), stage line
   ("Gemini 2.5 Flash is thinking about your walk"), and Cancel. While judging, the big number shows the measured
   points with the label "Measured so far" and a ghost "+?" chip after it so people understand 30 more may come.

6. **Studio camera-off state is ambiguous.** The stage says "Your camera is off" on a dark rectangle; on the booth
   laptop with a fake/continuity camera it is a flat green slab. Fix: off state shows a drawn runway silhouette (same
   art language as the hero, aria-hidden) with the prompt and the big "Turn on camera" button centred *on the stage*,
   not below it. "Waiting for camera permission" gets a small arrow hint "Allow the camera in your browser's bar above".
   Live: add framing guides on the stage canvas overlay: a dashed head line near top and feet line near bottom, tinted
   accent when the person fits ("You are in frame. Press Start"), amber when not ("Step back until your head and feet
   are in frame").

### P1

7. **Countdown and recording need to be readable from 5 m.** The walker is across the room. Prompt text is 48 px on
   desktop; make the countdown digit fill ~45% of stage height, the walking prompt ("Walk 2 of 3: keep coming") at
   clamp(32px, 6vw, 72px), with a high-contrast scrim. Add a fullscreen-feel option: during countdown/recording scroll
   the stage into view and dim the rest of the page (`body[data-phase=recording]` lowers opacity of non-stage
   content). Keep `[role=status]` announcements.

8. **Step tracker wraps into three rows on phone** ("Get in frame / Stand tall / Walk 1 / ... / Your score"). Fix: on
   phone render it as a single horizontal line of dots with only the current step's label shown
   ("2 of 6 · Stand tall"); keep the `ol` and `aria-current` intact, hide inactive labels visually with `.rw-sr`-style
   clipping, not `display:none`.

9. **Results summary is a long stack of equal-weight blocks** (verdict, closest walk, based on N walks, strongest part,
   biggest win, judge suggests). Fix hierarchy:
   - Tier 1: label ("Your score" / "Measured so far" / sample label), `.rw-score__num` at 120-160 px, grade name in
     accent, grade line.
   - Tier 2: verdict quote (Gemini) or the judge prompt/judging card.
   - Tier 3: a 2x2 grid of small "insight" tiles: Closest walk, Strongest part, Biggest win, The judge suggests;
     "Based on 2 of 2 walks" becomes a one-line caption under the number with per-walk chips
     ("Walk 1 · 70/70").
10. **Actions are scattered.** Save/Walk again/Delete sit top right next to the editable name; "Post it to the wall"
    is far below moments; "Save the video file" and "Rotate video and analyze again" hide inside "The numbers behind
    this". Fix: one **"Keep it"** band directly after the breakdown, two cards side by side: left "On this device"
    (name field `.rw-name`, socials `@yourhandle` field, Save changes / Save to this device, Walk again, Delete,
    status pill), right "Post it to the wall" (existing wall panel). The top of the page keeps only the pill, the name
    as the heading-sized input and a compact "Walk again" for the next walker. Keep "Save the video file" and "Rotate
    video and analyze again" in details (they are rare).
11. **The editable walk name does not look editable.** Give `.rw-name` a pencil affordance (inline SVG, aria-hidden),
    a dotted underline on hover, and a focus ring. Placeholder "Name this walk".
12. **"Why this score" is a tiny link under every bar**, seven times. Fix: make each bar row a single disclosure:
    the whole row (label, number, bar, one-line note) is the `<summary>`-like trigger with a chevron at right; keep
    the `details.rw-why` element and "Why this score" text as the summary's visible label on small screens. Bars get
    the measured accent; the Gemini group gets a second neutral ink so the 70/30 split from the home page carries
    through.
13. **Moments are orphaned.** Two chips and a sentence at full width under a half-width breakdown. Move `.rw-moments`
    into the right column under "Gemini's opinion" (they are Gemini's notes), as a vertical timeline: time chip,
    note, and a tiny tick mark on the ribbon at that time.
14. **Wall empty and stats.** Four stats reading "0 / 0 / None yet / None yet" look broken. When `walks === 0`, hide
    the stats row and show only the empty state, with a drawn empty runway and "Be the first one up." Keep "The wall is
    empty." text. When there are walks, rank 1-3 get a larger card treatment (podium row), rest in a grid.
15. **Home hero CTA set on phone drops "See the wall"** (it is hidden at narrow widths). Keep three actions on phone:
    Start a walk (full width solid), then a row with See a sample / See the wall as two half-width outline buttons.
16. **Home is long and ends weakly** (fairness, saved walks, privacy, credit). Reorder home to: hero -> How it works
    (3 steps + Before you start) -> Measured, not opinion (70/30) -> Checked against real walks -> Same rules for every
    body (dark band) -> Where your walk goes -> Your saved walks (only when there are saved walks; otherwise a single
    line link) -> closing CTA band "Ready? It takes two minutes." + Start a walk -> credit.

### P2

17. Hero copy "We follow 26 points on your body" next to a 70/30 score confuses "points". Change to
    "We track 26 body landmarks to measure how you really move". (Not a tested string.)
18. Home "Walk: up to three times" vs "Two minutes: two or three times" vs studio select. Use "two or three times"
    everywhere on home.
19. The sample banner, pill "Sample: synthetic data", player badge and score label all say "sample" four times above
    the fold. Keep the banner and the score label; make the pill and badge quieter.
20. Saved walks toolbar: "Download all videos" is the first, boldest control. Move it to the right end of the toolbar
    as an outline button; filters (Show, Sort by) left. On phone the toolbar is a 2-column grid of selects with the
    download button full width below.
21. History and wall rows should show a skeleton thumbnail (`.rw-thumb`) at 4:5 with score badge, not just text.
22. Long numbers (`70/70`, times, fps) use tabular figures (`font-variant-numeric: tabular-nums`) everywhere.
23. "Tracking with RTMPose-m on the GPU." in the camera card: render as a small status chip with a green dot when
    ready, amber "Loading the pose tracker.", red line for failure. Text unchanged.
24. Errors (`.rw-error`) need an icon and a tinted panel, not just red text; failures always pair with the recovery
    button already present ("Run the analysis again", "Ask the judge again", "Try the camera again").
25. Visible focus: 3 px accent outline with 2 px offset on every interactive element, including ribbon segments,
    stills and moment chips.

---

## 4. State inventory (every state must look intentional)

| Where | State | Must show |
|---|---|---|
| Studio | off | Runway art, "Your camera is off", Turn on camera on the stage, setup open |
| Studio | permission | "Waiting for camera permission" + browser-bar hint |
| Studio | problem | `.rw-error` panel with message + "Try the camera again" |
| Studio | live, not framed | Amber guides, "Step back until your head and feet are in frame" |
| Studio | live, framed | Accent guides, "You are in frame. Press Start", Start enabled |
| Studio | countdown | Giant 3-2-1, "Get ready", Cancel |
| Studio | calibrating | "Stand tall and hold still", step 2 active, soft pulse ring |
| Studio | recording | "Walk N of M: ...", timer, Stop recording |
| Studio | take | Take player, "Use this walk" primary, re-record quiet |
| Studio | tracker loading/failed | Chip states (see 23) |
| Studio | Gemini not connected | Consent row replaced by muted line (existing copy) |
| Results | analysing | Overlay progress on player, Cancel |
| Results | analysis failed/cancelled | Panel with "Run the analysis again" |
| Results | not scorable | "We could not score this one." + reason + Walk again, big and kind, no score number |
| Results | measured, judge offered | "Measured so far", number /70, "30 points still open" card |
| Results | judging | Judging card, ghost "+?" chip |
| Results | judge failed | `.rw-error` "No judgment this time..." + Ask the judge again |
| Results | judge not connected | muted line "...not connected to this server yet..." |
| Results | judged | "Your score", /100, verdict, insights |
| Results | wall: checking / not connected / needs judging / form / posting / posted / failed | All inside the right "Post it to the wall" card |
| Review | missing | "This walk is not here" empty state with two buttons |
| Wall | loading / empty / not connected / list / more | Skeleton placeholders while loading (3 grey cards) |
| History | loading / empty / no match / list / error | "No saved walks match this filter." empty |

---

## 5. Wireframes in words

Widths: content max 1200 px, gutters 24 px desktop / 16 px phone, 8 px spacing grid (8, 16, 24, 40, 64, 104).

### Home

Desktop (1440):
1. Top bar, transparent over the hero: RunwayLab wordmark left; New walk, The wall, Saved walks right.
2. Hero, full viewport height minus nothing (min 640 px): left 5/12 columns: kicker "The AI runway judge", H1 three
   lines with "Get judged." in accent, lede (2-3 lines), CTAs (Start a walk solid, See a sample, See the wall outline).
   Right 7/12: the runway scene canvas with live measurement callouts. Caption bottom right, small.
3. "How it works": three numbered steps in a row, then "Before you start" as four small items with icons.
4. "Most of your score is measured, not opinion": left headline + 70/30 bar; right two lists (Measured 70, Gemini 30)
   with point bars. Bars draw in on scroll.
5. "Checked against real walks": left text, right chart card.
6. Dark band "The same rules for every body": four principles + sources disclosure.
7. "Where your walk goes": privacy card, with a small lock/device glyph.
8. "Your saved walks" (only with saved walks: up to 3 rows + See all).
9. Closing CTA band: "Ready? It takes two minutes." + Start a walk.
10. Footer: credit (fox + Made by Annontrix), small and muted.

Phone (390): top bar one row; hero art first (≈ 360 px tall, figure centred), then kicker, H1 at ~44 px, lede, Start a
walk full width, then See a sample / See the wall side by side; caption. Sections stack single column, 64 px apart;
principles become a vertical list; chart card full width with labels above dots.

### Studio

Desktop:
1. Top bar.
2. Two columns. Left: stage (4:3, rounded 16, prompt over a bottom scrim, framing guides, timer chip top right while
   recording, countdown digit centred), step tracker under it, primary button under that (big, centred), problem
   panel, `[role=status]` live region. Right rail (sticky top 24): card "Before you walk": Score me on (`#rw-laps`),
   Stop by itself, Judge my walk toggle with legal small print; then card "Set up the runway" (5 steps, collapsible).
3. Below: three equal cards: Camera (Which camera, Picture / Camera reports / Measured here `.rw-fps`, tracker chip,
   Rotate picture), Music to walk to (`#rw-music`, volume, Preview, Use my own track, credit), Or upload a clip
   (Choose a video, `#rw-upload`, status).
4. Footer credit.
During recording: the rail and cards dim to 35% and are inert-looking (still focusable); the stage scrolls into view.

Phone: stage full bleed width minus 16 px gutters (aspect 3:4 if the camera is portrait, else 4:3); prompt at 28 px;
step tracker as one line "Step 2 of 6 · Stand tall" with dots; primary button full width, 56 px tall; Before you walk
card; Set up the runway (details, open when camera off); Camera, Music, Upload stacked; credit.

### Results (real and sample)

Desktop:
1. Top bar.
2. Sample only: banner (one line where it fits).
3. Head row: status pill (`.rw-pill`), editable name (`.rw-name`, 40 px, pencil) left; compact Walk again right.
4. Result: left 7/12 player (`.rw-player__video` / canvas, transport, Skeleton toggle) with the analysis overlay
   while running; ribbon (`.rw-ribbon__seg`) with legend and moment ticks. Right 5/12: label, `.rw-score__num`, /100,
   grade name, grade line, per-walk chips caption; verdict or judge card; insight tiles 2x2.
5. Breakdown band, two columns: left "Measured from your movement" `.rw-breakdown` with seven `.rw-bar` rows
   (expandable `.rw-why`); right "Gemini's opinion" with Presence and Style, the opinion disclaimer, then Moments
   (`.rw-moments`) timeline, then "What Gemini saw" stills (`.rw-still`).
6. Keep it band: left card "On this device" (socials field "Your socials, to be tagged" `@yourhandle`, Save changes /
   Save to this device, Walk again, Delete, "All changes saved"); right card "Post it to the wall".
7. Details: "The numbers behind this" (coverage `.rw-coverage`, `.rw-metric` grid, tracker line, Save the video file,
   Rotate video and analyze again).
8. Footer credit.

Phone: banner (sample) -> pill + name -> score block (number ~96 px) -> verdict/judge card -> player -> ribbon ->
insight tiles (1 column) -> Measured breakdown -> Gemini's opinion -> moments -> stills (3-column grid) -> Keep it
(device card, then wall card) -> details -> credit. Sticky bottom bar on phone after scrolling past the score:
"Walk again" + score chip, so the next walker can start without scrolling back.

### The wall

Desktop: heading "The wall" + one-line description left, Start a walk right; local-test banner if local; stats row
(4 tiles, hidden when empty); toolbar (Sort by select); podium row (top 3 large cards with rank numeral, skeleton
stage, name, score, match tag, verdict excerpt, Clap); grid of remaining cards (3 columns); Show more; the fairness
footnote; credit. Wall post page `#/wall/<id>`: back link, name + posted date, skeleton player left, score + verdict
+ closest walk right, The numbers disclosure, Copy link / Remove from the wall.

Phone: heading, description, Start a walk full width; stats as 2x2; sort select full width; cards single column with
skeleton thumb left (96 px) and text right; credit.

### Saved walks

Desktop: heading "Saved walks" + "On this device only..." left, Start a walk right; toolbar: Show, Sort by left,
Download all videos right; list rows: thumbnail, name, date, status line ("Judged. Closest walk: ..."), score at
right, Delete quiet at far right; empty states as specified; credit.

Phone: heading, description, Start a walk full width; Show and Sort by side by side; Download all videos full width;
rows: thumb, name and status stacked, score right; Delete as an icon-labelled quiet button under the row text.

---

## 6. Motion and feedback (restrained)

- Scroll: sections fade-rise 12 px once (IntersectionObserver), bars grow from 0 when visible. None under reduced motion.
- State: score counts up over 900 ms (exists), grade name fades in after; judging border shimmer; countdown digit
  scales 1.15 -> 1 per second; framing guides colour-fade 200 ms.
- Never animate layout on the stage while recording; nothing moves that the walker might mistake for a prompt.

## 7. Done means

- Every screen at 360, 390, 430, 768, 1440 in light and dark with no sideways scroll.
- Booth run: someone who has never seen it goes Home -> result in under 3 minutes without help.
- `npm test` and `npm run e2e` pass with no string or hook changes.
