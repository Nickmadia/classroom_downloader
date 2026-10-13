import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeFilename, identifyFile, selectFiles, runQueue, retry, delay} from '../src/downloader.js';

test('selection allows only scanned available files and deduplicates selected IDs', () => {
  const files = [{id:'a'}, {id:'b'}, {id:'restricted',unavailable:'Not permitted'}];
  assert.deepEqual(selectFiles(files),files.slice(0,2));
  assert.deepEqual(selectFiles(files,['b','b','restricted']),[files[1]]);
  assert.deepEqual(selectFiles(files,[]),[]);
  assert.throws(() => selectFiles(files,['unscanned']),/not in this course scan/);
  assert.throws(() => selectFiles(files,'b'),/Invalid file selection/);
  assert.throws(() => selectFiles(files,[{}]),/Invalid file selection/);
});

test('safe filenames handle traversal, reserved names, Unicode and empty input', () => {
  assert.equal(sanitizeFilename('../../bad\\name:*?'), '_.._bad_name___');
  assert.equal(sanitizeFilename('CON.pdf'),'_CON.pdf');
  assert.equal(sanitizeFilename(' .. '),'Untitled');
  assert.equal(sanitizeFilename('Résumé.pdf'),'Résumé.pdf');
  assert.equal(sanitizeFilename('a\u202eb.pdf'),'a_b.pdf');
  assert.equal(sanitizeFilename('x'.repeat(200)).length,100);
});
test('Workspace exports and original file categories', () => {
  assert.equal(identifyFile('application/vnd.google-apps.document').extension,'.pdf');
  assert.equal(identifyFile('application/vnd.google-apps.presentation').exportMime,'application/pdf');
  assert.equal(identifyFile('application/vnd.google-apps.spreadsheet').extension,'.xlsx');
  assert.equal(identifyFile('application/vnd.google-apps.form').unsupported,true);
  assert.equal(identifyFile('application/pdf').category,'PDF');
  assert.equal(identifyFile('image/png').category,'Images');
  assert.equal(identifyFile('application/zip').category,'Other');
});
test('queue limits concurrency and waits for completion, records failures', async () => {
  let active = 0, peak = 0;
  const updates = [];
  const result = await runQueue([{name:'A'},{name:'B'},{name:'C'}], async file => {
    active++; peak = Math.max(peak,active);
    await new Promise(resolve => setTimeout(resolve,10)); active--;
    if (file.name === 'B') throw new Error('Restricted');
  },new AbortController().signal, state => updates.push(state));
  assert.equal(peak,2); assert.equal(result.succeeded,2); assert.equal(result.failed,1);
  assert.equal(result.failures[0].message,'Restricted'); assert.equal(updates.length,3);
});
test('cancellation stops active and pending work without labelling it failure', async () => {
  const controller = new AbortController(); let started = 0;
  const promise = runQueue(Array.from({length:10},(_,i) => ({name:String(i)})),async (_,signal) => {started++; await delay(1000,signal);},controller.signal,() => {});
  controller.abort();
  const result = await promise;
  assert.equal(started,2); assert.equal(result.cancelled,true); assert.equal(result.succeeded,0); assert.equal(result.failed,0);
});
test('permanent failures are not retried, transient failures recover', async () => {
  let count = 0;
  const signal = new AbortController().signal;
  await assert.rejects(retry(async () => {count++; throw new Error('denied');},signal),/denied/);
  assert.equal(count,1); count = 0;
  assert.equal(await retry(async () => {count++; if (count === 1) throw Object.assign(new Error('busy'),{temporary:true}); return 'saved';},signal),'saved');
  assert.equal(count,2);
});
test('abort during retry backoff prevents another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const promise = retry(async () => {calls++; throw Object.assign(new Error('busy'),{temporary:true});},controller.signal);
  setTimeout(() => controller.abort(),10);
  await assert.rejects(promise,{name:'AbortError'}); assert.equal(calls,1);
});
test('empty course completes without invoking a download', async () => {
  const result = await runQueue([],async () => assert.fail('No files to download'),new AbortController().signal,() => {});
  assert.equal(result.total,0); assert.equal(result.succeeded,0); assert.equal(result.failed,0);
});
test('transient failures stop after three attempts and cannot multiply outer retries', async () => {
  let count = 0;
  const signal = new AbortController().signal;
  await assert.rejects(retry(() => retry(async () => {
    count++; throw Object.assign(new Error('unavailable'),{temporary:true});
  },signal),signal),/unavailable/);
  assert.equal(count,3);
});
