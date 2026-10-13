import {sanitizeFilename} from './downloader.js';

export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

const UTF8_FLAG = 0x0800;
const END_SIZE = 22;
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}

function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return {time, date:day};
}

function localHeader(name, size, crc, stamp) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, UTF8_FLAG, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, stamp.time, true);
  view.setUint16(12, stamp.date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function centralHeader(name, size, crc, stamp, offset) {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, UTF8_FLAG, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, stamp.time, true);
  view.setUint16(14, stamp.date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, offset, true);
  header.set(name, 46);
  return header;
}

function endRecord(count, centralSize, centralOffset) {
  const end = new Uint8Array(END_SIZE);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return end;
}

function uniqueName(filename, used) {
  const dot = filename.lastIndexOf('.');
  const split = dot > 0 ? dot : filename.length;
  const stem = filename.slice(0, split), suffix = filename.slice(split);
  let candidate = filename, number = 2;
  while (used.has(candidate.toLowerCase())) candidate = `${stem} (${number++})${suffix}`;
  return candidate;
}

async function readBlob(blob, signal) {
  signal?.throwIfAborted();
  if (!blob || !Number.isSafeInteger(blob.size) || blob.size < 0 || typeof blob.stream !== 'function') {
    throw new TypeError('Archive entries must be Blob-like values with a stream and known size');
  }
  const reader = blob.stream().getReader();
  const chunks = [];
  let total = 0, crc = 0xffffffff;
  const onAbort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, {once:true});
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > blob.size) throw new Error('Blob stream exceeded its declared size');
      chunks.push(chunk);
      crc = crcUpdate(crc, chunk);
    }
    if (total !== blob.size) throw new Error('Blob stream did not match its declared size');
    return {chunks, crc:(crc ^ 0xffffffff) >>> 0};
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

export function createArchive(folder, {maxBytes = MAX_ARCHIVE_BYTES} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < END_SIZE) throw new RangeError('Archive byte limit must be at least 22 bytes');
  if (maxBytes > 0xffffffff) throw new RangeError('Archive byte limit exceeds the classic ZIP format');
  const root = `${sanitizeFilename(folder)}/`;
  const rootBytes = new TextEncoder().encode(root);
  const local = [], central = [], names = new Set();
  let totalBytes = END_SIZE, dataOffset = 0, count = 0, tail = Promise.resolve(), finished = false;

  function add(blob, name, signal) {
    const operation = tail.then(async () => {
      signal?.throwIfAborted();
      if (finished) throw new Error('Archive is already finished');
      if (count >= 0xffff) throw new RangeError('ZIP archives support at most 65,535 entries');
      const base = sanitizeFilename(name);
      const filename = uniqueName(base, names);
      const path = new Uint8Array(rootBytes.length + new TextEncoder().encode(filename).length);
      path.set(rootBytes);
      path.set(new TextEncoder().encode(filename), rootBytes.length);
      const overhead = 30 + 46 + path.length * 2;
      if (blob?.size > 0xffffffff || totalBytes + overhead + (blob?.size ?? 0) > maxBytes) {
        throw new RangeError(`Adding ${filename} would exceed the archive size limit`);
      }
      const {chunks, crc} = await readBlob(blob, signal);
      signal?.throwIfAborted();
      const stamp = dosDateTime();
      const header = localHeader(path, blob.size, crc, stamp);
      const directory = centralHeader(path, blob.size, crc, stamp, dataOffset);
      // Commit the entry only after the complete stream and every check succeed.
      local.push(header);
      for (const chunk of chunks) local.push(chunk);
      central.push(directory);
      names.add(filename.toLowerCase());
      dataOffset += header.length + blob.size;
      totalBytes += overhead + blob.size;
      count++;
    });
    tail = operation.catch(() => {});
    return operation;
  }

  return {
    add,
    finish() {
      if (count === 0) throw new Error('Cannot create an empty archive');
      if (!finished) finished = true;
      const centralOffset = dataOffset;
      const centralSize = central.reduce((sum, part) => sum + part.length, 0);
      return new Blob([...local, ...central, endRecord(count, centralSize, centralOffset)], {type:'application/zip'});
    },
    get count() { return count; },
  };
}
