// Plans one showreel edit from a tracked walk: which moments go where, the captions, the palette and the beat
// grid. Pure functions, so the plan can be tested without rendering anything.
import { gradeFor } from '../../src/lib/score.mjs';

export const PALETTES = {
  violet: { ink: '#F7F3EC', stage: '#141210', accent: '#B3A1FF', deep: '#5B3FC4', hot: '#FF5A36' },
  ember: { ink: '#FFF6EC', stage: '#140D09', accent: '#FFB067', deep: '#8A3412', hot: '#FFE14D' },
  acid: { ink: '#F2FFF0', stage: '#0A100C', accent: '#C6FF3D', deep: '#1F6B3F', hot: '#FF3DA8' },
  ice: { ink: '#F0FAFF', stage: '#080E14', accent: '#8BDCFF', deep: '#1B4F7A', hot: '#FF5A36' },
};

// Caption banks. Each edit draws a set no recent edit used, and any line can be overridden.
export const CAPTIONS = {
  intro: [['CAN CODE', 'JUDGE', 'A WALK?'], ['NO JUDGES.', 'JUST', 'MATH.'], ['38 POINTS.', 'ONE', 'WALK.'], ['WALK', 'LIKE IT', 'COUNTS.'], ['EVERY STEP', 'IS', 'DATA.'],
    ['THE RUNWAY', 'IS', 'WATCHING.'], ['POSTURE.', 'PACE.', 'PRESENCE.'], ['MEASURED', 'IN', 'MOTION.'], ['NOT VIBES.', 'PURE', 'SIGNAL.'], ['STEP', 'INTO', 'FRAME.']],
  turn: ['THE TURN', 'PIVOT', '180°', 'TURN IT', 'BACK AROUND'],
  posture: ['POSTURE', 'SPINE', 'ALIGNMENT', 'STAND TALL'],
  balance: ['BALANCE', 'SYMMETRY', 'CENTRED', 'MIRROR'],
  sequence: ['EVERY STEP', 'FRAME BY FRAME', 'IN SEQUENCE', 'STEP. STEP.'],
  chronoSub: ['MEASURED, NOT GUESSED', 'TRACKED AT 60 HZ', 'EVERY POSE, KEPT', 'NO GUESSWORK', 'READ BY THE TRACKER'],
};

/** A small seeded random, so the same seed gives the same edit. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (rand, list, avoid = []) => {
  const fresh = list.filter((x) => !avoid.some((a) => JSON.stringify(a) === JSON.stringify(x)));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(rand() * pool.length)];
};

const ordered = (pts) => pts?.[11] && pts?.[12];
/** Facing the camera, the person's left shoulder is on the right of the picture. */
const facingCamera = (f) => (ordered(f.pts) ? f.pts[11][0] > f.pts[12][0] : null);

