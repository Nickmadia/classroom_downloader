# Verification record and Firefox checklist

Automated native Node logic tests and syntax checks were run in the development environment. **All live checks below are unverified.** No signed-in Classroom session, OAuth client, interactive Firefox session, or signed XPI was available during implementation. Record Firefox/OS version, OAuth client type, date, and outcome when running this checklist.

## Authorization and installation

- [ ] Load source via `about:debugging`; ensure manifest/modules/CSP produce no startup errors.
- [ ] With blank config, Scan reports the actionable OAuth configuration error.
- [ ] Configure a Desktop app client, APIs and test user. Verify Firefox's loopback redirect works with Google and token exchange accepts PKCE; if it fails, do not claim release readiness.
- [ ] Deny consent, close the authorization window, select the wrong account, and test admin-blocked consent; confirm clear errors and a retryable Scan button.
- [ ] Grant all scopes. Confirm no submissions, rosters or profiles endpoints in extension network logs. Never publish logs containing bearer tokens.
- [ ] Let the token expire; verify Scan reconnects and an active batch reports expired authorization accurately.

## Courses and discovery

- [ ] Home, People, grades and private assignment/submission pages show no overlay.
- [ ] Stream and Classwork routes, including `/u/1/` multi-account routes, show one overlay.
- [ ] A synthetic course with no attachments returns zero, disables Download all, and shows no false errors.
- [ ] A course with over 100 posts fetches every page in each resource. Compare attachment IDs against a teacher-maintained fixture inventory.
- [ ] Repeat a Drive attachment across materials, assignments and announcements: it appears once per scan.
- [ ] Verify topic/collapsed/lazy-loaded attachments appear without scrolling or expanding Classroom.
- [ ] External links, Forms, YouTube, add-ons and private submissions are excluded.
- [ ] Rapidly switch courses, enter a private detail page, close/reload the tab, and navigate back through the browser cache. Old job cancels, stale results never populate a new course, and only one panel exists.

## Downloads and failures

- [ ] Test one PDF, Docs, Slides, Sheets, DOCX, PPTX, XLSX, PNG, ZIP and arbitrary ordinary Drive file; open each output and verify its format/content.
- [ ] Include files with identical names, Unicode, reserved characters, and long names. Verify sanitized paths and uniquified saves, without overwrites.
- [ ] Restricted, deleted or revoked-access documents report individual failures. Revoke a file between scan and download to test the second permission check.
- [ ] Verify shared-drive attachments and resource-key-protected attachments; record unsupported cases rather than assuming coverage.
- [ ] Test a Workspace export exceeding Google's export limit and original files above 100 MiB; they fail explicitly with no bogus success.
- [ ] Simulate HTTP 429/5xx and offline/interrupted connections; confirm bounded retry requests, no indefinite hang, and accurate success/failure counts.
- [ ] Cancel during discovery, metadata lookup, file fetch, save dialog and active Firefox download. No pending file starts; completed files remain. Check Firefox Downloads for actual final states.
- [ ] Interrupt a save through Firefox Downloads; it counts as failure rather than success.
- [ ] Test default download location, Ask where to save, managed browser policy, unwritable disk and insufficient space. Preferences remain unchanged.
- [ ] With many attachments, observe at most two active file operations; completion occurs only after Firefox completes each save. Re-running a batch produces uniquified files.

## UI and accessibility

- [ ] Check light/dark OS modes, 200% zoom, narrow viewport and reduced-motion preference.
- [ ] Navigate with keyboard; buttons and summary have visible focus, Escape collapses, focus returns to the launcher, status is announced by a screen reader.
- [ ] Collapse while scanning/downloading; reopening shows current progress. Confirm Classroom menus, controls, scrolling and dialogs remain usable.
- [ ] Verify idle, scanning, ready, downloading, completed, partial, error and cancelled states.

Do not tick a box from automated mock tests alone. Publish screenshots only from a synthetic course containing no personal information.
