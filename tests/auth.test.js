import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthClient} from '../src/config.js';

async function fixture(t, launch) {
  const previousBrowser = globalThis.browser;
  const previousFetch = globalThis.fetch;
  const previousConfig = {...oauthClient};
  oauthClient.clientId = 'test.apps.googleusercontent.com';
  oauthClient.clientSecret = '';
  globalThis.browser = {identity:{getRedirectURL:() => 'https://example.extensions.allizom.org/', launchWebAuthFlow:launch}};
  t.after(() => {
    globalThis.browser = previousBrowser;
    globalThis.fetch = previousFetch;
    Object.assign(oauthClient, previousConfig);
  });
  return import(`../src/auth.js?fixture=${Math.random()}`);
}
test('OAuth uses PKCE/state, validates scopes and keeps token out of redirect URLs', async t => {
  let authorizationUrl;
  const auth = await fixture(t, async ({url}) => {
    authorizationUrl = new URL(url);
    const redirect = new URL(authorizationUrl.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'authorization-code',state:authorizationUrl.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async (url,{body}) => {
    assert.equal(url,'https://oauth2.googleapis.com/token');
    assert.equal(body.get('grant_type'),'authorization_code');
    const verifier = body.get('code_verifier');
    assert.equal(verifier.length,43);
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier));
    assert.equal(Buffer.from(digest).toString('base64url'),authorizationUrl.searchParams.get('code_challenge'));
    assert.equal(authorizationUrl.searchParams.get('code_challenge_method'),'S256');
    assert.equal(authorizationUrl.searchParams.get('response_type'),'code');
    return Response.json({access_token:'session-token',expires_in:3600,scope:auth.scopes.join(' ')});
  };
  const signal = new AbortController().signal;
  assert.equal(await auth.getToken(signal,true),'session-token');
  assert.equal(await auth.getToken(signal),'session-token');
  auth.forgetToken();
  await assert.rejects(auth.getToken(signal),/Scan again/);
});
test('OAuth rejects mismatched state before exchanging a token', async t => {
  const auth = await fixture(t, async ({url}) => {
    const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
    redirect.search = '?code=wrong&state=wrong'; return redirect.href;
  });
  globalThis.fetch = async () => {assert.fail('Invalid OAuth response must not reach token endpoint');};
  await assert.rejects(auth.getToken(new AbortController().signal,true),/did not match/);
});
test('OAuth cancellation releases the scan without waiting for the consent window', async t => {
  let rejectConsent;
  const auth = await fixture(t, () => new Promise((_,reject) => {rejectConsent = reject;}));
  const controller = new AbortController();
  const token = auth.getToken(controller.signal,true);
  const assertion = assert.rejects(token,{name:'AbortError'});
  controller.abort(); await assertion;
  // Close the mocked authorization window and let shared pending state clean up.
  while (!rejectConsent) await new Promise(resolve => setImmediate(resolve));
  rejectConsent(new Error('Window closed'));
  await new Promise(resolve => setImmediate(resolve));
});
