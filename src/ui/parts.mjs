// Small pieces shared by the review page and the wall.
import { h, button, fmtTime, num, artSvg } from './dom.mjs';
import { BONES, LM } from '../lib/landmarks.mjs';

/**
 * One data bar: label and points on one line, the track, a note, and an optional "Why this score" fold.
 * @param options.index Staggers the fill on first paint.
 * @param options.opinion Draws Gemini's half in ink, apart from the measured half in the accent.
 */
export function bar(label, points, max, note, why = null, about = null, seen = true, { index = 0, opinion = false } = {}) {
  const kind = ['rw-bar', opinion ? 'rw-bar--opinion' : '', seen ? '' : 'rw-bar--none'].filter(Boolean).join(' ');
  return h('div', { class: kind, style: `--i:${index}` },
    h('div', { class: 'rw-bar__head' },
      h('span', { class: 'rw-bar__label' }, label),
      h('span', { class: 'rw-bar__num' }, seen ? [String(points), h('span', { class: 'rw-unit' }, `/${max}`)] : 'Not seen')),
    h('div', { class: 'rw-bar__track', role: 'img', 'aria-label': seen ? `${label}: ${points} out of ${max}` : `${label}: could not be seen, so it is left out` },
      h('div', { class: 'rw-bar__fill', style: `width:${seen ? (points / max) * 100 : 0}%` })),
    note ? h('p', { class: 'rw-bar__note' }, note) : null,
    why?.length ? h('details', { class: 'rw-why' },
      h('summary', null, h('span', null, 'Why this score')),
      h('div', { class: 'rw-why__body' },
        about ? h('p', { class: 'rw-why__about' }, about) : null,
        h('ul', { class: 'rw-why__list' }, why.map((w) => h('li', null,
          h('div', { class: 'rw-why__head' }, h('strong', null, w.label), h('span', { class: 'rw-why__value' }, w.value), h('span', { class: 'rw-why__share' }, w.share === null ? 'Left out' : `${w.share}% of the marks`)),
          h('p', { class: 'rw-muted rw-small' }, w.scale),
          w.ref ? h('p', { class: 'rw-why__ref rw-small' }, w.ref) : null))))) : null);
}

const groupHead = (title, points, max, eyebrow) => h('div', { class: 'rw-breakdown__head' },
  h('div', { class: 'rw-breakdown__title' },
    h('p', { class: 'rw-eyebrow' }, eyebrow),
    h('h2', null, title)),
  h('span', { class: 'rw-breakdown__sum rw-num' }, String(points), h('span', { class: 'rw-unit' }, `/${max}`)));

/** Both halves of the score, each labeled by where it came from. */
export function breakdown(measured, judge, { sample = false, model = null, calibrated = false } = {}) {
  const groups = [];
  if (measured?.ok) {
    groups.push(h('section', { class: 'rw-breakdown__group rw-breakdown__group--measured' },
      groupHead(sample ? 'Measured from synthetic movement' : 'Measured from your movement', measured.points, measured.max, 'Measured, 70 points'),
      h('p', { class: 'rw-breakdown__note' }, calibrated
        ? 'Calibrated to your height, how you stood, and this camera. Everyone is held to the same scale.'
        : 'No standing moment in this clip, so this uses typical body proportions.'),
      measured.scaled ? h('p', { class: 'rw-bar__note rw-breakdown__scaled' }, `We could not see your ${measured.scaled.unseen.join(', ').toLowerCase()}, so that is left out rather than marked down. You earned ${measured.scaled.earned} of the ${measured.scaled.seenMax} points we could measure, which is ${measured.points} out of ${measured.max}.`) : null,
      h('div', { class: 'rw-breakdown__bars' },
        measured.parts.map((p, i) => bar(p.label, p.points, p.max, p.note, p.why, p.about, p.seen, { index: i })))));
  }
  if (judge?.ok) {
    groups.push(h('section', { class: 'rw-breakdown__group rw-breakdown__group--opinion' },
      groupHead(sample ? 'Sample judge, written by hand' : `Gemini's opinion`, judge.presence.score + judge.style.score, 30, 'Opinion, 30 points'),
      model ? h('p', { class: 'rw-breakdown__note' }, model) : null,
      h('div', { class: 'rw-breakdown__bars' },
        bar('Presence', judge.presence.score, 15, judge.presence.why, null, null, true, { index: 0, opinion: true }),
        bar('Style', judge.style.score, 15, judge.style.why, null, null, true, { index: 1, opinion: true })),
      h('p', { class: 'rw-caption rw-breakdown__disclaimer' }, 'An opinion, not a measurement. Gemini sees pixelated stills, and is told to ignore body, face, age, race and gender.')));
  }
  return groups;
}

/** The judge's moments as a short timeline. Each time jumps the replay there. */
export function momentsList(moments, seek) {
  if (!moments?.length) return null;
  return h('section', { class: 'rw-momentsblock' },
    h('h2', { class: 'rw-aside__title' }, 'Moments'),
    h('ol', { class: 'rw-moments' }, moments.map((m) => h('li', null,
      button(fmtTime(m.t), () => seek(m.t), { kind: 'chip', 'aria-label': `Go to ${fmtTime(m.t)}` }),
      h('p', null, m.note)))));
}

/** A placeholder that becomes a drawn file from src/art once it has loaded. Decorative: words always sit beside it. */
export function art(name, className, copy) {
  const slot = h('span', { class: `rw-artslot ${className || ''}`, 'aria-hidden': 'true' });
  artSvg(name, { className, decorative: true, copy })
    .then((svg) => { if (slot.isConnected || slot.parentNode) slot.replaceWith(svg); })
    .catch(() => slot.remove());
  return slot;
}

/** The score and its maximum, in the house number style. */
export const scoreNum = (value, max, xl = true) => num(value, `/${max}`, { xl });

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
  // A soft glow under the bones, then the bones, then the joints: the same layering as the live overlay.
  const glow = svg('g', { opacity: '0.22' });
  const bones = svg('g', {});
  for (const [a, b] of BONES) {
    if (!pts[a] || !pts[b]) continue;
    const line = { x1: pts[a][0], y1: pts[a][1], x2: pts[b][0], y2: pts[b][1], 'stroke-linecap': 'round', stroke: 'currentColor' };
    glow.append(svg('line', { ...line, 'stroke-width': stroke * 3.2, class: 'rw-thumb__glow' }));
    bones.append(svg('line', { ...line, 'stroke-width': stroke }));
  }
  root.append(glow, bones);
  const head = [LM.NOSE, LM.L_EAR, LM.R_EAR].map((i) => pts[i]).filter(Boolean);
  if (head.length && pts[LM.L_SHOULDER] && pts[LM.L_HIP]) {
    const cx = head.reduce((sum, p) => sum + p[0], 0) / head.length;
    const cy = head.reduce((sum, p) => sum + p[1], 0) / head.length;
    root.append(svg('circle', { cx, cy, r: height / 16, fill: 'none', 'stroke-width': stroke, stroke: 'currentColor' }));
  }
  return root;
}
