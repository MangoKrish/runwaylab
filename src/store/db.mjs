// Saved walks, in this browser only, using IndexedDB. Nothing is written until the person presses Save.
// saveWalk and deleteWalk resolve only when the transaction has committed, and one transaction covers
// all three stores, so a walk is never half saved or half deleted.
const DB_NAME = 'runwaylab';
const STORES = ['summaries', 'details', 'videos'];

let opening = null;
function open() {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('This browser has no local storage for videos.'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const name of STORES) req.result.createObjectStore(name, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Local storage could not be opened. Private browsing can block it.'));
    req.onblocked = () => reject(new Error('Local storage is blocked by another RunwayLab tab. Close it and try again.'));
  });
  opening.catch(() => { opening = null; });
  return opening;
}

function friendly(err) {
  if (err?.name === 'QuotaExceededError') return new Error('There is not enough storage space left in this browser to save this walk.');
  return new Error(`The walk could not be saved${err?.message ? `: ${err.message}` : '.'}`);
}

const committed = (tx) => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(friendly(tx.error));
  tx.onerror = () => reject(friendly(tx.error));
});

const asRequest = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** The short version shown in lists, so opening a list never loads every video. */
export function summarize(session, total) {
  return {
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    source: session.source,
    total,
    measuredPoints: session.analysis?.measured?.ok ? session.analysis.measured.points : null,
    judged: !!session.judge?.ok,
    matchName: session.judge?.ok ? session.judge.match?.name ?? null : null,
    metricsVersion: session.analysis?.metrics?.version ?? null,
    socials: session.socials || '',
  };
}

export async function saveWalk(session, total) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  const done = committed(tx);
  tx.objectStore('summaries').put(summarize(session, total));
  tx.objectStore('details').put({ id: session.id, analysis: session.analysis, judge: session.judge, stills: session.stills, setup: session.setup, mime: session.mime, rotation: session.rotation ?? 0, wallPost: session.wallPost ?? null });
  tx.objectStore('videos').put({ id: session.id, blob: session.blob });
  return done;
}

export async function listWalks() {
  const db = await open();
  const rows = await asRequest(db.transaction('summaries').objectStore('summaries').getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

/** @returns the whole saved walk as a session, or null if it is not here. */
export async function loadWalk(id) {
  const db = await open();
  const tx = db.transaction(STORES);
  const [summary, details, video] = await Promise.all(STORES.map((name) => asRequest(tx.objectStore(name).get(id))));
  if (!summary || !details || !video) return null;
  return { ...summary, ...details, blob: video.blob, saved: true, dirty: false };
}

export async function deleteWalk(id) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  const done = committed(tx);
  for (const name of STORES) tx.objectStore(name).delete(id);
  return done;
}
