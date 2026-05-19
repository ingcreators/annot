// "Connect to Annot Cloud" modal.
//
// Annot Cloud is the hosted worker + D1 + R2 stack
// (`@ingcreators/annot-worker`). Auth is cookie-based: the worker
// runs the OAuth flow, sets an HttpOnly session cookie, and
// subsequent fetches with `credentials: "include"` carry it. The
// PWA never sees the token directly.
//
// Connect flow:
//   1. User clicks "Annot Cloud" in the sidebar.
//   2. This modal opens. The base URL field defaults to "" so the
//      worker is reached at the PWA's same origin (recommended
//      deploy — `annot.work/api/*` routed to the worker).
//   3. If the session cookie is already valid (returning visitor),
//      `init()` succeeds and the modal resolves with the store.
//   4. If init returns 401, the modal shows two buttons —
//      "Sign in with GitHub" / "Sign in with Google" — which open
//      a popup to the worker's OAuth start endpoint. While the
//      popup is open, the modal polls `/api/auth/me` every 1.5s
//      until success.
//
// Account-switch flow (`forcePicker: true`, fired by the sidebar's
// "Change cloud workspace" reselect icon):
//   - If a session already exists, render the management screen:
//     "Signed in as <name>" + Sign out button + provider buttons
//     framed as "Switch to <provider>". Picking a provider hits
//     `/api/auth/logout` first so the new OAuth callback mints a
//     clean session (avoids accumulating dead session records in
//     KV and prevents the worker from re-using the previous user's
//     workspace on re-auth).
//   - If no session exists, behave exactly like the first-time
//     flow above.
//
// Same-origin deploy is strongly recommended: it avoids
// third-party cookie issues (Safari ITP / Chrome 3P cookie
// phase-out) and CORS configuration. The "Advanced" disclosure
// lets self-hosters override the base URL.

import { AnnotCloudStore, type AuthMeWire } from "@ingcreators/annot-cloud-store";
import { StoragePermissionError } from "@ingcreators/annot-core/storage";
import {
  DEFAULT_CLOUD_BASE_URL,
  loadCloudBaseUrl,
  logoutCloudSession,
  saveCloudBaseUrl,
} from "./cloud-auth.js";

/** Discriminated result so the caller can distinguish a fresh
 *  connection from a deliberate sign-out (which needs to fall back
 *  to the browser store) from a cancellation (which leaves the
 *  existing storage untouched). */
export type CloudConnectResult =
  | { kind: "connected"; store: AnnotCloudStore }
  | { kind: "disconnected" }
  | { kind: "cancelled" };

export interface CloudConnectOptions {
  /** When true (fired by the sidebar's "Change cloud workspace"
   *  reselect icon), surface the account-management screen instead
   *  of silently auto-resolving on a still-valid cookie. Lets the
   *  user sign out or switch to a different account. */
  forcePicker?: boolean;
}

/**
 * Show the connect modal. Resolves with a discriminated result —
 * see `CloudConnectResult`.
 *
 * Does NOT call `attachMetadataCache` — the bridge wires the
 * shared cache before returning the store to the caller.
 */
