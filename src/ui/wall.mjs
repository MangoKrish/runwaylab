// The public wall: a leaderboard of posted walks, and a replay page for each one.
import { h, add, button, clear, fmtDate } from './dom.mjs';
import { breakdown, momentsList, poseThumb } from './parts.mjs';
import { createPlayer } from './player.mjs';
import { METRIC_INFO } from '../lib/metrics.mjs';
import { gradeFor } from '../lib/score.mjs';
import { clapFor, getWall, hasClapped, hasToken, listWall, removeFromWall, signIn, signOut, wallInfo, wallStats } from '../wall/client.mjs';

const scoreText = (walk) => (walk.total !== null && walk.total !== undefined ? [String(walk.total), '/100'] : [String(walk.measured), '/70']);

function score(walk) {
  const [value, max] = scoreText(walk);
  return h('p', { class: 'rw-wallcard__score' }, value, h('small', null, max));
}

function clapButton(walk) {
  let count = walk.claps;
  const label = () => `${hasClapped(walk.id) ? 'Clapped' : 'Clap'} · ${count}`;
  const el = button(label(), async () => {
    el.disabled = true;
    const result = await clapFor(walk.id);
    if (result.ok) count = result.claps;
    else el.disabled = false;
    el.textContent = label();
  }, { kind: 'small', disabled: hasClapped(walk.id), 'aria-label': `Clap for ${walk.name}. ${count} so far.` });
  return el;
}

function localNotice(info) {
  return info?.store === 'local'
    ? h('p', { class: 'rw-banner' }, h('strong', null, 'Local test wall.'), ' These posts stay on this computer. Connect a database to share them.')
    : null;
}

