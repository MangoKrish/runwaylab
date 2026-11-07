import { h, button, clear } from './dom.mjs';
import { listWalks, deleteWalk, loadWalk } from '../store/db.mjs';
import { recordingName } from '../store/keep.mjs';
import { walkRow } from './home.mjs';

const has = (x) => x !== null && x !== undefined;
const FILTERS = {
  all: { label: 'All walks', test: () => true },
  judged: { label: 'Judged', test: (w) => w.judged },
  measured: { label: 'Measured only', test: (w) => !w.judged && has(w.measuredPoints) },
  none: { label: 'No score', test: (w) => !w.judged && !has(w.measuredPoints) },
};
const bestScore = (w) => w.total ?? w.measuredPoints ?? -1;

export function historyScreen(root) {
  let walks = [];
  let filter = 'all';
  let sort = 'newest';
  let alive = true;

  const list = h('div', { class: 'rw-list' });
  const status = h('p', { class: 'rw-muted', role: 'status' }, 'Loading your saved walks.');

  function render() {
    clear(list);
    const shown = walks.filter(FILTERS[filter].test);
    if (sort === 'top') shown.sort((a, b) => bestScore(b) - bestScore(a));
    status.textContent = walks.length ? `${shown.length} of ${walks.length} saved ${walks.length === 1 ? 'walk' : 'walks'}.` : '';
    if (!walks.length) {
      list.append(h('div', { class: 'rw-empty' },
        h('p', { class: 'rw-empty__title' }, 'Nothing saved yet.'),
        h('p', { class: 'rw-muted' }, 'Every walk you record is kept here automatically.'),
        h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk')));
      return;
    }
    if (!shown.length) {
      list.append(h('div', { class: 'rw-empty' }, h('p', { class: 'rw-muted' }, 'No saved walks match this filter.')));
      return;
    }
    for (const walk of shown) {
      list.append(h('div', { class: 'rw-row-wrap' },
        walkRow(walk),
        button('Delete', async () => {
          if (!confirm(`Delete "${walk.name}"? This removes its video, measurements and judging for good.`)) return;
          try {
            await deleteWalk(walk.id);
            walks = walks.filter((w) => w.id !== walk.id);
            render();
          } catch (err) {
            status.textContent = `Could not delete it. ${err.message}`;
          }
        }, { kind: 'quiet', 'aria-label': `Delete ${walk.name}` })));
    }
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

  const choose = (label, options, value, onChange) => h('label', { class: 'rw-field rw-field--inline' },
    h('span', null, label),
    h('select', { onChange: (e) => onChange(e.target.value) },
      Object.entries(options).map(([key, text]) => h('option', { value: key, selected: key === value }, text))));

  root.append(
    h('div', { class: 'rw-pagehead' },
      h('div', null,
        h('h1', { tabindex: '-1' }, 'Saved walks'),
        h('p', { class: 'rw-muted' }, 'On this device only. Clearing this browser\'s site data removes them.')),
      h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk')),
    h('div', { class: 'rw-toolbar' },
      button('Download all videos', () => walks.length && downloadAll()),
      choose('Show', Object.fromEntries(Object.entries(FILTERS).map(([k, v]) => [k, v.label])), filter, (v) => { filter = v; render(); }),
      choose('Sort by', { newest: 'Newest first', top: 'Highest score' }, sort, (v) => { sort = v; render(); })),
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
      if (alive) status.textContent = `Saved walks could not be read. ${err.message}`;
    });

  return { cleanup() { alive = false; } };
}
