export function createOverlay(css, course, act) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:2147483647;';
  const root = host.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style);
  function element(tag, text, parent = root) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    parent.append(node);
    return node;
  }
  const panel = element('section');
  panel.id = 'panel'; panel.hidden = true;
  panel.setAttribute('aria-label','Classroom Downloader');
  const header = element('header', '', panel);
  element('h2','Classroom Downloader', header);
  const close = element('button','×', header);
  close.setAttribute('aria-label','Collapse panel');
  const name = element('p',`Course ${course.key}`, panel); name.className = 'course';
  const status = element('p','Scan to connect Google and find course attachments.', panel);
  status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
  const count = element('p','No scan yet', panel);
  const summary = element('p','',panel); summary.className = 'muted';
  const progress = element('progress','',panel); progress.max = 1; progress.value = 0; progress.hidden = true;
  progress.setAttribute('aria-label','Files processed');
  const totals = element('p','',panel);
  const details = element('details','',panel);
  element('summary','Review files and failures',details);
  const list = element('ul','',details);
  const actions = element('div','',panel); actions.className = 'actions';
  const scan = element('button','Scan course',actions);
  const download = element('button','Download all',actions); download.disabled = true;
  const cancel = element('button','Cancel',actions); cancel.hidden = true;
  const hint = element('p','Read-only Google authorization required. No student submissions are accessed.',panel); hint.className = 'muted';
  const toggle = element('button','↓',root); toggle.className = 'toggle';
  toggle.setAttribute('aria-label','Open Classroom Downloader');
  toggle.setAttribute('aria-controls','panel'); toggle.setAttribute('aria-expanded','false');
  function collapse() {panel.hidden = true; toggle.setAttribute('aria-expanded','false'); toggle.focus();}
  toggle.addEventListener('click', () => {panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) scan.focus();});
  close.addEventListener('click',collapse);
  root.addEventListener('keydown', event => {if (event.key === 'Escape') collapse();});
  scan.addEventListener('click',() => {scan.disabled = true; download.disabled = true; act('scan');});
  download.addEventListener('click',() => {download.disabled = true; scan.disabled = true; act('download');});
  cancel.addEventListener('click',() => {cancel.disabled = true; act('cancel');});
  let files = [];
  let failures = [];
  function update(message) {
    const busy = ['scanning','downloading'].includes(message.state);
    if (message.state === 'scanning') {files = []; failures = []; count.textContent = 'Scanning…'; summary.textContent = ''; list.replaceChildren(); totals.textContent = '';}
    if (message.files) {
      files = message.files; failures = [];
      name.textContent = message.course.name;
      count.textContent = `${files.length} files found`;
      const categories = new Map();
      files.forEach(file => categories.set(file.category, (categories.get(file.category) || 0) + 1));
      summary.textContent = [...categories].map(([type,n]) => `${type}: ${n}`).join(' · ');
    }
    if (message.state === 'downloading' && message.total === undefined) {failures = []; totals.textContent = ''; progress.value = 0;}
    if (message.failures) failures = message.failures;
    if (message.files || message.failures) {
      list.replaceChildren();
      for (const file of files) {
        const failure = failures.find(item => item.id === file.id);
        element('li',`${file.name}${failure ? ` — ${failure.message}` : file.unavailable ? ` — ${file.unavailable}` : ''}`,list);
      }
    }
    status.textContent = message.status;
    scan.disabled = busy; download.disabled = busy || !files.length;
    cancel.hidden = !busy; cancel.disabled = false;
    progress.hidden = !['downloading','completed','partial','cancelled'].includes(message.state);
    if (message.total !== undefined) {
      progress.max = Math.max(1,message.total); progress.value = message.succeeded + message.failed;
      totals.textContent = `${message.succeeded} saved · ${message.failed} failed · ${Math.max(0,message.total-message.succeeded-message.failed)} remaining`;
    }
  }
  document.documentElement.append(host);
  return {update, destroy:() => host.remove()};
}
