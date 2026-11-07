import { h, fmtDate } from './dom.mjs';
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

const scoreRow = (part, tone) => h('li', { class: 'rw-points__row' },
  h('span', { class: 'rw-points__num' }, String(part.max)),
  h('div', { class: 'rw-points__text' },
    h('h3', null, part.label),
    h('p', { class: 'rw-muted' }, part.about),
    h('span', { class: `rw-points__bar rw-points__bar--${tone}`, style: `width:${(part.max / LARGEST_PART) * 100}%`, 'aria-hidden': 'true' })));

const fairness = (title, text) => h('div', { class: 'rw-fair__item' }, h('h3', null, title), h('p', null, text));

const source = (text, href, label) => h('li', null, text, ' ', h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, label));

const need = (title, text) => h('li', null, h('h3', null, title), h('p', { class: 'rw-muted' }, text));

// The measurements that separated professional models from everyone else on real footage.
const FOOTAGE_ROWS = [
  { key: 'shoulderSway', label: 'Shoulder rock', unit: '°', max: 8, other: 'stock', otherName: 'stock clips' },
  { key: 'headMovement', label: 'Head movement', unit: '% of height', max: 7, other: 'stock', otherName: 'stock clips' },
  { key: 'footLine', label: 'Foot placement', unit: '% of height', max: 9, other: 'published', otherName: 'published everyday walking' },
];

