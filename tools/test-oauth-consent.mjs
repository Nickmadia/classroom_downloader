// Developer diagnostic only. No token exchange, credential storage or API calls.
import {createServer} from 'node:http';
import {readFile, readdir} from 'node:fs/promises';
import {createHash, randomBytes} from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const scope = 'https://www.googleapis.com/auth/classroom.courses.readonly';
const candidates = (await readdir('.')).filter(name => /^client_secret.*\.json$/.test(name));
let filename;
let timeoutMs = DEFAULT_TIMEOUT_MS;
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index];
  if (arg === '--timeout-ms') {
    const value = process.argv[++index];
    timeoutMs = Number(value);
    if (!value || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error(`--timeout-ms must be a positive number no greater than ${MAX_TIMEOUT_MS}.`);
    }
  } else if (arg.startsWith('--')) {
    throw new Error(`Unknown option: ${arg}`);
  } else if (!filename) {
    filename = arg;
  } else {
    throw new Error('Specify at most one Desktop client JSON filename.');
  }
}
filename ||= candidates.length === 1 ? candidates[0] : null;
if (!filename) throw new Error('Specify your downloaded Desktop client JSON as the first argument.');
const {installed} = JSON.parse(await readFile(filename, 'utf8'));
if (!installed?.client_id?.endsWith('.apps.googleusercontent.com')) {
  throw new Error('Expected a downloaded Desktop app OAuth client JSON.');
}

const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
let redirect;
let timeout;
let finished = false;
function finish(message, success) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  console.log(message);
  process.exitCode = success ? 0 : 1;
  server.close();
}
const server = createServer((request, response) => {
  const callback = new URL(request.url, redirect);
  response.setHeader('Content-Type', 'text/plain; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  if (request.method !== 'GET' || callback.pathname !== '/') {
    response.writeHead(404).end('Not found.');
    return;
  }
  if (callback.searchParams.get('state') !== state) {
    response.writeHead(400).end('This callback does not belong to the current test.');
    return;
  }
  if (callback.searchParams.has('error')) {
    response.writeHead(400).end('Google returned an authorization error. No token was requested.');
    finish('Google returned an authorization error to the standard callback.', false);
    return;
  }
  if (!callback.searchParams.get('code')) {
    response.writeHead(400).end('No authorization code received.');
    return;
  }
  response.end('Consent test succeeded. The code was discarded. No token or course data was requested. You can close this tab.');
  finish('SUCCESS: Google completed consent using the standard Desktop callback. No token was requested.', true);
});
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
} catch {
  console.error('Could not open the local callback listener. Run this diagnostic from a terminal that permits local network listeners.');
  process.exit(1);
}
server.on('error', () => finish('The local callback listener failed.', false));
redirect = `http://127.0.0.1:${server.address().port}`;
const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
url.search = new URLSearchParams({client_id:installed.client_id, redirect_uri:redirect,
  response_type:'code', scope, state, code_challenge:challenge, code_challenge_method:'S256'});
console.log('Open this Google consent link in the same Firefox profile and use the same test account:');
// This initial request contains public client configuration and a one-time
// state/challenge. Callback URLs and returned codes are never printed.
console.log(url.href);
console.log(`Waiting for consent for up to ${Math.ceil(timeoutMs / 1000)} seconds. If Google shows unknownerror, note that outcome; this process will time out.`);
timeout = setTimeout(() => finish('No callback received. This does not identify why Google consent failed.', false), timeoutMs);
