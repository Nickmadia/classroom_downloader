import { oauthClient } from './config.js';
export const scopes = [
  'classroom.courses.readonly', 'classroom.coursework.me.readonly',
  'classroom.courseworkmaterials.readonly', 'classroom.announcements.readonly', 'drive.readonly',
].map(scope => `https://www.googleapis.com/auth/${scope}`);
const TOKEN_TIMEOUT = 60 * 1000;
let session;
let pending;
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
async function authorize() {
  if (!oauthClient.clientId) throw new Error('Configure your Desktop app OAuth client in src/config.js first. See README.');
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const redirect = `http://127.0.0.1/mozoauth2/${new URL(browser.identity.getRedirectURL()).hostname.split('.')[0]}`;
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({client_id: oauthClient.clientId, redirect_uri: redirect,
    response_type: 'code', scope: scopes.join(' '), state, code_challenge: challenge,
    code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account'});
  const result = new URL(await browser.identity.launchWebAuthFlow({url: url.href, interactive: true}));
  if (result.origin !== new URL(redirect).origin || result.pathname !== new URL(redirect).pathname || result.searchParams.get('state') !== state) {
    throw new Error('Authorization response did not match this request.');
  }
  if (result.searchParams.has('error')) throw new Error(`Google authorization: ${result.searchParams.get('error')}`);
  const code = result.searchParams.get('code');
  if (!code) throw new Error('Google did not return an authorization code.');
  const body = new URLSearchParams({client_id: oauthClient.clientId, code, code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: redirect});
  if (oauthClient.clientSecret) body.set('client_secret', oauthClient.clientSecret);
  const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', body, credentials: 'omit', signal: AbortSignal.timeout(TOKEN_TIMEOUT)});
  if (!response.ok) throw new Error(`Token exchange failed (${response.status}). Check your OAuth configuration.`);
  const data = await response.json();
  const granted = new Set((data.scope || '').split(' '));
  if (!data.access_token || !scopes.every(scope => granted.has(scope))) throw new Error('All requested read-only scopes must be granted.');
  session = {token: data.access_token, expires: Date.now() + data.expires_in * 1000 - 60000};
  return session.token;
}
export async function getToken(signal, interactive = false) {
  signal.throwIfAborted();
  if (session?.expires > Date.now()) return session.token;
  if (!interactive) throw new Error('Authorization expired. Scan again to reconnect.');
  pending ??= authorize().finally(() => { pending = undefined; });
  // identity has no cancellation API. Stop the scan immediately while the user
  // can close the authorization window; a later consent result stays local.
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, {once:true});
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function forgetToken() { session = undefined; }
