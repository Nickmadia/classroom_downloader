import {getToken, forgetToken} from './auth.js';
import {detectCourse, discoverCourse} from './classroom.js';
import {identifyFile, sanitizeFilename, selectFiles, runQueue, retry, MAX_FILE_BYTES} from './downloader.js';
import {createArchive} from './archive.js';
const jobs = new Map();
const activeDownloads = new Map();
const API = 'https://www.googleapis.com/drive/v3/files/';
const API_TIMEOUT = 2 * 60 * 1000;
const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;

async function apiRead(url, signal, consume) {
  const token = await getToken(signal);
  signal.throwIfAborted();
  return retry(async () => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, {once:true});
    const timer = setTimeout(() => {timedOut = true; controller.abort();}, API_TIMEOUT);
    try {
      signal.throwIfAborted();
      const response = await fetch(url, {headers:{Authorization:`Bearer ${token}`}, signal:controller.signal, credentials:'omit', redirect:'error'});
      if (!response.ok) {
        if (response.status === 401) forgetToken();
        const error = new Error(response.status === 401 ? 'Authorization expired. Scan again to reconnect.' : `Google API refused this request (${response.status}).`);
        error.temporary = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw error;
      }
      return await consume(response, controller.signal);
    } catch (error) {
      if (timedOut) throw Object.assign(new Error('Google request timed out.'), {temporary:true});
      if (error instanceof TypeError && !signal.aborted) error.temporary = true;
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }, signal);
}

async function request(path, params, signal) {
  const url = new URL(`https://classroom.googleapis.com/v1/${path}`);
  url.search = new URLSearchParams(params);
  return apiRead(url, signal, response => response.json());
}
async function metadata(file, signal) {
  const url = new URL(`${API}${encodeURIComponent(file.id)}`);
  url.search = new URLSearchParams({fields:'id,name,mimeType,size,capabilities(canDownload)', supportsAllDrives:'true'});
  const data = await apiRead(url, signal, response => response.json());
  const type = identifyFile(data.mimeType);
  return {...file, ...data, ...type, unavailable: !data.capabilities?.canDownload ? 'Downloading is restricted.' : type.unsupported ? 'Unsupported Google file type.' : Number(data.size) > MAX_FILE_BYTES ? 'File exceeds the 100 MiB local memory limit.' : null};
}
export async function readBlob(response, signal) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const {done, value} = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) throw new Error('File exceeds the 100 MiB local memory limit.');
      chunks.push(value);
    }
    return new Blob(chunks, {type:response.headers.get('content-type') || 'application/octet-stream'});
  } finally { await reader.cancel(); reader.releaseLock(); }
}
function settleDownload(item) {
  const pending = activeDownloads.get(item.id);
  if (!pending || !['complete','interrupted'].includes(item.state)) return;
  pending.finish(item.state === 'complete' ? null : new Error(`Firefox download interrupted: ${item.error || 'unknown reason'}`));
}
browser.downloads.onChanged.addListener(delta => {
  if (delta.state?.current) settleDownload({id:delta.id, state:delta.state.current, error:delta.error?.current});
});
export async function saveBlob(blob, filename, signal) {
  const url = URL.createObjectURL(blob);
  let id;
  try {
    signal.throwIfAborted();
    id = await browser.downloads.download({url, filename, saveAs:true, conflictAction:'uniquify'});
    await new Promise((resolve, reject) => {
      let finished = false;
      const finish = error => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        activeDownloads.delete(id);
        error ? reject(error) : resolve();
      };
      const abort = () => {
        browser.downloads.cancel(id).then(() => finish(new DOMException('Cancelled','AbortError')), error => finish(new Error(`Could not cancel Firefox download: ${error.message}`)));
      };
      const timer = setTimeout(() => {
        browser.downloads.cancel(id).then(() => finish(new Error('Firefox download timed out.')), error => finish(error));
      }, DOWNLOAD_TIMEOUT);
      activeDownloads.set(id, {finish});
      signal.addEventListener('abort', abort, {once:true});
      if (signal.aborted) abort();
      // Close the race where onChanged fires before download() resolves.
      browser.downloads.search({id}).then(items => { if (items[0]) settleDownload(items[0]); }, finish);
    });
    return id;
  } finally { URL.revokeObjectURL(url); }
}
export async function showArchive(id) {
  if (!Number.isInteger(id) || id < 0) throw new Error('No saved ZIP is available.');
  const [item] = await browser.downloads.search({id});
  if (!item || item.state !== 'complete' || item.exists === false) {
    throw new Error('The saved ZIP is no longer available in Firefox Downloads.');
  }
  if (await browser.downloads.show(id) === false) throw new Error('Firefox could not show the saved ZIP.');
}
async function fetchFile(file, signal) {
  if (file.unavailable) throw new Error(file.unavailable);
  // Recheck restrictions: access may have changed since scanning.
  const current = await metadata(file, signal);
  if (current.unavailable) throw new Error(current.unavailable);
  const url = new URL(`${API}${encodeURIComponent(file.id)}${current.exportMime ? '/export' : ''}`);
  url.search = new URLSearchParams(current.exportMime ? {mimeType:current.exportMime} : {alt:'media', supportsAllDrives:'true'});
  const blob = await apiRead(url, signal, async (response, requestSignal) => {
    const mime = response.headers.get('content-type')?.split(';')[0];
    if (current.exportMime && mime !== current.exportMime) {
      await response.body?.cancel();
      throw new Error('Google returned an unexpected export format.');
    }
    return readBlob(response, requestSignal);
  });
  let name = sanitizeFilename(current.name);
  if (current.extension && !name.toLowerCase().endsWith(current.extension)) name += current.extension;
  return {blob, name};
}

