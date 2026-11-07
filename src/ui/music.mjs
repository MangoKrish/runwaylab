// Music to walk to. It plays from this laptop while recording, and is not part of the recording, because the
// microphone stays off. The tracks are Creative Commons, from Wikimedia Commons: see NOTICE.md. Anyone can also
// choose a file of their own, which stays on this device.
import { h, clear, icon } from './dom.mjs';

const SAVED_TRACK = 'rw-music';
const remember = (value) => { try { localStorage.setItem(SAVED_TRACK, value); } catch { /* Private browsing. */ } };
const recall = () => { try { return localStorage.getItem(SAVED_TRACK); } catch { return null; } };

export const TRACKS = [
  { id: 'rollin', title: 'Rollin at 5', artist: 'Kevin MacLeod', license: 'CC BY 3.0', file: 'vendor/music/rollin-at-5-electronic.mp3', bpm: 105 },
  { id: 'aitech', title: 'Aitech', artist: 'Kevin MacLeod', license: 'CC BY 3.0', file: 'vendor/music/aitech.mp3', bpm: 105 },
  { id: 'house', title: 'Lets Bring This House Down', artist: 'Antti Luode', license: 'CC BY 3.0', file: 'vendor/music/lets-bring-this-house-down.mp3', bpm: 113 },
];

/** The control for the studio, plus play and stop for the recording to call. */
export function createMusic(base) {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'auto';
  let ownUrl = null;
  let choice = recall() || TRACKS[0].id;
  if (choice !== 'off' && !TRACKS.some((t) => t.id === choice)) choice = TRACKS[0].id;
  let fading = null;

  const credit = h('p', { class: 'rw-caption rw-music__credit', 'data-music-credit': '' });
  const status = h('p', { class: 'rw-status rw-status--warn', role: 'status' });
  const fileInput = h('input', { type: 'file', accept: 'audio/*', class: 'rw-upload__input', id: 'rw-music-file', onChange: onFile });
  const select = h('select', { id: 'rw-music', 'aria-label': 'Music', onChange: (e) => choose(e.target.value) });
  const volume = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: 0.7, class: 'rw-range', 'aria-label': 'Music volume', onInput: (e) => { audio.volume = Number(e.target.value); paintVolume(); } });
  // The filled part of the slider, drawn from the value, so the track reads like the data bars elsewhere.
  const paintVolume = () => volume.style.setProperty('--fill', `${Math.round(Number(volume.value) * 100)}%`);
  paintVolume();
  audio.volume = 0.7;
  const previewLabel = h('span', null, 'Preview');
  const previewIcon = h('span', { class: 'rw-music__icon', 'aria-hidden': 'true' }, icon('play'));
  const previewButton = h('button', { type: 'button', class: 'rw-btn rw-btn--small rw-music__preview', onClick: togglePreview }, previewIcon, previewLabel);
  const setPreview = (playing) => {
    previewLabel.textContent = playing ? 'Stop preview' : 'Preview';
    previewButton.classList.toggle('is-playing', playing);
    previewIcon.replaceChildren(icon(playing ? 'pause' : 'play'));
  };

  function fillOptions() {
    clear(select).append(
      h('option', { value: 'off', selected: choice === 'off' }, 'No music'),
      ...TRACKS.map((t) => h('option', { value: t.id, selected: choice === t.id }, `${t.title}, ${t.artist}`)),
      ...(ownUrl ? [h('option', { value: 'own', selected: choice === 'own' }, 'My own track')] : []),
    );
  }

  function current() {
    return TRACKS.find((t) => t.id === choice) || null;
  }

  function choose(id) {
    stop();
    choice = id;
    if (id !== 'own') remember(id);
    const track = current();
    credit.textContent = track ? `"${track.title}" by ${track.artist}, ${track.license}.` : id === 'own' ? 'Your own track, played from this device.' : '';
    status.textContent = '';
    if (track) audio.src = `${base}${track.file}`;
    else if (id === 'own') audio.src = ownUrl;
    else audio.removeAttribute('src');
    previewButton.disabled = id === 'off';
    setPreview(false);
  }

  function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (ownUrl) URL.revokeObjectURL(ownUrl);
    ownUrl = URL.createObjectURL(file);
    fillOptions();
    choose('own');
    select.value = 'own';
  }

  function play() {
    clearInterval(fading);
    if (choice === 'off' || !audio.src) return;
    audio.volume = Number(volume.value);
    audio.currentTime = 0;
    // A browser can refuse to start sound on its own. The walk matters more than the music, so carry on.
    audio.play().catch(() => { status.textContent = 'The browser blocked the music. Press Preview once, then try again.'; });
  }

  function stop() {
    clearInterval(fading);
    audio.pause();
    setPreview(false);
  }

  /** Fade out rather than cutting off at the end of the walk. */
  function fadeOut() {
    clearInterval(fading);
    if (audio.paused) return;
    fading = setInterval(() => {
      if (audio.volume <= 0.06) {
        stop();
        audio.volume = Number(volume.value);
      } else {
        audio.volume -= 0.05;
      }
    }, 60);
  }

  function togglePreview() {
    if (audio.paused) {
      play();
      setPreview(true);
    } else {
      stop();
    }
  }

  fillOptions();
  choose(choice);

  const el = h('section', { class: 'rw-card rw-card--quiet rw-panel rw-music', 'aria-labelledby': 'rw-music-title' },
    h('div', { class: 'rw-card__head' }, h('h2', { id: 'rw-music-title' }, 'Music to walk to')),
    h('label', { class: 'rw-field' }, h('span', null, 'Track'), select),
    h('label', { class: 'rw-field' }, h('span', null, 'Volume'), volume),
    h('div', { class: 'rw-actions rw-actions--top' },
      previewButton,
      fileInput,
      h('label', { class: 'rw-btn rw-btn--small', for: 'rw-music-file' }, 'Use my own track')),
    credit,
    status,
    h('p', { class: 'rw-field__help' }, 'It starts when recording starts. It plays out loud and is never recorded.'));

  return {
    el,
    play,
    fadeOut,
    stop,
    /** For the result: what was playing, so a cadence can be compared with it. */
    info() {
      const track = current();
      return track ? { title: track.title, bpm: track.bpm } : null;
    },
    destroy() {
      stop();
      audio.removeAttribute('src');
      audio.load();
      if (ownUrl) URL.revokeObjectURL(ownUrl);
    },
  };
}
