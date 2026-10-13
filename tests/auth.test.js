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
test('OAuth token errors explain a missing secret without exposing response data', async t => {
  const auth = await fixture(t, async ({url}) => {
    const request = new URL(url);
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'private-code',state:request.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async () => Response.json({error:'invalid_request',error_description:'client_secret is missing. private-code private-token',access_token:'private-token'},{status:400});
  const statuses = [];
  await assert.rejects(auth.getToken(new AbortController().signal,true,status => statuses.push(status)), error => {
    assert.match(error.message,/Google requires client_secret/);
    assert.ok(!error.message.includes('private-code'));
    assert.ok(!error.message.includes('private-token'));
    return true;
  });
  assert.deepEqual(statuses,['Waiting for Google sign-in and permission approval…','Google returned authorization. Connecting to the APIs…']);
});
test('unrecognized token errors do not expose arbitrary response strings', async t => {
  const auth = await fixture(t, async ({url}) => {
    const request = new URL(url);
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'code',state:request.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async () => Response.json({error:'private-token',error_description:'private-code'},{status:400});
  await assert.rejects(auth.getToken(new AbortController().signal,true), error => {
    assert.equal(error.message,'Token exchange failed (400). Check your OAuth client configuration.');
    return true;
  });
});
test('single-scope consent diagnostic discards codes without exchanging or caching tokens', async t => {
  const requests = [];
  const auth = await fixture(t, async ({url}) => {
    const request = new URL(url);
    requests.push(request.searchParams.get('scope'));
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'private-code',state:request.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async () => assert.fail('Consent diagnostic must not exchange codes');
  assert.deepEqual(await auth.testGoogleConsent(), {callbackReceived:true,scope:'classroom.courses.readonly'});
  assert.deepEqual(await auth.testGoogleConsent('classroom.coursework.me.readonly'), {callbackReceived:true,scope:'classroom.coursework.me.readonly'});
  assert.deepEqual(requests,['https://www.googleapis.com/auth/classroom.courses.readonly','https://www.googleapis.com/auth/classroom.coursework.me.readonly']);
  await assert.rejects(auth.getToken(new AbortController().signal),/Scan again/);
  await assert.rejects(auth.testGoogleConsent('drive'),/already requested/);
  assert.equal(requests.length,2);
});
test('requests the Console read-only name and accepts the legacy response alias', async t => {
  const auth = await fixture(t, async ({url}) => {
    const request = new URL(url);
    const requested = request.searchParams.get('scope').split(' ');
    assert.ok(requested.includes('https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'));
    assert.ok(!requested.includes('https://www.googleapis.com/auth/classroom.coursework.me'));
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'code',state:request.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async () => Response.json({access_token:'session-token',expires_in:3600,
    scope:auth.scopes.map(scope => scope.replace('classroom.student-submissions.me.readonly','classroom.coursework.me.readonly')).join(' ')});
  assert.equal(await auth.getToken(new AbortController().signal,true),'session-token');
});
test('a coursework write grant alone does not satisfy read-only scope validation', async t => {
  const auth = await fixture(t, async ({url}) => {
    const request = new URL(url);
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'code',state:request.searchParams.get('state')});
    return redirect.href;
  });
  globalThis.fetch = async () => Response.json({access_token:'session-token',expires_in:3600,
    scope:auth.scopes.map(scope => scope.replace('classroom.student-submissions.me.readonly','classroom.coursework.me')).join(' ')});
  await assert.rejects(auth.getToken(new AbortController().signal,true),/All requested read-only scopes/);
});
test('consent diagnostics cannot overlap a pending scan, including a cancelled scan', async t => {
  let rejectConsent;
  let launches = 0;
  const auth = await fixture(t, () => {
    launches++;
    return new Promise((_,reject) => {rejectConsent = reject;});
  });
  const controller = new AbortController();
  const scan = auth.getToken(controller.signal,true);
  const cancelled = assert.rejects(scan,{name:'AbortError'});
  await assert.rejects(auth.testGoogleConsent(),/already open/);
  controller.abort(); await cancelled;
  await assert.rejects(auth.testGoogleConsent(),/already open/);
  while (!rejectConsent) await new Promise(resolve => setImmediate(resolve));
  assert.equal(launches,1);
  rejectConsent(new Error('User cancelled or denied access.'));
  await new Promise(resolve => setImmediate(resolve));
  globalThis.browser.identity.launchWebAuthFlow = async ({url}) => {
    launches++;
    const request = new URL(url);
    const redirect = new URL(request.searchParams.get('redirect_uri'));
    redirect.search = new URLSearchParams({code:'code',state:request.searchParams.get('state')});
    return redirect.href;
  };
  assert.equal((await auth.testGoogleConsent()).callbackReceived,true);
  assert.equal(launches,2);
});