export async function downloadBatch(files, course, signal, update, load = fetchFile, save = saveBlob) {
  const folder = `${sanitizeFilename(course.name)} (${sanitizeFilename(course.id).slice(0, 40)})`;
  const archive = createArchive(folder);
  const preparedFiles = [];
  const preparing = progress => ({...progress, succeeded:0, prepared:progress.succeeded,
    processed:progress.succeeded + progress.failed, stage:'preparing'});
  update({state:'downloading', total:files.length, succeeded:0, prepared:0, processed:0, failed:0,
    failures:[], stage:'preparing', status:'Preparing files for one ZIP download…'});
  const result = await runQueue(files, async (file, abortSignal) => {
    const {blob, name} = await load(file, abortSignal);
    await archive.add(blob, name, abortSignal);
    preparedFiles.push(file);
  }, signal, progress => update({state:'downloading', ...preparing(progress),
    status:`Preparing files: ${progress.succeeded + progress.failed} / ${progress.total}`}));
  const finish = (state, status, extra = {}) => ({...preparing(result), batchIds:files.map(file => file.id), state, status, ...extra});
  if (signal.aborted) return finish('cancelled', 'Cancelled. No archive was saved.', {cancelled:true});
  if (!result.succeeded) return finish('error', 'No files could be prepared. Review the failures and try again.');
  update(finish('downloading', 'Choose where to save the ZIP…', {stage:'saving'}));
  try {
    const archiveId = await save(archive.finish(), `${sanitizeFilename(course.name)}.zip`, signal);
    return finish(result.failed ? 'partial' : 'completed', result.failed
      ? 'ZIP saved with some files missing. Review the failures.' : 'ZIP saved. Extract it to access your files.',
    {stage:'saved', succeeded:result.succeeded, prepared:0, archiveId});
  } catch (error) {
    if (signal.aborted || /USER_CANCELED|Download canceled by the user/i.test(error.message)) {
      return finish('cancelled', 'Cancelled. The archive was not saved.', {cancelled:true});
    }
    return finish('error', `The ZIP could not be saved: ${error.message}`, {stage:'saving', failed:files.length,
      failures:[...result.failures, ...preparedFiles.map(file => ({id:file.id, name:file.name, message:'Archive was not saved.'}))]});
  }
}
function send(port, message) {
  try { port.postMessage(message); } catch (error) {
    console.warn('Classroom Downloader panel disconnected:', error.message);
  }
}
export function getCourseSession(key) {
  if (!jobs.has(key)) jobs.set(key, {controller:null, snapshot:null, running:false, archiveId:null,
    ports:new Set(), lastMessage:null, uiState:null, courseName:null});
  return jobs.get(key);
}
function notify(job, message) {
  if (message.state) job.lastMessage = message;
  if (message.state === 'ready') job.uiState = {...job.uiState,
    selectedIds:message.files.filter(file => !file.unavailable).map(file => file.id), view:'results'};
  if (Number.isFinite(message.total) && ['completed','partial','cancelled','error'].includes(message.state)) {
    job.uiState = {...job.uiState, view:'completion'};
  }
  for (const port of job.ports) send(port, message);
}
browser.runtime.onConnect.addListener(async port => {
  const key = port.name.startsWith('classroom-downloader:') ? port.name.slice('classroom-downloader:'.length) : '';
  if (!/^[A-Za-z0-9_-]+$/.test(key) || port.sender?.id !== browser.runtime.id || !port.sender?.tab || port.sender.frameId !== 0) {
    port.disconnect(); return;
  }
  // Firefox's sender URL can retain the original document URL after pushState.
  // Validate the requested course against the browser's current top-level tab.
  const tabId = port.sender.tab.id;
  let disconnected = false;
  port.onDisconnect.addListener(() => {disconnected = true;});
  async function isCurrentCourse() {
    try { const tab = await browser.tabs.get(tabId); return !disconnected && detectCourse(tab.url)?.key === key; }
    catch { return false; }
  }
  if (!await isCurrentCourse() || disconnected) {if (!disconnected) port.disconnect(); return;}
  const job = getCourseSession(key);
  job.ports.add(port);
  port.onDisconnect.addListener(() => job.ports.delete(port));
  if (job.courseName && !job.snapshot) send(port, {course:{name:job.courseName}});
  if (job.snapshot) send(port, {state:'ready', ...job.snapshot, status:'Restored this course’s scan.'});
  if (job.lastMessage && job.lastMessage.state !== 'ready') send(port, job.lastMessage);
  if (!job.snapshot && !job.lastMessage) {
    const otherJobRunning = [...jobs.values()].some(other => other !== job && other.running);
    send(port, {state:'idle', statusTone:otherJobRunning ? 'warning' : 'normal', status:otherJobRunning
      ? 'A task continues in another course. Return there to view or cancel it, or scan this course.'
      : 'Scan this course to find its attachments.'});
  }
  if (job.uiState) send(port, {uiState:job.uiState});
  send(port, {sessionRestored:true});
  port.onMessage.addListener(async message => {
    if (message.action === 'remember-ui') {
      const state = message.uiState;
      if (!state || !Array.isArray(state.selectedIds) || !['initial','results','completion'].includes(state.view)) return;
      const selected = new Set(state.selectedIds.filter(id => typeof id === 'string'));
      if (typeof state.courseName === 'string' && state.courseName !== 'Current course' && state.courseName.trim()) {
        job.courseName = state.courseName.slice(0,1000);
      }
      job.uiState = {selectedIds:(job.snapshot?.files || []).filter(file => !file.unavailable && selected.has(file.id)).map(file => file.id),
        expanded:state.expanded === true, view:state.view};
      return;
    }
    if (!await isCurrentCourse()) {if (!disconnected) port.disconnect(); return;}
    if (message.action === 'show-folder') {
      if (job.running) return;
      try {
        await showArchive(job.archiveId);
        send(port, {folderError:''});
      } catch {
        send(port, {folderError:'Could not show the saved ZIP. It may have been moved or removed. Check Firefox Downloads.'});
      }
      return;
    }
    if (message.action === 'cancel') {job.controller?.abort(); return;}
    if (job.running || !['scan','download'].includes(message.action)) return;
    job.running = true;
    job.controller = new AbortController();
    const signal = job.controller.signal;
    try {
      if (message.action === 'scan') {
        job.archiveId = null;
        job.snapshot = null;
        notify(job, {state:'scanning', status:'Authorize Google, then scan course attachments…'});
        await getToken(signal, true, status => notify(job, {state:'scanning', status}));
        const snapshot = await discoverCourse(request, key, signal);
        const files = [];
        for (const file of snapshot.files) {
          try { files.push(await metadata(file, signal)); }
          catch (error) { signal.throwIfAborted(); files.push({...file, category:'Other', unavailable:error.message}); }
          notify(job, {state:'scanning', scanChecked:files.length, scanTotal:snapshot.files.length,
            status:`Checking files: ${files.length} / ${snapshot.files.length}`});
        }
        signal.throwIfAborted();
        job.snapshot = {...snapshot, files};
        notify(job, {state:'ready', ...job.snapshot, status:`${files.length} files found. ${snapshot.unsupported} unsupported links skipped.`});
      } else {
        if (!job.snapshot) throw new Error('Scan this course before downloading.');
        const files = selectFiles(job.snapshot.files, message.fileIds);
        if (!files.length) throw new Error('Select at least one available file to download.');
        job.archiveId = null;
        const result = await downloadBatch(files, job.snapshot.course, signal, progress => notify(job, progress));
        if (result.stage === 'saved' && Number.isInteger(result.archiveId)) job.archiveId = result.archiveId;
        notify(job, result);
      }
    } catch (error) {
      notify(job, {state:signal.aborted ? 'cancelled' : 'error', status:signal.aborted ? 'Cancelled.' : error.message});
    } finally {job.running = false;}
  });
});
