// The page's side of the wall. Everything goes through this site's own functions.
const url = (path) => new URL(path, document.baseURI).href;

async function call(path, options) {
  try {
    const res = await fetch(url(path), { cache: 'no-store', ...options });
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, code: 'bad_reply', message: 'The wall sent back something unreadable. Try again.' };
    return res.ok ? { ok: true, ...body } : { ok: false, ...body };
  } catch {
    return { ok: false, code: 'offline', message: 'Could not reach the wall. Check the connection and try again.' };
  }
}

// Small per-browser notes: which posts this browser may remove, and which it has clapped for.
function readNote(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}
function writeNote(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing can refuse this. The wall still works; this browser just forgets.
  }
}

const TOKENS = 'rw-wall-tokens';
const CLAPS = 'rw-wall-claps';
export const hasToken = (id) => !!readNote(TOKENS)[id];
export const hasClapped = (id) => !!readNote(CLAPS)[id];

export const wallInfo = () => call('api/wall?action=info');
export const wallStats = () => call('api/wall?action=stats');
export const listWall = ({ sort = 'top', offset = 0 } = {}) => call(`api/wall?sort=${sort}&offset=${offset}`);
export const getWall = (id) => call(`api/wall?id=${encodeURIComponent(id)}`);

/** Sends movement data and text only. The video and stills are never part of a post. */
export async function postToWall(session, name) {
  const a = session.analysis;
  const result = await call('api/wall', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      W: a.W,
      H: a.H,
      duration: a.duration,
      frames: a.frames.map((f) => ({ t: f.t, s: f.status, p: f.pts ? f.pts.map((q) => (q ? [q[0], q[1]] : null)) : null })),
      judge: session.judge?.ok ? session.judge : null,
    }),
  });
  if (result.ok && result.token) {
    writeNote(TOKENS, { ...readNote(TOKENS), [result.id]: result.token });
  }
  return result;
}

export async function clapFor(id) {
  const result = await call(`api/wall?action=clap&id=${encodeURIComponent(id)}`, { method: 'POST' });
  if (result.ok) writeNote(CLAPS, { ...readNote(CLAPS), [id]: true });
  return result;
}

export async function removeFromWall(id) {
  const token = readNote(TOKENS)[id];
  const result = await call(`api/wall?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: token ? { 'x-wall-token': token } : {},
  });
  if (result.ok) {
    const tokens = readNote(TOKENS);
    delete tokens[id];
    writeNote(TOKENS, tokens);
  }
  return result;
}

/**
 * Sign in through a popup, so the temporary walk in this page's memory survives. Call this directly from a
 * click, before any await, or the browser will block the popup.
 * @returns {Promise<{ok:boolean, message?:string}>}
 */
export function signIn() {
  return new Promise((resolve) => {
    const popup = window.open(url('api/auth?action=login'), 'rw-signin', 'width=480,height=720');
    if (!popup) {
      resolve({ ok: false, message: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' });
      return;
    }
    let finished = false;
    const channel = 'BroadcastChannel' in window ? new BroadcastChannel('rw-auth') : null;
    const finish = (ok) => {
      if (finished) return;
      finished = true;
      clearInterval(watcher);
      channel?.close();
      resolve(ok ? { ok: true } : { ok: false, message: 'Sign-in did not finish. Try again.' });
    };
    if (channel) channel.onmessage = (event) => finish(event.data === true);
    // If the person closes the window, or the message cannot arrive, ask the server who is signed in.
    const watcher = setInterval(async () => {
      if (!popup.closed) return;
      clearInterval(watcher);
      const me = await call('api/auth?action=me');
      finish(!!me.signedIn);
    }, 500);
  });
}

export const signOut = () => call('api/auth?action=logout', { method: 'POST' });
