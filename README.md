# MCN Wedding Day Plan

Development upgrade of the uploaded Wedding Day Plan. The original prototype remains in Git history and on `main` until this branch is reviewed and merged.

## What this branch implements

- Firebase email/password accounts, email verification and individual staff permissions.
- Couples see only active weddings linked to their verified email. Staff see all venues.
- Firestore shared records with live updates. No local-storage database or embedded admin password.
- Authenticated Netlify API for every write. Firestore rules prohibit direct browser writes, including staff writes.
- Revision checks reject stale edits. Failed saves keep the form open. No offline write queue.
- Server-side checks for guest meals, RSVPs, seats and menu options before signing.
- Atomic submission and locking. Staff must reopen with a reason before editing submitted details.
- Automatic pre-change versions in the same transaction as each save, with actor, time, action and reason. Staff can restore previous versions or download a wedding JSON backup. Restores retain the current access list and return the wedding to draft.
- Recoverable archive instead of permanent deletion.
- Staff overview, guest CSV export with spreadsheet-formula escaping, printable kitchen quantities and table-by-table service sheets.
- Original Shotton, Parlour and Marshall menus retained. No new venue menus have been invented.

## Deployment status

This is a **development branch**, not an activated live service. There is no Firebase project or server credential in this repository. The application deliberately shows a setup screen until configuration exists. No demo access code bypass exists in this version.

The earlier ChatGPT-hosted static preview remains the original prototype. This branch targets Netlify because its server functions are needed. Uploading only `index.html`, or publishing this branch as a static-only Site, will not activate it.

## Firebase and Netlify setup

Use a separate Firebase project for wedding records rather than broadening access to another MCN application's data.

1. Create a Firebase project and register a Web app. Enable Email/Password in Authentication. Set the password policy to at least 12 characters. Add the intended Netlify domain and custom domain under Authentication's authorised domains. Enable email-enumeration protection. Configure verification/reset email branding.
2. Create Cloud Firestore in a UK/EU region chosen for this project. Start with restrictive rules. This implementation uses Firebase Auth and Firestore, not Firebase Cloud Functions.
3. Run `npm ci`, then deploy **both rules and indexes** to that exact project:
   ```sh
   npx firebase deploy --only firestore:rules,firestore:indexes --project YOUR_PROJECT_ID
   ```
4. Connect a development/branch deployment on Netlify to this branch. The build settings are in `netlify.toml`. Do not switch the production branch until the acceptance checks below pass.
5. Configure these environment variables in Netlify's protected environment settings, scoped to Functions and to the intended deployment contexts:
   - `FIREBASE_WEB_CONFIG`: the Web app configuration JSON with `apiKey`, `authDomain`, `projectId`, `appId`. This is public configuration, not an admin credential.
   - `FIREBASE_SERVICE_ACCOUNT`: service-account JSON for **this wedding project only**, with the permissions required for Firebase Admin Authentication and Firestore. Never put it in source, HTML, a commit, a downloadable file, or chat. Store it directly in the hosting environment. Use separate development and production projects if both are active.
6. Redeploy the development build. `/api/config` should return only public Web configuration. Verify login, email verification and Firestore access.
7. Create and verify the first staff account through the app. In a trusted local shell, provide `FIREBASE_SERVICE_ACCOUNT` securely through the environment, then run:
   ```sh
   npm run staff -- staff@example.com grant
   ```
   Sign in again to refresh the staff claim. To revoke, use `revoke`. The script preserves other claims and revokes refresh tokens. Direct Firestore reads use Firebase's ID-token lifetime, so already-issued read tokens may remain usable until expiry. API writes check revocation on every request.
8. Staff add weddings and the couple's one or two email addresses. Each partner creates and verifies their own account with the matching address. Account registration alone grants no wedding access. The app does not send invitations automatically.

No paid Firebase plan is deliberately enabled by this code. Check current Firebase and Netlify quotas before launch. Netlify functions and deployment usage remain subject to the hosting account's limits.

## Validation

```sh
npm test
npm run test:rules
npm run build
```

The Firestore emulator suite requires Java 21 and downloads Google's emulator. It uses the isolated `demo-mcn-wedding` project, never a live project. Unit/API tests use in-memory test records and require no credentials. Rules tests prove the access policy in the emulator, not the deployed Firebase configuration.

The build copies only `public/` and `index.html` into `dist/`. Server code, tests, credentials and package metadata are not part of the static publish directory. Netlify separately bundles `netlify/functions/api.mjs` and its imports.

## Required live acceptance checks

Before merging/deploying to production:

- Sign in as staff and as two different verified couples. Confirm each couple sees only their own wedding, including after refresh and direct API attempts.
- Verify a third unrelated account and an unverified account have no wedding access.
- Open the same wedding on two devices. Save on one, then attempt to submit a form opened earlier on the other. Expect a conflict, not an overwrite.
- Add/edit/bulk-add guests, change adult/child/vegan choices, remove tables, export CSV, and print on tablet/mobile and desktop.
- Complete meal choices and seats, sign, submit, reload, and confirm all writes are blocked until staff reopen with a reason.
- Reopen, edit, restore a previous version and archive/unarchive. Verify the history and signed snapshot remain available.
- Disconnect the network during a save. Confirm no false success and retry after reconnecting.
- Check that deployed rules match this repository, the API verifies tokens for the same project, and both Netlify environment values refer to that project.

## Data and recovery limits

Version history protects against accidental edits in this application. It is stored in the same Firebase project and is **not** independent disaster recovery. A downloaded JSON backup is a manual offline copy. Scheduled independent backups, a retention policy, and a verified full-project recovery procedure remain launch follow-up work.

Old browser-only records are not uploaded automatically. The ZIP contains code, not the data held in browsers. Preserve any real records separately before migration. A supported legacy import is not included in this branch.

Current scope does not include reminder emails, a staff menu editor, Gibraltar Rock menus, payments or guest self-service invitations.

## References

- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Staff roles with custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

## Planning checklist and isolated demo

`/demo.html` opens an explicitly labelled fictional wedding without Firebase. All changes remain in memory and reset on refresh. Staff/couple switching exercises the same pure transition rules as the API, without granting real access or writing records. Printed demo sheets are labelled fictional.

The planning checklist links to pending RSVPs, missing meal choices and unseated guests. Guest search covers names, tables, meals and dietary notes. Group seating rejects non-attending guests, locked weddings and capacity overflow. Guest rows use a stacked layout on small screens.

Validation: 36 domain, API and planning tests pass. Browser checks cover checklist filtering, guest search and assigning two guests together. Live Firebase login and cross-device acceptance testing remain pending configuration.