export async function showCloudConnectDialog(
  opts: CloudConnectOptions = {},
): Promise<CloudConnectResult> {
  const forcePicker = !!opts.forcePicker;
  return new Promise((resolve) => {
    const { close, body } = openDialog(
      "Connect to Annot Cloud",
      "Sign in to save your screenshots and documents to the Annot Cloud workspace.",
    );

    let popup: Window | null = null;
    let pollTimer: number | null = null;
    let cancelled = false;
    /** Tracks whether the postMessage listener is currently
     *  registered so cleanup knows whether to detach it. */
    let messageListener: ((event: MessageEvent) => void) | null = null;

    function cleanup(): void {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      if (messageListener !== null) {
        window.removeEventListener("message", messageListener);
        messageListener = null;
      }
      // Best-effort popup close. Same-origin popups (the new
      // `/api/auth/success` terminal page already does
      // `window.close()` itself); cross-origin popups can refuse
      // — the user can dismiss them manually.
      try {
        popup?.close();
      } catch {
        /* ignore */
      }
      popup = null;
    }

    function settleConnected(store: AnnotCloudStore): void {
      if (cancelled) return;
      cleanup();
      close();
      resolve({ kind: "connected", store });
    }

    function settleDisconnected(): void {
      cleanup();
      close();
      resolve({ kind: "disconnected" });
    }

    function settleCancel(): void {
      cleanup();
      close();
      resolve({ kind: "cancelled" });
    }

    // ─── Initial UI ─────────────────────────────────────────────

    // Optional baseUrl field, hidden behind an "Advanced" toggle so
    // the common case is just "click and sign in".
    const lastBaseUrl = loadCloudBaseUrl();
    let baseUrl = lastBaseUrl ?? "";

    const status = document.createElement("div");
    status.className = "app-dialog-message";
    status.textContent = "";
    body.appendChild(status);

    // ─── Account management section (shown only when a session
    // already exists AND the caller asked for the picker, i.e. the
    // sidebar's reselect icon). Kept hidden by default; revealed by
    // `enterManagementMode()` after the existing-session probe
    // succeeds. ─────────────────────────────────────────────────
    const accountInfo = document.createElement("div");
    accountInfo.className = "app-dialog-message";
    accountInfo.style.display = "none";
    accountInfo.style.fontSize = "13px";
    accountInfo.style.marginTop = "4px";
    body.appendChild(accountInfo);

    const signinRow = document.createElement("div");
    signinRow.style.display = "flex";
    signinRow.style.gap = "8px";
    signinRow.style.justifyContent = "center";
    signinRow.style.marginTop = "12px";
    signinRow.style.flexWrap = "wrap";

    const githubBtn = makeProviderButton("Sign in with GitHub", () => {
      void startSignIn("github");
    });
    const googleBtn = makeProviderButton("Sign in with Google", () => {
      void startSignIn("google");
    });
    signinRow.append(githubBtn, googleBtn);
    body.appendChild(signinRow);

    // Sign-out button — only shown in management mode. Placed
    // below the provider row so the primary "Switch to …" action
    // stays the visual default; sign-out is the deliberate
    // secondary path.
    const signOutRow = document.createElement("div");
    signOutRow.style.display = "none";
    signOutRow.style.justifyContent = "center";
    signOutRow.style.marginTop = "8px";
    const signOutBtn = document.createElement("button");
    signOutBtn.type = "button";
    signOutBtn.className = "app-dialog-btn app-dialog-danger";
    signOutBtn.textContent = "Sign out of Annot Cloud";
    signOutBtn.addEventListener("click", () => {
      void runSignOut();
    });
    signOutRow.appendChild(signOutBtn);
    body.appendChild(signOutRow);

    // ─── Advanced disclosure ────────────────────────────────────

    const advancedToggle = document.createElement("button");
    advancedToggle.type = "button";
    advancedToggle.className = "app-dialog-link";
    advancedToggle.textContent = "Advanced — override base URL";
    advancedToggle.style.background = "transparent";
    advancedToggle.style.border = "none";
    advancedToggle.style.padding = "8px 0 0";
    advancedToggle.style.color = "inherit";
    advancedToggle.style.cursor = "pointer";
    advancedToggle.style.opacity = "0.7";
    advancedToggle.style.fontSize = "13px";
    body.appendChild(advancedToggle);

    const advancedRow = document.createElement("div");
    advancedRow.style.display = "none";
    advancedRow.style.marginTop = "8px";
    const advLabel = document.createElement("label");
    advLabel.textContent = "Worker base URL (leave blank for same-origin)";
    advLabel.style.display = "block";
    advLabel.style.fontSize = "13px";
    advLabel.style.marginBottom = "4px";
    const advInput = document.createElement("input");
    advInput.type = "url";
    advInput.placeholder = DEFAULT_CLOUD_BASE_URL;
    advInput.value = baseUrl;
    advInput.style.width = "100%";
    advInput.style.padding = "6px 8px";
    advInput.style.boxSizing = "border-box";
    advInput.addEventListener("input", () => {
      baseUrl = advInput.value.trim();
    });
    advancedRow.append(advLabel, advInput);
    body.appendChild(advancedRow);

    advancedToggle.addEventListener("click", () => {
      advancedRow.style.display = advancedRow.style.display === "none" ? "block" : "none";
    });

    // ─── Cancel button ──────────────────────────────────────────

    const cancelRow = document.createElement("div");
    cancelRow.className = "app-dialog-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "app-dialog-btn app-dialog-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", settleCancel);
    cancelRow.appendChild(cancelBtn);
    body.appendChild(cancelRow);

    // ─── Try the existing session first ─────────────────────────

    void tryExistingSession();

    async function tryExistingSession(): Promise<void> {
      status.textContent = "Checking existing session…";
      try {
        const store = await connectAndInit(baseUrl);
        if (forcePicker) {
          // The user came in via the reselect icon — they want to
          // see their options (sign out / switch account) instead
          // of being silently re-resolved into the same session.
          // Fetch the user identity so the dialog can show
          // "Signed in as …". A 401 here would mean the session
          // expired between `init()` and now (essentially
          // impossible); the management-mode renderer treats a
          // null user as "unknown account" without breaking the
          // flow.
          let me: AuthMeWire | null = null;
          try {
            me = await fetchAuthMe(baseUrl);
          } catch {
            /* show management mode without the identity line */
          }
          enterManagementMode(me);
        } else {
          settleConnected(store);
        }
      } catch (err) {
        if (err instanceof StoragePermissionError) {
          status.textContent = "Not signed in. Pick a provider below.";
          status.style.color = "";
        } else {
          // Cleaner copy than "Unexpected token '<' …" parse-error
          // noise. The dev server returns the SPA HTML when no
          // worker route binding is configured, which trips
          // JSON.parse — easy to mistake for a "broken" UI.
          status.textContent =
            "Could not reach the worker. Set the base URL under Advanced or check your deployment.";
          status.style.color = "var(--annot-error, #c00)";
        }
      }
    }

    /** Show the "signed in as X / sign out / switch to <provider>"
     *  view. Called only when `forcePicker` is true AND the
     *  existing session is valid. */
    function enterManagementMode(me: AuthMeWire | null): void {
      status.textContent = "You're already signed in to Annot Cloud.";
      status.style.color = "";
      const who = me?.user;
      if (who) {
        const provider = who.provider === "github" ? "GitHub" : "Google";
        const name = who.name || who.login || provider;
        accountInfo.textContent = `Signed in as ${name} (via ${provider}).`;
      } else {
        accountInfo.textContent = "Signed in.";
      }
      accountInfo.style.display = "";
      // Re-label provider buttons so the picker reads as
      // "switch", not "sign in again into the same account".
      githubBtn.textContent = "Switch to GitHub account";
      googleBtn.textContent = "Switch to Google account";
      signOutRow.style.display = "flex";
    }

    /** Sign out and bail. Clears the worker-side session cookie,
     *  forgets the persisted base URL, and resolves the dialog
     *  with `disconnected` so the caller can fall back to the
     *  browser store. */
    async function runSignOut(): Promise<void> {
      status.textContent = "Signing out…";
      status.style.color = "";
      // Disable buttons so the user can't double-fire mid-fetch.
      githubBtn.disabled = true;
      googleBtn.disabled = true;
      signOutBtn.disabled = true;
      try {
        await logoutCloudSession(baseUrl);
      } catch {
        /* best-effort */
      }
      settleDisconnected();
    }

    // ─── OAuth popup + polling ──────────────────────────────────

    async function startSignIn(provider: "github" | "google"): Promise<void> {
      // Make sure no stale popup / poll timer is left over from a
      // prior provider click in the same dialog session.
      cleanup();
      cancelled = false;

      // Strip trailing slashes without a polynomial-regex shape
      // (CodeQL flagged the `replace(/\/+$/, "")` pattern as a
      // theoretical ReDoS risk).
      let effectiveBase = baseUrl;
      while (effectiveBase.endsWith("/")) effectiveBase = effectiveBase.slice(0, -1);

      // If we're in management mode, log out first so the new
      // OAuth callback mints a clean session record instead of
      // leaving the previous user's session lingering in KV.
      // Same effect as the user clicking "Sign out" then a
      // provider button, but in one gesture so the popup still
      // counts as user-initiated and isn't popup-blocked.
      const wasManaging = signOutRow.style.display !== "none";
      if (wasManaging) {
        try {
          await logoutCloudSession(effectiveBase);
        } catch {
          /* best-effort */
        }
        // Hide management UI now that the session is gone — if
        // the OAuth popup ends up cancelled, we'll surface the
        // plain "Not signed in" message via the poll fallthrough.
        accountInfo.style.display = "none";
        signOutRow.style.display = "none";
        githubBtn.textContent = "Sign in with GitHub";
        googleBtn.textContent = "Sign in with Google";
      }

      const oauthUrl = `${effectiveBase}/api/auth/${provider}`;
      popup = window.open(
        oauthUrl,
        "annot-cloud-oauth",
        "width=560,height=720,menubar=no,toolbar=no",
      );
      if (!popup) {
        status.textContent = "Popup was blocked. Allow popups for this site and try again.";
        status.style.color = "var(--annot-error, #c00)";
        return;
      }
      status.style.color = "";
      status.textContent = `Waiting for ${provider === "github" ? "GitHub" : "Google"} sign-in…`;

      // postMessage handshake — the worker-served terminal page
      // at `/api/auth/success` posts a message to its opener
      // when OAuth completes. Same-origin (under the
      // `annot.work/api/*` route binding) so the origin check
      // here is precise. Receiving the message short-circuits
      // the polling delay: we retry `/api/auth/me` immediately
      // instead of waiting up to 1.5s.
      //
      // Polling stays in place as the fallback: cross-origin
      // self-hosted deploys, blocked popup-message channels, or
      // an older worker without the success page all still get
      // resolved by the timer.
      const expectedOrigin = effectiveBase || window.location.origin;
      messageListener = (event) => {
        if (event.origin !== expectedOrigin) return;
        const data = event.data;
        if (
          data == null ||
          typeof data !== "object" ||
          (data as { type?: unknown }).type !== "annot-cloud-auth-complete"
        ) {
          return;
        }
        // Run the same connect-and-settle logic the poller
        // runs. Race against the timer is harmless — `settle`
        // and `cleanup` are idempotent guards.
        void (async () => {
          try {
            const store = await connectAndInit(baseUrl);
            settleConnected(store);
          } catch {
            // Fall through — the poll timer will catch it on the
            // next tick if the session genuinely landed, or surface
            // the failure if it didn't.
          }
        })();
      };
      window.addEventListener("message", messageListener);

      // Poll both `popup.closed` and `/api/auth/me` every 1.5s.
      // `closed` is the user-cancel signal; `me` is the success
      // signal once the cookie lands. First to fire wins.
      pollTimer = window.setInterval(async () => {
        if (cancelled) return;
        // If the popup is closed and we still don't have a
        // session, surface the failure.
        const popupClosed = !popup || popup.closed;
        try {
          const store = await connectAndInit(baseUrl);
          // Success! Close the popup if it's still around.
          settleConnected(store);
        } catch (err) {
          if (err instanceof StoragePermissionError) {
            if (popupClosed) {
              status.textContent = "Sign-in window closed before completing. Try again?";
              cleanup();
            }
            // Else: keep polling — the user is still in OAuth.
          } else {
            status.textContent = `Connection error: ${(err as Error).message}`;
            status.style.color = "var(--annot-error, #c00)";
            cleanup();
          }
        }
      }, 1500);
    }
  });
}

