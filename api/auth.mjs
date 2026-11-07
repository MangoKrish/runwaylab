// Sign-in endpoints: ?action=login starts Auth0, ?action=me says who is signed in, ?action=logout ends it.
import { randomBytes } from 'node:crypto';
import { json, refuse, sameSite, seal } from './_common.mjs';
import { authEnabled, auth0Base, callbackUrl, cookie, currentUser, FLOW_COOKIE, SESSION_COOKIE } from './_auth.mjs';

export async function GET(request) {
  const action = new URL(request.url).searchParams.get('action');

  if (action === 'me') {
    const user = currentUser(request);
    return json(200, { enabled: authEnabled(), signedIn: !!user, name: user?.name ?? null });
  }

  if (action === 'login') {
    if (!authEnabled()) return refuse(503, 'auth_off', 'Sign-in is not set up on this server.');
    const state = randomBytes(18).toString('base64url');
    const nonce = randomBytes(18).toString('base64url');
    const authorize = new URL(`${auth0Base()}/authorize`);
    authorize.search = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.AUTH0_CLIENT_ID,
      redirect_uri: callbackUrl(request),
      // Name only: no email scope, so an email address never reaches this app.
      scope: 'openid profile',
      state,
      nonce,
      // Always ask, so the next person at a shared kiosk is not silently signed in as the last one.
      prompt: 'login',
    });
    const flow = seal({ state, nonce, exp: Math.floor(Date.now() / 1000) + 600 });
    return new Response(null, {
      status: 302,
      headers: { Location: authorize.href, 'Cache-Control': 'no-store', 'Set-Cookie': cookie(request, FLOW_COOKIE, flow, 600) },
    });
  }

  return refuse(404, 'unknown_action', 'No such action.');
}

export async function POST(request) {
  if (!sameSite(request)) return refuse(403, 'forbidden', 'This endpoint only answers its own site.');
  if (new URL(request.url).searchParams.get('action') !== 'logout') return refuse(404, 'unknown_action', 'No such action.');
  return json(200, { ok: true }, { 'Set-Cookie': cookie(request, SESSION_COOKIE, '', 0) });
}