/** A dot for each group on the scale the points are given on, which is shaded where marks are earned. */
function footageChart() {
  const legend = h('ul', { class: 'rw-legend' },
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--pros', 'aria-hidden': 'true' }), 'Professional models, Milan runway'),
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--other', 'aria-hidden': 'true' }), 'Everyday walkers'),
    h('li', null, h('span', { class: 'rw-dots__key rw-dots__key--zone', 'aria-hidden': 'true' }), 'Where points are earned'));
  const rows = FOOTAGE_ROWS.map((row) => {
    const data = FOOTAGE[row.key];
    const { best, worst } = RULES[row.key];
    const at = (v) => `${(Math.min(v, row.max) / row.max) * 100}%`;
    const short = row.unit === '°' ? '°' : '%';
    const fmt = (v) => `${v.toFixed(1)}${short}`;
    const other = data[row.other];
    return h('li', { class: 'rw-dots__row' },
      h('div', { class: 'rw-dots__head' }, h('strong', null, row.label), h('span', { class: 'rw-muted rw-small' }, `Full marks up to ${fmt(best)}, none from ${fmt(worst)}`)),
      h('div', {
        class: 'rw-dots__track',
        role: 'img',
        'aria-label': `${row.label}: professional models ${fmt(data.pros)}, ${row.otherName} ${fmt(other)}. Full marks up to ${fmt(best)}, none from ${fmt(worst)}.`,
      },
      h('span', { class: 'rw-dots__zone', style: `width:${at(worst)};--best:${(best / worst) * 100}%` }),
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
  if (m.headMovement.ok) list.push({ at: 'head', value: `${m.headMovement.value}% of height`, label: 'Head steadiness' });
  if (m.shoulderSway.ok) list.push({ at: 'shoulders', value: `${m.shoulderSway.value}°`, label: 'Shoulder rock' });
  if (m.cadence) list.push({ at: 'hips', value: `${m.cadence} steps a minute`, label: 'Rhythm' });
  if (m.footLine.ok) list.push({ at: 'feet', value: `${m.footLine.value}% of height`, label: 'Foot placement' });
  return list;
}

export function homeScreen(root) {
  const recent = h('div', { class: 'rw-list' }, h('p', { class: 'rw-muted' }, 'Checking for saved walks.'));
  const canvas = h('canvas', {
    class: 'rw-hero__canvas',
    role: 'img',
    'aria-label': 'A made-up figure walks down a lit runway toward you, with the points we track drawn on its body.',
  });

  root.append(
    h('section', { class: 'rw-hero' },
      canvas,
      h('div', { class: 'rw-hero__scrim' }),
      h('div', { class: 'rw-hero__inner' },
        h('p', { class: 'rw-hero__kicker' }, 'The AI runway judge'),
        h('h1', { tabindex: '-1' }, 'Walk up.', h('br', null), 'Turn.', h('br', null), h('span', { class: 'rw-hero__accent' }, 'Get judged.')),
        h('p', { class: 'rw-hero__lede' }, 'Walk toward the camera and back. We follow 26 points on your body to measure how you really move, Gemini judges your presence and style, and you find out if you have a runway walk.'),
        h('div', { class: 'rw-actions' },
          h('a', { class: 'rw-btn rw-btn--solid rw-btn--big', href: '#/studio' }, 'Start a walk'),
          h('a', { class: 'rw-btn rw-btn--big', href: '#/review/sample' }, 'See a sample'),
          h('a', { class: 'rw-btn rw-btn--big rw-hero__wall', href: '#/wall' }, 'See the wall'))),
      h('p', { class: 'rw-hero__caption' }, 'Illustration. A made-up figure, not a real person.')),

    h('section', { class: 'rw-section' },
      h('h2', { class: 'rw-section__title' }, 'How it works'),
      h('ol', { class: 'rw-steps' },
        h('li', { class: 'rw-step' },
          h('span', { class: 'rw-step__num', 'aria-hidden': 'true' }, '1'),
          h('h3', null, 'Walk'),
          h('p', null, 'Stand tall for a moment, then walk up and back to the music, up to three times. Recording starts and stops by itself.')),
        h('li', { class: 'rw-step' },
          h('span', { class: 'rw-step__num', 'aria-hidden': 'true' }, '2'),
          h('h3', null, 'Get measured'),
          h('p', null, 'Your foot placement, rhythm, posture, line, arms and turn are worked out on this device, and each walk is measured by itself so one stumble cannot sink you.')),
        h('li', { class: 'rw-step' },
          h('span', { class: 'rw-step__num', 'aria-hidden': 'true' }, '3'),
          h('h3', null, 'Get judged'),
          h('p', null, 'If you agree, Gemini sees a dozen stills with your face pixelated, and gives its opinion. You get your score, the reasoning behind every point, and the walk closest to yours.'))),
      h('h3', { class: 'rw-needs__title' }, 'Before you start'),
      h('ul', { class: 'rw-needs' },
        need('A camera at hip height', 'An iPhone through Continuity Camera works best, at 60 frames a second. Any webcam will do.'),
        need('About 6 m of clear floor', 'You turn about 2.5 m from the camera, so start as far back as you can.'),
        need('Light in front of you', 'A bright window behind you hides your pose from the tracker.'),
        need('Two minutes', 'Stand tall for a moment, then walk up and back two or three times. It stops by itself.'))),

    h('section', { class: 'rw-section rw-score-guide' },
      h('div', { class: 'rw-score-guide__intro' },
        h('h2', { class: 'rw-section__title' }, `Most of your score is measured, not opinion`),
        h('p', { class: 'rw-lede' }, `${MEASURED_MAX} of the 100 points come from movement, on one scale for everyone. Gemini can add up to ${JUDGE_MAX}, and it never gets to state the total: the code adds it up.`),
        h('div', { class: 'rw-split', role: 'img', 'aria-label': `${MEASURED_MAX} points measured, ${JUDGE_MAX} points of opinion` },
          h('span', { class: 'rw-split__part rw-split__part--measured', style: `flex-grow:${MEASURED_MAX}` }),
          h('span', { class: 'rw-split__part rw-split__part--opinion', style: `flex-grow:${JUDGE_MAX}` })),
        h('div', { class: 'rw-split__key' },
          h('span', null, h('strong', null, String(MEASURED_MAX)), ' measured'),
          h('span', null, h('strong', null, String(JUDGE_MAX)), ' opinion'))),
      h('div', { class: 'rw-points' },
        h('h3', { class: 'rw-points__head' }, `Measured, ${MEASURED_MAX} points`),
        h('ul', { class: 'rw-points__list' }, [...PARTS].sort((a, b) => b.max - a.max).map((p) => scoreRow(p, 'measured'))),
        h('h3', { class: 'rw-points__head' }, `Gemini's opinion, ${JUDGE_MAX} points`),
        h('ul', { class: 'rw-points__list' }, OPINION.map((p) => scoreRow(p, 'opinion'))))),

    h('section', { class: 'rw-section rw-proof' },
      h('div', { class: 'rw-proof__intro' },
        h('h2', { class: 'rw-section__title' }, 'Checked against real walks'),
        h('p', { class: 'rw-lede' }, 'We ran real footage through the same code: professional models walking at the camera in a Milan show, and people walking toward a camera in stock clips.'),
        h('p', { class: 'rw-muted' }, 'The measurements that separated them carry the points. Bounce and trunk sway did not separate them, so they count for little, and only exaggeration costs much.')),
      h('figure', { class: 'rw-proof__figure' },
        footageChart(),
        h('figcaption', { class: 'rw-muted rw-small' }, 'Middle values from 14 runway shots (9 with both feet clear) and 5 stock clips. The footage was not filmed for this, so treat it as a check on the rules, not a study. Everyday foot placement is from motion capture of 10 women (Moon and Choi 2025).'))),

    h('section', { class: 'rw-band' },
      h('div', { class: 'rw-band__inner' },
        h('h2', { class: 'rw-section__title' }, 'The same rules for every body'),
        h('div', { class: 'rw-fair' },
          fairness('Your height, not your frame', 'Every length is a share of your own height, measured while you stand still. Shoulder width would favour some bodies over others, so it is not used.'),
          fairness('Compared with you', 'Your head and shoulders are judged against how you stood a moment earlier, not against an average person.'),
          fairness('Hidden means left out', 'Long hair, a head covering or a gown costs nothing. What the camera cannot see is left out of your score, never marked down, and the result tells you when that happened.'),
          fairness('Noise is taken off', 'Standing still shows how much this camera and tracker wobble on their own. That amount is taken off what you walked, so their wobble is not counted as yours.')),
        h('details', { class: 'rw-sources' },
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

    h('section', { class: 'rw-section' },
      h('div', { class: 'rw-block__head' }, h('h2', { class: 'rw-section__title' }, 'Your saved walks'), h('a', { href: '#/history' }, 'See all')),
      recent),

    h('section', { class: 'rw-section rw-note' },
      h('h2', null, 'Where your walk goes'),
      h('p', null, 'Your video stays in this browser. It is temporary until you press Save, and it is never uploaded. Only two things can ever leave this device, each only if you choose: pixelated stills for Gemini to judge, and, if you post to the wall, your name, score and skeleton movement.'),
      h('p', null, 'The browser enforces this: the page is only allowed to connect to its own site.')),
  );

  const scene = createRunwayScene(canvas);
  scene.start();
  let alive = true;
  // The walk behind the labels takes a moment to measure, so it waits until the picture is already moving.
  const labels = setTimeout(() => {
    if (alive) scene.setCallouts(sceneCallouts());
  }, 250);

  listWalks()
    .then((walks) => {
      if (!alive) return;
      recent.replaceChildren();
      if (!walks.length) {
        recent.append(h('div', { class: 'rw-empty' },
          h('p', { class: 'rw-empty__title' }, 'The runway is empty.'),
          h('p', { class: 'rw-muted' }, 'Walks you choose to save appear here, on this device only.')));
        return;
      }
      recent.append(...walks.slice(0, 4).map(walkRow));
    })
    .catch((err) => {
      if (!alive) return;
      recent.replaceChildren(h('p', { class: 'rw-error' }, `Saved walks could not be read. ${err.message}`));
    });

  return {
    cleanup() {
      alive = false;
      clearTimeout(labels);
      scene.stop();
    },
  };
}
