const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export function readCourseName(page, key) {
  if (!key) return 'Current course';
  for (const link of page.querySelectorAll('a[href]')) {
    if (detectCourse(link.href)?.key !== key) continue;
    if (!/^\/(?:u\/\d+\/)?c\/[^/]+\/?$/.test(new URL(link.href).pathname)) continue;
    // Classroom's course breadcrumb has direct spans for the name and section.
    // Navigation tabs have no name span; sidebar links use nested divs.
    const name = [...link.children].find(child => child.tagName === 'SPAN')?.textContent?.trim();
    if (name) return name;
  }
  return 'Current course';
}

export function readHelpAnchor(page, width, height) {
  const buttons = page.querySelectorAll('button[aria-label], [role="button"][aria-label]');
  for (const button of buttons) {
    if (!/^(?:help\s*(?:&|and)?\s*feedback|guida\s*e\s*feedback)$/i.test(button.getAttribute('aria-label')?.trim() || '')) continue;
    const rect = button.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.width > 64 || rect.right > width || rect.bottom > height) continue;
    return {bottom:height - rect.top + 8, right:Math.max(0,width - rect.right), size:rect.width};
  }
  return {bottom:80, right:8, size:48};
}

export function detectCourse(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://classroom.google.com') return null;
    const match = url.pathname.match(/^\/(?:u\/\d+\/)?(?:c|w|r)\/([A-Za-z0-9_-]+)(?:\/|$)/);
    if (!match) return null;
    // The overlay follows every course view. Discovery still uses only course
    // attachment APIs and never reads submissions or people from the page.
    return {key: match[1]};
  } catch { return null; }
}
export function deduplicateAttachments(posts, topics = null) {
  const files = new Map();
  let unsupported = 0;
  for (const post of posts) for (const material of post.materials || []) {
    const file = material.driveFile?.driveFile || material.driveFile;
    if (file?.id && /^[A-Za-z0-9_-]+$/.test(file.id)) {
      if (!files.has(file.id)) files.set(file.id, {id: file.id, name: file.title || 'Untitled file'});
      if (topics) {
        const attachment = files.get(file.id);
        attachment.topics ??= [];
        const id = post.topicId || '';
        if (!attachment.topics.some(topic => topic.id === id)) {
          attachment.topics.push({id, name:id ? topics.get(id) || 'Unnamed topic' : 'No topic'});
        }
      }
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
  const topics = await listPages(request, `courses/${encodeURIComponent(course.id)}/topics`, 'topic', signal,
    {fields:'topic(topicId,name),nextPageToken'});
  const topicNames = new Map(topics.map(topic => [topic.topicId, topic.name]));
  const posts = [];
  for (const [resource, field] of [['courseWork', 'courseWork'], ['courseWorkMaterials', 'courseWorkMaterial'], ['announcements', 'announcements']]) {
    posts.push(...await listPages(request, `courses/${encodeURIComponent(course.id)}/${resource}`, field, signal,
      {fields:`${field}(materials${resource === 'announcements' ? '' : ',topicId'}),nextPageToken`}));
  }
  return {course, ...deduplicateAttachments(posts, topicNames)};
}
