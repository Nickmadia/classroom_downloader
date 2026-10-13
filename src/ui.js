export function createOverlay(css, course, act) {
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:80px;right:8px;z-index:2147483647;';
  const root = host.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = css;
  root.append(style);

  function element(tag, text, parent = root) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== '') node.textContent = text;
    parent.append(node);
    return node;
  }

  const panel = element('section');
  panel.id = 'panel';
  panel.hidden = true;
  panel.setAttribute('aria-label','Classroom Downloader');
  const header = element('header','',panel);
  const name = element('h2',course?.name || 'Current course',header);
  const close = element('button','×',header);
  close.type = 'button';
  close.className = 'close';
  close.setAttribute('aria-label','Collapse panel');

  const status = element('p','Scan this course to find its attachments.',panel);
  status.className = 'status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  const progress = element('progress','',panel);
  progress.className = 'progress';
  progress.hidden = true;
  progress.setAttribute('aria-label','Scan or download progress');
  const spinner = element('span','',panel);
  spinner.className = 'spinner';
  spinner.hidden = true;
  spinner.setAttribute('aria-hidden','true');
  const progressLabel = element('p','',panel);
  progressLabel.className = 'progress-label muted';
  progressLabel.hidden = true;

  const initialView = element('div','',panel);
  initialView.className = 'initial-view';
  const scan = element('button','Scan course',initialView);
  scan.type = 'button';
  scan.className = 'primary scan-button';
  const initialCancel = element('button','Cancel',initialView);
  initialCancel.type = 'button';
  initialCancel.className = 'secondary cancel';
  initialCancel.hidden = true;
  const privacyHint = element('p','Read-only access. Student submissions are not accessed.',initialView);
  privacyHint.className = 'muted privacy-hint';

  const resultsView = element('div','',panel);
  resultsView.className = 'results-view';
  resultsView.hidden = true;
  const count = element('p','',resultsView);
  count.className = 'count';
  const summary = element('p','',resultsView);
  summary.className = 'muted summary';
  const selectionBar = element('div','',resultsView);
  selectionBar.className = 'selection-bar';
  const selectAllLabel = element('label','',selectionBar);
  selectAllLabel.className = 'select-all';
  const selectAll = element('input','',selectAllLabel);
  selectAll.type = 'checkbox';
  selectAll.setAttribute('aria-label','Select all available files');
  element('span','Select all available',selectAllLabel);
  const selectedCount = element('span','0 selected',selectionBar);
  selectedCount.className = 'muted selected-count';

  const details = element('details','',resultsView);
  element('summary','Choose files to download',details);
  const list = element('ul','',details);
  list.className = 'file-groups';
  const totals = element('p','',resultsView);
  totals.className = 'muted totals';
  totals.hidden = true;
  const resultActions = element('div','',resultsView);
  resultActions.className = 'actions';
  const downloadSelected = element('button','Download selected',resultActions);
  downloadSelected.type = 'button';
  downloadSelected.className = 'primary';
  downloadSelected.disabled = true;
  const resultCancel = element('button','Cancel',resultActions);
  resultCancel.type = 'button';
  resultCancel.className = 'secondary cancel';
  resultCancel.hidden = true;
  const scanAgain = element('button','Scan again',resultsView);
  scanAgain.type = 'button';
  scanAgain.className = 'scan-again';

  const completionView = element('div','',panel);
  completionView.className = 'completion-view';
  completionView.hidden = true;
  const completionHeadline = element('h3','',completionView);
  const completionStatus = element('p','',completionView);
  completionStatus.className = 'completion-status';
  completionStatus.setAttribute('role','status');
  completionStatus.setAttribute('aria-live','polite');
  const completionCounts = element('p','',completionView);
  completionCounts.className = 'completion-counts';
  const completionTip = element('p','',completionView);
  completionTip.className = 'muted completion-tip';
  const folderError = element('p','',completionView);
  folderError.className = 'folder-error';
  folderError.setAttribute('role','alert');
  folderError.hidden = true;
  const completionActions = element('div','',completionView);
  completionActions.className = 'actions completion-actions';
  const showFolder = element('button','Show in folder',completionActions);
  showFolder.type = 'button';
  showFolder.className = 'primary';
  showFolder.hidden = true;
  const chooseMore = element('button','Choose more files',completionActions);
  chooseMore.type = 'button';
  chooseMore.className = 'secondary';
  chooseMore.hidden = true;
  const reviewFailures = element('button','Review failed files',completionActions);
  reviewFailures.type = 'button';
  reviewFailures.className = 'secondary';
  reviewFailures.hidden = true;
  const completionScan = element('button','Scan again',completionView);
  completionScan.type = 'button';
  completionScan.className = 'scan-again';

  const toggle = element('button','',root);
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('aria-label','Open Classroom Downloader');
  toggle.setAttribute('aria-controls','panel');
  toggle.setAttribute('aria-expanded','false');
  const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
  icon.setAttribute('viewBox','0 0 24 24');
  icon.setAttribute('aria-hidden','true');
  icon.setAttribute('focusable','false');
  const shaft = document.createElementNS('http://www.w3.org/2000/svg','path');
  shaft.setAttribute('d','M12 3v12m0 0 5-5m-5 5-5-5');
  const tray = document.createElementNS('http://www.w3.org/2000/svg','path');
  tray.setAttribute('d','M5 16v4h14v-4');
  icon.append(shaft,tray);
  toggle.append(icon);

  let files = [];
  let failures = [];
  let selected = new Set();
  let topicGroups = [];
  let fileCheckboxes = new Map();
  let hasResults = false;
  let hasCompletion = false;
  let completionData = null;
  let completionKey = '';
  let savedBatchIds = new Set();
  let eligibleFailureIds = new Set();
  let wasScanning = false;
  let wasDownloading = false;
  let busy = false;
  const available = () => [...new Map(files.filter(file => !file.unavailable).map(file => [file.id,file])).values()];
  const topicsFor = file => Array.isArray(file.topics) && file.topics.length
    ? file.topics.map(topic => ({id:String(topic?.id ?? ''), name:typeof topic?.name === 'string' && topic.name ? topic.name : 'No topic'}))
    : [{id:'',name:'No topic'}];
  const fileListKey = list => JSON.stringify(list.map(file => [file.id,file.name,file.category,file.unavailable,
    Array.isArray(file.topics) ? file.topics.map(topic => [topic?.id,topic?.name]) : []]));
  const failureListKey = list => JSON.stringify(list.map(item => [item.id,item.message]));

  function refreshSelection() {
    const candidates = available();
    const chosen = candidates.filter(file => selected.has(file.id));
    selectedCount.textContent = `${chosen.length} selected`;
    selectAll.disabled = busy || !candidates.length;
    selectAll.checked = candidates.length > 0 && chosen.length === candidates.length;
    selectAll.indeterminate = chosen.length > 0 && chosen.length < candidates.length;
    downloadSelected.disabled = busy || chosen.length === 0;
    for (const group of topicGroups) {
      const groupFiles = group.files.filter(file => !file.unavailable);
      const groupSelected = groupFiles.reduce((n,file) => n + Number(selected.has(file.id)),0);
      group.checkbox.disabled = busy || groupFiles.length === 0;
      group.checkbox.checked = groupFiles.length > 0 && groupSelected === groupFiles.length;
      group.checkbox.indeterminate = groupSelected > 0 && groupSelected < groupFiles.length;
    }
    for (const file of files) {
      for (const checkbox of fileCheckboxes.get(file.id) || []) {
        checkbox.checked = selected.has(file.id);
        checkbox.disabled = busy || Boolean(file.unavailable);
      }
    }
  }

  function renderFiles() {
    list.replaceChildren();
    const groupsById = new Map();
    for (const file of files) for (const topic of topicsFor(file)) {
      const key = topic.id ? `topic:${topic.id}` : 'unassigned';
      if (!groupsById.has(key)) groupsById.set(key,{id:key,name:topic.name,files:[],fileIds:new Set()});
      const group = groupsById.get(key);
      if (!group.fileIds.has(file.id)) {group.fileIds.add(file.id); group.files.push(file);}
    }
    topicGroups = [];
    fileCheckboxes = new Map();
    for (const group of groupsById.values()) {
      const groupRow = element('li','',list);
      groupRow.className = 'topic-group';
      const groupHeader = element('div','',groupRow);
      groupHeader.className = 'topic-header';
      const groupLabel = element('label','',groupHeader);
      groupLabel.className = 'topic-label';
      const groupCheckbox = element('input','',groupLabel);
      groupCheckbox.type = 'checkbox';
      groupCheckbox.className = 'topic-checkbox';
      groupCheckbox.setAttribute('aria-label',`Select all available files in ${group.name}`);
      const topicName = element('span',group.name,groupLabel);
      topicName.className = 'topic-name';
      const topicCount = element('span',String(group.files.length),groupHeader);
      topicCount.className = 'topic-count muted';
      group.checkbox = groupCheckbox;
      topicGroups.push(group);
      groupCheckbox.addEventListener('change',() => {
        for (const file of group.files) {
          if (file.unavailable) continue;
          if (groupCheckbox.checked) selected.add(file.id); else selected.delete(file.id);
        }
        refreshSelection();
      });
      const topicFiles = element('ul','',groupRow);
      topicFiles.className = 'topic-files';
      for (const file of group.files) {
        const row = element('li','',topicFiles);
        row.className = 'file-row';
        const label = element('label','',row);
        label.className = 'file-label';
        const checkbox = element('input','',label);
        checkbox.type = 'checkbox';
        checkbox.checked = selected.has(file.id);
        checkbox.disabled = busy || Boolean(file.unavailable);
        checkbox.setAttribute('aria-label', file.unavailable ? `${file.name}, unavailable: ${file.unavailable}` : `Select ${file.name}`);
        if (!fileCheckboxes.has(file.id)) fileCheckboxes.set(file.id,[]);
        fileCheckboxes.get(file.id).push(checkbox);
        checkbox.addEventListener('change',() => {
          if (checkbox.checked) selected.add(file.id); else selected.delete(file.id);
          refreshSelection();
        });
        const copy = element('span','',label);
        copy.className = 'file-copy';
        element('span',file.name,copy);
        const failure = failures.find(item => item.id === file.id);
        if (file.unavailable || failure) {
          const explanation = element('span',file.unavailable ? `Unavailable: ${file.unavailable}` : `Failed: ${failure.message}`,copy);
          explanation.className = file.unavailable ? 'file-note restricted' : 'file-note';
        }
        if (file.category) {
          const category = element('span',file.category,row);
          category.className = 'file-category muted';
        }
      }
    }
    refreshSelection();
  }

  function focusPrimaryAction() {
    if (hasCompletion) {
      if (!showFolder.hidden) showFolder.focus();
      else if (!reviewFailures.hidden) reviewFailures.focus();
      else if (!chooseMore.hidden) chooseMore.focus();
      else completionScan.focus();
    } else if (busy) {
      (hasResults ? resultCancel : initialCancel).focus();
    } else if (hasResults) {
      if (available().length) downloadSelected.focus(); else scanAgain.focus();
    } else scan.focus();
  }
  function collapse() {
    panel.hidden = true;
    toggle.setAttribute('aria-expanded','false');
    toggle.focus();
  }
  function beginScan() {
    scan.disabled = true;
    scanAgain.disabled = true;
    completionScan.disabled = true;
    act('scan');
  }
  function returnToResults(statusText, {focus = true} = {}) {
    hasCompletion = false;
    completionView.hidden = true;
    initialView.hidden = true;
    resultsView.hidden = false;
    status.hidden = false;
    status.textContent = statusText;
    progress.hidden = true;
    spinner.hidden = true;
    progressLabel.hidden = true;
    totals.textContent = '';
    totals.hidden = true;
    resultCancel.hidden = true;
    scanAgain.disabled = false;
    completionScan.disabled = false;
    refreshSelection();
    if (focus && !panel.hidden) {
      if (!downloadSelected.disabled) downloadSelected.focus(); else scanAgain.focus();
    }
  }
  function renderCompletion(message, folderErrorMessage = '', hasFolderError = false) {
    const state = message.state;
    const succeeded = Number.isFinite(message.succeeded) ? message.succeeded : 0;
    const failed = Number.isFinite(message.failed) ? message.failed : 0;
    const prepared = Number.isFinite(message.prepared) ? message.prepared : 0;
    const nextKey = JSON.stringify([state,message.total,succeeded,failed,message.archiveId,message.batchIds,message.failures]);
    if (completionKey !== nextKey) {
      folderError.textContent = '';
      folderError.hidden = true;
      completionKey = nextKey;
    }
    completionData = {...message,state};
    hasCompletion = true;

    const failureIds = new Set(failures.map(item => item.id));
    savedBatchIds = new Set(
      ['completed','partial'].includes(state) && succeeded > 0
        ? (Array.isArray(message.batchIds) ? message.batchIds : []).filter(id => !failureIds.has(id))
        : [],
    );
    const availableIds = new Set(available().map(file => file.id));
    eligibleFailureIds = new Set([...failureIds].filter(id => availableIds.has(id)));

    const copy = {
      completed:['Download complete','Your ZIP was saved successfully.','Extract the ZIP to access your files.'],
      partial:['Some files couldn’t be downloaded','The ZIP contains the files that were saved successfully.','Extract the ZIP to access those files, then review failures.'],
      cancelled:['Download cancelled','No files were saved. Your choices are preserved.','You can try again or choose more files.'],
      error:['Download failed','No files were saved.','Review the failures and try again.'],
    }[state];
    completionHeadline.textContent = copy[0];
    completionStatus.textContent = state === 'error' && message.status ? message.status : copy[1];
    const unsaved = Math.max(0,prepared - succeeded);
    completionCounts.textContent = state === 'cancelled' || (state === 'error' && prepared > 0)
      ? `${succeeded} saved · ${failed} failed · ${unsaved} prepared, not saved`
      : `${succeeded} saved · ${failed} failed`;
    completionTip.textContent = copy[2];
    showFolder.hidden = !Number.isInteger(message.archiveId) || message.archiveId < 0 || succeeded <= 0;
    chooseMore.hidden = available().length === 0;
    reviewFailures.hidden = !['partial','error'].includes(state) || eligibleFailureIds.size === 0;
    completionScan.disabled = false;
    if (hasFolderError) {
      folderError.textContent = folderErrorMessage;
      folderError.hidden = !folderErrorMessage;
      if (!folderErrorMessage) showFolder.disabled = false;
    }
  }

  toggle.addEventListener('click',() => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded',String(!panel.hidden));
    if (!panel.hidden) focusPrimaryAction();
  });
  close.addEventListener('click',collapse);
  root.addEventListener('keydown',event => {if (event.key === 'Escape') collapse();});
  scan.addEventListener('click',beginScan);
  scanAgain.addEventListener('click',beginScan);
  completionScan.addEventListener('click',beginScan);
  selectAll.addEventListener('change',() => {
    for (const file of available()) {
      if (selectAll.checked) selected.add(file.id); else selected.delete(file.id);
    }
    refreshSelection();
  });
  downloadSelected.addEventListener('click',() => {
    const fileIds = available().filter(file => selected.has(file.id)).map(file => file.id);
    downloadSelected.disabled = true;
    scanAgain.disabled = true;
    act('download',{fileIds});
  });
  for (const cancel of [initialCancel,resultCancel]) cancel.addEventListener('click',() => {cancel.disabled = true; act('cancel');});
  showFolder.addEventListener('click',() => act('show-folder'));
  chooseMore.addEventListener('click',() => {
    if (completionData?.state !== 'cancelled') for (const id of savedBatchIds) selected.delete(id);
    returnToResults('Choose additional files to download.');
  });
  reviewFailures.addEventListener('click',() => {
    selected = new Set(eligibleFailureIds);
    returnToResults('Only files that failed are selected.');
  });

  function update(message) {
    if (message.course?.name) name.textContent = message.course.name;
    else if (message.courseName) name.textContent = message.courseName;
    const folderErrorMessage = typeof message.folderError === 'string'
      ? message.folderError
      : message.folderError?.message || (message.folderError ? 'Could not open the folder.' : '');
    const hasFolderError = Object.prototype.hasOwnProperty.call(message,'folderError');
    if (!message.state) {
      if (hasFolderError) {
        folderError.textContent = folderErrorMessage;
        folderError.hidden = !folderErrorMessage;
        if (!folderErrorMessage) showFolder.disabled = false;
      }
      return;
    }

    const isScanning = message.state === 'scanning';
    const isDownloading = message.state === 'downloading';
    const previousBusy = busy;
    const previousFiles = fileListKey(files);
    const previousFailures = failureListKey(failures);
    const previousView = hasCompletion ? completionView : hasResults ? resultsView : initialView;
    const activeElement = root.activeElement;
    const shouldRestoreFocus = !panel.hidden && Boolean(activeElement && previousView.contains?.(activeElement));
    busy = isScanning || isDownloading;
    if (isScanning && !wasScanning) {
      files = [];
      failures = [];
      selected.clear();
      hasResults = false;
      hasCompletion = false;
      completionData = null;
      completionKey = '';
      folderError.textContent = '';
      folderError.hidden = true;
      count.textContent = '';
      summary.textContent = '';
      totals.textContent = '';
      list.replaceChildren();
      refreshSelection();
    }
    if (isDownloading && !wasDownloading) totals.textContent = '';
    if (isDownloading) hasCompletion = false;
    wasScanning = isScanning;
    wasDownloading = isDownloading;

    if (Array.isArray(message.files)) {
      const oldIds = new Set(files.map(file => file.id));
      files = message.files;
      failures = [];
      hasResults = true;
      for (const file of files) if (!oldIds.has(file.id) && !file.unavailable) selected.add(file.id);
      for (const id of selected) if (!files.some(file => file.id === id && !file.unavailable)) selected.delete(id);
      count.textContent = `${files.length} files found · ${message.unsupported || 0} unsupported links skipped`;
      const categories = new Map();
      files.forEach(file => categories.set(file.category || 'Other',(categories.get(file.category || 'Other') || 0) + 1));
      summary.textContent = [...categories].map(([type,n]) => `${type}: ${n}`).join(' · ');
      details.open = true;
    }
    if (message.failures) failures = message.failures;
    if (fileListKey(files) !== previousFiles || failureListKey(failures) !== previousFailures || busy !== previousBusy) renderFiles();
    else refreshSelection();

    const terminalBatch = hasResults && Number.isFinite(message.total) && ['completed','partial','cancelled','error'].includes(message.state);
    if (terminalBatch) renderCompletion(message,folderErrorMessage,hasFolderError);
    else if (hasFolderError) {
      folderError.textContent = folderErrorMessage;
      folderError.hidden = !folderErrorMessage;
      if (!folderErrorMessage) showFolder.disabled = false;
    }

    initialView.hidden = hasResults || hasCompletion;
    resultsView.hidden = !hasResults || hasCompletion;
    completionView.hidden = !hasCompletion;
    const scanCancelled = message.state === 'cancelled' && !hasResults && !Number.isFinite(message.total);
    status.textContent = scanCancelled ? 'Scan this course to find its attachments.'
      : message.status || (isScanning ? 'Scanning course attachments…' : isDownloading ? 'Preparing your ZIP…' : status.textContent);
    status.className = message.statusTone === 'warning' ? 'status warning' : 'status';
    status.hidden = hasCompletion || message.state === 'ready';
    scan.disabled = busy;
    scan.hidden = busy;
    scanAgain.disabled = busy;
    count.hidden = isDownloading;
    summary.hidden = isDownloading;
    selectionBar.hidden = isDownloading;
    details.hidden = isDownloading;
    downloadSelected.hidden = isDownloading;
    scanAgain.hidden = isDownloading;
    initialCancel.hidden = !busy || hasResults;
    resultCancel.hidden = !busy || !hasResults;
    initialCancel.disabled = false;
    resultCancel.disabled = false;
    progress.hidden = hasCompletion || !busy;
    spinner.hidden = hasCompletion || !busy;
    progressLabel.textContent = '';

    if (isScanning) {
      if (Number.isFinite(message.scanTotal) && message.scanTotal > 0 && Number.isFinite(message.scanChecked)) {
        progress.max = message.scanTotal;
        progress.value = Math.min(message.scanChecked,message.scanTotal);
        progressLabel.textContent = `${Math.min(message.scanChecked,message.scanTotal)} of ${message.scanTotal} checked`;
      } else progress.removeAttribute('value');
      if (Number.isFinite(message.scanTotal)) count.textContent = `Scanning ${message.scanChecked || 0} of ${message.scanTotal}`;
    } else if (isDownloading && message.stage === 'preparing' && Number.isFinite(message.total)) {
      progress.max = Math.max(1,message.total);
      progress.value = Math.min(message.processed || 0,message.total);
      progressLabel.textContent = 'Preparing ZIP…';
      totals.textContent = `${message.prepared || 0} prepared · ${message.failed || 0} failed`;
    } else if (isDownloading && message.stage === 'saving' && Number.isFinite(message.total)) {
      progress.max = Math.max(1,message.total);
      progress.value = Math.min(message.processed ?? message.prepared ?? 0,message.total);
      progressLabel.textContent = 'Saving ZIP…';
      totals.textContent = `${message.prepared || 0} prepared · ${message.failed || 0} failed`;
    } else if (message.total !== undefined) {
      progress.max = Math.max(1,message.total);
      const succeeded = message.succeeded || 0;
      const failed = message.failed || 0;
      progress.value = Math.min(message.processed ?? (succeeded + failed),message.total);
      if (['completed','partial','cancelled','error'].includes(message.state)) {
        const unsaved = Math.max(0,(message.prepared || 0) - succeeded);
        totals.textContent = message.state === 'cancelled'
          ? `${succeeded} saved · ${failed} failed` + (unsaved ? ` · ${unsaved} prepared, not saved` : '')
          : `${succeeded} saved · ${failed} failed`;
      } else totals.textContent = `${message.prepared || 0} prepared · ${failed} failed`;
    }
    progressLabel.hidden = hasCompletion || !busy || !progressLabel.textContent;
    totals.hidden = hasCompletion || !totals.textContent;
    const nextView = hasCompletion ? completionView : hasResults ? resultsView : initialView;
    if (shouldRestoreFocus && previousView !== nextView) focusPrimaryAction();
  }

  function setAnchor({bottom,right,size} = {}) {
    if (Number.isFinite(bottom)) host.style.bottom = `${bottom}px`;
    if (Number.isFinite(right)) host.style.right = `${right}px`;
    if (Number.isFinite(size) && size > 0) host.style.setProperty('--launcher-size',`${size}px`);
    const bottomRoom = (Number.isFinite(bottom) ? bottom : 80) + (Number.isFinite(size) ? size : 48) + 32;
    host.style.setProperty('--panel-room',`${bottomRoom}px`);
  }

  function getState() {
    return {
      selectedIds:available().filter(file => selected.has(file.id)).map(file => file.id),
      expanded:!panel.hidden,
      view:hasCompletion ? 'completion' : hasResults ? 'results' : 'initial',
    };
  }

  function restoreState(state) {
    if (!state || typeof state !== 'object') return;
    const wanted = new Set(Array.isArray(state.selectedIds) ? state.selectedIds : []);
    selected = new Set(available().filter(file => wanted.has(file.id)).map(file => file.id));
    if (state.view === 'results' && hasResults) {
      if (hasCompletion) returnToResults('Choose files to download.',{focus:false});
      else {
        initialView.hidden = true;
        resultsView.hidden = false;
        completionView.hidden = true;
      }
    }
    panel.hidden = !Boolean(state.expanded);
    toggle.setAttribute('aria-expanded',String(!panel.hidden));
    refreshSelection();
  }

  document.documentElement.append(host);
  return {update, setAnchor, getState, restoreState, destroy:() => host.remove()};
}
