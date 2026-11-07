import { h, fmtDate, sectionHead, num, icon, artSvg, reducedMotion } from './dom.mjs';
import { listWalks } from '../store/db.mjs';
import { createRunwayScene } from './scene.mjs';
import { PARTS, MEASURED_MAX, JUDGE_MAX, RULES, FOOTAGE } from '../lib/score.mjs';
import { generateRound } from '../lib/sampleWalk.mjs';
import { processFrames } from '../lib/process.mjs';

export function walkRow(walk) {
  const has = (x) => x !== null && x !== undefined;
  const score = has(walk.total)
    ? h('span', { class: 'rw-row__score' }, String(walk.total), h('small', null, '/100'))
    : has(walk.measuredPoints)
      ? h('span', { class: 'rw-row__score' }, String(walk.measuredPoints), h('small', null, '/70'))
      : h('span', { class: 'rw-row__score rw-row__score--none' }, 'No score');
  const status = walk.judged ? `Judged. Closest walk: ${walk.matchName}` : has(walk.measuredPoints) ? 'Measured only, no judge' : 'Not enough data to score';
  return h('a', { class: 'rw-row', href: `#/review/${walk.id}` },
    h('span', { class: 'rw-row__main' },
      h('strong', null, walk.name),
      h('span', { class: 'rw-row__meta' }, `${fmtDate(walk.createdAt)} · ${status}`),
      walk.socials ? h('span', { class: 'rw-row__socials' }, walk.socials) : null),
    score);
}

// The two parts Gemini scores. Its instructions are in api/judge.mjs.
const OPINION = [
  { label: 'Presence', max: 15, about: 'Confidence, intent and how you carry yourself.' },
  { label: 'Style', max: 15, about: 'How your outfit and attitude work together. Conviction beats expensive clothes.' },
];
const LARGEST_PART = Math.max(...PARTS.map((p) => p.max), ...OPINION.map((p) => p.max));

const SVG = 'http://www.w3.org/2000/svg';
/** A lamp, drawn like the sprite's icons (24 grid, 1.75 stroke, one accent point). The sprite has no light. */
function lightIcon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'rw-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = '<g fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></g><circle cx="12" cy="12" r="1.3" style="fill:var(--accent,#4E38B5)"/>';
  return svg;
}

const scoreRow = (part, tone, i) => h('li', { class: `rw-points__row rw-points__row--${tone}`, style: `--i:${i}` },
  h('span', { class: 'rw-points__num rw-num' }, String(part.max)),
  h('div', { class: 'rw-points__text' },
    h('h4', { class: 'rw-points__label' }, part.label),
    h('p', { class: 'rw-points__about' }, part.about),
    h('div', { class: `rw-bar rw-bar--compact${tone === 'opinion' ? ' rw-bar--opinion' : ''}`, 'aria-hidden': 'true' },
      h('div', { class: 'rw-bar__track' },
        h('div', { class: 'rw-bar__fill', style: `width:${(part.max / LARGEST_PART) * 100}%;--i:${i}` })))));

const fairness = (title, text) => h('div', { class: 'rw-fair__item' }, h('h3', null, title), h('p', null, text));

const source = (text, href, label) => h('li', null, text, ' ', h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label));

const need = (glyph, title, text) => h('li', { class: 'rw-needs__item' },
  h('span', { class: 'rw-needs__icon' }, glyph),
  h('h4', null, title),
  h('p', null, text));

const step = (n, glyph, title, text) => h('li', { class: 'rw-step' },
  h('div', { class: 'rw-step__mark', 'aria-hidden': 'true' },
    h('span', { class: 'rw-step__num' }, String(n)),
    h('span', { class: 'rw-step__icon' }, icon(glyph))),
  h('h3', null, title),
  h('p', null, text));

// The measurements that separated professional models from everyone else on real footage.
const FOOTAGE_ROWS = [
  { key: 'shoulderSway', label: 'Shoulder rock', unit: '°', max: 8, other: 'stock', otherName: 'stock clips' },
  { key: 'headMovement', label: 'Head movement', unit: '% of height', max: 7, other: 'stock', otherName: 'stock clips' },
  { key: 'footLine', label: 'Foot placement', unit: '% of height', max: 12, other: 'published', otherName: 'published everyday walking' },
];

