// The game score: 70 points measured from movement, 30 from Gemini. Most of it is measured, so everyone is held
// to exactly the same rules, whatever they look like.
//
// Fairness comes from how the numbers are made: lengths are a share of the person's own height, posture is
// compared with how they stood, tracker noise from this setup is taken off, and anything that could not be seen
// is left out rather than marked down, so long hair, a head covering or a gown costs nothing.
//
// The rules below are ours, informed by published values where they exist. Foot placement has the most weight
// because it has the strongest evidence: 10 model applicants averaging 177 cm landed 1.54 cm apart, against 8.12 cm
// for 10 other women averaging 172 cm (Moon and Choi 2025), and people prefer about 0.13 leg lengths (Donelan 2001).
// As a share of height that is about 1% against 5 to 7%. Published sideways trunk movement is about 3.3 degrees (Chung 2010), and centre of
// mass rise is 2.7 to 4.8 cm (Orendurff 2004), which is why ordinary values land mid-scale on those two. No
// published study sets runway targets for the rest, so this is a game, and the app says so.
// Bump the version if the rules change.
export const SCORE_RULES_VERSION = 'rl-score-4';
/** Below this many measurable points of the 70, there is too little to give a fair score. */
export const MIN_MEASURED_POINTS = 40;

export const MEASURED_MAX = 70;
export const JUDGE_MAX = 30;

/** What earns the 70 measured points, in the order the result shows them. */
export const PARTS = [
  { key: 'footLine', label: 'Foot placement', max: 20, about: 'Runway walks land each foot close to one straight line.' },
  { key: 'rhythm', label: 'Rhythm', max: 12, about: 'Even steps at a steady speed.' },
  { key: 'posture', label: 'Posture', max: 18, about: 'Tall, level and quiet through the upper body.' },
  { key: 'line', label: 'Straight line', max: 6, about: 'Walking a straight path there and back, wherever it points.' },
  { key: 'head', label: 'Head steadiness', max: 6, about: 'A still head, with the body moving beneath it.' },
  { key: 'arms', label: 'Arms', max: 4, about: 'Relaxed, even and not stiff.' },
  { key: 'turn', label: 'Turn', max: 4, about: 'One clean pivot, with no wandering.' },
];

/** 1 at or below `best`, 0 at or above `worst`, a straight line between. Works in either direction. */
export function ramp(x, best, worst) {
  if (best < worst) return x <= best ? 1 : x >= worst ? 0 : (worst - x) / (worst - best);
  return x >= best ? 1 : x <= worst ? 0 : (x - worst) / (best - worst);
}

export const RULES = {
  footLine: { best: 2, worst: 7 },
  stepRhythm: { best: 0.05, worst: 0.2 },
  pace: { best: 0.12, worst: 0.5 },
  shoulderSway: { best: 1.2, worst: 5 },
  shoulderLevel: { best: 0.8, worst: 4 },
  trunkSway: { best: 0.8, worst: 3.5 },
  bounce: { best: 1.2, worst: 3.5 },
  neck: { best: 12, worst: 7.3 },
  gaze: { best: 1.5, worst: 4.7 },
  neckDrop: { best: 0.6, worst: 3.5 },
  gazeDrop: { best: 0.45, worst: 2.6 },
  headTilt: { best: 1.5, worst: 8 },
  torsoSpread: { best: 2.5, worst: 11 },
  headMovement: { best: 2, worst: 9 },
  armBalance: { best: 0.75, worst: 0.3 },
  turnTime: { best: 2.2, worst: 6 },
  turnWobble: { best: 12, worst: 47 },
};

/** A relaxed swing earns full marks. Arms held stiff, or flailing, earn less. */
export function armAmount(x) {
  if (x < 3) return ramp(x, 3, 0.6);
  if (x > 20) return ramp(x, 20, 38);
  return 1;
}

const of = (metrics, key) => (metrics[key]?.ok ? ramp(metrics[key].value, RULES[key].best, RULES[key].worst) : null);

/** Weighted average over the parts that could be measured. @returns null if none could. */
function blend(parts) {
  let earned = 0;
  let weight = 0;
  for (const [quality, w] of parts) {
    if (quality === null) continue;
    weight += w;
    earned += quality * w;
  }
  return weight ? earned / weight : null;
}

const pretty = (value, digits = 1) => (value === null || value === undefined ? 'unknown' : String(Math.round(value * 10 ** digits) / 10 ** digits));
const unitOf = (unit) => (unit === '°' ? '°' : unit === 's' ? ' s' : unit === 'variation' ? '%' : unit === 'ratio' ? '' : '% of your height');
const shown = (m) => (m.unit === 'variation' ? m.value * 100 : m.value);

