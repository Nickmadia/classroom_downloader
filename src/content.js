const NAVIGATION_INTERVAL = 500;

(async () => {
  const {detectCourse} = await import(browser.runtime.getURL('src/classroom.js'));
  const {createOverlay} = await import(browser.runtime.getURL('src/ui.js'));
  const css = await (await fetch(browser.runtime.getURL('src/styles.css'))).text();
  let key;
  let overlay;
  let port;
  function syncCourse() {
    const course = detectCourse(location.href);
    if (course?.key === key) return;
    port?.disconnect();
    overlay?.destroy();
    key = course?.key;
    if (!course) return;
    port = browser.runtime.connect({name:'classroom-downloader'});
    overlay = createOverlay(css, course, action => port.postMessage({action}));
    const mountedOverlay = overlay;
    port.onMessage.addListener(message => mountedOverlay.update(message));
    port.onDisconnect.addListener(() => mountedOverlay.update({state:'error', status:'Connection closed. Reload this course to reconnect.'}));
  }
  syncCourse();
  // Classroom uses pushState; polling avoids patching page scripts or private events.
  let timer = setInterval(syncCourse, NAVIGATION_INTERVAL);
  window.addEventListener('pageshow', event => {
    if (event.persisted) { key = undefined; syncCourse(); timer = setInterval(syncCourse, NAVIGATION_INTERVAL); }
  });
  window.addEventListener('pagehide', () => {clearInterval(timer); port?.disconnect(); overlay?.destroy();});
})().catch(error => console.error('Classroom Downloader could not start:', error));
