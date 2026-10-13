import test from 'node:test';
import assert from 'node:assert/strict';

test('content lifecycle cancels the old connection and removes its panel on navigation', async t => {
  const originals = Object.fromEntries(['browser','fetch','location','window','setInterval','clearInterval','__navigationTest'].map(key => [key,globalThis[key]]));
  t.after(() => {for (const [key,value] of Object.entries(originals)) globalThis[key] = value;});
  const panels = [], ports = [], events = new Map();
  let poll;
  let cleared = 0;
  globalThis.__navigationTest = {panels};
  const uiCode = `export function createOverlay(css,course,act) {
    const panel = {key:course.key, updates:[], destroyed:false, update(message){this.updates.push(message);}, destroy(){this.destroyed=true;}};
    globalThis.__navigationTest.panels.push(panel); return panel;
  }`;
  globalThis.location = {href:'https://classroom.google.com/'};
  globalThis.window = {addEventListener:(event,callback) => events.set(event,callback)};
  globalThis.setInterval = callback => {poll = callback; return 42;};
  globalThis.clearInterval = id => {assert.equal(id,42); cleared++;};
  globalThis.fetch = async () => new Response('/* test CSS */');
  globalThis.browser = {runtime:{
    getURL:path => path === 'src/ui.js' ? `data:text/javascript,${encodeURIComponent(uiCode)}` : new URL(`../${path}`,import.meta.url).href,
    connect:() => {
      const messages = [], disconnects = [];
      const port = {closed:false, onMessage:{addListener:listener => messages.push(listener)}, onDisconnect:{addListener:listener => disconnects.push(listener)}, postMessage() {},
        disconnect(){this.closed=true; disconnects.forEach(listener => listener());}, messages};
      ports.push(port); return port;
    },
  }};
  await import('../src/content.js?navigation-test');
  while (!poll) await new Promise(resolve => setImmediate(resolve));
  assert.equal(panels.length,0);
  location.href = 'https://classroom.google.com/c/one'; poll();
  assert.equal(panels[0].key,'one');
  location.href = 'https://classroom.google.com/c/one/t/all'; poll();
  assert.equal(panels.length,1);
  location.href = 'https://classroom.google.com/c/two'; poll();
  assert.equal(ports[0].closed,true); assert.equal(panels[0].destroyed,true);
  const before = panels[1].updates.length;
  ports[0].messages[0]({state:'ready',status:'stale'});
  assert.equal(panels[1].updates.length,before);
  location.href = 'https://classroom.google.com/c/two/a/private/details'; poll();
  assert.equal(ports[1].closed,true); assert.equal(panels[1].destroyed,true);
  location.href = 'https://classroom.google.com/c/two'; poll();
  events.get('pagehide')(); assert.equal(cleared,1); assert.equal(panels[2].destroyed,true);
  events.get('pageshow')({persisted:true}); assert.equal(panels[3].key,'two');
});
