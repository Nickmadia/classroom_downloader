# Verification record and Firefox checklist

Automated native Node logic tests and syntax checks have been run. Live OAuth verification is partial. In an isolated Firefox 157 profile with a stored university account matching the account in the usual-profile error report, topic-only consent succeeded, followed by consent for all six current scopes and token exchange using the ignored local Desktop metadata. Authenticated Classroom `courses.list` returned HTTP 200; `topics.list` for the selected current course returned HTTP 200 with four topics and no next page. The earlier `accounts.google.com/info/unknownerror` has not yet been reproduced in the usual profile, so its cause remains unconfirmed. A synthetic Firefox preview using the actual UI modules and `downloadBatch` verified selection filtering, ZIP saving through one Firefox prompt, archive contents, and prompt cancellation. Real Drive attachment fetching and broader course discovery remain unverified.

## Authorization and installation

- [ ] Load source via `about:debugging`; ensure manifest/modules/CSP produce no startup errors.
- [ ] With blank config, Scan reports the actionable OAuth configuration error.
- [x] In Firefox 157, verify course-list consent using both the standalone pathless loopback callback and Firefox's extension callback. The earlier five-scope request succeeded; in a later run, topic-only consent and consent with all six current scopes succeeded.
- [x] Exchange the six-scope authorization code using the ignored local Desktop metadata; authenticated Classroom `courses.list` returned HTTP 200.
- [ ] Deny consent, close the authorization window, select the wrong account, and test admin-blocked consent; confirm clear errors and a retryable Scan button.
- [x] With the six-scope token, authenticated `topics.list` for the selected current course returned HTTP 200 with four topics and no next page.
- [ ] Verify broader course discovery and remaining API calls; confirm no submissions, rosters or profiles endpoints appear in extension network logs. Never publish logs containing bearer tokens.
- [ ] Let the token expire; verify Scan reconnects and an active batch reports expired authorization accurately.

## Courses and discovery

- [ ] In the panel, verify topic names and per-topic files, topic select/deselect, mixed group checkboxes, and disabled restricted files. Shared attachments must stay synchronized across groups, download once, and keep the existing ZIP folder layout. Announcements and unassigned posts belong under **No topic**.

- [ ] Home and other pages outside a course show no overlay. People, grades and post details inside a course retain the overlay; no roster, grade or submission contents are read.
- [x] Firefox 157 live Classroom navigation: Stream uses `/c/`, Classwork uses `/w/`, and People uses `/r/`. The same expanded panel survived Classwork and People navigation. `/u/1/` variants are covered by URL tests, not live verification.
- [ ] A synthetic course with no attachments returns zero, disables Download selected, and shows no false errors.
- [x] Synthetic UI preview: uncheck the first file and click **Download selected**; the payload contains only the second file's ID, and the restricted file's checkbox is disabled.
- [ ] With a real course, verify each available file has a checkbox, restricted/unsupported files cannot be selected, **Download selected** is enabled only with eligible selections, and **Select all available** selects every available file.
- [ ] A course with over 100 posts fetches every page in each resource. Compare attachment IDs against a teacher-maintained fixture inventory.
- [ ] Repeat a Drive attachment across materials, assignments and announcements: it appears once per scan.
- [ ] Verify topic/collapsed/lazy-loaded attachments appear without scrolling or expanding Classroom.
- [ ] External links, Forms, YouTube, add-ons and private submissions are excluded.
- [ ] Rapidly switch views within one course: keep the same panel, scan and selection. Switch to another course, then return: restore that course's own scan, topic choices, completion view and saved ZIP action. Old-course messages never populate the new course.
- [x] Firefox 157 live Classroom navigation with synthetic scan state: switching courses changed the title and removed old files; returning restored the previous scan and checked selection. A simulated active scan stayed attached to its original course, the other course showed a background-task notice, and returning restored progress. Cancel then hid progress/spinner and re-enabled Scan. This did not run Google attachment requests or downloads.
- [ ] Close/reload the tab and navigate back through the browser cache: state restores from background memory. Active jobs keep running while disconnected, and returning shows current progress; Cancel still stops that course's job. Reload the extension or restart Firefox: session memory clears. Tab reload/closure cases are covered by mocks; further live verification remains pending.

The failing implementation recognized only `/c/` and keyed background connections from `port.sender.url`. In Firefox 157, the sender URL remained the original page URL after Classroom's SPA navigation; `tabs.get()` supplied the current URL. Connections now carry an expected course key and validate it against that current URL, using existing Classroom host access. Targeted tests cover stale sender URLs, correct cache selection, pending actions during connection validation, and preventing an old panel from acting on a task after navigation.

## Downloads and failures

