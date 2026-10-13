import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlay} from '../src/ui.js';

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {setProperty:(name,value) => {this.style[name] = value;}};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.value = 0;
    this.max = 1;
    this.textContent = '';
  }
  append(...nodes) { for (const node of nodes) node.parentNode = this; this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; for (const node of nodes) node.parentNode = this; }
  setAttribute(name,value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name,callback) { (this.listeners[name] ||= []).push(callback); }
  fire(name) { for (const callback of this.listeners[name] || []) callback({key:'',target:this}); }
  focus() { this.focused = true; }
  attachShadow() { this.shadowRoot = new FakeElement('shadow-root'); return this.shadowRoot; }
  remove() { this.removed = true; }
}

function find(root,predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    const result = find(child,predicate);
    if (result) return result;
  }
  return undefined;
}
function all(root,predicate,out=[]) {
  if (predicate(root)) out.push(root);
  for (const child of root.children || []) all(child,predicate,out);
  return out;
}
function button(root,label) {
  return find(root,node => node.tagName === 'button' && node.textContent === label);
}

function withDocument(run) {
  const previous = globalThis.document;
  const documentRoot = new FakeElement('html');
  globalThis.document = {
    documentElement:documentRoot,
    createElement:tag => new FakeElement(tag),
    createElementNS:(_namespace,tag) => new FakeElement(tag),
  };
  try { return run(documentRoot); }
  finally { globalThis.document = previous; }
}

test('initial view stays minimal until scan results arrive', () => withDocument(documentRoot => {
  const actions = [];
  const overlay = createOverlay('',{key:'private-course-id'},(...args) => actions.push(args));
  overlay.setAnchor({bottom:72,right:10,size:44});
  const root = documentRoot.children[0].shadowRoot;
  const host = documentRoot.children[0];
  const initial = find(root,node => node.className === 'initial-view');
  const results = find(root,node => node.className === 'results-view');
  assert.equal(find(root,node => node.tagName === 'h2').textContent,'Current course');
  assert.equal(initial.hidden,false);
  assert.equal(results.hidden,true);
  assert.equal(button(root,'Scan course').disabled,false);
  assert.equal(button(root,'Scan course').hidden,false);
  assert.equal(host.style.bottom,'72px');
  assert.equal(host.style.right,'10px');
  assert.equal(host.style['--launcher-size'],'44px');
  assert.equal(find(root,node => node.className === 'progress-label muted').hidden,true);
  assert.equal(button(root,'Download selected').parentNode.parentNode.hidden,true);
  assert.equal(button(root,'Download all'),undefined);

  overlay.update({state:'ready',course:{name:'Biology'},status:'Ready to scan.'});
  assert.equal(find(root,node => node.tagName === 'h2').textContent,'Biology');
  button(root,'Scan course').fire('click');
  assert.deepEqual(actions,[['scan']]);
}));

test('results support subset downloads and remain stable through download progress', () => withDocument(documentRoot => {
  const actions = [];
  const overlay = createOverlay('',{key:'course'},(...args) => actions.push(args));
  const root = documentRoot.children[0].shadowRoot;
  overlay.update({state:'scanning',status:'Scanning…'});
  assert.equal(find(root,node => node.className === 'spinner').hidden,false);
  assert.equal(button(root,'Scan course').hidden,true);
  assert.equal(button(root,'Cancel').hidden,false);
  overlay.update({course:{name:'Chemistry'}});
  assert.equal(find(root,node => node.tagName === 'h2').textContent,'Chemistry');
  assert.equal(find(root,node => node.className === 'spinner').hidden,false);
  assert.equal(button(root,'Cancel').hidden,false);
  overlay.update({state:'ready',status:'Found files.',files:[
    {id:'one',name:'Lesson notes.pdf',category:'Materials'},
    {id:'two',name:'Slides.pdf',category:'Materials'},
    {id:'restricted',name:'Private work',unavailable:'Permission denied'},
  ]});
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
  const checkboxes = all(root,node => node.tagName === 'input' && node.type === 'checkbox' && node.className !== 'topic-checkbox' && node.attributes['aria-label'] !== 'Select all available files');
  assert.equal(checkboxes.length,3);
  assert.equal(checkboxes[2].disabled,true);
  assert.equal(find(root,node => node.tagName === 'details')?.open,true);

  checkboxes[0].checked = false;
  checkboxes[0].fire('change');
  button(root,'Download selected').fire('click');
  const listBeforeProgress = find(root,node => node.tagName === 'ul');
  overlay.update({state:'downloading',stage:'preparing',total:2,processed:1,prepared:1,failed:1,succeeded:0});
  const totals = find(root,node => node.className === 'muted totals');
  assert.equal(totals.textContent,'1 prepared · 1 failed');
  assert.equal(totals.textContent.includes('saved'),false);
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
  assert.equal(all(root,node => node.tagName === 'input' && node.type === 'checkbox')[1].disabled,true);
  overlay.update({state:'downloading',stage:'preparing',total:2,processed:2,prepared:2,failed:0,succeeded:0});
  assert.equal(find(root,node => node.tagName === 'ul'),listBeforeProgress);
  overlay.update({state:'downloading',stage:'saving',total:2,processed:2,prepared:2,failed:0,succeeded:0});
  assert.equal(find(root,node => node.tagName === 'progress').value,2);
  assert.equal(find(root,node => node.className === 'spinner').hidden,false);
  assert.equal(find(root,node => node.className === 'muted totals').textContent,'2 prepared · 0 failed');

  overlay.update({state:'completed',total:2,prepared:0,processed:2,succeeded:2,failed:0,archiveId:42,batchIds:['two']});
  assert.equal(find(root,node => node.className === 'completion-view').hidden,false);
  assert.equal(find(root,node => node.tagName === 'h3').textContent,'Download complete');
  assert.equal(find(root,node => node.className === 'completion-counts').textContent,'2 saved · 0 failed');
  assert.equal(find(root,node => node.className === 'muted completion-tip').textContent,'Extract the ZIP to access your files.');
  assert.equal(button(root,'Show in folder').hidden,false);
  overlay.update({folderError:'Could not open the saved folder.'});
  assert.equal(find(root,node => node.className === 'folder-error').hidden,false);
  assert.equal(find(root,node => node.className === 'completion-view').hidden,false);
  overlay.update({folderError:''});
  assert.equal(find(root,node => node.className === 'folder-error').hidden,true);
  button(root,'Show in folder').fire('click');
  button(root,'Choose more files').fire('click');
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
  assert.equal(find(root,node => node.className === 'muted selected-count').textContent,'0 selected');
  assert.equal(button(root,'Download selected').disabled,true);
  assert.deepEqual(actions,[['download',{fileIds:['two']}],['show-folder']]);
}));

