// Shared by the server functions. The leading underscore keeps Vercel from making this a function.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
export const refuse = (status, code, message) => json(status, { ok: false, code, message });

/** Same-site only, so other pages cannot use these endpoints from a visitor's browser. */
export function sameSite(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') || request.headers.get('host'));
  } catch {
    return false;
  }
}

/** WALL_SECRET signs sessions and judge results. Local previews get a fixed value so they work with no setup. */
export const secret = () => process.env.WALL_SECRET || (process.env.RUNWAYLAB_DEV ? 'local-preview-only' : null);

const mac = (text) => createHmac('sha256', secret()).update(text).digest('base64url');

function equal(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Tamper-evident storage for a small value, such as a session cookie. Signed, not encrypted. */
export function seal(value) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${mac(body)}`;
}

export function unseal(token) {
  if (!secret() || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature || !equal(signature, mac(body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    return null;
  }
}

const judgeFacts = (j) => JSON.stringify([
  j.presence.score, j.presence.why, j.style.score, j.style.why, j.match.id, j.match.why, j.verdict, j.tip ?? '',
  (j.moments || []).map((m) => [m.still, m.note]),
]);

/**
 * The judge function signs its answer, and the wall only accepts a signature it recognises. That stops
 * anyone posting a made-up Gemini score. It does not stop reusing one real judgment on forged landmarks,
 * which is an acceptable limit for a game leaderboard.
 */
export const signJudge = (judge) => (secret() ? mac(`judge:${judgeFacts(judge)}`) : null);

export function judgeIsGenuine(judge) {
  if (!secret() || typeof judge?.sig !== 'string') return false;
  try {
    return equal(judge.sig, mac(`judge:${judgeFacts(judge)}`));
  } catch {
    return false;
  }
}

/** Who owns a post, stored as a keyed hash so the database holds no account IDs or delete tokens. */
export const ownerHash = (value) => mac(`owner:${value}`);
