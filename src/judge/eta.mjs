// How long judging should take, learned from the last few judgments on this device. Gemini sends nothing until it
// has finished, so the bar is an estimate. It is honest about that: once the estimate has passed, it slows down
// and says so instead of sitting at 100%.
const KEY = 'runwaylab.judgeSeconds';
const KEEP = 5;
export const DEFAULT_SECONDS = 15;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((x) => Number.isFinite(x) && x > 0) : [];
  } catch {
    return [];
  }
}

/** The median of recent judgments, or the default when there are none. */
export function expectedSeconds(list = read()) {
  if (!list.length) return DEFAULT_SECONDS;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.min(60, Math.max(4, median));
}

/** Only successful answers are remembered, so one stuck request does not make every later estimate long. */
export function rememberSeconds(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...read(), Math.round(seconds * 10) / 10].slice(-KEEP)));
  } catch {
    // Storage can be blocked. The default estimate still works.
  }
}

/** 0 to 1. Steady up to 90% at the expected time, then creeping toward 99% and never reaching it. */
export function progressAt(elapsed, expected) {
  const x = Math.max(0, elapsed) / expected;
  return x <= 1 ? 0.9 * x : 0.9 + 0.09 * (1 - Math.exp(-(x - 1) * 1.5));
}

/** What to say about the wait. */
export function timeLeftText(elapsed, expected) {
  const left = Math.ceil(expected - elapsed);
  if (left > 1) return `About ${left} seconds left`;
  if (elapsed < expected * 2) return 'Almost there';
  return `Slower than usual (${Math.round(elapsed)} s). Gemini may be busy, so the server is trying other models. It gives up after 2 minutes.`;
}
