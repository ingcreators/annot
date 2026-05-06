/**
 * Browse window renderer — Phase 6 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Wires the chrome (address bar, nav buttons, capture toolbar)
 * to the embedded `<webview>` that loads the user-navigated URL.
 * Visible capture goes through `browse.captureVisible` IPC: the
 * main process receives the webview's `webContentsId` and calls
 * `webContents.capturePage()` on it, returning a PNG data URL.
 *
 * **Phase 6 minimum-viable scope.** Single tab. Visible mode
 * only. Captures save into `<userData>/library/Inbox/` via the
 * `browse.persistVisible` IPC (which writes the PNG plus a JSON
 * sidecar through Node fs). Multi-tab + Area / Full-Page /
 * Per-Page / Click / Hotkey modes are deferred to a follow-up
 * that lands the `@ingcreators/annot-capture` package extraction
 * (`docs/plans/desktop-browser-mode.md` Phase 1).
 */

interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

interface CaptureVisibleResult {
  /** PNG data URL of the visible viewport. */
  data_url: string;
  width: number;
  height: number;
}

interface PersistVisibleResult {
  /** Library-relative path of the saved file. */
  path: string;
}

const ELECTRON_API_KEY = "electronAPI" as const;

function api(): ElectronApi {
  const electronAPI = (window as unknown as Record<string, unknown>)[ELECTRON_API_KEY];
  if (!electronAPI) {
    throw new Error(
      "[browse] window.electronAPI is missing — preload script not loaded?",
    );
  }
  return electronAPI as ElectronApi;
}

const HOME_URL = "about:blank";

interface BrowseDom {
  webview: WebviewElement;
  btnBack: HTMLButtonElement;
  btnForward: HTMLButtonElement;
  btnReload: HTMLButtonElement;
  urlInput: HTMLInputElement;
  btnCaptureVisible: HTMLButtonElement;
  statusBar: HTMLDivElement;
  statusText: HTMLSpanElement;
}

function resolveDom(): BrowseDom {
  const webview = document.getElementById("browse-target") as WebviewElement | null;
  const btnBack = document.getElementById("btn-back") as HTMLButtonElement | null;
  const btnForward = document.getElementById("btn-forward") as HTMLButtonElement | null;
  const btnReload = document.getElementById("btn-reload") as HTMLButtonElement | null;
  const urlInput = document.getElementById("browse-url") as HTMLInputElement | null;
  const btnCaptureVisible = document.getElementById(
    "btn-capture-visible",
  ) as HTMLButtonElement | null;
  const statusBar = document.getElementById("browse-status") as HTMLDivElement | null;
  const statusText = document.getElementById("browse-status-text") as HTMLSpanElement | null;

  if (
    !webview ||
    !btnBack ||
    !btnForward ||
    !btnReload ||
    !urlInput ||
    !btnCaptureVisible ||
    !statusBar ||
    !statusText
  ) {
    throw new Error("[browse] expected DOM elements not found in browse.html");
  }

  return { webview, btnBack, btnForward, btnReload, urlInput, btnCaptureVisible, statusBar, statusText };
}

document.addEventListener("DOMContentLoaded", () => {
  const dom = resolveDom();

  // ---- Navigation wiring ────────────────────────────────────────

  function navigateTo(rawUrl: string): void {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    // Be permissive: accept bare hostnames and prepend `https://`,
    // mirroring how mainstream browsers' address bars behave.
    const url =
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("about:")
        ? trimmed
        : `https://${trimmed}`;
    dom.webview.src = url;
  }

  dom.urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateTo(dom.urlInput.value);
    }
  });

  dom.btnBack.addEventListener("click", () => {
    if (dom.webview.canGoBack()) dom.webview.goBack();
  });
  dom.btnForward.addEventListener("click", () => {
    if (dom.webview.canGoForward()) dom.webview.goForward();
  });
  dom.btnReload.addEventListener("click", () => dom.webview.reload());

  function refreshNavState(): void {
    dom.btnBack.disabled = !dom.webview.canGoBack();
    dom.btnForward.disabled = !dom.webview.canGoForward();
  }

  dom.webview.addEventListener("did-navigate", (event) => {
    const e = event as unknown as { url: string };
    dom.urlInput.value = e.url;
    refreshNavState();
    setStatus(`Loaded ${e.url}`, "success");
  });

  dom.webview.addEventListener("did-navigate-in-page", (event) => {
    const e = event as unknown as { url: string };
    dom.urlInput.value = e.url;
    refreshNavState();
  });

  dom.webview.addEventListener("did-start-loading", () => setStatus("Loading…", "busy"));
  dom.webview.addEventListener("did-stop-loading", () => refreshNavState());
  dom.webview.addEventListener("did-fail-load", (event) => {
    const e = event as unknown as { errorCode: number; errorDescription: string };
    // -3 (ERR_ABORTED) fires on every Back/Forward navigation that
    // a user explicitly cancels via clicking another link mid-load;
    // not a user-visible failure.
    if (e.errorCode === -3) return;
    setStatus(`Load failed: ${e.errorDescription}`, "error");
  });

  dom.webview.addEventListener("page-title-updated", (event) => {
    const e = event as unknown as { title: string };
    document.title = e.title ? `${e.title} · Annot Browse` : "Annot Browse";
  });

  // ---- Capture wiring ────────────────────────────────────────────

  async function captureVisible(): Promise<void> {
    dom.btnCaptureVisible.disabled = true;
    setStatus("Capturing visible viewport…", "busy");
    try {
      const webContentsId = dom.webview.getWebContentsId();
      const captured = await api().invoke<CaptureVisibleResult>("browse.captureVisible", {
        webContentsId,
      });
      const persisted = await api().invoke<PersistVisibleResult>("browse.persistVisible", {
        dataUrl: captured.data_url,
        width: captured.width,
        height: captured.height,
        sourceUrl: dom.webview.src,
        title: document.title,
      });
      setStatus(`Saved to ${persisted.path}`, "success");
    } catch (err) {
      setStatus(`Capture failed: ${(err as Error).message}`, "error");
    } finally {
      dom.btnCaptureVisible.disabled = false;
    }
  }

  dom.btnCaptureVisible.addEventListener("click", () => void captureVisible());

  // ---- Programmatic navigation from main process ────────────────
  //
  // The main process broadcasts `browse.navigate` when a user
  // chooses "Open URL in Browse" or when the menu spawns a new
  // window with a URL. The renderer just forwards to navigateTo.
  api().on("browse.navigate", (payload) => {
    const p = payload as { url?: string } | undefined;
    if (p?.url) navigateTo(p.url);
  });

  // ---- Initial state ────────────────────────────────────────────

  dom.urlInput.value = HOME_URL;
  refreshNavState();
  setStatus("Ready", null);

  // ---- Helpers ──────────────────────────────────────────────────

  function setStatus(text: string, kind: "busy" | "success" | "error" | null): void {
    dom.statusText.textContent = text;
    dom.statusBar.classList.remove("busy", "success", "error");
    if (kind) dom.statusBar.classList.add(kind);
  }
});

// ---- `<webview>` element type ──────────────────────────────────
//
// Electron's `<webview>` tag isn't part of TS's standard DOM lib.
// Declare just the methods this file uses; production code can
// pull `electron`'s `WebviewTag` type from a host adapter later
// if more methods are needed.

interface WebviewElement extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  /** ID of the embedder's `webContents`. The main process uses
   *  this to resolve the webview from `webContents.fromId(id)`
   *  for `capturePage()`. */
  getWebContentsId(): number;
}
