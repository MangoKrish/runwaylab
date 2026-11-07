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
