const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export function detectCourse(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://classroom.google.com') return null;
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?c\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) return null;
    // Only stream/classwork routes: assignment details can contain private submissions.
    const suffix = url.pathname.slice(match[0].length);
    if (suffix && !/^(?:t|m)(?:\/[A-Za-z0-9_-]+)?\/?$/.test(suffix)) return null;
    return {key: match[1]};
  } catch { return null; }
}
export function deduplicateAttachments(posts) {
  const files = new Map();
  let unsupported = 0;
  for (const post of posts) for (const material of post.materials || []) {
    const file = material.driveFile?.driveFile || material.driveFile;
    if (file?.id && /^[A-Za-z0-9_-]+$/.test(file.id)) {
      if (!files.has(file.id)) files.set(file.id, {id: file.id, name: file.title || 'Untitled file'});
    } else unsupported++;
  }
  return {files: [...files.values()], unsupported};
}
export async function listPages(request, path, field, signal, params = {}) {
  const items = [];
  const seen = new Set();
  let pageToken = '';
  do {
    const data = await request(path, {...params, pageSize: String(PAGE_SIZE), ...(pageToken ? {pageToken} : {})}, signal);
    items.push(...(data[field] || []));
    pageToken = data.nextPageToken || '';
    if (pageToken && seen.has(pageToken)) throw new Error('Google returned a repeated page token. Scan stopped.');
    seen.add(pageToken);
    if (seen.size > MAX_PAGES) throw new Error('Scan exceeded 1,000 pages. Narrow the course before retrying.');
  } while (pageToken);
  return items;
}
export async function discoverCourse(request, key, signal) {
  const courses = await listPages(request, 'courses', 'courses', signal, {fields:'courses(id,name,alternateLink),nextPageToken'});
  const course = courses.find(item => detectCourse(item.alternateLink)?.key === key);
  if (!course) throw new Error('Course not found for the authorized account. Sign in with the Classroom account.');
  const posts = [];
  for (const [resource, field] of [['courseWork', 'courseWork'], ['courseWorkMaterials', 'courseWorkMaterial'], ['announcements', 'announcements']]) {
    posts.push(...await listPages(request, `courses/${encodeURIComponent(course.id)}/${resource}`, field, signal,
      {fields:`${field}(materials),nextPageToken`}));
  }
  return {course, ...deduplicateAttachments(posts)};
}
