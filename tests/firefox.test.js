import test from 'node:test';
import assert from 'node:assert/strict';
const changed = [];
let items = new Map();
let nextId = 1;
let earlyComplete = false;
let lastId;
let cancellations = [];
globalThis.browser = {
  downloads:{
    onChanged:{addListener:listener => changed.push(listener)},
    async download(options) {
      assert.ok(options.url.startsWith('blob:'));
      assert.equal(options.conflictAction,'uniquify');
      assert.equal(options.saveAs,undefined, 'Respect Firefox save-dialog preferences');
      lastId = nextId++;
      items.set(lastId,{id:lastId,state:earlyComplete ? 'complete' : 'in_progress'});
      if (earlyComplete) changed.forEach(listener => listener({id:lastId,state:{current:'complete'}}));
      return lastId;
    },
    async search({id}) { return [items.get(id)]; },
    async cancel(id) {cancellations.push(id); items.set(id,{id,state:'interrupted'});},
  },
  runtime:{onConnect:{addListener() {}},id:'test'},
};
const {saveBlob,readBlob} = await import('../src/background.js');
function reset() {items = new Map(); earlyComplete = false; cancellations = [];}
function emit(state,error) {
  items.set(lastId,{id:lastId,state,error});
  changed.forEach(listener => listener({id:lastId,state:{current:state},error:{current:error}}));
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('queued Firefox download remains pending until complete', async () => {
  reset(); let done = false;
  const promise = saveBlob(new Blob(['data']),'test/file.pdf',new AbortController().signal).then(() => {done = true;});
  await tick(); assert.equal(done,false);
  emit('complete'); await promise; assert.equal(done,true);
});
test('completion before download resolves is recovered by search', async () => {
  reset(); earlyComplete = true;
  await saveBlob(new Blob(['data']),'test/file.pdf',new AbortController().signal);
});
test('Firefox interruption is an error, never a success', async () => {
  reset();
  const promise = saveBlob(new Blob(['data']),'test/file.pdf',new AbortController().signal);
  const assertion = assert.rejects(promise,/NETWORK_FAILED/);
  await tick(); emit('interrupted','NETWORK_FAILED'); await assertion;
});
test('active save cancellation invokes Firefox cancel and rejects', async () => {
  reset(); const controller = new AbortController();
  const promise = saveBlob(new Blob(['data']),'test/file.pdf',controller.signal);
  const assertion = assert.rejects(promise,{name:'AbortError'});
  await tick(); controller.abort(); await assertion;
  assert.deepEqual(cancellations,[lastId]);
});
test('pre-cancelled saves never start Firefox downloads', async () => {
  reset(); const controller = new AbortController(); controller.abort();
  const before = nextId;
  await assert.rejects(saveBlob(new Blob(['data']),'file.pdf',controller.signal),{name:'AbortError'});
  assert.equal(nextId,before);
});
test('response reader preserves contents and MIME', async () => {
  const blob = await readBlob(new Response('file content',{headers:{'content-type':'application/pdf'}}),new AbortController().signal);
  assert.equal(await blob.text(),'file content'); assert.equal(blob.type,'application/pdf');
});
test('response reader refuses oversized files before constructing a blob', async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({pull(controller) {controller.enqueue(chunk);}});
  await assert.rejects(readBlob(new Response(stream),new AbortController().signal),/100 MiB/);
});