export function wallScreen(root) {
  let alive = true;
  let sort = 'top';
  let walks = [];
  let more = false;

  const statsRow = h('div', { class: 'rw-stats' });
  const list = h('div', { class: 'rw-wallgrid' });
  const status = h('p', { class: 'rw-muted', role: 'status' }, 'Loading the wall.');
  const moreSlot = h('div', { class: 'rw-actions' });
  const notice = h('div');

  function card(walk, index) {
    const thumb = poseThumb(walk.detail?.pose);
    const judge = walk.detail?.judge;
    return h('article', { class: 'rw-wallcard' },
      h('a', { class: 'rw-wallcard__link', href: `#/wall/${walk.id}`, 'aria-label': `${walk.name}, ${scoreText(walk).join('')}. Watch the replay.` },
        h('div', { class: 'rw-wallcard__stage' },
          sort === 'top' ? h('span', { class: 'rw-wallcard__rank' }, String(index + 1)) : null,
          thumb),
        h('div', { class: 'rw-wallcard__body' },
          h('div', { class: 'rw-wallcard__head' }, h('h2', null, walk.name), score(walk)),
          judge?.match ? h('p', { class: 'rw-wallcard__match' }, `${judge.match.tag}, ${judge.match.name}`) : h('p', { class: 'rw-muted rw-small' }, 'Measured half only'),
          judge?.verdict ? h('p', { class: 'rw-wallcard__verdict' }, judge.verdict) : null)),
      h('div', { class: 'rw-wallcard__foot' },
        h('span', { class: 'rw-muted rw-small' }, fmtDate(Date.parse(walk.postedAt))),
        clapButton(walk)));
  }

  function render() {
    clear(list);
    list.append(...walks.map(card));
    clear(moreSlot);
    if (more) moreSlot.append(button('Show more', () => load(walks.length)));
    if (!walks.length && !status.textContent) {
      list.append(h('div', { class: 'rw-empty rw-empty--wide' },
        h('p', { class: 'rw-empty__title' }, 'The wall is empty.'),
        h('p', { class: 'rw-muted' }, 'Finish a walk and post it to be the first one up.'),
        h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk')));
    }
  }

  async function load(offset = 0) {
    status.textContent = offset ? 'Loading more.' : 'Loading the wall.';
    const result = await listWall({ sort, offset });
    if (!alive) return;
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    status.textContent = '';
    walks = offset ? [...walks, ...result.walks] : result.walks;
    more = result.more;
    render();
  }

  function renderStats(stats) {
    clear(statsRow);
    const tile = (label, value) => h('div', { class: 'rw-stat' }, h('p', { class: 'rw-stat__label' }, label), h('p', { class: 'rw-stat__value' }, value === null || value === undefined ? 'None yet' : String(value)));
    statsRow.append(tile('Walks posted', stats.walks), tile('In the last hour', stats.lastHour), tile('Average score', stats.average), tile('Top score', stats.top));
  }

  const sortSelect = h('select', { onChange: (e) => { sort = e.target.value; load(); } },
    h('option', { value: 'top' }, 'Highest score'),
    h('option', { value: 'new' }, 'Newest first'));

  root.append(
    h('div', { class: 'rw-pagehead' },
      h('div', null,
        h('h1', { tabindex: '-1' }, 'The wall'),
        h('p', { class: 'rw-muted' }, 'Everyone who chose to post. Skeletons and scores, never video.')),
      h('a', { class: 'rw-btn rw-btn--solid', href: '#/studio' }, 'Start a walk')),
    notice,
    statsRow,
    h('div', { class: 'rw-toolbar' }, h('label', { class: 'rw-field rw-field--inline' }, h('span', null, 'Sort by'), sortSelect)),
    status,
    list,
    moreSlot,
    h('p', { class: 'rw-muted rw-small rw-spaced' }, 'The server works out each measured score itself from the movement data, and only accepts Gemini results it signed. The score is a game, not a verdict on anyone.'),
  );

  (async () => {
    const info = await wallInfo();
    if (!alive) return;
    if (!info.ready) {
      status.textContent = '';
      list.replaceChildren(h('div', { class: 'rw-empty rw-empty--wide' },
        h('p', { class: 'rw-empty__title' }, 'The wall is not connected yet.'),
        h('p', { class: 'rw-muted' }, info.ok === false ? info.message : 'This server has no database for it. Walks still work and can be saved on this device.')));
      return;
    }
    notice.replaceChildren(...[localNotice(info)].filter(Boolean));
    wallStats().then((stats) => { if (alive && stats.ok) renderStats(stats); });
    load();
  })();

  return { cleanup() { alive = false; } };
}

export function wallWalkScreen(root, app, id) {
  let alive = true;
  let player = null;

  async function load() {
    const [result, info] = await Promise.all([getWall(id), wallInfo()]);
    if (!alive) return;
    if (!result.ok) {
      clear(root).append(h('div', { class: 'rw-empty' },
        h('h1', { tabindex: '-1' }, result.code === 'not_found' ? 'This walk is not on the wall' : 'The wall could not load this walk'),
        h('p', { class: 'rw-muted' }, result.code === 'not_found' ? 'It may have been removed by the person who posted it.' : result.message),
        h('a', { class: 'rw-btn rw-btn--solid', href: '#/wall' }, 'Back to the wall')));
      root.querySelector('h1')?.focus({ preventScroll: true });
      return;
    }
    render(result.walk, result.mine, info);
  }

  function render(walk, mine, info) {
    const d = walk.detail;
    const judge = d.judge;
    player = createPlayer({
      analysis: { frames: walk.frames, W: walk.width, H: walk.height, duration: walk.duration },
      badge: 'Skeleton replay. No video is stored.',
      label: `A skeleton replay of ${walk.name}'s walk toward the camera and back`,
    });

    const status = h('p', { class: 'rw-muted rw-small', role: 'status' });
    const canRemove = mine || hasToken(walk.id) || (info.auth && !info.signedIn);

    const copy = button('Copy link', async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        status.textContent = 'Link copied.';
      } catch {
        status.textContent = `Copy this link: ${location.href}`;
      }
    });

    const remove = canRemove ? button('Remove from the wall', async () => {
      if (!confirm(`Remove "${walk.name}" from the wall? This deletes the post and its movement data for good.`)) return;
      // Sign-in must open directly from this click, before anything else waits.
      if (info.auth && !mine) {
        const signed = await signIn();
        if (!signed.ok) {
          status.textContent = signed.message;
          return;
        }
      }
      const result = await removeFromWall(walk.id);
      if (info.auth) await signOut();
      if (!alive) return;
      if (result.ok) app.go('#/wall');
      else status.textContent = result.code === 'not_owner' ? 'That account did not post this walk.' : result.message;
    }, { kind: 'quiet' }) : null;

    const [value, max] = scoreText(walk);
    const percent = walk.total !== null && walk.total !== undefined ? walk.total : (walk.measured / 70) * 100;
    const grade = gradeFor(percent);
    const metric = (key) => {
      const m = d.metrics[key];
      if (!m) return null;
      return h('div', { class: 'rw-measure' },
        h('dt', null, METRIC_INFO[key].title),
        h('dd', null, m.ok ? `${m.value} ${m.unit}` : 'Not enough data'));
    };

    clear(root);
    add(root,
      localNotice(info),
      h('div', { class: 'rw-pagehead' },
        h('div', null,
          h('a', { href: '#/wall', class: 'rw-backlink' }, 'The wall'),
          h('h1', { tabindex: '-1' }, walk.name),
          h('p', { class: 'rw-muted' }, `Posted ${fmtDate(Date.parse(walk.postedAt))}`)),
        h('div', { class: 'rw-actions rw-actions--top' }, clapButton(walk), copy, remove)),
      status,
      h('div', { class: 'rw-result' },
        h('div', { class: 'rw-result__media' }, player.el),
        h('div', { class: 'rw-result__summary' },
          h('p', { class: 'rw-score' }, h('span', { class: 'rw-score__num' }, value), h('span', { class: 'rw-score__max' }, max)),
          h('p', { class: 'rw-grade' }, grade.label),
          judge ? h('blockquote', { class: 'rw-verdict' }, judge.verdict) : h('p', { class: 'rw-muted' }, 'Measured half only.'),
          judge ? h('div', { class: 'rw-match' },
            h('p', { class: 'rw-label' }, 'Closest walk'),
            h('p', { class: 'rw-match__name' }, judge.match.name),
            h('p', { class: 'rw-match__tag' }, judge.match.tag),
            judge.match.why ? h('p', { class: 'rw-small' }, judge.match.why) : null) : null)),
      h('div', { class: 'rw-breakdown' }, breakdown({ ok: true, points: walk.measured, max: 70, parts: d.parts }, judge ? { ok: true, ...judge } : null, { model: judge?.model, calibrated: d.calibrated })),
      momentsList(judge?.moments, (t) => player.seek(t)),
      h('details', { class: 'rw-details' },
        h('summary', null, 'The numbers'),
        h('dl', { class: 'rw-measures' }, Object.keys(METRIC_INFO).filter((key) => d.metrics[key]?.ok).map(metric)),
        h('p', { class: 'rw-muted rw-small' }, `These describe movement in the picture. ${Math.round(d.coverage.ratio * 100)}% of walking frames were usable. The score is a game, and the rules that turn these numbers into points are ours.`)),
    );
    root.querySelector('h1')?.focus({ preventScroll: true });
  }

  load();
  return {
    cleanup() {
      alive = false;
      player?.destroy();
    },
  };
}