/** One line of reasoning: what was measured, the scale it is held to, and how much of the marks it earned. */
function reason(metrics, key, label) {
  const m = metrics[key];
  const rule = RULES[key];
  if (!m?.ok) return { label, value: 'No data', scale: m?.why ?? 'Not enough usable data.', share: null };
  const scaleValue = (x) => (m.unit === 'variation' ? x * 100 : x);
  const lowerIsBetter = rule.best < rule.worst;
  const u = unitOf(m.unit);
  return {
    label,
    value: `${pretty(shown(m), m.unit === 'ratio' ? 2 : 1)}${u}`,
    scale: `Full marks at ${pretty(scaleValue(rule.best), 2)}${u} or ${lowerIsBetter ? 'less' : 'more'}, none at ${pretty(scaleValue(rule.worst), 2)}${u} or ${lowerIsBetter ? 'more' : 'less'}.`,
    share: Math.round(ramp(m.value, rule.best, rule.worst) * 100),
  };
}

/** Criteria in display order, with feedback and reasoning written from the measured values. */
function criteria(m) {
  const list = [];
  const add = (key, quality, note, tip, why) => {
    const seen = quality !== null;
    const { label, max, about } = PARTS.find((p) => p.key === key);
    list.push({ key, label, max, points: seen ? Math.round(quality * max) : 0, quality: seen ? quality : 0, about, note, tip, why, seen });
  };

  const foot = of(m, 'footLine');
  add('footLine', foot,
    foot === null ? m.footLine.why : `Your feet landed ${pretty(m.footLine.value)}% of your height apart, side to side.`,
    'Place each foot directly in front of the other, as if walking along a line on the floor.',
    [reason(m, 'footLine', 'Distance between feet')]);

  const rhythm = of(m, 'stepRhythm');
  const pace = of(m, 'pace');
  add('rhythm', blend([[rhythm, 6], [pace, 4]]),
    rhythm === null && pace === null ? m.stepRhythm.why : [
      rhythm === null ? null : `Your step timing varied by ${pretty(m.stepRhythm.value * 100, 0)}%.`,
      pace === null ? null : `Your speed varied by ${pretty(m.pace.value * 100, 0)}%.`,
      m.cadence ? `You took ${m.cadence} steps a minute.` : null,
    ].filter(Boolean).join(' '),
    'Walk to a steady count in your head, and hold the same speed from start to finish.',
    [reason(m, 'stepRhythm', 'Step timing'), reason(m, 'pace', 'Speed')]);

  const shoulders = of(m, 'shoulderSway');
  const level = of(m, 'shoulderLevel');
  const trunk = of(m, 'trunkSway');
  const bounce = of(m, 'bounce');
  // Compared with their own standing posture when calibration has it, which is fairer to every build.
  const usingStance = m.neckDrop?.ok;
  const neck = usingStance ? of(m, 'neckDrop') : of(m, 'neck');
  const gaze = m.gazeDrop?.ok ? of(m, 'gazeDrop') : of(m, 'gaze');
  const tilt = of(m, 'headTilt');
  add('posture', blend([[shoulders, 4], [level, 2], [trunk, 4], [neck, 3], [gaze, 2], [bounce, 3], [tilt, 2]]),
    `Your shoulders rocked ${pretty(m.shoulderSway.value)}° and your trunk swayed ${pretty(m.trunkSway.value)}°.${m.neckDrop?.ok ? ` Your head sat ${pretty(m.neckDrop.value)}% of your height lower than when you stood tall.` : ''}`,
    gaze !== null && gaze < 0.5 ? 'Lift your chin and look straight ahead, not at the floor.' : neck !== null && neck < 0.5 ? 'Keep the height you had standing still: grow tall through your neck as you walk.' : 'Stand tall with level shoulders, and let your legs do the moving.',
    [
      reason(m, 'shoulderSway', 'Shoulder rock'),
      reason(m, 'shoulderLevel', 'Shoulder level'),
      reason(m, 'trunkSway', 'Trunk sway'),
      reason(m, usingStance ? 'neckDrop' : 'neck', usingStance ? 'Head drop' : 'Head height'),
      reason(m, m.gazeDrop?.ok ? 'gazeDrop' : 'gaze', m.gazeDrop?.ok ? 'Chin drop' : 'Chin'),
      ...(tilt === null ? [] : [reason(m, 'headTilt', 'Head tilt')]),
      reason(m, 'bounce', 'Bounce'),
    ]);

  const line = of(m, 'torsoSpread');
  add('line', line,
    line === null ? m.torsoSpread.why : `You strayed ${pretty(m.torsoSpread.value)}% of your height from a straight path.`,
    'Pick a point straight ahead and walk directly at it.',
    [reason(m, 'torsoSpread', 'Straying from your path')]);

  const head = of(m, 'headMovement');
  add('head', head,
    head === null ? m.headMovement.why : `Your head moved ${pretty(m.headMovement.value)}% of your height side to side.`,
    'Keep your head still and your eyes on one point.',
    [reason(m, 'headMovement', 'Head movement')]);

  const amount = m.armSwing.ok ? armAmount(m.armSwing.value) : null;
  const balance = of(m, 'armBalance');
  add('arms', blend([[amount, 1], [balance, 1]]),
    amount === null ? m.armSwing.why : `Your wrists swung ${pretty(m.armSwing.value)}% of your height, with a left-right balance of ${pretty(m.armBalance.value, 2)}.`,
    'Let both arms swing loosely from the shoulder, by the same amount.',
    [
      amount === null
        ? { label: 'Arm swing', value: 'No data', scale: m.armSwing.why, share: null }
        : { label: 'Arm swing', value: `${pretty(m.armSwing.value)}% of your height`, scale: 'Full marks between 3% and 20% of your height. Stiffer or wilder earns less.', share: Math.round(amount * 100) },
      reason(m, 'armBalance', 'Left-right balance'),
    ]);

  const time = of(m, 'turnTime');
  const wobble = of(m, 'turnWobble');
  add('turn', blend([[time, 1], [wobble, 1]]),
    time === null ? m.turnTime.why : `Your turn took ${pretty(m.turnTime.value)} seconds.`,
    'Plant your foot, pivot once, and leave at the same pace you arrived.',
    [reason(m, 'turnTime', 'Turn time'), reason(m, 'turnWobble', 'Hip wander')]);

  return list;
}

