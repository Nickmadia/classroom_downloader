# Google OAuth setup

Classroom Downloader uses the official Classroom and Drive APIs. Scanning requires explicit Google authorization, even when you are already signed into Classroom.

## Configure your client

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **Google Classroom API** and **Google Drive API**.
3. Configure Google Auth Platform. If your app is in **Testing**, add the Classroom account you will use as a test user. Workspace administrators may need to approve the app.
4. Add the read-only scopes listed below under **Data access**.
5. Create an OAuth client with application type **Desktop app** and download its JSON configuration.
6. Put that client’s public ID in `src/config.js`. Create `src/config.local.json` with the matching Desktop client metadata:

```json
{
  "clientId": "same client ID as src/config.js",
  "clientSecret": "client secret from the downloaded Desktop client JSON"
}
```

The tested Desktop client requires this secret during token exchange. The downloaded `client_secret*.json` and `src/config.local.json` are ignored by Git; do not force-add them. The public client ID is safe to commit. Installed-app metadata is extractable when packaged and cannot be treated as confidential. Never use a Web-application client secret or account password here.

Reload the extension, open a course, and click **Scan course**. Choose the account that has access to that course and approve the requested permissions.

## Requested scopes

Every scope below starts with `https://www.googleapis.com/auth/`.

| Scope | Purpose |
| --- | --- |
| `classroom.courses.readonly` | Match the current course and retrieve its name. |
| `classroom.student-submissions.me.readonly` | Read accessible assignment posts and attachments; no submissions endpoint is called. The legacy `classroom.coursework.me.readonly` response name is also accepted. |
| `classroom.courseworkmaterials.readonly` | Read course materials. |
| `classroom.announcements.readonly` | Read announcement attachments. |
| `classroom.topics.readonly` | Retrieve topic names. |
| `drive.readonly` | Read and export existing Drive attachments. This permission is broader than the attachment access the extension uses. |

The extension uses the installed-app authorization-code flow with PKCE and Firefox’s intercepted loopback redirect. It does not run an application server, store passwords, or retain refresh tokens. Access tokens expire; scan again to reconnect.

Scopes can cover multiple courses, but attachment requests are restricted to the selected course. Publishing a shared client may require Google verification; Workspace policy can still restrict access. See [Google authorization guidance](https://developers.google.com/workspace/classroom/guides/auth).

## Troubleshooting

- **Course not found:** select the same account used in Classroom.
- **App blocked in Testing:** confirm that account is listed as a test user.
- **Missing client secret:** check the local configuration and ensure its ID matches `src/config.js`.
- **Authorization cancelled:** close the Google window before retrying. Cancelling a scan cannot close that window automatically.
- **Generic Google error:** see the [OAuth diagnostics](TESTING.md#investigating-a-google-consent-error). The error alone does not establish its cause.

Return to the [installation instructions](../README.md#installation).
