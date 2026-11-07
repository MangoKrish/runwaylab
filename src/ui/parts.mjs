// Small pieces shared by the review page and the wall.
import { h, button, fmtTime } from './dom.mjs';
import { BONES, LM } from '../lib/landmarks.mjs';

export function bar(label, points, max, note, why = null, about = null, seen = true) {
  return h('div', { class: 'rw-bar' },
    h('div', { class: 'rw-bar__head' }, h('span', { class: 'rw-bar__label' }, label), h('span', { class: 'rw-bar__num' }, seen ? `${points}/${max}` : 'Not seen')),
    h('div', { class: 'rw-bar__track', role: 'img', 'aria-label': seen ? `${label}: ${points} out of ${max}` : `${label}: could not be seen, so it is left out` }, h('div', { class: 'rw-bar__fill', style: `width:${(points / max) * 100}%` })),
    note ? h('p', { class: 'rw-bar__note' }, note) : null,
    why?.length ? h('details', { class: 'rw-why' },
      h('summary', null, 'Why this score'),
      about ? h('p', { class: 'rw-why__about' }, about) : null,
      h('ul', { class: 'rw-why__list' }, why.map((w) => h('li', null,
        h('div', { class: 'rw-why__head' }, h('strong', null, w.label), h('span', null, w.value), h('span', { class: 'rw-why__share' }, w.share === null ? 'Left out' : `${w.share}% of the marks`)),
        h('p', { class: 'rw-muted rw-small' }, w.scale))))) : null);
}

/** Both halves of the score, side by side, each labeled by where it came from. */
export function breakdown(measured, judge, { sample = false, model = null, calibrated = false } = {}) {
  const groups = [];
  if (measured?.ok) {
    groups.push(h('section', { class: 'rw-breakdown__group' },
      h('div', { class: 'rw-breakdown__head' },
        h('h2', null, sample ? 'Measured from synthetic movement' : 'Measured from your movement'),
        h('span', { class: 'rw-breakdown__sum' }, `${measured.points}/${measured.max}`)),
      calibrated ? h('p', { class: 'rw-muted rw-small' }, 'Calibrated to your height, how you stood, and this camera. Everyone is held to the same scale.') : h('p', { class: 'rw-muted rw-small' }, 'No standing moment in this clip, so this uses typical body proportions.'),
      measured.scaled ? h('p', { class: 'rw-bar__note' }, `We could not see your ${measured.scaled.unseen.join(', ').toLowerCase()}, so that is left out rather than marked down. You earned ${measured.scaled.earned} of the ${measured.scaled.seenMax} points we could measure, which is ${measured.points} out of ${measured.max}.`) : null,
      measured.parts.map((p) => bar(p.label, p.points, p.max, p.note, p.why, p.about, p.seen))));
  }
  if (judge?.ok) {
    groups.push(h('section', { class: 'rw-breakdown__group' },
      h('div', { class: 'rw-breakdown__head' },
        h('h2', null, sample ? 'Sample judge, written by hand' : `Gemini's opinion`),
        h('span', { class: 'rw-breakdown__sum' }, `${judge.presence.score + judge.style.score}/30`)),
      model ? h('p', { class: 'rw-muted rw-small' }, model) : null,
      bar('Presence', judge.presence.score, 15, judge.presence.why),
      bar('Style', judge.style.score, 15, judge.style.why),
      h('p', { class: 'rw-muted rw-small' }, 'An opinion, not a measurement. Gemini sees pixelated stills, and is told to ignore body, face, age, race and gender.')));
  }
  return groups;
}

export function momentsList(moments, seek) {
  if (!moments?.length) return null;
  return h('section', { class: 'rw-block' },
    h('h2', null, 'Moments'),
    h('ul', { class: 'rw-moments' }, moments.map((m) => h('li', null,
      button(fmtTime(m.t), () => seek(m.t), { kind: 'chip', 'aria-label': `Go to ${fmtTime(m.t)}` }),
      h('span', null, m.note)))));
}

const SVG = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

/** A still of the skeleton, drawn only from landmarks that exist. Returns null with nothing to draw. */
export function poseThumb(pts) {
  const present = (pts || []).filter(Boolean);
  if (present.length < 4) return null;
  const xs = present.map((p) => p[0]);
  const ys = present.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const width = Math.max(...xs) - x0;
  const height = Math.max(...ys) - y0;
  const margin = height * 0.12;
  const root = svg('svg', {
    viewBox: `${x0 - margin} ${y0 - margin} ${width + margin * 2} ${height + margin * 2}`,
    class: 'rw-thumb',
    'aria-hidden': 'true',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const stroke = Math.max(height / 70, 1);
  for (const [a, b] of BONES) {
    if (!pts[a] || !pts[b]) continue;
    root.append(svg('line', { x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1], 'stroke-width': stroke, 'stroke-linecap': 'round', stroke: 'currentColor' }));
  }
  const head = [LM.NOSE, LM.L_EAR, LM.R_EAR].map((i) => pts[i]).filter(Boolean);
  if (head.length && pts[LM.L_SHOULDER] && pts[LM.L_HIP]) {
    const cx = head.reduce((sum, p) => sum + p[0], 0) / head.length;
    const cy = head.reduce((sum, p) => sum + p[1], 0) / head.length;
    root.append(svg('circle', { cx, cy, r: height / 16, fill: 'none', 'stroke-width': stroke, stroke: 'currentColor' }));
  }
  return root;
}
