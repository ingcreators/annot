# Sign in

The PWA works fully offline — you can use it without signing in.
Sign-in is required only when you want cloud sync.

## GitHub sign-in

Click **Sign in with GitHub** in the top-right of the PWA.

1. The PWA opens a popup at `annot.work/api/auth/github/start`.
2. GitHub asks you to authorise the `Annot` OAuth app.
3. On approval, the popup closes and the PWA reloads with your
   account active.

The OAuth app requests **only public scopes** for sign-in —
your email and your username. GitHub repo access (for the
`GitHubStore` storage backend) is a separate, optional grant.

## Google sign-in

Same flow; click **Sign in with Google**. The OAuth scope is
`openid email profile` — no Drive access by default.

Granting Drive access (for the `GoogleDriveStore` backend) is
separate; the PWA asks for the `drive.file` scope only when you
explicitly switch to that backend.

## Sign out / switch accounts

The settings dialog has a **Sign out** action. Signing out
removes the worker-side session cookie; your locally-stored
annotations stay on the device.

To switch accounts, sign out and sign in again with a different
identity.

## What we store

When you sign in we store, on the worker side:

- Your GitHub or Google account id (numeric).
- Your display name and email (for the in-app account chip).
- An opaque session token in an HTTP-only cookie.

No screenshots, annotations, or browsing data are uploaded until
you explicitly use a cloud storage backend or generate a share
link.

See the [`/privacy`](https://annot.work/privacy) page for the
full disclosure.
