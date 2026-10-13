import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOAuthClient, oauthClient} from '../src/config.js';

function fixture(t, {clientSecret = '', browser = undefined, fetchImpl = async () => {
  assert.fail('Unexpected local OAuth configuration fetch');
}} = {}) {
  const previousConfig = {...oauthClient};
  const previousBrowser = Object.getOwnPropertyDescriptor(globalThis, 'browser');
  const previousFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  oauthClient.clientId = 'synthetic.apps.googleusercontent.com';
  oauthClient.clientSecret = clientSecret;
  if (browser === undefined) delete globalThis.browser;
  else globalThis.browser = browser;
  globalThis.fetch = fetchImpl;
  t.after(() => {
    Object.assign(oauthClient, previousConfig);
    if (previousBrowser) Object.defineProperty(globalThis, 'browser', previousBrowser);
    else delete globalThis.browser;
    if (previousFetch) Object.defineProperty(globalThis, 'fetch', previousFetch);
    else delete globalThis.fetch;
  });
}

test('uses base configuration when no extension runtime URL is available', async t => {
  fixture(t);
  const result = await loadOAuthClient();
  assert.equal(result, oauthClient);
  assert.equal(result.clientId, 'synthetic.apps.googleusercontent.com');
  assert.equal(result.clientSecret, '');
});

test('uses an already configured Desktop client secret without fetching local metadata', async t => {
  fixture(t, {clientSecret:'synthetic-desktop-secret'});
  assert.equal(await loadOAuthClient(), oauthClient);
});

test('loads matching local metadata into a copy of the public configuration', async t => {
  const requested = [];
  fixture(t, {
    browser:{runtime:{getURL:path => `moz-extension://test/${path}`}},
    fetchImpl:async url => {
      requested.push(url);
      return Response.json({clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-desktop-secret'});
    },
  });
  const result = await loadOAuthClient();
  assert.deepEqual(requested, ['moz-extension://test/src/config.local.json']);
  assert.notEqual(result, oauthClient);
  assert.deepEqual(result, {clientId:'synthetic.apps.googleusercontent.com',clientSecret:'synthetic-desktop-secret'});
  assert.equal(oauthClient.clientSecret, '');
});

test('falls back to base configuration when local metadata is absent', async t => {
  fixture(t, {
    browser:{runtime:{getURL:path => `moz-extension://test/${path}`}},
    fetchImpl:async () => new Response('', {status:404}),
  });
  assert.equal(await loadOAuthClient(), oauthClient);
});

test('reports non-404 local configuration fetch failures without response contents', async t => {
  fixture(t, {
    browser:{runtime:{getURL:path => `moz-extension://test/${path}`}},
    fetchImpl:async () => new Response('synthetic private response', {status:500}),
  });
  await assert.rejects(loadOAuthClient(), error => {
    assert.equal(error.message, 'Could not read the local OAuth configuration.');
    assert.ok(!error.message.includes('synthetic private response'));
    return true;
  });
});

test('rejects local metadata that does not match the configured client or contain a nonempty secret', async t => {
  const invalidConfigs = [
    null,
    {clientId:'different.apps.googleusercontent.com',clientSecret:'synthetic-desktop-secret'},
    {clientId:'synthetic.apps.googleusercontent.com',clientSecret:''},
    {clientId:'synthetic.apps.googleusercontent.com',clientSecret:'   '},
    {clientId:'synthetic.apps.googleusercontent.com',clientSecret:42},
  ];
  fixture(t, {
    browser:{runtime:{getURL:path => `moz-extension://test/${path}`}},
    fetchImpl:async () => Response.json(invalidConfigs.shift()),
  });
  for (let index = 0; index < 5; index++) {
    await assert.rejects(loadOAuthClient(), /Local OAuth configuration must match the configured client ID and contain its Desktop client secret\./);
  }
});

test('sanitizes local configuration network and JSON errors', async t => {
  let networkFailure = true;
  fixture(t, {
    browser:{runtime:{getURL:path => `moz-extension://test/${path}`}},
    fetchImpl:async () => {
      if (networkFailure) throw new Error('synthetic private network details');
      return new Response('synthetic private malformed JSON');
    },
  });
  await assert.rejects(loadOAuthClient(), {message:'Could not load src/config.local.json. Check the local OAuth setup in README.md.'});
  networkFailure = false;
  await assert.rejects(loadOAuthClient(), {message:'Local OAuth configuration must contain valid JSON.'});
});
