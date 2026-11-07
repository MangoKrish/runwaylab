import { h, button, clear } from './dom.mjs';
import { listWalks, deleteWalk } from '../store/db.mjs';
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
        h('p', { class: 'rw-muted' }, 'Finish a walk and press Save to keep it on this device.'),
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
