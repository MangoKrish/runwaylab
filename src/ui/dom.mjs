// A tiny element builder, so screens read like the page they make. No framework needed.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected' || key === 'muted') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

/** Like el.append, but skips empty values. Plain append would print null as the word "null". */
export function add(el, ...children) {
  el.append(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const fmtTime = (seconds) => {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const fmtDate = (ms) => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** A status line that screen readers announce when it changes. */
export function liveRegion(className = '') {
  return h('p', { class: className, role: 'status', 'aria-live': 'polite' });
}

export function button(label, onClick, { kind = 'ghost', ...rest } = {}) {
  return h('button', { type: 'button', class: `rw-btn rw-btn--${kind}`, onClick, ...rest }, label);
}

// Shared pieces for the screens, so every page builds its section heads, numbers and notices the same way.
export { icon, artSvg } from '../art/inline.mjs';

/**
 * A section head: eyebrow, title and an optional lede, with the runway rule on top.
 * @param options.no A number for the margin, like a look in a show programme: `01` in the serif, the eyebrow under it.
 * @param options.action An element (a link or button) placed at the right on wide screens.
 */
export function sectionHead({ eyebrow, title, lede, level = 'h2', id, action, no } = {}) {
  const classes = ['rw-sechead', action ? 'rw-sechead--row' : '', no ? 'rw-sechead--no' : ''].filter(Boolean).join(' ');
  return h('div', { class: classes },
    no ? h('p', { class: 'rw-sechead__no', 'aria-hidden': 'true' }, h('b', null, String(no).padStart(2, '0')), eyebrow ? h('span', null, eyebrow) : null) : null,
    h('div', { class: 'rw-sechead__text' },
      eyebrow && !no ? h('p', { class: 'rw-eyebrow' }, eyebrow) : null,
      no && eyebrow ? h('p', { class: 'rw-sr' }, eyebrow) : null,
      h(level, { class: 'rw-title', id }, title),
      lede ? h('p', { class: 'rw-lede' }, lede) : null),
    action ? h('div', { class: 'rw-sechead__action' }, action) : null);
}

/** A number in the house style, with its unit or maximum in a quieter span: num(82, '/100'). */
export function num(value, unit, { xl = false } = {}) {
  return h('span', { class: xl ? 'rw-num rw-num--xl' : 'rw-num' }, String(value), unit ? h('span', { class: 'rw-unit' }, unit) : null);
}

let toastEl = null;
let toastTimer = 0;
/** A short confirmation at the bottom of the screen, announced politely. One at a time; a new one replaces it. */
export function toast(text) {
  if (!toastEl || !toastEl.isConnected) {
    toastEl = h('p', { class: 'rw-toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.textContent = text;
  toastEl.classList.remove('is-shown');
  void toastEl.offsetWidth;
  toastEl.classList.add('is-shown');
  toastTimer = setTimeout(() => toastEl?.classList.remove('is-shown'), 2600);
}
