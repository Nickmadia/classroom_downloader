export const CONCURRENCY = 2;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export function selectFiles(files, fileIds) {
  if (fileIds === undefined) return files.filter(file => !file.unavailable);
  if (!Array.isArray(fileIds) || fileIds.length > files.length || fileIds.some(id => typeof id !== 'string')) {
    throw new Error('Invalid file selection. Scan this course again.');
  }
  const selected = new Set(fileIds);
  if (fileIds.some(id => !files.some(file => file.id === id))) {
    throw new Error('The selected files are not in this course scan. Scan again.');
  }
  return files.filter(file => selected.has(file.id) && !file.unavailable);
}
export function sanitizeFilename(value, fallback = 'Untitled') {
  let name = String(value ?? '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '');
  name = Array.from(name).slice(0, 100).join('');
  while (new TextEncoder().encode(name).length > 150) name = Array.from(name).slice(0, -1).join('');
  name = name.replace(/[. ]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) name = `_${name}`;
  return name || fallback;
}
export function identifyFile(mime) {
  const workspace = {
    'application/vnd.google-apps.document': ['Documents', 'application/pdf', '.pdf'],
    'application/vnd.google-apps.presentation': ['Presentations', 'application/pdf', '.pdf'],
    'application/vnd.google-apps.spreadsheet': ['Spreadsheets', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  };
  if (workspace[mime]) { const [category, exportMime, extension] = workspace[mime]; return {category, exportMime, extension}; }
  if (mime?.startsWith('application/vnd.google-apps.')) return {category:'Unsupported', unsupported:true};
  return {category: mime === 'application/pdf' ? 'PDF' : /word|opendocument.text/.test(mime) ? 'Documents' : /presentation|powerpoint/.test(mime) ? 'Presentations' : /sheet|excel/.test(mime) ? 'Spreadsheets' : mime?.startsWith('image/') ? 'Images' : 'Other'};
}
export function abortError() { return new DOMException('Cancelled', 'AbortError'); }
export function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, {once:true});
  });
}
export async function retry(operation, signal) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await operation(); } catch (error) {
      if (signal.aborted || !error.temporary || attempt >= 2) {
        error.temporary = false; // Prevent nested request and queue retries from multiplying.
        throw error;
      }
      await delay(500 * 2 ** attempt, signal);
    }
  }
}
export async function runQueue(files, download, signal, update, concurrency = CONCURRENCY) {
  const result = {total:files.length, succeeded:0, failed:0, failures:[], cancelled:false};
  let next = 0;
  async function worker() {
    while (!signal.aborted && next < files.length) {
      const file = files[next++];
      try { await retry(() => download(file, signal), signal); result.succeeded++; }
      catch (error) {
        if (signal.aborted) break;
        result.failed++;
        result.failures.push({id:file.id, name:file.name, message:error.message});
      }
      update({...result, failures:[...result.failures]});
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency, files.length)}, worker));
  result.cancelled = signal.aborted;
  return result;
}
