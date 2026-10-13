# Classroom Downloader

**Your course files, together.** A small Firefox extension that packs accessible Google Classroom attachments into a ZIP, arranged under a course folder.

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Dependencies: zero](https://img.shields.io/badge/dependencies-zero-blue)

> Screenshot placeholder: floating button and expanded course panel in Google Classroom. No screenshot is included because end-to-end Classroom attachment fetching has not yet been tested.

[Setup](#google-authorization-setup) · [Installation](#installation) · [Usage](#usage) · [Limitations](#limitations) · [Development](#development) · [Privacy](#privacy)

## Features

- Floating panel inside Classroom, with Shadow DOM style isolation.
- Overlay on every course view, including Classwork, People, and post details; hidden outside courses.
- Separate course state retains scans, selections, progress and completion when navigating away and returning.
- Official, paginated discovery of materials, assignments, and announcements, including attachments under topics without expanding them.
- Drive ID deduplication and permission checks before downloading.
- Docs and Slides exported to PDF; Sheets to XLSX; ordinary Drive files preserved.
- At most two concurrent file preparations, one ZIP save per batch, bounded retries for transient API errors, cancellation, and per-file failure details.
- Sanitized course folders inside ZIPs, Firefox completion tracking, keyboard controls, and system light/dark themes.
- Vanilla JavaScript, no runtime dependencies, no build step, no analytics.

**Verification status:** automated logic tests pass. In an isolated Firefox 157 profile with a stored university account—the same university account used in the usual-profile error report—the extension's topic-only consent callback succeeded. Consent for all six current scopes, token exchange, authenticated Classroom `courses.list` (HTTP 200), and `topics.list` for the selected current course (HTTP 200, four topics, one page) also succeeded. The earlier `unknownerror` has not yet been reproduced in the usual profile, so its cause remains unconfirmed. A synthetic Firefox preview exercised selection and the real batch-save path with two tiny fixture files: one archive save prompt appeared, the ZIP entries passed Python `zipfile` CRC checks, and Escape-cancelling a second prompt left two files prepared and zero saved. Real Drive attachment fetching and broader course discovery remain unverified. No signed package or published add-on currently exists.

## Architecture decision

A DOM scan sees only rendered attachments. It cannot reliably enumerate collapsed, paginated, or unloaded posts, and a Drive viewer link is not a supported download API. This implementation uses Google's documented Classroom and Drive APIs instead of scraping or constructing guessed Google download links.

This trades one-time Google Cloud setup and explicit OAuth consent for pagination, stable attachment IDs, file metadata, and supported downloads. It uses no application server. Firefox's persistent Manifest V2 background page keeps in-memory queues and tokens alive during a session; an HTML background page loads ES modules directly. The content script imports packaged modules and never executes scripts in Google's page context.

See [Classroom scopes](https://developers.google.com/workspace/classroom/guides/auth), [Classroom course resources](https://developers.google.com/workspace/classroom/reference/rest/v1/courses), [Drive download/export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [Google installed-app PKCE](https://developers.google.com/identity/protocols/oauth2/native-app), [Firefox identity](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity), and [background pages](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background).

## Google authorization setup

The repository deliberately contains no registered OAuth client. Loading it is sufficient to see the panel; **scanning requires a real OAuth configuration**. No API key or existing Classroom login cookie substitutes for this authorization.

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Classroom API** and **Google Drive API**.
3. Configure the Google Auth Platform consent screen. For an external app in Testing, add your own Google account as a test user. A Workspace administrator may need to allow the client.
4. Create an OAuth client with application type **Desktop app**, using the installed-app authorization code flow with PKCE. Do not use a Chrome-extension or Web-application client.
5. Put its client ID in `src/config.js`. The Desktop client used for live verification requires its client secret at token exchange. Use the downloaded Desktop client JSON to create the ignored file `src/config.local.json` with the matching `clientId` and its `clientSecret`:
   ```json
   {
     "clientId": "same client ID as src/config.js",
     "clientSecret": "client secret from the downloaded Desktop client JSON"
   }
   ```
   The source JSON and `src/config.local.json` are ignored by Git. Installed-app client metadata is not confidential, and a packaged client secret can be extracted; never use a Web-application client secret or put a Google account password here.
6. Reload the temporary extension. Open a course, click **Scan course**, and explicitly authorize the account used for that Classroom course.

The extension uses Firefox's supported `http://127.0.0.1/mozoauth2/<extension-derived-subdomain>` redirect. Firefox intercepts this redirect; there is no local HTTP server. In an isolated Firefox 157 profile with a stored university account matching the account in the usual-profile error report, the extension's topic-only consent callback succeeded. Consent for all six current scopes and token exchange also succeeded. Authenticated Classroom `courses.list` returned HTTP 200, and `topics.list` for the selected current course returned HTTP 200 with four topics and no next page. The earlier Google `unknownerror` has not yet been reproduced in the usual profile, so its cause remains unconfirmed. Real Drive attachment fetching and broader course discovery remain untested; the synthetic archive/save check is described below.

Requested Google scopes:

| Scope suffix (under `https://www.googleapis.com/auth/`) | Purpose |
| --- | --- |
| `classroom.courses.readonly` | Match the current UI course to its API `alternateLink` and retrieve its name. Course listing requests only IDs, names, and links. |
| `classroom.student-submissions.me.readonly` | Read accessible assignment posts and their materials. Google Console uses this name for the read-only permission also documented as `classroom.coursework.me.readonly`; both response names are accepted. No submissions endpoint is called. |
| `classroom.courseworkmaterials.readonly` | Read course materials. |
| `classroom.announcements.readonly` | Read announcement attachments. |
| `classroom.topics.readonly` | Read topic names to group files and select whole topics in the panel. |
| `drive.readonly` | Read metadata, original files, and Workspace exports for existing attachments. This scope grants broader Drive access than the extension uses; `drive.file` cannot read arbitrary existing course attachments. |

All are required for this implementation. Access tokens remain in background memory, expire, and are discarded when the extension unloads. No refresh token is retained, and the extension does not persist user tokens. Scan again to reconnect after expiry. Choose the correct account at the authorization prompt. API scopes are broader than a single course, but post and file requests are restricted to the matched course and its attachment IDs. Publishing a shared OAuth client may require Google's sensitive/restricted-scope verification and other reviews; see [Google authorization requirements](https://developers.google.com/workspace/classroom/guides/auth).

Topic grouping adds `classroom.topics.readonly` to the original five scopes. Topic-only consent and consent for all six scopes have succeeded in the isolated Firefox check described above. Topic headings organize the selection list only; they do not create ZIP subfolders. Announcements and unassigned posts appear under **No topic**. A file used by several topics appears in each group with synchronized checkboxes and is downloaded once.

## Installation

1. Download this repository as a ZIP and extract it, or clone your fork:
   ```sh
   git clone <your-fork-url> classroom-downloader
   cd classroom-downloader
   ```
2. Complete the OAuth setup above.
3. Open Firefox desktop and visit `about:debugging`.
4. Select **This Firefox** → **Load Temporary Add-on**.
5. Select this repository's `manifest.json`.
6. Open [Google Classroom](https://classroom.google.com/) and enter a course.

Temporary add-ons are removed when Firefox restarts. Reload them in `about:debugging` after editing source files, then reload Classroom. A permanent installation normally requires a signed XPI from Mozilla or a published Add-ons listing. This project currently provides neither; no badge implies an available release. Firefox desktop 140+ is the declared minimum; the actual supported release matrix awaits manual verification. Chrome and mobile Firefox are not supported targets.

## Usage

1. Open Google Classroom and navigate to the course's Stream or Classwork page.
2. Click the small gray download icon directly above the **?** help control. The panel shows the course name and a scan button.
3. Click **Scan course** and approve Google's read-only authorization when prompted.
4. Review the files grouped by Classroom topic. Use a topic checkbox to select or deselect its available files, or choose individual files. Restricted/unsupported files carry explanations.
5. Choose **Download selected** for checked files. To download everything available, tick **Select all available**. Each batch is saved as one uncompressed ZIP archive. Firefox asks once where to save that archive.
6. The ZIP contains the files under a sanitized course folder. The panel tracks file preparation separately from saved files; it counts files as saved only after Firefox reports the complete archive download.
7. When the batch finishes, the panel switches to a completion view. **Show in folder** locates a successfully saved ZIP. **Choose more files** returns to the existing scan with saved files deselected, and **Scan again** refreshes the course. For partial or failed batches, **Review failed files** selects eligible failed files for a new batch. Cancelling reports that nothing was saved and keeps your choices for retry.

You can switch course views or visit another course without losing your scan. Each course keeps its own results, file selections, panel state and saved ZIP reference in background memory. Active jobs continue while you navigate; return to the course to see progress or cancel. This memory survives page reloads and tab closures during the extension session, and clears when the extension reloads/unloads or Firefox restarts. No additional storage permission is requested. Cached scans can become outdated; use **Scan again** to refresh them. File permissions are rechecked before downloading.

Before scanning, the course name comes from Classroom's visible course breadcrumb and is cached per course; page titles are never used. A scan supplies the official API name. A task running in another course is indicated by a yellow notice.

> Screenshot placeholder: scan results, file review, and download progress.

The extension prepares archive contents with at most two files in flight and caps each file at **100 MiB** and each batch at **256 MiB**. Firefox's download API takes filenames relative to its default download folder, so the extension uses one Save As prompt for the batch archive instead of asking for an arbitrary folder for each file.

If cancelling during OAuth consent, close the Google authorization window yourself; Firefox exposes no API to close that flow. If you cancel Firefox's archive Save As prompt, the batch does not count any files as saved. Use **Cancel** to stop pending preparation or cancel an active archive download. Files count as saved only when Firefox reports that the archive finished; a cancelled or failed archive does not produce saved-file successes. Completed archives from earlier batches remain. Collapse with the close button or Escape; downloads continue while the page stays connected. Leaving the course, closing its tab, or refreshing aborts its job. Returning requires a fresh scan. Browser restart does not resume a batch. Firefox and managed browser policies retain control over download prompts and locations; the extension does not change preferences.

## Supported file types

| Classroom attachment | Saved format |
| --- | --- |
| Google Docs | PDF |
| Google Slides | PDF |
| Google Sheets | XLSX |
| PDF | Original PDF |
| Word, PowerPoint, Excel, OpenDocument | Original format |
| Images, ZIP archives, other ordinary Drive files | Original format |
| Google Forms, Drawings, Sites, Vids, folders, shortcuts | Unsupported; reported or skipped |
| YouTube, external links, third-party add-on attachments | Skipped |

## Limitations

- Coverage is limited to Drive attachments returned by published course materials, assignments, and announcements. No verified claim of every file in a course is made. Legacy About-page materials, links in text/comments, third-party add-ons, externally hosted files, folders and student submissions are excluded.
- No submission endpoints, rosters, grades, student profiles, or submission contents are read. The overlay can appear on these course views, but discovery always uses the same course attachment APIs. Assignment posts can themselves contain personal information authored by teachers; their text is not requested or saved.
- API access and Drive access are separate. Downloads may fail because of restrictions, revoked permission, administrator policy, quota, or unsupported exports. These restrictions are respected.
- Drive API Workspace exports have Google's size/format limits (including the documented 10 MB export limit); see [export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Rendering may differ from the editor.
- Files are fetched into bounded local memory before Firefox saves them. Each file is limited to **100 MiB**, with at most two in flight, and each ZIP batch is limited to **256 MiB** total. Larger files or batches must be split or downloaded manually. ZIPs are uncompressed and add no runtime dependency. Scan pagination stops on repeated tokens or beyond 1,000 pages per resource.
- This source repository does not include OAuth client metadata. Account selection and Google Cloud setup are mandatory; admin approval may prevent use entirely. Consent and token exchange were verified in Firefox 157 with a university account, and authenticated Classroom `courses.list` returned HTTP 200. A synthetic two-file batch exercised the Firefox save path and ZIP archive, but real Drive attachment fetching and course discovery have not been tested. The successful test does not establish the cause of the earlier `unknownerror` report.
- Navigation detection polls the URL twice per second. Unknown/private routes are excluded conservatively. A change to Classroom course URLs or API access rules may require an update; DOM attachment CSS changes do not affect discovery.
- Scan failure in any post resource aborts the scan, so it cannot silently claim complete coverage. Individual file metadata failures remain visible as unavailable files.
- A batch is saved as one ZIP with sanitized entries under a sanitized course folder; it is not sorted into topic folders. Extracted files are not individually saved to the chosen location, and Firefox may suffix an existing archive filename.
- A completed archive save means Firefox reported completion. This does not independently validate every document's contents. Synthetic ZIP creation and the Firefox save path were checked; the end-to-end path with real Drive attachments remains unverified.

## Project structure

| File | Responsibility |
| --- | --- |
| `manifest.json` | Firefox permissions, entry points, icons and CSP. |
| `src/content.js` | Page lifecycle, course navigation and messaging. |
| `src/classroom.js` | Course URL parsing, paginated post discovery and Drive ID deduplication. |
| `src/background.html` / `src/background.js` | Persistent module host, permission-aware API operations and Firefox completion/cancellation tracking. |
| `src/auth.js` / `src/config.js` | OAuth PKCE, session-only token handling and loading the public client ID plus ignored local Desktop client metadata. |
| `src/downloader.js` | Filename safety, format selection, bounded queue and retry rules. |
| `src/ui.js` / `src/styles.css` | Shadow DOM overlay, accessible controls, states and themes. |
| `icons/icon.svg` | Extension icon. |
| `tests/` | Native Node tests; no dependencies. |
| `docs/TESTING.md` | Manual Firefox and Google integration checklist. |

## Development

No build or npm installation is necessary. Edit the source and reload the extension.

With Node.js 20 or newer:

```sh
npm test
npm run check
```

Tests cover OAuth configuration loading, PKCE/state/scope validation, cancellation during consent, content-script navigation and stale messages, course routes, pagination, course isolation, attachment deduplication, file types, safe filenames, queue concurrency, failure reporting, retries and cancellation. They use mocks and do not contact Google. Firefox save-completion, interruption, and cancellation races are also exercised through mocks. They do **not** substitute for Firefox/OAuth integration tests. See [the manual checklist](docs/TESTING.md) and run it before publishing. To package, include `manifest.json`, `src/`, and `icons/` at the archive root, including the required `src/config.local.json` for the OAuth client used by that release. Exclude the downloaded `client_secret*.json` source file, tests, `.git`, and development files. The release metadata is extractable and is not confidential. A registered publisher-owned OAuth configuration and Mozilla review are separate release prerequisites.

## Permissions

| Manifest permission | Why it is needed |
| --- | --- |
| `downloads` | Start saves, observe completion, query extension-started IDs, cancel them, and show a saved ZIP in its containing folder when requested. The extension does not inspect unrelated download history. |
| `identity` | Open Google's authorization flow and receive its redirect. |
| `https://classroom.google.com/*` | Inject the overlay and read the originating tab's current Classroom URL to bind connections to the correct course after navigation. |
| `https://classroom.googleapis.com/*` | Read the selected course's published attachment resources. |
| `https://www.googleapis.com/*` | Read Drive metadata, download original content and export Workspace files. |
| `https://oauth2.googleapis.com/*` | Exchange an authorization code for a short-lived token. |

The manifest also declares required `authenticationInfo` and `websiteContent` data categories: OAuth codes/tokens and attachment identifiers are transmitted to Google to fulfill the requested scans/downloads. These are Firefox disclosure categories, not telemetry permissions. Firefox 140+ supplies the built-in installation consent; see [Mozilla data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

No `tabs`, `storage`, `cookies`, `webRequest`, `<all_urls>`, or scripting permission is requested. Google sign-in is opened through `identity`; no content script runs on the accounts site.

## Contributing

Issues and pull requests are welcome. Include Firefox/OS versions, the route type, steps to reproduce, and sanitized error messages. Never upload access tokens, client secrets, course IDs, student data or real course documents. Use synthetic fixtures. For a pull request, explain the behavior change and checks run; keep vanilla code and narrow permissions. Security reports should omit sensitive details from public issues and use a repository maintainer's private contact when available.

## Privacy

The extension reads the current course URL, course name, attachment IDs/names/types/permission metadata, and selected file contents. It sends authenticated requests directly to **Google** to retrieve that information and download files. OAuth opens Google's sign-in page; account passwords never enter the extension. The local `src/config.local.json` contains only installed-app client metadata, is ignored by Git, and is read during token exchange; it does not store account tokens. No information is sent to an extension server or a third party. Downloaded files remain on your filesystem; ephemeral scan results and access tokens stay in memory. The README badges are GitHub-page images and are never loaded by the extension.

The Google consent grant remains until revoked in your [Google account's third-party connections](https://myaccount.google.com/connections). Removing the extension discards its token memory; it does not automatically revoke that grant or delete downloaded files.

## License

[MIT](LICENSE). Independent project; not affiliated with Google or Mozilla.
