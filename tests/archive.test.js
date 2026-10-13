import test from 'node:test';
import assert from 'node:assert/strict';
import {createArchive, MAX_ARCHIVE_BYTES} from '../src/archive.js';

const decoder = new TextDecoder();

function inspectArchive(blob) {
  return blob.arrayBuffer().then(buffer => {
    const bytes = new Uint8Array(buffer), view = new DataView(buffer), entries = [];
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const flags = view.getUint16(offset + 6, true);
      const method = view.getUint16(offset + 8, true);
      const crc = view.getUint32(offset + 14, true);
      const size = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 30;
      const dataStart = nameStart + nameLength + extraLength;
      entries.push({
        flags, method, crc,
        name:decoder.decode(bytes.subarray(nameStart, nameStart + nameLength)),
        data:bytes.slice(dataStart, dataStart + size),
      });
      offset = dataStart + size;
    }
    const centralStart = offset;
    const central = [];
    while (view.getUint32(offset, true) === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      central.push({
        flags:view.getUint16(offset + 8, true),
        method:view.getUint16(offset + 10, true),
        crc:view.getUint32(offset + 16, true),
        size:view.getUint32(offset + 20, true),
        name:decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
        localOffset:view.getUint32(offset + 42, true),
      });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    assert.equal(view.getUint32(offset, true), 0x06054b50);
    const endCount = view.getUint16(offset + 10, true);
    assert.equal(view.getUint32(offset + 16, true), centralStart);
    return {entries, central, endCount, totalBytes:bytes.length};
  });
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

test('writes STORE ZIP entries with UTF-8 paths, valid CRCs, and matching central directory', async () => {
  const archive = createArchive('../Biology: 2026');
  const first = new Blob(['hello']);
  const second = new Blob(['Résumé 🌿']);
  await Promise.all([
    archive.add(first, 'lesson.txt'),
    archive.add(second, 'notes-über.txt'),
  ]);
  assert.equal(archive.count, 2);

  const {entries, central, endCount, totalBytes} = await inspectArchive(archive.finish());
  assert.equal(endCount, 2);
  assert.deepEqual(entries.map(entry => entry.name), ['_Biology_ 2026/lesson.txt', '_Biology_ 2026/notes-über.txt']);
  assert.deepEqual(central.map(entry => entry.name), entries.map(entry => entry.name));
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index], directory = central[index];
    assert.equal(entry.flags & 0x0800, 0x0800);
    assert.equal(directory.flags & 0x0800, 0x0800);
    assert.equal(entry.method, 0);
    assert.equal(directory.method, 0);
    assert.equal(entry.crc, crc32(entry.data));
    assert.equal(directory.crc, entry.crc);
    assert.equal(directory.size, entry.data.length);
    assert.equal(directory.localOffset, index === 0 ? 0 : 30 + new TextEncoder().encode(entries[0].name).length + entries[0].data.length);
  }
  assert.equal(decoder.decode(entries[0].data), 'hello');
  assert.equal(decoder.decode(entries[1].data), 'Résumé 🌿');
  assert.equal(totalBytes, archive.finish().size);
});

test('sanitizes file paths and disambiguates names case-insensitively before the extension', async () => {
  const archive = createArchive('Course/../Name');
  await Promise.all([
    archive.add(new Blob(['a']), '../report.pdf'),
    archive.add(new Blob(['b']), 'report.PDF'),
    archive.add(new Blob(['c']), 'REPORT.pdf'),
    archive.add(new Blob(['d']), '.env'),
  ]);
  const {entries} = await inspectArchive(archive.finish());
  assert.deepEqual(entries.map(entry => entry.name), [
    'Course_.._Name/_report.pdf',
    'Course_.._Name/report.PDF',
    'Course_.._Name/REPORT (2).pdf',
    'Course_.._Name/env',
  ]);
  for (const entry of entries) assert.equal(entry.name.split('/').length, 2);
});

test('rejects entries beyond the byte budget atomically and accepts later smaller entries', async () => {
  const name = new TextEncoder().encode('Course/x.bin');
  const exactSize = 22 + 30 + 46 + name.length * 2 + 4;
  const archive = createArchive('Course', {maxBytes:exactSize});
  await assert.rejects(archive.add(new Blob(['large']), 'x.bin'), /size limit/);
  assert.equal(archive.count, 0);
  await archive.add(new Blob(['1234']), 'x.bin');
  assert.equal(archive.count, 1);
  assert.equal(archive.finish().size, exactSize);
  assert.throws(() => createArchive('Course', {maxBytes:21}), /at least 22/);
  assert.throws(() => createArchive('Course', {maxBytes:0x100000000}), /classic ZIP/);
  assert.equal(MAX_ARCHIVE_BYTES, 256 * 1024 * 1024);
});

test('serializes concurrent additions so budget and duplicate names stay consistent', async () => {
  const firstName = new TextEncoder().encode('Course/a.txt');
  const secondName = new TextEncoder().encode('Course/a (2).txt');
  const size = 22 + (30 + 46 + firstName.length * 2 + 2) + (30 + 46 + secondName.length * 2 + 2);
  const archive = createArchive('Course', {maxBytes:size});
  await Promise.all([
    archive.add(new Blob(['aa']), 'a.txt'),
    archive.add(new Blob(['bb']), 'a.txt'),
  ]);
  const {entries, totalBytes} = await inspectArchive(archive.finish());
  assert.deepEqual(entries.map(entry => entry.name), ['Course/a.txt', 'Course/a (2).txt']);
  assert.equal(totalBytes, size);
});

test('cancellation during a stream leaves no partial entry or reserved name', async () => {
  const controller = new AbortController();
  const delayedBlob = {
    size:4,
    stream() {
      let cancelled = false;
      return new ReadableStream({
        start(stream) { setTimeout(() => { if (!cancelled) stream.enqueue(new TextEncoder().encode('part')); }, 30); },
        cancel() { cancelled = true; },
      });
    },
  };
  const archive = createArchive('Course');
  const adding = archive.add(delayedBlob, 'same.txt', controller.signal);
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(adding, {name:'AbortError'});
  assert.equal(archive.count, 0);
  await archive.add(new Blob(['ok']), 'same.txt');
  const {entries} = await inspectArchive(archive.finish());
  assert.deepEqual(entries.map(entry => entry.name), ['Course/same.txt']);
});

test('empty archives are rejected and additions after finish fail', async () => {
  const empty = createArchive('Course');
  assert.throws(() => empty.finish(), /empty archive/);
  const archive = createArchive('Course');
  await archive.add(new Blob(['ok']), 'one.txt');
  archive.finish();
  await assert.rejects(archive.add(new Blob(['late']), 'two.txt'), /already finished/);
});
