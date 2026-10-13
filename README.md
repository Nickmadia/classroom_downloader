# Classroom Downloader

**Your course files, together.** A small Firefox extension that downloads accessible Google Classroom attachments into a course folder.

![License: MIT](https://img.shields.io/badge/license-MIT-green) ![Dependencies: zero](https://img.shields.io/badge/dependencies-zero-blue)

> Screenshot placeholder: floating button and expanded course panel in Google Classroom. No screenshot is included because the signed-in interface has not yet been tested.

[Setup](#google-authorization-setup) · [Installation](#installation) · [Usage](#usage) · [Limitations](#limitations) · [Development](#development) · [Privacy](#privacy)

## Features

- Floating panel inside Classroom, with Shadow DOM style isolation.
- Course detection across stream/classwork navigation; hidden on home, People, and assignment detail/submission pages.
- Official, paginated discovery of materials, assignments, and announcements, including attachments under topics without expanding them.
- Drive ID deduplication and permission checks before downloading.
- Docs and Slides exported to PDF; Sheets to XLSX; ordinary Drive files preserved.
- Two concurrent downloads, bounded retries for transient API errors, cancellation, and per-file failure details.
- Sanitized course folders, Firefox completion tracking, keyboard controls, and system light/dark themes.
- Vanilla JavaScript, no runtime dependencies, no build step, no analytics.

**Verification status:** automated logic tests pass. Live Google OAuth, Classroom integration, and Firefox downloads have **not** been verified in a signed-in browser. This is a complete implementation awaiting that integration validation, not a verified release. No signed package or published add-on currently exists.

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
5. Put its client ID in `src/config.js`. If your installed-app client requires its client secret for token exchange, enter that optional value too. Installed-app client configuration cannot be kept confidential; never insert a Web-application secret or Google account password. Do not commit your local configuration.
6. Reload the temporary extension. Open a course, click **Scan course**, and explicitly authorize the account used for that Classroom course.

The extension uses Firefox's supported `http://127.0.0.1/mozoauth2/<extension-derived-subdomain>` redirect. Firefox intercepts this redirect; there is no local HTTP server. The exact Google-client/Firefox loopback combination still needs live validation. A `redirect_uri_mismatch` is an integration failure to investigate, not a reason to use deprecated out-of-band flows or bypass Google policy.

Requested Google scopes:

| Scope suffix (under `https://www.googleapis.com/auth/`) | Purpose |
| --- | --- |
| `classroom.courses.readonly` | Match the current UI course to its API `alternateLink` and retrieve its name. Course listing requests only IDs, names, and links. |
| `classroom.coursework.me.readonly` | Read accessible assignment posts and their materials. No submissions endpoint is called. |
| `classroom.courseworkmaterials.readonly` | Read course materials. |
| `classroom.announcements.readonly` | Read announcement attachments. |
| `drive.readonly` | Read metadata, original files, and Workspace exports for existing attachments. This scope grants broader Drive access than the extension uses; `drive.file` cannot read arbitrary existing course attachments. |

All are required for this implementation. Tokens remain in background memory, expire, and are discarded when the extension unloads. No refresh token is retained. Scan again to reconnect after expiry. Choose the correct account at the authorization prompt. API scopes are broader than a single course, but post and file requests are restricted to the matched course and its attachment IDs. Publishing a shared OAuth client may require Google's sensitive/restricted-scope verification and other reviews; see [Google authorization requirements](https://developers.google.com/workspace/classroom/guides/auth).

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
2. Click the floating **↓** button in the bottom-right corner.
3. Click **Scan course** and approve Google's read-only authorization when prompted.
4. Review the file counts and expandable file list. Restricted/unsupported files carry explanations.
5. Click **Download all**. The panel shows files processed, saved, failed, and remaining. Progress counts files, not bytes.
6. Find files under `Classroom Downloader/<course name> (<course ID>)/` inside Firefox's default download directory.

> Screenshot placeholder: scan results, file review, and download progress.

If cancelling during OAuth consent, close the Google authorization window yourself; Firefox exposes no API to close that flow. A native Save As dialog must also be dismissed manually if Firefox has not yet returned a download ID. Use **Cancel** to stop pending work, abort API requests, and cancel active Firefox downloads. Completed files remain. Collapse with the close button or Escape; downloads continue while the page stays connected. Leaving the course, closing its tab, or refreshing aborts its job. Returning requires a fresh scan. Browser restart does not resume a batch. Pressing Download all again starts a new batch; Firefox uniquifies existing names rather than overwriting them. Firefox and managed browser policies retain control over download prompts and locations; the extension does not change preferences.

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
- No submission endpoints, rosters, grades, student profiles, or private submission pages are read. Assignment posts can themselves contain personal information authored by teachers; their text is not requested or saved.
- API access and Drive access are separate. Downloads may fail because of restrictions, revoked permission, administrator policy, quota, or unsupported exports. These restrictions are respected.
- Drive API Workspace exports have Google's size/format limits (including the documented 10 MB export limit); see [export guidance](https://developers.google.com/workspace/drive/api/guides/manage-downloads). Rendering may differ from the editor.
- Files are fetched into bounded local memory before Firefox saves them. Each file is limited to **100 MiB**, with at most two in flight. Larger files must be downloaded manually. Scan pagination stops on repeated tokens or beyond 1,000 pages per resource.
- No OAuth client is bundled. Account selection and Google Cloud setup are mandatory; admin approval may prevent use entirely. OAuth and download integration are unverified here.
- Navigation detection polls the URL twice per second. Unknown/private routes are excluded conservatively. A change to Classroom course URLs or API access rules may require an update; DOM attachment CSS changes do not affect discovery.
- Scan failure in any post resource aborts the scan, so it cannot silently claim complete coverage. Individual file metadata failures remain visible as unavailable files.
- A completed save means Firefox reported completion. This does not independently validate every document's contents.
- Safe names can collide; Firefox adds a suffix. Files are not sorted into topic folders.

## Project structure

| File | Responsibility |
| --- | --- |
| `manifest.json` | Firefox permissions, entry points, icons and CSP. |
| `src/content.js` | Page lifecycle, course navigation and messaging. |
| `src/classroom.js` | Course URL parsing, paginated post discovery and Drive ID deduplication. |
| `src/background.html` / `src/background.js` | Persistent module host, permission-aware API operations and Firefox completion/cancellation tracking. |
| `src/auth.js` / `src/config.js` | OAuth PKCE, session-only token handling and public client configuration. |
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

Tests cover OAuth PKCE/state/scope validation, cancellation during consent, content-script navigation and stale messages, course routes, pagination, course isolation, attachment deduplication, file types, safe filenames, queue concurrency, failure reporting, retries and cancellation. They use mocks and do not contact Google. Firefox save-completion, interruption, and cancellation races are also exercised through mocks. They do **not** substitute for Firefox/OAuth integration tests. See [the manual checklist](docs/TESTING.md) and run it before publishing. To package, include `manifest.json`, `src/`, and `icons/` at the archive root; exclude local secrets, tests, `.git`, and development files. A registered publisher-owned OAuth configuration and Mozilla review are separate release prerequisites.

## Permissions

| Manifest permission | Why it is needed |
| --- | --- |
| `downloads` | Start saves, observe completion, query extension-started IDs and cancel them. The extension does not inspect unrelated download history. |
| `identity` | Open Google's authorization flow and receive its redirect. |
| `https://classroom.google.com/*` | Inject the overlay on Classroom only. |
| `https://classroom.googleapis.com/*` | Read the selected course's published attachment resources. |
| `https://www.googleapis.com/*` | Read Drive metadata, download original content and export Workspace files. |
| `https://oauth2.googleapis.com/*` | Exchange an authorization code for a short-lived token. |

The manifest also declares required `authenticationInfo` and `websiteContent` data categories: OAuth codes/tokens and attachment identifiers are transmitted to Google to fulfill the requested scans/downloads. These are Firefox disclosure categories, not telemetry permissions. Firefox 140+ supplies the built-in installation consent; see [Mozilla data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

No `tabs`, `storage`, `cookies`, `webRequest`, `<all_urls>`, or scripting permission is requested. Google sign-in is opened through `identity`; no content script runs on the accounts site.

## Contributing

Issues and pull requests are welcome. Include Firefox/OS versions, the route type, steps to reproduce, and sanitized error messages. Never upload access tokens, client secrets, course IDs, student data or real course documents. Use synthetic fixtures. For a pull request, explain the behavior change and checks run; keep vanilla code and narrow permissions. Security reports should omit sensitive details from public issues and use a repository maintainer's private contact when available.

## Privacy

The extension reads the current course URL, course name, attachment IDs/names/types/permission metadata, and selected file contents. It sends authenticated requests directly to **Google** to retrieve that information and download files. OAuth opens Google's sign-in page; account passwords never enter the extension. No information is sent to an extension server or a third party. Downloaded files remain on your filesystem; ephemeral scan results and tokens stay in memory. The README badges are GitHub-page images and are never loaded by the extension.

The Google consent grant remains until revoked in your [Google account's third-party connections](https://myaccount.google.com/connections). Removing the extension discards its token memory; it does not automatically revoke that grant or delete downloaded files.

## License

[MIT](LICENSE). Independent project; not affiliated with Google or Mozilla.
