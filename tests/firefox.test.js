import test from 'node:test';
import assert from 'node:assert/strict';
const changed = [];
let items = new Map();
let nextId = 1;
let earlyComplete = false;
let lastId;
let cancellations = [];
let shown = [];
let showSucceeds = true;
let connect;
const tabUrls = new Map();
globalThis.browser = {
  tabs:{async get(id) {return {id,url:tabUrls.get(id)};}},
  downloads:{
    onChanged:{addListener:listener => changed.push(listener)},
    async download(options) {
      assert.ok(options.url.startsWith('blob:'));
      assert.equal(options.conflictAction,'uniquify');
      assert.equal(options.saveAs,true, 'Ask once where to save the batch ZIP');
      lastId = nextId++;
      items.set(lastId,{id:lastId,state:earlyComplete ? 'complete' : 'in_progress'});
      if (earlyComplete) changed.forEach(listener => listener({id:lastId,state:{current:'complete'}}));
      return lastId;
    },
    async search({id}) { return [items.get(id)]; },
    async cancel(id) {cancellations.push(id); items.set(id,{id,state:'interrupted'});},
    async show(id) {shown.push(id); return showSucceeds;},
  },
  runtime:{onConnect:{addListener(listener) {connect = listener;}},id:'test'},
};
const {saveBlob,readBlob,downloadBatch,showArchive,getCourseSession} = await import('../src/background.js');
function reset() {items = new Map(); earlyComplete = false; cancellations = []; shown = []; showSucceeds = true;}
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
  const id = await saveBlob(new Blob(['data']),'test/file.pdf',new AbortController().signal);
  assert.equal(id,lastId);
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

const course = {id:'test-course',name:'Test course'};
const sampleFiles = [{id:'one',name:'first.txt'}, {id:'two',name:'second.txt'}];
const loadSample = async file => ({blob:new Blob([file.id]),name:file.name});

test('batch prepares files then saves one ZIP, counts saved only after Firefox completion', async () => {
  const updates = [];
  let saveCalls = 0;
  let finish;
  let started;
  const saving = new Promise(resolve => {started = resolve;});
  const saved = new Promise(resolve => {finish = resolve;});
  const promise = downloadBatch(sampleFiles,course,new AbortController().signal, state => updates.push(state),loadSample,
    async (blob,filename) => {
      saveCalls++;
      assert.equal(blob.type,'application/zip');
      assert.equal(filename,'Test course.zip');
      started();
      await saved;
      return 42;
    });
  await saving;
  assert.equal(saveCalls,1);
  assert.equal(updates.at(-1).stage,'saving');
  assert.equal(updates.at(-1).prepared,2);
  assert.ok(updates.every(state => state.succeeded === 0));
  finish();
  const result = await promise;
  assert.equal(result.state,'completed');
  assert.equal(result.succeeded,2);
  assert.equal(result.archiveId,42);
  assert.deepEqual(result.batchIds,['one','two']);
});

test('partial batch includes successful files and preserves preparation failures', async () => {
  let saves = 0;
  const result = await downloadBatch(sampleFiles,course,new AbortController().signal,() => {}, async file => {
    if (file.id === 'two') throw new Error('Access restricted');
    return loadSample(file);
  },async () => {saves++;});
  assert.equal(saves,1); assert.equal(result.state,'partial');
  assert.equal(result.succeeded,1); assert.equal(result.failed,1);
  assert.equal(result.failures[0].id,'two');
});

test('failed archive save never reports prepared files as saved', async () => {
  const result = await downloadBatch(sampleFiles,course,new AbortController().signal,() => {},loadSample,
    async () => {throw new Error('Disk full');});
  assert.equal(result.state,'error'); assert.equal(result.succeeded,0);
  assert.equal(result.failed,2); assert.equal(result.failures.length,2);
  assert.match(result.status,/Disk full/);
});

test('cancelled preparation does not save an archive or report saved files', async () => {
  const controller = new AbortController();
  const result = await downloadBatch(sampleFiles,course,controller.signal,state => {
    if (state.prepared > 0) controller.abort();
  },loadSample,async () => {assert.fail('Cancelled batch must not save');});
  assert.equal(result.state,'cancelled'); assert.equal(result.succeeded,0);
});

test('cancelled save dialog does not mark prepared files as saved', async () => {
  const result = await downloadBatch(sampleFiles,course,new AbortController().signal,() => {},loadSample,
    async () => {throw new Error('Download canceled by the user');});
  assert.equal(result.state,'cancelled'); assert.equal(result.succeeded,0);
});

test('an entirely failed batch does not open a save dialog', async () => {
  const result = await downloadBatch(sampleFiles,course,new AbortController().signal,() => {},
    async () => {throw new Error('Permission denied');},async () => {assert.fail('Empty archive must not save');});
  assert.equal(result.state,'error'); assert.equal(result.succeeded,0); assert.equal(result.failed,2);
});

test('show in folder reveals only a completed available archive', async () => {
  reset();
  items.set(42,{id:42,state:'complete',exists:true});
  await showArchive(42);
  assert.deepEqual(shown,[42]);
  items.set(42,{id:42,state:'complete',exists:false});
  await assert.rejects(showArchive(42),/no longer available/);
  items.set(42,{id:42,state:'in_progress'});
  await assert.rejects(showArchive(42),/no longer available/);
  await assert.rejects(showArchive(null),/No saved ZIP/);
  assert.deepEqual(shown,[42]);
});

