// The app shell: a small router over the location hash. Walks being reviewed live in memory, in `sessions`,
// so a walk is temporary until the person explicitly saves it.
import { h, clear, artSvg } from './ui/dom.mjs';
import { homeScreen } from './ui/home.mjs';
import { studioScreen } from './ui/studio.mjs';
import { reviewScreen } from './ui/review.mjs';
import { historyScreen } from './ui/history.mjs';
import { wallScreen, wallWalkScreen } from './ui/wall.mjs';
import { foxMark } from './ui/fox.mjs';

function newId() {
  return crypto.randomUUID?.() ?? `walk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function credit() {
  const link = h('a', { class: 'rw-foot__credit', href: 'https://annontrix.vercel.app', target: '_blank', rel: 'noopener noreferrer' }, foxMark(), h('span', null, 'Made by Annontrix'));
  return h('footer', { class: 'rw-foot' }, link, h('p', { class: 'rw-foot__meta' }, 'Built for HackTrent 2026'));
}

/** A header link with a shorter label for phones, so brand and nav always fit on one row. Its name stays whole. */
function navLink(href, label, short) {
  return h('a', { href, 'aria-label': label },
    h('span', { class: 'rw-top__long', 'aria-hidden': 'true' }, label),
    h('span', { class: 'rw-top__short', 'aria-hidden': 'true' }, short));
}

/** The name with its mark. The mark is drawn from src/art/mark.svg once it loads; a plain tile holds its place. */
function brand() {
  const holder = h('span', { class: 'rw-brand__mark rw-brand__mark--blank', 'aria-hidden': 'true' });
  artSvg('mark.svg', { className: 'rw-brand__mark', decorative: true }).then((svg) => {
    svg.querySelector('title')?.remove();
    svg.querySelector('style')?.remove();
    holder.replaceWith(svg);
  }).catch(() => {});
  return h('a', { class: 'rw-brand', href: '#/' }, holder, h('span', null, 'RunwayLab'));
}

export function start(root, base) {
  const main = h('main', { class: 'rw-screen', id: 'main' });
  const nav = h('nav', { class: 'rw-top__nav', 'aria-label': 'Main' },
    h('a', { class: 'rw-top__cta', href: '#/studio' }, 'New walk'),
    navLink('#/wall', 'The wall', 'Wall'),
    navLink('#/history', 'Saved walks', 'Saved'));
  clear(root).append(
    h('header', { class: 'rw-top' }, brand(), nav),
    main,
    credit(),
  );

  let current = null;
  let currentHash = location.hash;
  let skipNextHashChange = false;

  const app = {
    base,
    sessions: new Map(),
    discardCurrent: false,
    createSession({ blob, mime, source, consent, setup, name, rotation }) {
      const createdAt = Date.now();
      const label = new Date(createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const session = {
        id: newId(), name: name || `Walk at ${label}`, createdAt, blob, mime, source, consent: !!consent, setup: setup || {},
        rotation: rotation || 0, analysis: null, judge: null, stills: [], saved: false, dirty: true,
      };
      app.sessions.set(session.id, session);
      return session;
    },
    /** Navigate from code. The guard is for leaving by accident; these calls are deliberate. */
    go(hash) {
      app.discardCurrent = true;
      if (location.hash === hash) mount();
      else location.hash = hash;
    },
  };

  function mount() {
    current?.cleanup?.();
    current = null;
    clear(main);
    // Each screen fades up as it arrives (styles.css, .rw-screen--enter). Restart it on every mount.
    main.classList.remove('rw-screen--enter');
    void main.offsetWidth;
    main.classList.add('rw-screen--enter');
    currentHash = location.hash;
    app.discardCurrent = false;
    const [, route = '', arg] = location.hash.split('/');
    // The home page's picture runs behind the header, so the header needs to know.
    root.dataset.route = route || 'home';
    nav.querySelectorAll('a').forEach((a) => {
      if (a.getAttribute('href') === `#/${route}`) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (route === 'studio') current = studioScreen(main, app);
    else if (route === 'review' && arg) current = reviewScreen(main, app, decodeURIComponent(arg));
    else if (route === 'history') current = historyScreen(main, app);
    else if (route === 'wall' && arg) current = wallWalkScreen(main, app, decodeURIComponent(arg));
    else if (route === 'wall') current = wallScreen(main, app);
    else current = homeScreen(main, app);
    window.scrollTo(0, 0);
    // Move focus to the new screen's heading, so keyboard and screen reader users land in the right place.
    main.querySelector('h1')?.focus({ preventScroll: true });
  }

  window.addEventListener('hashchange', () => {
    if (skipNextHashChange) {
      skipNextHashChange = false;
      return;
    }
    if (!app.discardCurrent) {
      const warning = current?.guard?.();
      if (warning && !confirm(warning)) {
        // Stay put: put the address back without remounting.
        skipNextHashChange = true;
        location.hash = currentHash;
        return;
      }
    }
    mount();
  });

  window.addEventListener('beforeunload', (event) => {
    if (current?.guard?.()) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  mount();
  return app;
}
