import test from 'node:test';
import assert from 'node:assert/strict';

test('content keeps one panel across course views and saves state before switching or unloading', async t => {
  const originals = Object.fromEntries(['browser','fetch','location','window','document','setInterval','clearInterval','__navigationTest'].map(key => [key,globalThis[key]]));
  t.after(() => {for (const [key,value] of Object.entries(originals)) globalThis[key] = value;});
  const panels = [], ports = [], events = new Map();
  let poll;
  let cleared = 0;
  let breadcrumbName = 'Biology';
  globalThis.__navigationTest = {panels};
  const uiCode = `export function createOverlay(css,course,act) {
    const panel = {key:course.key, name:course.name, act, uiState:{selectedIds:[],expanded:false,view:'initial'}, updates:[], destroyed:false,
      getState(){return this.uiState;}, restoreState(state){this.uiState=state;}, setAnchor(anchor){this.anchor=anchor;}, update(message){this.updates.push(message);}, destroy(){this.destroyed=true;}};
    globalThis.__navigationTest.panels.push(panel); return panel;
  }`;
  globalThis.location = {href:'https://classroom.google.com/'};
  globalThis.window = {innerWidth:1000,innerHeight:800,addEventListener:(event,callback) => events.set(event,callback)};
  globalThis.document = {title:'An unrelated page title',querySelector:() => null,querySelectorAll:selector => selector === 'a[href]' ? [{
    href:`https://classroom.google.com/c/${location.href.match(/\/(?:c|w|r)\/([^/]+)/)?.[1] || 'none'}`,
    children:[{tagName:'SPAN',textContent:breadcrumbName}],
  }] : []};
  globalThis.setInterval = callback => {poll = callback; return 42;};
  globalThis.clearInterval = id => {assert.equal(id,42); cleared++;};
  globalThis.fetch = async () => new Response('/* test CSS */');
  globalThis.browser = {runtime:{
    getURL:path => path === 'src/ui.js' ? `data:text/javascript,${encodeURIComponent(uiCode)}` : new URL(`../${path}`,import.meta.url).href,
    connect:() => {
      const messages = [], disconnects = [], sent = [];
      const port = {closed:false, sent, onMessage:{addListener:listener => messages.push(listener)}, onDisconnect:{addListener:listener => disconnects.push(listener)}, postMessage(message) {sent.push(message);},
        disconnect(){this.closed=true; disconnects.forEach(listener => listener());}, messages};
      ports.push(port); return port;
    },
  }};
  await import('../src/content.js?navigation-test');
  while (!poll) await new Promise(resolve => setImmediate(resolve));
  assert.equal(panels.length,0);
  location.href = 'https://classroom.google.com/c/one'; poll();
  assert.equal(panels[0].key,'one');
  assert.equal(panels[0].name,'Biology');
  panels[0].act('download',{fileIds:['selected-file']});
  assert.deepEqual(ports[0].sent,[], 'Actions wait for course validation and restoration');
  panels[0].uiState = {selectedIds:['selected-file'],expanded:true,view:'results'};
  ports[0].messages[0]({sessionRestored:true});
  assert.deepEqual(ports[0].sent.at(-1),{action:'download',fileIds:['selected-file']});
  location.href = 'https://classroom.google.com/w/one/t/all'; poll();
  assert.equal(panels.length,1);
  document.title = 'Biology, term two - Classroom'; poll();
  assert.equal(panels[0].updates.at(-1).course.name,'Biology');
  location.href = 'https://classroom.google.com/r/one/sort-name'; poll();
  location.href = 'https://classroom.google.com/c/one/a/post/details'; poll();
  assert.equal(panels.length,1); assert.equal(ports[0].closed,false);
  breadcrumbName = 'Chemistry';
  location.href = 'https://classroom.google.com/c/two'; poll();
  assert.equal(panels[1].name,'Chemistry');
  assert.equal(ports[0].closed,true); assert.equal(panels[0].destroyed,true);
  assert.equal(panels[1].uiState.expanded,true,'Expanded panel follows navigation to another course');
  const before = panels[1].updates.length;
  ports[0].messages[0]({state:'ready',status:'stale'});
  assert.equal(panels[1].updates.length,before);
  location.href = 'https://classroom.google.com/c/two/a/private/details'; poll();
  assert.equal(ports[1].closed,false); assert.equal(panels[1].destroyed,false);
  location.href = 'https://classroom.google.com/c/one'; poll();
  const restored = {selectedIds:['selected-file'],expanded:true,view:'results'};
  ports[2].messages[0]({uiState:restored});
  ports[2].messages[0]({sessionRestored:true});
  assert.deepEqual(panels[2].uiState,restored);
  events.get('pagehide')(); assert.equal(cleared,1); assert.equal(panels[2].destroyed,true);
  events.get('pageshow')({persisted:true}); assert.equal(panels[3].key,'one');
});
