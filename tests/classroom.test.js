import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCourse, readCourseName, readHelpAnchor, deduplicateAttachments, listPages, discoverCourse} from '../src/classroom.js';

test('course display names come from the course breadcrumb, never page titles or section text', () => {
  const links = [{href:'https://classroom.google.com/c/one',children:[
    {tagName:'SPAN',textContent:'Introduction to Biology'},{tagName:'SPAN',textContent:'Section A'},
  ]}];
  for (const title of ['Stream - Classroom','Lavori del corso','Persone','Private post title']) {
    assert.equal(readCourseName({title,querySelectorAll:() => links},'one'),'Introduction to Biology');
  }
  assert.equal(readCourseName({title:'Private post title',querySelectorAll:() => []},'one'),'Current course');
  assert.equal(readCourseName({querySelectorAll:() => links},'another'),'Current course');
});

test('launcher placement aligns above the help button and matches its hit area', () => {
  const button = label => ({getAttribute:() => label,
    getBoundingClientRect:() => ({top:720,right:990,bottom:768,width:48,height:48})});
  for (const label of ['Guida e feedback','Help & feedback']) {
    const anchor = readHelpAnchor({querySelectorAll:() => [button(label)]},1000,800);
    assert.deepEqual(anchor,{bottom:88,right:10,size:48});
  }
  assert.deepEqual(readHelpAnchor({querySelectorAll:() => []},1000,800),{bottom:80,right:8,size:48});
});

test('detects every course view, including people and post details', () => {
  for (const path of ['/c/abc', '/c/abc/', '/w/abc/t/all', '/r/abc/sort-name', '/u/2/w/abc/t/all', '/u/2/r/abc/sort-name', '/c/abc/a/post/details']) assert.equal(detectCourse(`https://classroom.google.com${path}`).key,'abc');
  for (const url of ['https://classroom.google.com/', 'https://classroom.google.com.evil/c/abc','http://classroom.google.com/c/abc', 'invalid']) assert.equal(detectCourse(url),null);
});
test('course navigation identifies course changes and private views', () => {
  const paths = ['/c/one','/c/one/t/all','/c/two','/c/two/a/private/details','/'];
  assert.deepEqual(paths.map(path => detectCourse(`https://classroom.google.com${path}`)?.key), ['one','one','two','two',undefined]);
});
test('deduplicates wrapped and unwrapped Drive attachments, skips links and forms', () => {
  const result = deduplicateAttachments([{materials:[{driveFile:{driveFile:{id:'A',title:'One'}}},{driveFile:{id:'A',title:'Again'}},{link:{url:'https://example.com'}},{form:{}}]}]);
  assert.deepEqual(result,{files:[{id:'A',name:'One'}],unsupported:2});
});
test('shared attachments retain every topic while remaining one downloadable file', () => {
  const attachment = {driveFile:{id:'shared',title:'Shared PDF'}};
  const result = deduplicateAttachments([
    {topicId:'one',materials:[attachment,attachment]},
    {topicId:'two',materials:[attachment]},
    {materials:[attachment]},
  ],new Map([['one','Networks'],['two','Security']]));
  assert.equal(result.files.length,1);
  assert.deepEqual(result.files[0].topics,[{id:'one',name:'Networks'},{id:'two',name:'Security'},{id:'',name:'No topic'}]);
});
test('pagination consumes every page and refuses loops', async () => {
  const tokens = [];
  const result = await listPages(async (_,params) => {tokens.push(params.pageToken); return params.pageToken ? {items:[2]} : {items:[1],nextPageToken:'next'};},'path','items',new AbortController().signal);
  assert.deepEqual(result,[1,2]); assert.deepEqual(tokens,[undefined,'next']);
  await assert.rejects(listPages(async () => ({nextPageToken:'same'}),'path','items',new AbortController().signal),/repeated/);
});
test('discovery scopes every post request to the course matched by alternateLink', async () => {
  const paths = [];
  const request = async (path, params) => {
    paths.push(path);
    if (path === 'courses') return {courses:[{id:'unrelated',alternateLink:'https://classroom.google.com/c/other'}, {id:'123',name:'Selected',alternateLink:'https://classroom.google.com/c/current'}]};
    if (path.endsWith('topics')) return {topic:[{topicId:'topic-one',name:'Networks'}]};
    if (path.endsWith('courseWork')) {
      assert.match(params.fields,/topicId/);
      return {courseWork:[{topicId:'topic-one',materials:[{driveFile:{driveFile:{id:'D'}}}]}]};
    }
    if (path.endsWith('courseWorkMaterials')) return {courseWorkMaterial:[{materials:[{driveFile:{driveFile:{id:'D'}}}]}]};
    assert.ok(!params.fields.includes('topicId'), 'Announcements do not have a topicId field');
    return {announcements:[]};
  };
  const result = await discoverCourse(request,'current',new AbortController().signal);
  assert.equal(result.files.length,1);
  assert.deepEqual(paths,['courses','courses/123/topics','courses/123/courseWork','courses/123/courseWorkMaterials','courses/123/announcements']);
  assert.equal(result.files[0].topics[0].name,'Networks');
  await assert.rejects(discoverCourse(request,'missing',new AbortController().signal),/Course not found/);
});
test('scan API failures are propagated rather than claiming complete coverage', async () => {
  await assert.rejects(discoverCourse(async () => {throw new Error('Forbidden');},'course',new AbortController().signal),/Forbidden/);
});