/**
 * Up to 70 points from the measurements. Refuses to score unless the data passed its gates and a real walk up
 * and back was seen. Otherwise someone standing perfectly still would score well. A part that could not be seen
 * is left out, and the rest are scaled up to 70, so nobody loses marks for what they wear.
 */
export function measuredScore(metrics, phases) {
  const refuse = (why) => ({ ok: false, reason: why, points: null, max: MEASURED_MAX, parts: [], rules: SCORE_RULES_VERSION, focus: null });
  if (!metrics.gate.ok) return refuse(metrics.gate.reason);
  if (phases.shape !== 'up-and-back') {
    return refuse('We did not see a walk toward the camera and back, so there is nothing to score. Any measurements below still describe the clip.');
  }
  for (const key of ['shoulderSway', 'trunkSway', 'torsoSpread']) {
    if (!metrics[key].ok) return refuse(`One measurement did not have enough data: ${metrics[key].why}`);
  }
  const parts = criteria(metrics);
  const seen = parts.filter((p) => p.seen);
  const seenMax = seen.reduce((sum, p) => sum + p.max, 0);
  if (seenMax < MIN_MEASURED_POINTS) return refuse(`We could only measure ${seenMax} of the ${MEASURED_MAX} points, which is too little for a fair score. Keep your whole body in frame.`);
  const earned = seen.reduce((sum, p) => sum + p.points, 0);
  // The biggest available win, for the coaching line.
  const focus = [...seen].sort((a, b) => (b.max - b.points) - (a.max - a.points))[0];
  return {
    ok: true,
    reason: null,
    points: Math.round((earned * MEASURED_MAX) / seenMax),
    max: MEASURED_MAX,
    parts,
    // Set only when something could not be seen, so the app can say so beside the score.
    scaled: seenMax < MEASURED_MAX ? { earned, seenMax, unseen: parts.filter((p) => !p.seen).map((p) => p.label) } : null,
    rules: SCORE_RULES_VERSION,
    focus: focus.points < focus.max ? { label: focus.label, tip: focus.tip, gain: focus.max - focus.points } : null,
  };
}

/** The total only exists when both halves do. Code adds it up; Gemini never gets to state a total. */
export function totalScore(measured, judge) {
  if (!measured?.ok || !judge?.ok) return null;
  return measured.points + judge.presence.score + judge.style.score;
}

const GRADES = [
  { min: 90, label: 'Front row silence', line: 'Rare air. Nobody is looking at their phone.' },
  { min: 75, label: 'Runway ready', line: 'A real walk, with intent in every step.' },
  { min: 60, label: 'Has a walk', line: 'Good foundations, and one or two habits to clean up.' },
  { min: 40, label: 'Warming up', line: 'A normal walk with hints of a runway one.' },
  { min: 0, label: 'Just passing through', line: 'A walk to the shops, not the catwalk. Yet.' },
];

/** A name for a score. For a partial score, pass the share of the available points. */
export const gradeFor = (percent) => GRADES.find((g) => percent >= g.min);