- [ ] Verify successful batches switch to a completion view with counts and no active download button or progress bar. Partial, failed, and cancelled batches must show distinct outcomes; Show in folder is available only for a saved ZIP.
- [ ] Show in folder must locate the batch's actual saved archive, including when renamed in the save dialog. Move/delete the archive and check that the error appears without losing the completion view.
- [ ] Choose more files must preserve the scan and deselect successfully saved files. Review failed files must select only eligible failed files; shared topic checkboxes remain synchronized. Cancelled batches preserve the original selection. Scan again starts a fresh scan, and completion never automatically closes the panel.

Backend mocks cover archive IDs after actual completion, unavailable archives, file-manager failures, and rejection of unrelated panel-supplied download IDs. The revised completion UI and native file-manager integration have not been tested live.

- [x] Synthetic two-file batch through the actual UI/background download path: Firefox displayed one `saveAs` prompt; choosing a temporary archive completed with 2 succeeded and 0 failed, and Python `zipfile` validated entry contents and CRCs.
- [ ] With real Classroom attachments, download a selected subset and then all available files. Verify each action produces one uncompressed ZIP, Firefox prompts once for the archive location, and extracted files are under the sanitized course folder.
- [ ] Test one PDF, Docs, Slides, Sheets, DOCX, PPTX, XLSX, PNG, ZIP and arbitrary ordinary Drive file; extract the archive and verify each file's format/content.
- [ ] Include duplicate names, Unicode, reserved characters, traversal strings, and long names. Verify safe, distinct ZIP entry names and that a second archive does not overwrite an existing one.
- [ ] Verify per-file preparation remains bounded at two concurrent operations and shows separately from saved count; files count as saved only after Firefox reports the whole archive complete.
- [ ] Verify a batch over 256 MiB is rejected or reported without claiming success, and a single file over 100 MiB is reported as unavailable.
- [ ] Restricted, deleted or revoked-access documents report individual failures. Revoke a file between scan and download to test the second permission check.
- [ ] Verify shared-drive attachments and resource-key-protected attachments; record unsupported cases rather than assuming coverage.
- [ ] Test a Workspace export exceeding Google's export limit and original files above 100 MiB; they fail explicitly with no bogus success.
- [ ] Simulate HTTP 429/5xx and offline/interrupted connections; confirm bounded retry requests, no indefinite hang, and accurate success/failure counts.
- [ ] Cancel during discovery, metadata lookup, file preparation, and active archive download. No pending work starts; cancellation never reports unsaved archive contents as saved. Check Firefox Downloads for final states.
- [x] Synthetic batch: Escape-cancelled the native archive save dialog; the batch reported cancelled with 2 prepared and 0 saved.
- [ ] Interrupt or fail an archive save through Firefox. The batch must report failure, with no files counted as saved.
- [ ] Test the chosen archive destination, managed browser policy, unwritable disk, and insufficient space. Preferences remain unchanged.
- [ ] With many attachments, observe at most two active file preparations; the batch completes only after Firefox completes the archive. Re-running a batch produces a distinct archive filename.

## UI and accessibility

- [ ] Verify the gray launcher matches the help control’s size and aligns directly above it, including after resize. Verify initial scan controls and post-scan selection controls appear in separate views, and the course name appears before authorization. The earlier green launcher was visually checked in Firefox; this revision is covered by automated state and positioning tests.
- [x] Headless Firefox screenshots using synthetic course data verify the revised initial and results views, neutral launcher, and right alignment with a help-control fixture. Actual Classroom positioning still needs the check above.
- [ ] Verify that checkboxes and the download action are disabled while scanning/preparing/saving. After the batch, the completion view replaces them; returning to file selection re-enables them.
- [ ] Check light/dark OS modes, 200% zoom, narrow viewport and reduced-motion preference.
- [ ] Navigate with keyboard; buttons and summary have visible focus, Escape collapses, focus returns to the launcher, status is announced by a screen reader.
- [ ] Collapse while scanning/downloading; reopening shows current progress. Confirm Classroom menus, controls, scrolling and dialogs remain usable.
- [ ] Verify idle, scanning, ready, downloading, completed, partial, error and cancelled states.

Do not tick a box from automated mock tests alone. Publish screenshots only from a synthetic course containing no personal information.

## Local OAuth metadata and release packaging

For local development, put the Desktop OAuth client ID in `src/config.js` and create the ignored `src/config.local.json` with the same `clientId` and its `clientSecret`, using the metadata from the downloaded Desktop client JSON. `.gitignore` excludes both the local config and the downloaded `client_secret*.json`; keep them out of commits. The downloaded JSON is source metadata for preparing the local config, not an extension resource to package.

The extension loads the local metadata only for token exchange. It does not save OAuth access or refresh tokens; access tokens stay in background memory and are discarded when the extension unloads. For a packaged release, include the required `src/config.local.json` at that path along with the extension files. Installed-app client metadata is extractable and is not confidential; never package a Web application secret or Google account password. Do not publish the downloaded source JSON file.

## Investigating a Google consent error

