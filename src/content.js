const NAVIGATION_INTERVAL = 500;

(async () => {
  const {detectCourse, readCourseName, readHelpAnchor} = await import(browser.runtime.getURL('src/classroom.js'));
  const {createOverlay} = await import(browser.runtime.getURL('src/ui.js'));
  const css = await (await fetch(browser.runtime.getURL('src/styles.css'))).text();
  let key;
  let overlay;
  let port;
  let courseName;
  let savedCourseName;
  let rememberedState;
  let canRemember = false;
  let pendingAction;
  let navigationExpanded;
  function rememberPanel() {
    if (!overlay || !port || !canRemember) return;
    const uiState = {...overlay.getState(),courseName};
    const serialized = JSON.stringify(uiState);
    if (serialized !== rememberedState) {
      port.postMessage({action:'remember-ui', uiState});
      rememberedState = serialized;
    }
  }
  function syncPageDetails() {
    if (!overlay) return;
    const name = savedCourseName || (courseName && courseName !== 'Current course' ? courseName : readCourseName(document, key));
    if (name !== courseName) {courseName = name; overlay.update({course:{name}});}
    overlay.setAnchor(readHelpAnchor(document, window.innerWidth, window.innerHeight));
    rememberPanel();
  }
  function syncCourse() {
    const course = detectCourse(location.href);
    if (course?.key === key) {syncPageDetails(); return;}
    navigationExpanded = overlay ? overlay.getState().expanded : undefined;
    rememberPanel();
    const oldPort = port;
    port = undefined;
    oldPort?.disconnect();
    overlay?.destroy();
    overlay = undefined;
    courseName = undefined;
    savedCourseName = undefined;
    rememberedState = undefined;
    canRemember = false;
    pendingAction = undefined;
    key = course?.key;
    if (!course) return;
    port = browser.runtime.connect({name:`classroom-downloader:${key}`});
    course.name = readCourseName(document, key);
    overlay = createOverlay(css, course, (action, options = {}) => {
      if (!canRemember) {pendingAction = {action, options}; return;}
      rememberPanel();
      port.postMessage({...options, action});
    });
    if (navigationExpanded !== undefined) overlay.restoreState({expanded:navigationExpanded,selectedIds:[],view:'initial'});
    const mountedOverlay = overlay;
    const connectedPort = port;
    port.onMessage.addListener(message => {
      if (port !== connectedPort) return;
      if (message.sessionRestored) {
        canRemember = true; rememberedState = undefined; rememberPanel();
        if (pendingAction) {connectedPort.postMessage({...pendingAction.options,action:pendingAction.action}); pendingAction = undefined;}
        return;
      }
      if (message.course?.name) {savedCourseName = message.course.name; courseName = savedCourseName;}
      if (message.uiState) {
        mountedOverlay.restoreState({...message.uiState,...(navigationExpanded !== undefined ? {expanded:navigationExpanded} : {})});
        rememberedState = JSON.stringify(mountedOverlay.getState());
      } else mountedOverlay.update(message);
    });
    port.onDisconnect.addListener(() => {
      if (port === connectedPort) mountedOverlay.update({state:'error', status:'Connection closed. Reload this course to reconnect.'});
    });
    syncPageDetails();
  }
  syncCourse();
  // Classroom uses pushState; polling avoids patching page scripts or private events.
  let timer = setInterval(syncCourse, NAVIGATION_INTERVAL);
  window.addEventListener('pageshow', event => {
    if (event.persisted) { key = undefined; syncCourse(); timer = setInterval(syncCourse, NAVIGATION_INTERVAL); }
  });
  window.addEventListener('pagehide', () => {clearInterval(timer); rememberPanel(); const oldPort = port; port = undefined; oldPort?.disconnect(); overlay?.destroy();});
})().catch(error => console.error('Classroom Downloader could not start:', error));