/** A dot for each group on the scale the points are given on, which is shaded where marks are earned. */
function footageChart() {
  const legend = h('ul', { class: 'rw-legend' },
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--pros', 'aria-hidden': 'true' }), 'Professional models, Milan runway'),
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--other', 'aria-hidden': 'true' }), 'Everyday walkers'),
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--zone', 'aria-hidden': 'true' }), 'Where points are earned'));
  const rows = FOOTAGE_ROWS.map((row, i) => {
    const data = FOOTAGE[row.key];
    const { best, worst } = RULES[row.key];
    const at = (v) => `${(Math.min(v, row.max) / row.max) * 100}%`;
    const short = row.unit === '°' ? '°' : '%';
    const fmt = (v) => `${v.toFixed(1)}${short}`;
    const other = data[row.other];
    return h('li', { class: 'rw-dots__row', style: `--i:${i}` },
      h('div', { class: 'rw-dots__head' }, h('strong', null, row.label), h('span', { class: 'rw-dots__rule' }, `Full marks up to ${fmt(best)}, none from ${fmt(worst)}`)),
      h('div', {
        class: 'rw-dots__track',
        role: 'img',
        'aria-label': `${row.label}: professional models ${fmt(data.pros)}, ${row.otherName} ${fmt(other)}. Full marks up to ${fmt(best)}, none from ${fmt(worst)}.`,
      },
      h('span', { class: 'rw-dots__zone', style: `width:${at(worst)};--best:${(best / worst) * 100}%` },
        h('span', { class: 'rw-dots__best', style: `left:${(best / worst) * 100}%` })),
      h('span', { class: 'rw-dots__dot rw-dots__dot--pros', style: `left:${at(data.pros)}`, title: `Professional models: ${fmt(data.pros)}` }, h('span', { class: 'rw-dots__val' }, fmt(data.pros))),
      h('span', { class: 'rw-dots__dot rw-dots__dot--other', style: `left:${at(other)}`, title: `Everyday walkers, ${row.otherName}: ${fmt(other)}` }, h('span', { class: 'rw-dots__val' }, fmt(other)))));
  });
  return h('div', { class: 'rw-dots' }, legend, h('ul', { class: 'rw-dots__list' }, rows));
}

/** What the figure in the picture measures, worked out by the real code from its made-up walk. */
function sceneCallouts() {
  const { raw, W, H, duration } = generateRound('catwalk', { laps: 1 });
  const { metrics: m } = processFrames(raw, { W, H, duration });
  const list = [];
  if (m.headMovement.ok) list.push({ at: 'head', num: String(m.headMovement.value), unit: '% of height', label: 'Head steadiness' });
  if (m.shoulderSway.ok) list.push({ at: 'shoulders', num: String(m.shoulderSway.value), unit: '°', label: 'Shoulder rock' });
  if (m.cadence) list.push({ at: 'hips', num: String(m.cadence), unit: 'steps a minute', label: 'Rhythm' });
  if (m.footLine.ok) list.push({ at: 'feet', num: String(m.footLine.value), unit: '% of height', label: 'Foot placement' });
  return list.map((c) => ({ ...c, value: `${c.num}${c.unit === '°' ? '' : ' '}${c.unit}` }));
}

/** Fade sections up as they arrive, once. Content stays visible without JS, IntersectionObserver or motion. */
function revealOnScroll(root) {
  const items = [...root.querySelectorAll('[data-reveal]')];
  const show = (el) => el.classList.add('is-revealed');
  if (!('IntersectionObserver' in window) || reducedMotion()) {
    items.forEach(show);
    return null;
  }
  root.classList.add('rw-js-reveal');
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      show(entry.target);
      watcher.unobserve(entry.target);
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  items.forEach((el) => watcher.observe(el));
  return watcher;
}

export function homeScreen(root) {
  const recent = h('div', { class: 'rw-list rw-recent__list' }, h('p', { class: 'rw-muted' }, 'Checking for saved walks.'));
  const recentHead = h('div', { class: 'rw-recent__head' });
  const canvas = h('canvas', {
    class: 'rw-hero__canvas',
    role: 'img',
    'aria-label': 'A made-up figure walks down a lit runway toward you, with the points we track drawn on its body.',
  });
  const readouts = h('dl', { class: 'rw-hero__readouts', 'aria-label': 'Measured on the figure in the picture' });
  const divider = h('div', { class: 'rw-cta__art', 'aria-hidden': 'true' });

  root.append(
    h('section', { class: 'rw-hero rw-on-stage', 'aria-labelledby': 'rw-hero-title' },
      h('div', { class: 'rw-hero__picture' }, canvas, h('div', { class: 'rw-hero__scrim', 'aria-hidden': 'true' })),
      h('div', { class: 'rw-hero__inner' },
        h('div', { class: 'rw-hero__copy' },
          h('p', { class: 'rw-hero__kicker' }, 'The AI runway judge'),
          h('h1', { id: 'rw-hero-title', tabindex: '-1' },
            h('span', { class: 'rw-hero__line' }, 'Walk up.'), h('br', null),
            h('span', { class: 'rw-hero__line' }, 'Turn.'), h('br', null),
            h('span', { class: 'rw-hero__line rw-hero__accent' }, 'Get judged.')),
          h('p', { class: 'rw-hero__lede' }, 'Turn every runway walk into progress. Analyze your posture, refine your rhythm, and perfect your movement with personalized insights that help you walk with confidence.'),
          h('div', { class: 'rw-actions rw-actions--split rw-hero__actions' },
            h('a', { class: 'rw-btn rw-btn--solid rw-btn--big rw-actions__full', href: '#/studio' }, 'Start a walk'),
            h('a', { class: 'rw-btn rw-btn--big', href: '#/review/sample' }, 'See a sample'),
            h('a', { class: 'rw-btn rw-btn--big rw-hero__wall', href: '#/wall' }, 'See the wall'))),
        readouts),
      h('p', { class: 'rw-hero__caption' }, 'Illustration. A made-up figure, not a real person.')),

    h('section', { class: 'rw-section rw-how', 'aria-labelledby': 'rw-how-title' },
      h('div', { 'data-reveal': '' }, sectionHead({ eyebrow: 'How it works', title: 'Two minutes, three steps', id: 'rw-how-title' })),
      h('ol', { class: 'rw-steps', 'data-reveal': '' },
        step(1, 'walk', 'Walk', 'Stand tall for a moment, then walk up and back to the music, two or three times. Recording starts and stops by itself.'),
        step(2, 'score', 'Get measured', 'Your foot placement, rhythm, posture, line, arms and turn are worked out on this device, and each walk is measured by itself so one stumble cannot sink you.'),
        step(3, 'judge', 'Get judged', 'If you agree, Gemini sees a dozen stills with your face pixelated, and gives its opinion. You get your score, the reasoning behind every point, and the walk closest to yours.')),
      h('div', { class: 'rw-needs__wrap', 'data-reveal': '' },
        h('h3', { class: 'rw-needs__title' }, 'Before you start'),
        h('ul', { class: 'rw-needs' },
          need(icon('camera'), 'A camera at hip height', 'An iPhone through Continuity Camera works best, at 60 frames a second. Any webcam will do.'),
          need(icon('walk'), 'About 6 m of clear floor', 'You turn about 2.5 m from the camera, so start as far back as you can.'),
          need(lightIcon(), 'Light in front of you', 'A bright window behind you hides your pose from the tracker.'),
          need(icon('turn'), 'Two minutes', 'Stand tall for a moment, then walk up and back two or three times. It stops by itself.')))),

    h('section', { class: 'rw-section rw-score-guide', 'aria-labelledby': 'rw-score-title' },
      h('div', { class: 'rw-score-guide__intro', 'data-reveal': '' },
        sectionHead({
          eyebrow: 'Scoring',
          title: 'Most of your score is measured, not opinion',
          id: 'rw-score-title',
          lede: `${MEASURED_MAX} of the 100 points come from movement, on one scale for everyone. Gemini can add up to ${JUDGE_MAX}, and it never gets to state the total: the code adds it up.`,
        }),
        h('div', { class: 'rw-split' },
          h('div', { class: 'rw-split__line', role: 'img', 'aria-label': `${MEASURED_MAX} points measured, ${JUDGE_MAX} points of opinion` },
            h('span', { class: 'rw-split__part rw-split__part--measured', style: `flex-grow:${MEASURED_MAX}` }),
            h('span', { class: 'rw-split__part rw-split__part--opinion', style: `flex-grow:${JUDGE_MAX}` })),
          h('div', { class: 'rw-split__key', 'aria-hidden': 'true' },
            h('span', { class: 'rw-split__measured', style: `flex-grow:${MEASURED_MAX}` }, num(String(MEASURED_MAX), 'measured', { xl: true })),
            h('span', { class: 'rw-split__opinion', style: `flex-grow:${JUDGE_MAX}` }, num(String(JUDGE_MAX), 'opinion', { xl: true }))))),
      h('div', { class: 'rw-points' },
        h('div', { class: 'rw-points__group', 'data-reveal': '' },
          h('h3', { class: 'rw-points__head' }, `Measured, ${MEASURED_MAX} points`),
          h('ul', { class: 'rw-points__list' }, [...PARTS].sort((a, b) => b.max - a.max).map((p, i) => scoreRow(p, 'measured', i)))),
        h('div', { class: 'rw-points__group', 'data-reveal': '' },
          h('h3', { class: 'rw-points__head' }, `Gemini's opinion, ${JUDGE_MAX} points`),
          h('ul', { class: 'rw-points__list' }, OPINION.map((p, i) => scoreRow(p, 'opinion', i)))))),

    h('section', { class: 'rw-section rw-proof', 'aria-labelledby': 'rw-proof-title' },
      h('div', { class: 'rw-proof__intro', 'data-reveal': '' },
        sectionHead({
          eyebrow: 'Evidence',
          title: 'Checked against real walks',
          id: 'rw-proof-title',
          lede: 'We ran real footage through the same code: professional models walking at the camera in a Milan show, and people walking toward a camera in stock clips.',
        }),
        h('p', { class: 'rw-proof__more' }, 'The measurements that separated them carry the points. Bounce and trunk sway did not separate them, so they count for little, and only exaggeration costs much.')),
      h('figure', { class: 'rw-card rw-proof__figure', 'data-reveal': '' },
        footageChart(),
        h('figcaption', { class: 'rw-proof__caption' }, 'Middle values from 14 runway shots (9 with both feet clear) and 5 stock clips. The footage was not filmed for this, so treat it as a check on the rules, not a study. Everyday foot placement is from motion capture of 10 women (Moon and Choi 2025).'))),

    h('section', { class: 'rw-band rw-on-stage', 'aria-labelledby': 'rw-fair-title' },
      h('div', { class: 'rw-band__inner' },
        h('div', { 'data-reveal': '' }, sectionHead({ eyebrow: 'Fairness', title: 'The same rules for every body', id: 'rw-fair-title' })),
        h('div', { class: 'rw-fair', 'data-reveal': '' },
          fairness('Your height, not your frame', 'Every length is a share of your own height, measured while you stand still. Shoulder width would favour some bodies over others, so it is not used.'),
          fairness('Compared with you', 'Your head and shoulders are judged against how you stood a moment earlier, not against an average person.'),
          fairness('Hidden means left out', 'Long hair, a head covering or a gown costs nothing. What the camera cannot see is left out of your score, never marked down, and the result tells you when that happened.'),
          fairness('Noise is taken off', 'Standing still shows how much this camera and tracker wobble on their own. That amount is taken off what you walked, so their wobble is not counted as yours.')),
        h('details', { class: 'rw-details rw-sources', 'data-reveal': '' },
          h('summary', null, 'Where the numbers come from, and what this cannot do'),
          h('div', { class: 'rw-sources__body' },
            h('p', null, 'This is a game. No study sets targets for a runway walk, so the rules are ours, informed by what has been published:'),
            h('ul', null,
              source('Foot placement has the most points because it has the clearest evidence. 10 model applicants landed 1.54 cm apart, against 8.12 cm for 10 other women. The same authors warn that walking this narrowly may raise the risk of injury, so treat it as a game.', 'https://doi.org/10.5103/KJAB.2025.35.3.157', 'Moon and Choi, 2025'),
              source('Most people prefer a step width of about 0.13 leg lengths, because it costs the least energy.', 'https://doi.org/10.1098/rspb.2001.1761', 'Donelan, Kram and Kuo, 2001'),
              source('A single phone in front of the walker measured step width within about 1 to 3 cm of motion capture, which is why full marks for feet start at 2.5% of height.', 'https://doi.org/10.3390/s25216551', 'Ksoll and others, 2025'),
              source('In a study of 7 models and 10 other women on a treadmill, a steadier head was rated more attractive in heels, and so was a head tilted down. So only looking at the floor costs points here.', 'https://doi.org/10.1038/s41598-023-45130-2', 'Tanabe and Yamamoto, 2023'),
              source('Everyone\'s trunk sways about 3° from side to side, so trunk sway counts for little.', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC2843703/', 'Chung and others, 2010'),
              source('Everyone rises 3.6 to 4.9 cm with each step at ordinary speeds, so only exaggerated bounce costs points.', 'https://doi.org/10.1682/JRRD.2003.10.0150', 'Orendurff and others, 2004')),
            h('p', null, 'From the front, we cannot see forward lean, or how far your arms swing behind you. Trackers can be less accurate on some bodies and in some clothes, and we can reduce the effect of that but not remove it. Gemini\'s half is an opinion, even with its instructions to ignore body, face, age, race and gender.'))))),

    h('section', { class: 'rw-section rw-note rw-privacy', 'aria-labelledby': 'rw-privacy-title', 'data-reveal': '' },
      h('div', { class: 'rw-privacy__head' },
        h('span', { class: 'rw-privacy__icon' }, icon('device', { className: 'rw-icon rw-icon--lg' })),
        h('h2', { id: 'rw-privacy-title' }, 'Where your walk goes')),
      h('div', { class: 'rw-privacy__body' },
        h('p', null, 'Your video stays in this browser. It is temporary until you press Save, and it is never uploaded. Only two things can ever leave this device, each only if you choose: pixelated stills for Gemini to judge, and, if you post to the wall, your name, score and skeleton movement.'),
        h('p', { class: 'rw-privacy__csp' }, 'The browser enforces this: the page is only allowed to connect to its own site.'))),

    h('section', { class: 'rw-section rw-recent', 'aria-labelledby': 'rw-recent-title', 'data-reveal': '' },
      recentHead,
      recent),

    h('section', { class: 'rw-cta', 'aria-labelledby': 'rw-cta-title', 'data-reveal': '' },
      divider,
      h('h2', { class: 'rw-title rw-cta__title', id: 'rw-cta-title' }, 'Ready? It takes two minutes.'),
      h('div', { class: 'rw-actions rw-actions--center' },
        h('a', { class: 'rw-btn rw-btn--solid rw-btn--big rw-cta__btn', href: '#/studio' }, 'Start a walk'))),
  );

  // The heading of the saved walks block depends on whether there are any, so it starts as the plain title.
  const plainRecentHead = () => sectionHead({ title: 'Your saved walks', id: 'rw-recent-title' });
  recentHead.replaceChildren(plainRecentHead());

  artSvg('divider.svg', { decorative: true, className: 'rw-cta__divider' })
    .then((svg) => divider.append(svg))
    .catch(() => {});

  const scene = createRunwayScene(canvas, { labels: false });
  scene.start();
  const watcher = revealOnScroll(root);
  let alive = true;

  // The leaders on the picture run to the readout column, so the scene needs to know where its items sit.
  const placeLeaders = () => {
    if (!alive) return;
    const items = [...readouts.querySelectorAll('.rw-hero__readout')];
    const box = canvas.getBoundingClientRect();
    const column = readouts.getBoundingClientRect();
    const shown = items.length && column.width > 0 && getComputedStyle(readouts).getPropertyValue('--leaders').trim() === '1';
    if (!shown) {
      scene.setReadoutX(null);
      return;
    }
    const ys = {};
    for (const item of items) {
      const value = item.querySelector('dd').getBoundingClientRect();
      ys[item.dataset.at] = value.top + value.height / 2 - box.top;
    }
    scene.setReadoutX(column.left - box.left, ys);
  };
  const fitLeaders = new ResizeObserver(() => placeLeaders());
  fitLeaders.observe(canvas);
  fitLeaders.observe(readouts);

  // The walk behind the readouts takes a moment to measure, so it waits until the picture is already moving.
  const labels = setTimeout(() => {
    if (!alive) return;
    const callouts = sceneCallouts();
    readouts.replaceChildren(...callouts.map((c) => h('div', { class: 'rw-hero__readout', 'data-at': c.at },
      h('dt', null, c.label),
      h('dd', null, num(c.num, c.unit)))));
    scene.setCallouts(callouts);
    placeLeaders();
  }, 250);

  listWalks()
    .then((walks) => {
      if (!alive) return;
      recent.replaceChildren();
      if (!walks.length) {
        recent.classList.add('rw-recent__list--empty');
        recent.append(h('p', { class: 'rw-recent__empty' },
          icon('walk'),
          h('span', null, 'The runway is empty. Walks you save appear in ', h('a', { href: '#/history' }, 'Saved walks'), '.')));
        return;
      }
      recentHead.replaceChildren(sectionHead({
        title: 'Your saved walks',
        id: 'rw-recent-title',
        action: h('a', { class: 'rw-btn rw-btn--quiet', href: '#/history' }, 'See all'),
      }));
      recent.append(...walks.slice(0, 3).map(walkRow));
    })
    .catch((err) => {
      if (!alive) return;
      recent.replaceChildren(h('p', { class: 'rw-error' }, icon('alert'), h('span', null, `Saved walks could not be read. ${err.message}`)));
    });

  return {
    cleanup() {
      alive = false;
      clearTimeout(labels);
      fitLeaders.disconnect();
      watcher?.disconnect();
      root.classList.remove('rw-js-reveal');
      scene.stop();
    },
  };
}