A user previously reported `accounts.google.com/info/unknownerror` after approving permissions with the configured Desktop client in their usual Firefox profile. In an isolated Firefox 157 profile with a stored university account—the same account as the report—topic-only consent succeeded, as did consent for all six current scopes and token exchange with the ignored local Desktop metadata. Authenticated Classroom `courses.list` returned HTTP 200, and `topics.list` for the selected current course returned HTTP 200 with four topics and no next page. The error has not yet been reproduced in the usual profile, so its cause remains unconfirmed. Real Drive attachment fetching and broader course discovery have not been tested; the synthetic UI and archive save path is verified above.

To isolate consent from token exchange:

1. Reload the extension through `about:debugging` and close any previous authorization window.
2. Click **Inspect** for Classroom Downloader and select the background page's **Console**.
3. Run this single-scope diagnostic:

   ```js
   await (await import(browser.runtime.getURL('src/auth.js'))).testGoogleConsent('classroom.courses.readonly')
   ```

4. Choose the same test account and approve access. Success returns `{callbackReceived: true, scope: 'classroom.courses.readonly'}`. The authorization code is discarded; no token is requested or returned and no course API is called.
5. If that succeeds, repeat with `'classroom.student-submissions.me.readonly'` (the name shown in the saved Google Console table), then the other scopes already listed in `src/auth.js`, one at a time. Close a failed Google window before another test. The helper refuses scopes the extension does not normally request.
6. If each scope succeeds separately but Scan fails, investigate the combined consent request. If even the courses scope fails, compare with a clean Firefox profile loaded with the same extension and only the test account signed in to distinguish session problems from request/client problems.

A failed diagnostic may stay pending while Google's error page is open. Closing the authorization window rejects the call. Only share the success object, sanitized error messages, or the error page's hostname/path. Never share full callback URLs, authorization codes, token responses or client JSON files. This diagnostic does not prove that token exchange or downloads work.

The consent helper prevents simultaneous flows across scans and diagnostics. Cancelled scans still hold this guard until Firefox's authorization promise settles, because cancelling a scan cannot close the Google window. Before an isolated diagnostic, close all previous authorization windows and reload the extension; run the console command once without also pressing Scan course. A user has reported Firefox's `User cancelled or denied access` error while a dialog appeared to remain open. Whether that was the same window or an older flow is unverified. If reproduced with exactly one window, record Firefox version and whether rejection happens before or after interacting with consent.

The reported Console screenshot shows the coursework read-only permission saved as `classroom.student-submissions.me.readonly`. The extension now requests that name and accepts either that name or the legacy `classroom.coursework.me.readonly` in token responses. Consent and token exchange with all six current scopes, plus `courses.list` and `topics.list`, have been verified as recorded above; assignment discovery still needs live verification. This does not establish the cause of the earlier Google `unknownerror` report.

### Compare with Google's standard Desktop callback

If even the course-list-only extension diagnostic fails, use the independent developer test:

```sh
node tools/test-oauth-consent.mjs
```

Run it from the repository directory containing your ignored downloaded `client_secret*.json`. If there are multiple files, supply the intended filename as an argument. Open the printed Google link in the **same Firefox profile**, choose the **same test account**, and approve course-list access. The diagnostic uses the same public client ID and PKCE, with a temporary `http://127.0.0.1:<random-port>/` listener matching Google's documented Desktop loopback example in [the installed-app flow](https://developers.google.com/identity/protocols/oauth2/native-app). An earlier version added `/oauth/callback`; this version removes that path to align the comparison with Google's example. That difference alone does not establish the cause of a consent error. This is a separate development diagnostic, not part of the extension or a deployed server.

The default timeout is two minutes. To allow more time for sign-in or account selection, pass a positive timeout in milliseconds, for example `node tools/test-oauth-consent.mjs --timeout-ms 600000`. A client filename can also be supplied before the option: `node tools/test-oauth-consent.mjs client_secret.json --timeout-ms 600000`.

The script binds only to the loopback interface, checks state, discards the authorization code, never exchanges a token, and stops after success/error or the configured timeout. It does not use the client secret, store credentials, or call Classroom/Drive. Do not share the callback URL. The initial link is generated fresh for each test; do not reuse an old one.

- If the same Google `unknownerror` appears, the problem reproduces without Firefox's extension identity API. That still does not distinguish a Google session problem from a client/provider issue.
- If this test succeeds while the extension's single-scope test fails, investigate differences between the two requests, including the Firefox-specific callback and optional authorization parameters. This does not by itself prove one difference caused the failure.
- A timeout means no callback arrived; report what the Google page showed. The script cannot read Google's error page.

The pathless local synthetic callback was verified after its change. Live consent, token exchange, `courses.list`, and the selected course's `topics.list` succeeded in Firefox 157 as recorded above. A separate synthetic batch verified ZIP creation and Firefox save/cancel behavior. Real Drive attachment fetching and broader course discovery remain unverified.
