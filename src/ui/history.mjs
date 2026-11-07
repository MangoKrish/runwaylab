// Saved walks: everything kept in this browser, newest first, with filters and a way to take the videos away.
import { h, button, clear, fmtDate, icon } from './dom.mjs';
import { listWalks, deleteWalk, loadWalk } from '../store/db.mjs';
import { recordingName } from '../store/keep.mjs';
import { art } from './parts.mjs';

const has = (x) => x !== null && x !== undefined;
const FILTERS = {
  all: { label: 'All walks', test: () => true },
  judged: { label: 'Judged', test: (w) => w.judged },
  measured: { label: 'Measured only', test: (w) => !w.judged && has(w.measuredPoints) },
  none: { label: 'No score', test: (w) => !w.judged && !has(w.measuredPoints) },
};
const bestScore = (w) => w.total ?? w.measuredPoints ?? -1;

/** One saved walk as a row: a small figure on the stage, the name and status, and the score. */
function savedRow(walk, index) {
  const score = has(walk.total)
    ? h('span', { class: 'rw-row__score' }, String(walk.total), h('span', { class: 'rw-unit' }, '/100'))
    : has(walk.measuredPoints)
      ? h('span', { class: 'rw-row__score' }, String(walk.measuredPoints), h('span', { class: 'rw-unit' }, '/70'))
      : h('span', { class: 'rw-row__score rw-row__score--none' }, 'No score');
  const status = walk.judged ? `Judged. Closest walk: ${walk.matchName}` : has(walk.measuredPoints) ? 'Measured only, no judge' : 'Not enough data to score';
  return h('a', { class: 'rw-row rw-card--link rw-saved', href: `#/review/${walk.id}` },
    h('span', { class: 'rw-saved__thumb rw-on-stage', 'aria-hidden': 'true' }, art('figure.svg', 'rw-saved__figure', `row${index}`)),
    h('span', { class: 'rw-row__main' },
      h('strong', { class: 'rw-row__name' }, walk.name),
      h('span', { class: 'rw-row__meta' }, `${fmtDate(walk.createdAt)} · ${status}`),
      walk.socials ? h('span', { class: 'rw-row__socials' }, walk.socials) : null),
    score);
}

export function historyScreen(root) {
  let walks = [];
  let filter = 'all';
  let sort = 'newest';
  let alive = true;

  const list = h('div', { class: 'rw-list rw-saved-list', 'aria-busy': 'true' },
    [0, 1, 2].map(() => h('span', { class: 'rw-skel rw-skel--row', 'aria-hidden': 'true' })));
  const status = h('p', { class: 'rw-saved-count', role: 'status' }, 'Loading your saved walks.');

  function render() {
    clear(list);
    list.removeAttribute('aria-busy');
    const shown = walks.filter(FILTERS[filter].test);
    if (sort === 'top') shown.sort((a, b) => bestScore(b) - bestScore(a));
    status.textContent = walks.length ? `${shown.length} of ${walks.length} saved ${walks.length === 1 ? 'walk' : 'walks'}.` : '';
    if (!walks.length) {
      list.append(h('div', { class: 'rw-empty' },
        art('empty-walks.svg', 'rw-empty__art', 'saved'),
        h('h2', { class: 'rw-empty__title' }, 'Nothing saved yet.'),
        h('p', null, 'Walks appear here when you press Save on a result. Only on this device.'),
        h('div', { class: 'rw-actions rw-actions--center' }, h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk'))));
      return;
    }
    if (!shown.length) {
      list.append(h('div', { class: 'rw-empty rw-empty--small' },
        art('empty-walks.svg', 'rw-empty__art rw-empty__art--small', 'nomatch'),
        h('p', { class: 'rw-empty__title' }, 'No saved walks match this filter.'),
        h('p', null, 'Try another filter, or show all walks.')));
      return;
    }
    shown.forEach((walk, i) => {
      list.append(h('div', { class: 'rw-row-wrap' },
        savedRow(walk, i),
        button('Delete', async () => {
          if (!confirm(`Delete "${walk.name}"? This removes its video, measurements and judging for good.`)) return;
          try {
            await deleteWalk(walk.id);
            walks = walks.filter((w) => w.id !== walk.id);
            render();
          } catch (err) {
            status.textContent = `Could not delete it. ${err.message}`;
          }
        }, { kind: 'danger', class: 'rw-btn rw-btn--danger rw-btn--small rw-row__delete', 'aria-label': `Delete ${walk.name}` })));
    });
  }

  // One file per walk, named by date and time, for editing into a video.
  async function downloadAll() {
    status.textContent = `Preparing ${walks.length} videos.`;
    let done = 0;
    for (const walk of walks) {
      const full = await loadWalk(walk.id).catch(() => null);
      if (!alive) return;
      if (!full?.blob) continue;
      const url = URL.createObjectURL(full.blob);
      h('a', { href: url, download: recordingName(full) }).click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      done++;
      await new Promise((r) => setTimeout(r, 400)); // Browsers drop downloads started all at once.
    }
    // A list of who walked, with their socials, for tagging them in reels.
    const rows = [['video', 'name', 'socials', 'score']].concat(walks.map((w) => [recordingName(w), w.name, w.socials || '', w.total ?? w.measuredPoints ?? '']));
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    h('a', { href: url, download: 'runwaylab-walkers.csv' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    status.textContent = `${done} ${done === 1 ? 'video' : 'videos'} and a list of walkers with their socials sent to your downloads.`;
  }

  let fieldCount = 0;
  const choose = (label, options, value, onChange) => {
    const id = `rw-saved-${++fieldCount}`;
    return h('div', { class: 'rw-field' },
      h('label', { class: 'rw-field__label', for: id }, label),
      h('select', { id, onChange: (e) => onChange(e.target.value) },
        Object.entries(options).map(([key, text]) => h('option', { value: key, selected: key === value }, text))));
  };

  root.append(
    h('div', { class: 'rw-pagehead rw-pagehead--ruled' },
      h('div', null,
        h('p', { class: 'rw-eyebrow' }, 'On this device'),
        h('h1', { tabindex: '-1' }, 'Saved walks'),
        h('p', { class: 'rw-lede' }, 'On this device only. Clearing this browser\'s site data removes them.')),
      h('a', { class: 'rw-btn rw-btn--solid rw-pagehead__cta', href: '#/studio' }, 'Start a walk')),
    h('div', { class: 'rw-toolbar rw-saved-toolbar' },
      choose('Show', Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, v.label])), filter, (v) => { filter = v; render(); }),
      choose('Sort by', { newest: 'Newest first', top: 'Highest score' }, sort, (v) => { sort = v; render(); }),
      button([icon('download'), 'Download all videos'], () => walks.length && downloadAll(), { class: 'rw-btn rw-btn--ghost rw-toolbar__end' })),
    status,
    list,
  );

  listWalks()
    .then((rows) => {
      if (!alive) return;
      walks = rows;
      render();
    })
    .catch((err) => {
      if (!alive) return;
      clear(list);
      list.removeAttribute('aria-busy');
      status.textContent = '';
      list.append(h('p', { class: 'rw-error', role: 'alert' }, icon('alert'), h('span', null, `Saved walks could not be read. ${err.message}`)));
    });

  return { cleanup() { alive = false; } };
}
