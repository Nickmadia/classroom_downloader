// Public installed-app configuration, not a Google account credential.
// Create a Google Cloud OAuth client of type Desktop app. See README.md.
export const oauthClient = {
  clientId: "868250846465-ddph2te9t3gpradt7tikic5h6pv0pacm.apps.googleusercontent.com",
  clientSecret: '', // Optional installed-app secret if required by your Google client.
};

export async function loadOAuthClient() {
  if (oauthClient.clientSecret || !globalThis.browser?.runtime?.getURL) return oauthClient;
  let response;
  try {
    response = await fetch(browser.runtime.getURL('src/config.local.json'));
  } catch {
    throw new Error('Could not load src/config.local.json. Check the local OAuth setup in README.md.');
  }
  if (response.status === 404) return oauthClient;
  if (!response.ok) throw new Error('Could not read the local OAuth configuration.');
  let local;
  try { local = await response.json(); }
  catch { throw new Error('Local OAuth configuration must contain valid JSON.'); }
  if (!local || local.clientId !== oauthClient.clientId || typeof local.clientSecret !== 'string' || !local.clientSecret.trim()) {
    throw new Error('Local OAuth configuration must match the configured client ID and contain its Desktop client secret.');
  }
  return {...oauthClient, clientSecret: local.clientSecret};
}