/** Construct a store, call `init()`, return on success. Throws
 *  the StoragePermissionError unchanged so the caller's polling
 *  loop can distinguish "still signing in" from a real failure. */
async function connectAndInit(baseUrl: string): Promise<AnnotCloudStore> {
  const store = new AnnotCloudStore({ baseUrl });
  await store.init();
  // Persist the base URL so the next reload's `restoreAnnotCloud`
  // finds it without prompting.
  saveCloudBaseUrl(baseUrl);
  return store;
}

/** Fetch `/api/auth/me` directly so the management view can show
 *  "Signed in as …" without needing the store to expose the user
 *  identity it already cached in `init()`. Throws on non-200. */
async function fetchAuthMe(baseUrl: string): Promise<AuthMeWire> {
  let effectiveBase = baseUrl;
  while (effectiveBase.endsWith("/")) effectiveBase = effectiveBase.slice(0, -1);
  const res = await fetch(`${effectiveBase}/api/auth/me`, {
    method: "GET",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`auth/me returned ${res.status}`);
  }
  return (await res.json()) as AuthMeWire;
}

// ─── Tiny dialog primitives (mirrors github-setup-ui.ts) ──────

interface OpenedDialog {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

function openDialog(title: string, message?: string): OpenedDialog {
  const overlay = document.createElement("div");
  overlay.className = "app-dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "app-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  const t = document.createElement("div");
  t.className = "app-dialog-title";
  t.textContent = title;
  dialog.appendChild(t);
  if (message) {
    const m = document.createElement("div");
    m.className = "app-dialog-message";
    m.textContent = message;
    dialog.appendChild(m);
  }
  const body = document.createElement("div");
  body.className = "app-dialog-body";
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return {
    root: dialog,
    body,
    close: () => {
      try {
        overlay.remove();
      } catch {
        /* ignore */
      }
    },
  };
}

function makeProviderButton(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "app-dialog-btn app-dialog-primary";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}
