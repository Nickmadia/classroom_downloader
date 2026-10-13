import {getToken, forgetToken} from './auth.js';
import {detectCourse, discoverCourse} from './classroom.js';
import {identifyFile, sanitizeFilename, runQueue, retry, MAX_FILE_BYTES} from './downloader.js';
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
    id = await browser.downloads.download({url, filename, conflictAction:'uniquify'});
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
  } finally { URL.revokeObjectURL(url); }
}
async function downloadFile(file, course, signal) {
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
  const folder = `${sanitizeFilename(course.name)} (${sanitizeFilename(course.id).slice(0, 40)})`;
  await saveBlob(blob, `Classroom Downloader/${folder}/${name}`, signal);
}
function send(port, message) {
  try { port.postMessage(message); } catch (error) {
    console.warn('Classroom Downloader panel disconnected:', error.message);
  }
}
browser.runtime.onConnect.addListener(port => {
  if (port.name !== 'classroom-downloader' || port.sender?.id !== browser.runtime.id || !port.sender?.tab || port.sender.frameId !== 0 || !detectCourse(port.sender.url)) {
    port.disconnect(); return;
  }
  const key = detectCourse(port.sender.url).key;
  const tabId = port.sender.tab.id;
  const job = {controller:null, snapshot:null, running:false};
  jobs.get(tabId)?.controller?.abort();
  jobs.set(tabId, job);
  port.onDisconnect.addListener(() => {job.controller?.abort(); if (jobs.get(tabId) === job) jobs.delete(tabId);});
  port.onMessage.addListener(async message => {
    if (message.action === 'cancel') {job.controller?.abort(); return;}
    if (job.running || !['scan','download'].includes(message.action)) return;
    job.running = true;
    job.controller = new AbortController();
    const signal = job.controller.signal;
    try {
      if (message.action === 'scan') {
        job.snapshot = null;
        send(port, {state:'scanning', status:'Authorize Google, then scan course attachments…'});
        await getToken(signal, true);
        const snapshot = await discoverCourse(request, key, signal);
        const files = [];
        for (const file of snapshot.files) {
          try { files.push(await metadata(file, signal)); }
          catch (error) { signal.throwIfAborted(); files.push({...file, category:'Other', unavailable:error.message}); }
          send(port, {state:'scanning', status:`Checking files: ${files.length} / ${snapshot.files.length}`});
        }
        signal.throwIfAborted();
        job.snapshot = {...snapshot, files};
        send(port, {state:'ready', ...job.snapshot, status:`${files.length} files found. ${snapshot.unsupported} unsupported links skipped.`});
      } else {
        if (!job.snapshot) throw new Error('Scan this course before downloading.');
        send(port, {state:'downloading', status:'Downloading…'});
        const result = await runQueue(job.snapshot.files, (file, abortSignal) => downloadFile(file, job.snapshot.course, abortSignal), signal,
          progress => send(port, {state:'downloading', ...progress, status:`Processed ${progress.succeeded + progress.failed} / ${progress.total}`}));
        send(port, {...result, state:result.cancelled ? 'cancelled' : result.failed ? 'partial' : 'completed', status:result.cancelled ? 'Cancelled. Completed files remain in Downloads.' : result.failed ? 'Finished with some failures.' : 'All downloads completed.'});
      }
    } catch (error) {
      send(port, {state:signal.aborted ? 'cancelled' : 'error', status:signal.aborted ? 'Cancelled.' : error.message});
    } finally {job.running = false;}
  });
});
