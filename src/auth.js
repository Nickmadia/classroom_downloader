import { oauthClient, loadOAuthClient } from './config.js';
export const scopes = [
  'classroom.courses.readonly', 'classroom.student-submissions.me.readonly',
  'classroom.courseworkmaterials.readonly', 'classroom.announcements.readonly',
  'classroom.topics.readonly', 'drive.readonly',
].map(scope => `https://www.googleapis.com/auth/${scope}`);
// Google Console exposes this read-only permission under student-submissions;
// older Classroom documentation and token responses also use coursework.me.
function normalizeScope(scope) {
  return scope === 'https://www.googleapis.com/auth/classroom.coursework.me.readonly'
    ? 'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'
    : scope;
}
const TOKEN_TIMEOUT = 60 * 1000;
let session;
let pending;
let consentInProgress = false;
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
async function requestAuthorization(requestedScopes, onStatus = () => {}) {
  if (!oauthClient.clientId) throw new Error('Configure your Desktop app OAuth client in src/config.js first. See README.');
  if (consentInProgress) {
    throw new Error('A Google authorization flow is already open. Finish or close that window before trying again.');
  }
  consentInProgress = true;
  try {
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const redirect = `http://127.0.0.1/mozoauth2/${new URL(browser.identity.getRedirectURL()).hostname.split('.')[0]}`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id: oauthClient.clientId, redirect_uri: redirect,
      response_type: 'code', scope: requestedScopes.join(' '), state, code_challenge: challenge,
      code_challenge_method: 'S256', access_type: 'online', prompt: 'select_account'});
    onStatus('Waiting for Google sign-in and permission approval…');
    const result = new URL(await browser.identity.launchWebAuthFlow({url: url.href, interactive: true}));
    if (result.origin !== new URL(redirect).origin || result.pathname !== new URL(redirect).pathname || result.searchParams.get('state') !== state) {
      throw new Error('Authorization response did not match this request.');
    }
    if (result.searchParams.has('error')) throw new Error(`Google authorization: ${result.searchParams.get('error')}`);
    const code = result.searchParams.get('code');
    if (!code) throw new Error('Google did not return an authorization code.');
    return {code, verifier, redirect};
  } finally {
    consentInProgress = false;
  }
}

// Developer-console diagnostic: request one existing scope, discard the code,
// and never exchange it or cache a partially authorized session.
export async function testGoogleConsent(scopeSuffix = 'classroom.courses.readonly') {
  const scope = `https://www.googleapis.com/auth/${scopeSuffix}`;
  if (!scopes.includes(normalizeScope(scope))) throw new Error('Choose a scope already requested by Classroom Downloader.');
  await requestAuthorization([scope]);
  return {callbackReceived: true, scope: scopeSuffix};
}

async function authorize(onStatus) {
  const {code, verifier, redirect} = await requestAuthorization(scopes, onStatus);
  onStatus('Google returned authorization. Connecting to the APIs…');
  const client = await loadOAuthClient();
  const body = new URLSearchParams({client_id: client.clientId, code, code_verifier: verifier,
    grant_type: 'authorization_code', redirect_uri: redirect});
  if (client.clientSecret) body.set('client_secret', client.clientSecret);
  const response = await fetch('https://oauth2.googleapis.com/token', {method: 'POST', body, credentials: 'omit', signal: AbortSignal.timeout(TOKEN_TIMEOUT)});
  let data;
  try { data = await response.json(); }
  catch { throw new Error(`Google token endpoint returned an unreadable response (${response.status}).`); }
  if (!response.ok) {
    // Only show recognized error codes and fixed explanations, never raw OAuth
    // responses: they can contain authorization codes or other sensitive data.
    const errors = {
      invalid_client: 'Google rejected the OAuth client configuration.',
      invalid_grant: 'The authorization code expired or Google rejected the code/PKCE request. Retry Scan course.',
      invalid_request: 'Google rejected the token request parameters.',
      unauthorized_client: 'This OAuth client is not allowed to use this authorization flow.',
      access_denied: 'Google denied the token request.',
    };
    const missingSecret = data.error === 'invalid_request' &&
      /(?:client_secret.*(?:missing|required)|(?:missing|required).*client_secret)/i.test(data.error_description || '');
    const explanation = missingSecret ? 'Google requires client_secret for this Desktop OAuth client.' :
      errors[data.error] || 'Check your OAuth client configuration.';
    const code = Object.hasOwn(errors, data.error) ? `, ${data.error}` : '';
    throw new Error(`Token exchange failed (${response.status}${code}). ${explanation}`);
  }
  const granted = new Set((data.scope || '').split(/\s+/).map(normalizeScope));
  if (!data.access_token || !scopes.every(scope => granted.has(scope))) throw new Error('All requested read-only scopes must be granted.');
  session = {token: data.access_token, expires: Date.now() + data.expires_in * 1000 - 60000};
  return session.token;
}
export async function getToken(signal, interactive = false, onStatus = () => {}) {
  signal.throwIfAborted();
  if (session?.expires > Date.now()) return session.token;
  if (!interactive) throw new Error('Authorization expired. Scan again to reconnect.');
  pending ??= authorize(onStatus).finally(() => { pending = undefined; });
  // identity has no cancellation API. Stop the scan immediately while the user
  // can close the authorization window; a later consent result stays local.
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, {once:true});
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
export function forgetToken() { session = undefined; }
