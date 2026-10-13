# Development

The extension loads directly from source. It uses vanilla JavaScript, Shadow DOM, a persistent Firefox Manifest V2 background page, and official Google APIs. No build step or runtime dependencies are required.

## Files

| File | Responsibility |
| --- | --- |
| `manifest.json` | Permissions, entry points and content security policy. |
| `src/content.js` | Page lifecycle, course navigation and messaging. |
| `src/classroom.js` | Course breadcrumbs/routes, paginated discovery, topics and deduplication. |
| `src/background.js` / `src/background.html` | API requests, course sessions and Firefox download tracking. |
| `src/auth.js` / `src/config.js` | OAuth PKCE and local client configuration. |
| `src/downloader.js` | Safe filenames, export formats, bounded queue and retries. |
| `src/archive.js` | ZIP creation without dependencies. |
| `src/ui.js` / `src/styles.css` | Overlay, selection, progress and completion views. |
| `tests/` | Native Node tests with synthetic data and mocks. |
| `tools/test-oauth-consent.mjs` | Standalone local consent diagnostic. |

## Checks

Requires Node.js 20 or newer:

```sh
npm test
npm run check
```

After editing source, reload the add-on in `about:debugging` and refresh Classroom. Automated mocks do not replace Firefox integration checks; use the [manual checklist and verification record](TESTING.md).

Prefer straightforward functions and narrow permissions. Use synthetic fixtures in tests and bug reports. Never commit OAuth metadata, tokens, student information, or course documents.

## Behavior

The scanner reads published assignment, material and announcement attachments with pagination. It never calls roster, grades or submission endpoints. Topic grouping affects the interface only. Download preparation rechecks file permissions, exports Workspace documents, and builds one uncompressed ZIP with at most two files in flight.

The background keeps separate course sessions in memory. Connections validate their course against the browser’s current tab URL because Firefox can retain the original sender URL after Classroom navigation. URL families `/c/`, `/w/` and `/r/` identify Stream, Classwork and People views. Active jobs continue when a panel disconnects; state clears when the extension unloads.

Firefox completion, rather than queue acceptance, determines download success. The downloads permission also reveals the saved ZIP on explicit user request. The manifest’s `authenticationInfo` and `websiteContent` declarations describe the data sent to Google for authorization and file access; they are Firefox disclosure categories, not telemetry permissions.

## Releases

A permanent Firefox release requires Mozilla signing. A shared Google OAuth client may require Google verification separately. Neither is implied by a passing test suite.

Package `manifest.json`, `src/`, and `icons/` at the archive root. Include the local Desktop configuration required by the release client; installed-app metadata in a package is extractable. Exclude downloaded source credential JSON, `.git`, tests and development tools. Keep local metadata out of Git, and follow the [OAuth setup guide](SETUP.md).
