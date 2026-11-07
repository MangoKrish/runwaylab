// Auth0 sign-in, handled entirely on the server. The page only ever talks to its own site, so the
// browser's connection lock stays in place, and no Auth0 library or token ever reaches the page.
import { seal, unseal, secret } from './_common.mjs';

export const SESSION_COOKIE = 'rw_session';
export const FLOW_COOKIE = 'rw_auth_flow';
export const SESSION_SECONDS = 20 * 60; // Short, because this may be a shared kiosk.

export const auth0Base = () => process.env.AUTH0_BASE_URL || (process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : null);

export const authEnabled = () => !!(auth0Base() && process.env.AUTH0_CLIENT_ID && process.env.AUTH0_CLIENT_SECRET && secret());

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') || '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

function isHttps(request) {
  return (request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')) === 'https';
}

export function cookie(request, name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(request) ? '; Secure' : ''}`;
}

/** The site's own address, including any sub-path such as /preview/runway under a local preview. */
export function siteBase(request) {
  const url = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || url.host;
  const protocol = isHttps(request) ? 'https' : 'http';
  return `${protocol}://${host}${url.pathname.replace(/\/api\/[^/]*$/, '')}`;
}

export const callbackUrl = (request) => `${siteBase(request)}/api/auth-callback`;

/** @returns {{sub:string,name:string|null}|null} the signed-in person, if their session is valid. */
export function currentUser(request) {
  if (!authEnabled()) return null;
  const session = unseal(readCookie(request, SESSION_COOKIE));
  if (!session?.sub || !(session.exp > Date.now() / 1000)) return null;
  return { sub: session.sub, name: session.name ?? null };
}

export const makeSession = (sub, name) => seal({ sub, name, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS });

/**
 * Check an ID token received directly from Auth0's token endpoint. The OpenID Connect spec allows skipping
 * the signature check in this one case, because the token came straight from the issuer over TLS.
 * Issuer, audience, expiry and nonce are still checked.
 */
export function checkIdToken(idToken, nonce) {
  try {
    const claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
    if (claims.iss !== `${auth0Base()}/`) return null;
    const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audience.includes(process.env.AUTH0_CLIENT_ID)) return null;
    if (!(claims.exp > Date.now() / 1000)) return null;
    if (!nonce || claims.nonce !== nonce) return null;
    if (typeof claims.sub !== 'string' || !claims.sub) return null;
    return claims;
  } catch {
    return null;
  }
}
