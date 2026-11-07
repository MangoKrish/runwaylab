// Auth0 sends the sign-in popup back here. This swaps the one-time code for the person's identity on the
// server, sets a short session cookie, then tells the waiting page and closes itself.
import { unseal } from './_common.mjs';
import { authEnabled, auth0Base, callbackUrl, checkIdToken, cookie, FLOW_COOKIE, makeSession, readCookie, SESSION_COOKIE, SESSION_SECONDS } from './_auth.mjs';

/** Fixed strings only: nothing from the address bar is ever written into this page. */
function finish(ok, cookies = []) {
  const message = ok ? 'You are signed in. You can close this window.' : 'Sign-in did not finish. Close this window and try again.';
  const html = `<!doctype html><meta charset="utf-8"><title>RunwayLab sign-in</title><body style="font:16px/1.5 system-ui;padding:2rem"><p>${message}</p><script>try{new BroadcastChannel('rw-auth').postMessage(${ok ? 'true' : 'false'})}catch(e){}window.close()</script>`;
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
  });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(html, { status: ok ? 200 : 400, headers });
}

export async function GET(request) {
  if (!authEnabled()) return finish(false);
  const params = new URL(request.url).searchParams;
  const clearFlow = cookie(request, FLOW_COOKIE, '', 0);
  const flow = unseal(readCookie(request, FLOW_COOKIE));
  const code = params.get('code');

  // The state must match the cookie set at login, which proves this browser started this sign-in.
  if (params.get('error') || !code || !flow || !(flow.exp > Date.now() / 1000) || flow.state !== params.get('state')) {
    return finish(false, [clearFlow]);
  }

  let tokens;
  try {
    const res = await fetch(`${auth0Base()}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.AUTH0_CLIENT_ID,
        client_secret: process.env.AUTH0_CLIENT_SECRET,
        code,
        redirect_uri: callbackUrl(request),
      }),
    });
    if (!res.ok) return finish(false, [clearFlow]);
    tokens = await res.json();
  } catch {
    return finish(false, [clearFlow]);
  }

  const claims = checkIdToken(tokens.id_token, flow.nonce);
  if (!claims) return finish(false, [clearFlow]);

  const name = String(claims.given_name || claims.nickname || claims.name || '').slice(0, 30) || null;
  return finish(true, [clearFlow, cookie(request, SESSION_COOKIE, makeSession(claims.sub, name), SESSION_SECONDS)]);
}