/** Splits the walk's windows into ones toward the camera and ones walking away, by which way the shoulders face. */
export function splitWindows(an) {
  const windows = an.phases.windows?.length ? an.phases.windows : [an.phases.approach, an.phases.back].filter(Boolean);
  const toward = [], away = [];
  for (const [a, b] of windows) {
    const votes = an.frames.filter((f) => f.t >= a && f.t <= b).map(facingCamera).filter((v) => v !== null);
    (votes.filter(Boolean).length >= votes.length / 2 ? toward : away).push([a, b]);
  }
  if (!toward.length) toward.push([0, an.duration * 0.45]);
  return { toward, away };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const at = (w, share) => w[0] + (w[1] - w[0]) * share;

/**
 * @param an       processFrames output plus W, H, duration
 * @param music    { bpm, beat }
 * @param options  { seed, palette, captions (overrides), socials, history (past plans' captions and palettes) }
 */
export function planShowreel(an, music, { seed = 1, palette = null, captions = {}, socials = '', history = [] } = {}) {
  const rand = seeded(seed);
  const B = music.beat;
  const { toward, away } = splitWindows(an);
  const first = toward[0], last = toward.at(-1), middle = toward[Math.min(1, toward.length - 1)];
  const m = an.metrics;
  const value = (key, digits = 1) => (m[key]?.ok ? Math.round(m[key].value * 10 ** digits) / 10 ** digits : null);

  // About 15 s whatever the tempo: the montage takes up the slack, one cut per beat.
  const montageBeats = clamp(Math.round(15 / B - 24.5), 3, 8);
  const priority = ['shoulders', 'feet', 'triptych', 'head', 'mirror', 'lines', 'back'].filter((f) => f !== 'back' || away.length);
  const focuses = [...priority.slice(0, montageBeats - 1), 'whip'];
  const detail = (focus, i) => {
    const w = focus === 'back' ? away[0] : focus === 'triptych' || focus === 'mirror' || focus === 'whip' ? last : middle;
    const share = [0.3, 0.45, 0.6, 0.72][i % 4];
    return { focus, src: at(w, focus === 'whip' ? 0.8 : share), zoom: { feet: 2.6, shoulders: 2.3, head: 3.2, back: 1.15, mirror: 1.05 }[focus] ?? 1, moments: focus === 'triptych' ? [at(w, 0.2), at(w, 0.5), at(w, 0.8)] : null };
  };

  const turn = an.phases.turn ?? [first[1], first[1] + 1.2];
  const pastIntros = history.map((h) => h.captions?.intro).filter(Boolean);
  const chosen = {
    intro: captions.intro ?? pick(rand, CAPTIONS.intro, pastIntros),
    turn: captions.turn ?? pick(rand, CAPTIONS.turn),
    posture: captions.posture ?? pick(rand, CAPTIONS.posture),
    balance: captions.balance ?? pick(rand, CAPTIONS.balance),
    sequence: captions.sequence ?? pick(rand, CAPTIONS.sequence),
    chronoTitle: captions.chronoTitle ?? (m.stepCount ? `${m.stepCount} STEPS` : 'EVERY STEP'),
    chronoSub: captions.chronoSub ?? pick(rand, CAPTIONS.chronoSub),
  };
  const pastPalettes = history.slice(-2).map((h) => h.palette);
  const paletteName = palette ?? pick(rand, Object.keys(PALETTES), pastPalettes);
  const measured = an.measured;
  const part = (label) => measured.parts?.find((p) => p.label === label);
  const sections = { intro: 0, drop: 3, turn: 9, montage: 13, chrono: 13 + montageBeats, score: 17 + montageBeats, end: 24.5 + montageBeats };

  return {
    beat: B, bpm: music.bpm, seconds: sections.end * B, sections, palette: PALETTES[paletteName], paletteName,
    source: { w: an.W, h: an.H },
    still: at(first, 0.5),
    drop: { start: Math.max(0, Math.min(first[0], an.duration - 6 * B - 0.1)) },
    turn: { start: Math.max(0, turn[0] - 0.12), speed: clamp((turn[1] - turn[0] + 0.3) / (4 * B), 0.45, 0.85) },
    montage: focuses.map(detail),
    chrono: { start: last[0], speed: clamp((last[1] - last[0]) / (4 * B), 1, 2.6) },
    scoreStill: Math.max(0, last[1] - 0.4),
    captions: chosen,
    socials: socials ? (socials.startsWith('@') || /\s|\//.test(socials) ? socials : `@${socials}`) : '',
    values: {
      shoulderRock: value('shoulderSway'), headDrift: value('headMovement', 2), cadence: m.cadence ?? null, turnTime: value('turnTime', 2), footLine: value('footLine'),
      posture: part('Posture'), arms: part('Arms'), head: part('Head steadiness'), turn: part('Turn'),
      score: measured.ok ? measured.points : null, max: measured.max ?? 70, parts: measured.parts ?? [], grade: gradeFor(measured.ok ? (measured.points / measured.max) * 100 : 0).label.toUpperCase(),
    },
  };
}