test('a file manager failure is reported rather than treated as a successful reveal', async () => {
  reset();
  items.set(42,{id:42,state:'complete'});
  showSucceeds = false;
  await assert.rejects(showArchive(42),/could not show/);
});

test('panel cannot supply an unrelated download ID to show in folder', async () => {
  reset();
  let receive;
  const messages = [];
  tabUrls.set(99,'https://classroom.google.com/c/one');
  await connect({name:'classroom-downloader:one',sender:{id:'test',tab:{id:99},frameId:0,url:'https://classroom.google.com/c/one'},
    disconnect() {assert.fail('Valid panel should connect');},onDisconnect:{addListener() {}},
    onMessage:{addListener(listener) {receive=listener;}},postMessage(message) {messages.push(message);}});
  items.set(42,{id:42,state:'complete'});
  await receive({action:'show-folder',archiveId:42});
  assert.deepEqual(shown,[]);
  assert.match(messages.find(message => message.folderError)?.folderError,/Could not show/);
});

async function coursePort(key, {senderKey = key, tabId = 100, prefix = 'c'} = {}) {
  const messages = [];
  let receive;
  const disconnects = [];
  tabUrls.set(tabId,`https://classroom.google.com/${prefix}/${key}/people`);
  const port = {name:`classroom-downloader:${key}`,sender:{id:'test',tab:{id:tabId},frameId:0,url:`https://classroom.google.com/c/${senderKey}`},
    disconnect() {disconnects.forEach(listener => listener());},onDisconnect:{addListener(listener) {disconnects.push(listener);}},
    onMessage:{addListener(listener) {receive=listener;}},postMessage(message) {messages.push(message);}};
  await connect(port);
  return {messages, receive:message => receive(message), disconnect:() => port.disconnect()};
}

test('course sessions retain scans, selection, completion and archive IDs across connections', async () => {
  reset();
  const session = getCourseSession('cached-course');
  session.snapshot = {course:{id:'course-id',name:'Cached course'},files:[{id:'a',name:'File A'},{id:'b',name:'File B'}],unsupported:0};
  session.lastMessage = {state:'completed',total:1,succeeded:1,failed:0,archiveId:42,batchIds:['a']};
  session.archiveId = 42;
  session.uiState = {selectedIds:['b'],expanded:true,view:'results'};
  const panel = await coursePort('cached-course');
  assert.deepEqual(panel.messages.map(message => message.state).filter(Boolean),['ready','completed']);
  assert.deepEqual(panel.messages.find(message => message.uiState).uiState,session.uiState);
  await panel.receive({action:'remember-ui',uiState:{selectedIds:['a','foreign-id'],expanded:false,view:'results'}});
  panel.disconnect();
  const other = await coursePort('different-course');
  assert.ok(!other.messages.some(message => message.files || message.archiveId));
  const returned = await coursePort('cached-course');
  assert.deepEqual(returned.messages.find(message => message.uiState).uiState.selectedIds,['a']);
  items.set(42,{id:42,state:'complete',exists:true});
  await returned.receive({action:'show-folder'});
  assert.deepEqual(shown,[42]);
});

test('leaving a course keeps its active job alive and restores progress on return', async () => {
  const session = getCourseSession('active-course');
  session.controller = new AbortController();
  session.running = true;
  session.lastMessage = {state:'downloading',stage:'preparing',total:10,prepared:3,succeeded:0,failed:0};
  const panel = await coursePort('active-course');
  panel.disconnect();
  assert.equal(session.controller.signal.aborted,false);
  const returned = await coursePort('active-course');
  assert.equal(returned.messages.find(message => message.state === 'downloading').prepared,3);
  await returned.receive({action:'cancel'});
  assert.equal(session.controller.signal.aborted,true);
});

test('SPA connections use the current course rather than the original sender document URL', async () => {
  const old = getCourseSession('original-course');
  old.snapshot = {course:{name:'Old course'},files:[{id:'old-file'}]};
  const fresh = getCourseSession('current-course');
  fresh.snapshot = {course:{name:'Current course'},files:[{id:'new-file'}]};
  const panel = await coursePort('current-course',{senderKey:'original-course',prefix:'w'});
  assert.equal(panel.messages.find(message => message.files).files[0].id,'new-file');
  assert.ok(!panel.messages.some(message => message.course?.name === 'Old course'));
  tabUrls.set(100,'https://classroom.google.com/r/current-course/sort-name');
  await panel.receive({action:'remember-ui',uiState:{selectedIds:['new-file'],expanded:true,view:'results'}});
  assert.deepEqual(fresh.uiState.selectedIds,['new-file']);
});

test('an old panel cannot cancel its task after the tab navigates to another course', async () => {
  const session = getCourseSession('old-task');
  session.controller = new AbortController(); session.running = true;
  const panel = await coursePort('old-task');
  tabUrls.set(100,'https://classroom.google.com/c/another-course');
  await panel.receive({action:'cancel'});
  assert.equal(session.controller.signal.aborted,false);
  assert.equal(session.ports.size,0);
});
