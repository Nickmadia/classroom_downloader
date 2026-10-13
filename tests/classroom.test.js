import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCourse, deduplicateAttachments, listPages, discoverCourse} from '../src/classroom.js';

test('detects course stream and classwork routes, including multiple accounts', () => {
  for (const path of ['/c/abc', '/c/abc/', '/c/abc/t/all', '/u/2/c/abc/m']) assert.equal(detectCourse(`https://classroom.google.com${path}`).key,'abc');
  for (const url of ['https://classroom.google.com/', 'https://classroom.google.com/c/abc/a/private/details', 'https://classroom.google.com/c/abc/people', 'https://classroom.google.com.evil/c/abc','http://classroom.google.com/c/abc', 'invalid']) assert.equal(detectCourse(url),null);
});
test('course navigation identifies course changes and private views', () => {
  const paths = ['/c/one','/c/one/t/all','/c/two','/c/two/a/private/details','/'];
  assert.deepEqual(paths.map(path => detectCourse(`https://classroom.google.com${path}`)?.key), ['one','one','two',undefined,undefined]);
});
test('deduplicates wrapped and unwrapped Drive attachments, skips links and forms', () => {
  const result = deduplicateAttachments([{materials:[{driveFile:{driveFile:{id:'A',title:'One'}}},{driveFile:{id:'A',title:'Again'}},{link:{url:'https://example.com'}},{form:{}}]}]);
  assert.deepEqual(result,{files:[{id:'A',name:'One'}],unsupported:2});
});
test('pagination consumes every page and refuses loops', async () => {
  const tokens = [];
  const result = await listPages(async (_,params) => {tokens.push(params.pageToken); return params.pageToken ? {items:[2]} : {items:[1],nextPageToken:'next'};},'path','items',new AbortController().signal);
  assert.deepEqual(result,[1,2]); assert.deepEqual(tokens,[undefined,'next']);
  await assert.rejects(listPages(async () => ({nextPageToken:'same'}),'path','items',new AbortController().signal),/repeated/);
});
test('discovery scopes every post request to the course matched by alternateLink', async () => {
  const paths = [];
  const request = async path => {
    paths.push(path);
    if (path === 'courses') return {courses:[{id:'unrelated',alternateLink:'https://classroom.google.com/c/other'}, {id:'123',name:'Selected',alternateLink:'https://classroom.google.com/c/current'}]};
    if (path.endsWith('courseWork')) return {courseWork:[{materials:[{driveFile:{driveFile:{id:'D'}}}]}]};
    if (path.endsWith('courseWorkMaterials')) return {courseWorkMaterial:[{materials:[{driveFile:{driveFile:{id:'D'}}}]}]};
    return {announcements:[]};
  };
  const result = await discoverCourse(request,'current',new AbortController().signal);
  assert.equal(result.files.length,1);
  assert.deepEqual(paths,['courses','courses/123/courseWork','courses/123/courseWorkMaterials','courses/123/announcements']);
  await assert.rejects(discoverCourse(request,'missing',new AbortController().signal),/Course not found/);
});
test('scan API failures are propagated rather than claiming complete coverage', async () => {
  await assert.rejects(discoverCourse(async () => {throw new Error('Forbidden');},'course',new AbortController().signal),/Forbidden/);
});
