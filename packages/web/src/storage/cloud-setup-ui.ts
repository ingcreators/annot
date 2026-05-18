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
// Same-origin deploy is strongly recommended: it avoids
// third-party cookie issues (Safari ITP / Chrome 3P cookie
// phase-out) and CORS configuration. The "Advanced" disclosure
// lets self-hosters override the base URL.

import { AnnotCloudStore } from "@ingcreators/annot-cloud-store";
import { StoragePermissionError } from "@ingcreators/annot-core/storage";
import { DEFAULT_CLOUD_BASE_URL, loadCloudBaseUrl, saveCloudBaseUrl } from "./cloud-auth.js";

/**
 * Show the connect modal. Resolves with a ready-to-use store on
 * success, or `null` when the user cancelled.
 *
 * Does NOT call `attachMetadataCache` — the bridge wires the
 * shared cache before returning the store to the caller.
 */
export async function showCloudConnectDialog(): Promise<AnnotCloudStore | null> {
  return new Promise((resolve) => {
    const { close, body } = openDialog(
      "Connect to Annot Cloud",
      "Sign in to save your screenshots and documents to the Annot Cloud workspace.",
    );

    let popup: Window | null = null;
    let pollTimer: number | null = null;
    let cancelled = false;

    function cleanup(): void {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearInterval(pollTimer);
        pollTimer = null;
      }
      // Best-effort popup close. Cross-origin popups can refuse
      // (browser blocks `popup.close()` after a navigation to a
      // different origin); the user can dismiss them manually.
      try {
        popup?.close();
      } catch {
        /* ignore */
      }
      popup = null;
    }

    function settle(store: AnnotCloudStore | null): void {
      if (cancelled) return;
      cleanup();
      close();
      resolve(store);
    }

    function settleCancel(): void {
      cleanup();
      close();
      resolve(null);
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

    const signinRow = document.createElement("div");
    signinRow.style.display = "flex";
    signinRow.style.gap = "8px";
    signinRow.style.justifyContent = "center";
    signinRow.style.marginTop = "12px";

    const githubBtn = makeProviderButton("Sign in with GitHub", () => {
      void startSignIn("github");
    });
    const googleBtn = makeProviderButton("Sign in with Google", () => {
      void startSignIn("google");
    });
    signinRow.append(githubBtn, googleBtn);
    body.appendChild(signinRow);

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
        settle(store);
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
          settle(store);
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