test('rescanning resets choices and an empty scan stays in the results view', () => withDocument(documentRoot => {
  const overlay = createOverlay('',{key:'course'},() => {});
  const root = documentRoot.children[0].shadowRoot;
  overlay.update({state:'ready',files:[{id:'old',name:'Old file'}]});
  button(root,'Scan again').fire('click');
  overlay.update({state:'scanning',status:'Scanning…'});
  assert.equal(find(root,node => node.className === 'initial-view').hidden,false);
  assert.equal(find(root,node => node.tagName === 'ul').children.length,0);
  overlay.update({state:'ready',files:[]});
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
  assert.equal(find(root,node => node.className === 'count').textContent,'0 files found · 0 unsupported links skipped');
  assert.equal(button(root,'Download selected').disabled,true);
  assert.equal(button(root,'Scan again').disabled,false);
}));

test('cancelled prepared files are reported as unsaved', () => withDocument(documentRoot => {
  const overlay = createOverlay('',{key:'course'},() => {});
  const root = documentRoot.children[0].shadowRoot;
  overlay.update({state:'ready',files:[{id:'one',name:'File'}]});
  overlay.update({state:'cancelled',total:1,processed:1,prepared:1,succeeded:0,failed:0});
  assert.equal(find(root,node => node.className === 'completion-counts').textContent,'0 saved · 0 failed · 1 prepared, not saved');
  assert.equal(find(root,node => node.className === 'completion-view').hidden,false);
  button(root,'Choose more files').fire('click');
  assert.equal(find(root,node => node.className === 'muted selected-count').textContent,'1 selected');
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
}));

test('failed downloads preserve their reason and can select failed available files', () => withDocument(documentRoot => {
  const overlay = createOverlay('',{name:'Biology'},() => {});
  const root = documentRoot.children[0].shadowRoot;
  overlay.update({state:'ready',files:[
    {id:'failed',name:'Failed.pdf'},
    {id:'restricted',name:'Restricted.pdf',unavailable:'Permission denied'},
  ]});
  overlay.update({state:'error',status:'The ZIP could not be saved: disk is full.',total:2,prepared:1,succeeded:0,failed:2,
    failures:[{id:'failed',message:'Disk is full.'},{id:'restricted',message:'Permission denied.'}]});
  assert.equal(find(root,node => node.tagName === 'h3').textContent,'Download failed');
  assert.equal(find(root,node => node.className === 'completion-status').textContent,'The ZIP could not be saved: disk is full.');
  assert.equal(button(root,'Show in folder').hidden,true);
  button(root,'Review failed files').fire('click');
  assert.equal(find(root,node => node.className === 'results-view').hidden,false);
  assert.equal(find(root,node => node.className === 'muted selected-count').textContent,'1 selected');
  const failedCheckbox = find(root,node => node.attributes['aria-label'] === 'Select Failed.pdf');
  const restrictedCheckbox = find(root,node => node.attributes['aria-label'].startsWith('Restricted.pdf'));
  assert.equal(failedCheckbox.checked,true);
  assert.equal(restrictedCheckbox.checked,false);
}));

test('topic selections synchronize shared files, mixed groups and unique download IDs', () => withDocument(documentRoot => {
  const actions = [];
  const overlay = createOverlay('',{name:'Biology'},(...args) => actions.push(args));
  const root = documentRoot.children[0].shadowRoot;
  overlay.update({state:'ready',files:[
    {id:'shared',name:'Shared.pdf',topics:[{id:'a',name:'Networks'},{id:'b',name:'Security'}]},
    {id:'other',name:'Other.pdf',topics:[{id:'a',name:'Networks'}]},
    {id:'restricted',name:'Locked.pdf',unavailable:'Restricted',topics:[{id:'c',name:'Restricted topic'}]},
  ]});
  const topic = name => find(root,node => node.className === 'topic-checkbox' && node.attributes['aria-label'] === `Select all available files in ${name}`);
  assert.equal(topic('Restricted topic').disabled,true);
  topic('Security').checked = false;
  topic('Security').fire('change');
  assert.equal(topic('Networks').indeterminate,true);
  const sharedChecks = all(root,node => node.attributes['aria-label'] === 'Select Shared.pdf');
  assert.equal(sharedChecks.length,2);
  assert.ok(sharedChecks.every(node => !node.checked));
  sharedChecks[0].checked = true;
  sharedChecks[0].fire('change');
  assert.ok(sharedChecks.every(node => node.checked));
  assert.equal(topic('Security').checked,true);
  button(root,'Download selected').fire('click');
  assert.deepEqual(actions,[['download',{fileIds:['shared','other']}]]);
}));
