// The app shell: a small router over the location hash. Walks being reviewed live in memory, in `sessions`,
// so a walk is temporary until the person explicitly saves it.
import { h, clear, artSvg, toast } from './ui/dom.mjs';
import { homeScreen } from './ui/home.mjs';
import { studioScreen } from './ui/studio.mjs';
import { reviewScreen } from './ui/review.mjs';
import { historyScreen } from './ui/history.mjs';
import { wallScreen, wallWalkScreen } from './ui/wall.mjs';
import { foxMark } from './ui/fox.mjs';
import { signIn, signOut, wallInfo } from './wall/client.mjs';

function newId() {
  return crypto.randomUUID?.() ?? `walk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function credit() {
  const link = h('a', { class: 'rw-foot__credit', href: 'https://annontrix.vercel.app', target: '_blank', rel: 'noopener noreferrer' }, foxMark(), h('span', null, 'Made by Annontrix'));
  return h('footer', { class: 'rw-foot' }, link, h('p', { class: 'rw-foot__meta' }, h('i', null, 'Programme'), ' · Built for HackTrent 2026'));
}

/**
 * The theme switch: Matinée (paper) or Evening (navy). Off means the system setting decides; the choice is kept in
 * this browser, and src/theme.js applies it before the first paint on the next visit.
 */
function themeSwitch() {
  const KEY = 'rw-theme';
  const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const current = () => document.documentElement.getAttribute('data-theme') || (dark() ? 'dark' : 'light');
  const text = h('span', { class: 'rw-theme__text' });
  const el = h('button', { type: 'button', class: 'rw-theme', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Evening setting' },
    h('span', { class: 'rw-theme__track', 'aria-hidden': 'true' }), text);
  const draw = () => {
    const evening = current() === 'dark';
    el.setAttribute('aria-checked', evening ? 'true' : 'false');
    text.textContent = evening ? 'Evening' : 'Matinée';
  };
  el.addEventListener('click', () => {
    const next = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(KEY, next); } catch { /* no storage: the choice lasts this visit */ }
    draw();
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', draw);
  draw();
  return el;
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
  return h('a', { class: 'rw-brand', href: '#/' }, holder,
    h('span', { class: 'rw-brand__text' }, h('span', { class: 'rw-brand__name' }, 'RunwayLab'), h('span', { class: 'rw-brand__sub' }, 'The runway judge')));
}

/**
 * Sign in and out from the header, when the server has Auth0 set up. Hidden otherwise. The session is short and the
 * wall signs people out after posting, so it asks the server again on every page change and when the popup reports.
 */
function account() {
  const el = h('div', { class: 'rw-top__account', hidden: '' });
  let asking = 0;

  // On phones the words do not fit beside the nav, so the button shows a person and keeps its name for screen readers.
  function person() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'rw-top__person');
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    return svg;
  }
  const authButton = (text, onClick) => h('button', { type: 'button', class: 'rw-top__auth', 'aria-label': text, onClick },
    h('span', { class: 'rw-top__authtext', 'aria-hidden': 'true' }, text), person());

  async function refresh() {
    const n = ++asking;
    const info = await wallInfo().catch(() => null);
    if (n !== asking) return;
    if (!info?.auth) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    if (info.signedIn) {
      el.replaceChildren(
        h('span', { class: 'rw-top__who', title: `Signed in as ${info.name || 'you'}` }, info.name || 'Signed in'),
        authButton('Sign out', async () => { await signOut(); refresh(); }));
    } else {
      // signIn opens its popup straight from the click, before anything waits, so browsers allow it.
      el.replaceChildren(authButton('Sign in', () => signIn().then((result) => {
        if (!result.ok && result.message) toast(result.message);
        refresh();
      })));
    }
  }
  if ('BroadcastChannel' in window) new BroadcastChannel('rw-auth').onmessage = () => refresh();
  return { el, refresh };
}

export function start(root, base) {
  const main = h('main', { class: 'rw-screen', id: 'main' });
  const nav = h('nav', { class: 'rw-top__nav', 'aria-label': 'Main' },
    h('a', { class: 'rw-top__cta', href: '#/studio' }, 'New walk'),
    navLink('#/wall', 'The wall', 'Wall'),
    navLink('#/history', 'Saved walks', 'Saved'));
  const who = account();
  nav.append(who.el);
  clear(root).append(
    h('header', { class: 'rw-top' }, brand(), nav, themeSwitch()),
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
    who.refresh();
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
