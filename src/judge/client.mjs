// Talks to this site's own server function, which holds the Gemini key. The key never reaches the page.
const url = () => new URL('api/judge', document.baseURI).href;

/** Is a judge connected? Never throws: no answer just means no judge right now. */
export async function judgeStatus() {
  try {
    const res = await fetch(url(), { cache: 'no-store' });
    if (!res.ok) return { ready: false };
    return await res.json();
  } catch {
    return { ready: false, offline: true };
  }
}

const number = (m) => (m?.ok ? m.value : null);

/**
 * Send the stills and the measured numbers. Resolves with { ok: true, ... } or { ok: false, message }.
 * Rethrows only a cancel, so a navigating page can ignore it.
 */
export async function requestJudgement({ stills, analysis }, signal) {
  const timeout = new AbortController();
  // Long enough for the server's retries: one real answer took 27 seconds on its own.
  const timer = setTimeout(() => timeout.abort(), 120000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: timeout.signal,
      body: JSON.stringify({
        stills: stills.map((s) => ({ t: s.t, jpeg: s.dataUrl.split(',')[1] })),
        measurements: {
          footPlacementPercentOfHeight: number(analysis.metrics.footLine),
          shoulderRockDegrees: number(analysis.metrics.shoulderSway),
          trunkSwayDegrees: number(analysis.metrics.trunkSway),
          straightLinePercentOfHeight: number(analysis.metrics.torsoSpread),
          headMovementPercentOfHeight: number(analysis.metrics.headMovement),
        },
      }),
    });
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, code: 'bad_reply', message: 'The judge sent back something unreadable. Try again.' };
    if (!res.ok || !body.ok) return { ok: false, code: body.code || 'failed', message: body.message || 'The judge could not answer. Try again.' };
    return {
      ...body,
      // `still` stays because the server's signature covers it; the wall checks that signature later.
      moments: (body.moments || []).map((m) => ({ t: stills[m.still]?.t ?? 0, still: m.still, note: m.note })),
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    if (timeout.signal.aborted) return { ok: false, code: 'timeout', message: 'The judge took too long to answer. Try again.' };
    return { ok: false, code: 'offline', message: 'Could not reach the judge. Check the internet connection and try again.' };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
