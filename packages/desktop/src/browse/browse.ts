/**
 * Browse window renderer.
 *
 * Phase 3 of `docs/plans/desktop-browser-mode.md`: the bespoke
 * `browse.captureVisible` + `browse.persistVisible` IPC pair from
 * the Phase 6 MVP is gone. Visible-mode capture now flows through
 * the shared orchestrator from
 * `@ingcreators/annot-capture/orchestrate` against a renderer-side
 * `DesktopCaptureHost` (`./host.ts`); persistence routes through
 * `DesktopStore.saveImage` so the main editor's gallery picks the
 * new record up via its existing resync logic.
 *
 * Phase 3 minimum-viable scope: single tab, visible mode only.
 * Multi-tab + Area / Full-Page / Per-Page / Click / Hotkey land
 * in Phase 4 alongside the `<webview>` preload that bridges the
 * content-script bus.
 */

import {
  runAreaCapture,
  runPerPageCapture,
  runScrollCapture,
  runVisibleCapture,
  type CaptureFrame,
  type CaptureResult,
} from "@ingcreators/annot-capture/orchestrate";
import { newIdB58 } from "@ingcreators/annot-core/utils";
import type { DesktopStore } from "../storage/desktop-store.js";
import { createStandaloneDesktopStore } from "../storage/bootstrap.js";
import { createBrowseCaptureHost } from "./host.js";

interface ElectronApi {
  invoke<T = unknown>(channel: string, args?: unknown): Promise<T>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
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

/** Default folder under the library where Browse-window captures
 *  land. Mirrors the Phase 6 MVP. */
const INBOX_FOLDER = "Inbox";

interface BrowseDom {
  webview: WebviewElement;
  btnBack: HTMLButtonElement;
  btnForward: HTMLButtonElement;
  btnReload: HTMLButtonElement;
  urlInput: HTMLInputElement;
  btnCaptureVisible: HTMLButtonElement;
  btnCaptureArea: HTMLButtonElement;
  btnCaptureFull: HTMLButtonElement;
  btnCapturePages: HTMLButtonElement;
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
  const btnCaptureArea = document.getElementById(
    "btn-capture-area",
  ) as HTMLButtonElement | null;
  const btnCaptureFull = document.getElementById(
    "btn-capture-full",
  ) as HTMLButtonElement | null;
  const btnCapturePages = document.getElementById(
    "btn-capture-pages",
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
    !btnCaptureArea ||
    !btnCaptureFull ||
    !btnCapturePages ||
    !statusBar ||
    !statusText
  ) {
    throw new Error("[browse] expected DOM elements not found in browse.html");
  }

  return {
    webview,
    btnBack,
    btnForward,
    btnReload,
    urlInput,
    btnCaptureVisible,
    btnCaptureArea,
    btnCaptureFull,
    btnCapturePages,
    statusBar,
    statusText,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const dom = resolveDom();

  // Lazy-init the DesktopStore on first capture. Construction reads
  // the library root via IPC + initialises the index file, both of
  // which take a few hundred ms — defer until the user actually
  // clicks "Capture Visible" so the chrome's first paint isn't
  // gated on it.
  let storePromise: Promise<DesktopStore> | null = null;
  function getStore(): Promise<DesktopStore> {
    if (!storePromise) {
      storePromise = createStandaloneDesktopStore();
    }
    return storePromise;
  }

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

  // The host wraps the `<webview>` so the orchestrator can resolve
  // a `CaptureTargetRef`, capture the viewport, run the metadata
  // walker, and bridge `ContentBus` over Electron IPC (Phase 4A).
  // `getURL()` reads the live URL — preferable to the stale
  // `<webview>.src` after history-driven navigations.
  //
  // The element is passed directly so the host's `sendToContent` /
  // `onContentMessage` / `setEmulatedViewport` primitives can use
  // `webview.send` / `addEventListener("ipc-message", ...)` /
  // inline-`style` without re-wrapping. The `BrowseTargetWebview`
  // interface is structurally satisfied by the live element; cast
  // through `unknown` because TS doesn't model the `<webview>`
  // tag's `send` / `getURL` / `getTitle` extras.
  const host = createBrowseCaptureHost({
    webview: dom.webview as unknown as Parameters<typeof createBrowseCaptureHost>[0]["webview"],
  });

  /** Disable every capture button while a capture is in flight so
   *  multi-segment runs can't be retriggered mid-flow. The 3 modes
   *  share a single guard. */
  function setCaptureBusy(busy: boolean): void {
    dom.btnCaptureVisible.disabled = busy;
    dom.btnCaptureArea.disabled = busy;
    dom.btnCaptureFull.disabled = busy;
    dom.btnCapturePages.disabled = busy;
  }

  type ModeRunner = (host: ReturnType<typeof createBrowseCaptureHost>) => Promise<CaptureResult | null>;

  async function runMode(label: string, runner: ModeRunner): Promise<void> {
    setCaptureBusy(true);
    setStatus(`Capturing ${label}…`, "busy");
    try {
      const result = await runner(host);
      if (!result || result.frames.length === 0) {
        setStatus("Capture cancelled", null);
        return;
      }
      const sourceUrl = result.target.url;
      const title = result.target.title ?? "";
      const sessionId = result.frames.length > 1 ? newIdB58() : null;
      const store = await getStore();

      const savedPaths: string[] = [];
      for (let i = 0; i < result.frames.length; i++) {
        const frame = result.frames[i]!;
        const path = await persistFrame({
          frame,
          sourceUrl,
          store,
          // Per-page sessions tag every frame with the same
          // `session` + `sessionKind`; single-frame captures
          // (visible / area / scroll) skip session tagging
          // because the editor surfaces them as standalone
          // records.
          sessionTags:
            sessionId !== null
              ? {
                  session: sessionId,
                  sessionKind: result.kind,
                  sessionIndex: String(i),
                  sessionTotal: String(result.frames.length),
                  page: String(i + 1),
                }
              : null,
        });
        savedPaths.push(path);
      }

      if (savedPaths.length === 1) {
        setStatus(`Saved to ${savedPaths[0]} (${title || sourceUrl})`, "success");
      } else {
        setStatus(
          `Saved ${savedPaths.length} pages to ${INBOX_FOLDER}/ (${title || sourceUrl})`,
          "success",
        );
      }
    } catch (err) {
      setStatus(`Capture failed: ${(err as Error).message}`, "error");
    } finally {
      setCaptureBusy(false);
    }
  }

  async function persistFrame(input: {
    frame: CaptureFrame;
    sourceUrl: string;
    store: DesktopStore;
    sessionTags: Record<string, string> | null;
  }): Promise<string> {
    let { width, height } = input.frame;
    if (!width || !height) {
      const probed = await probeDataUrlDimensions(input.frame.dataUrl);
      width = probed.width;
      height = probed.height;
    }
    const tags: Record<string, string> = {
      ...urlTags(input.sourceUrl),
      captureId: newIdB58(),
      ...(input.sessionTags ?? {}),
    };
    return input.store.saveImage({
      originalDataUrl: input.frame.dataUrl,
      // `thumbnailDataUrl` is owned by the host's
      // ThumbnailManager — `DesktopStore.saveImage` ignores any
      // value passed here. Keep it empty so callers don't waste
      // a `generateThumbnail` round-trip just to populate it.
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width,
      height,
      sourceUrl: input.sourceUrl,
      tags,
      folderPath: INBOX_FOLDER,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pageMetadata: input.frame.pageMetadata,
    });
  }

  dom.btnCaptureVisible.addEventListener("click", () =>
    void runMode("visible viewport", runVisibleCapture),
  );
  dom.btnCaptureArea.addEventListener("click", () =>
    void runMode("selected area", runAreaCapture),
  );
  dom.btnCaptureFull.addEventListener("click", () =>
    void runMode("full page", runScrollCapture),
  );
  dom.btnCapturePages.addEventListener("click", () =>
    void runMode("per-page", runPerPageCapture),
  );

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

async function probeDataUrlDimensions(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const out = { width: bmp.width, height: bmp.height };
    bmp.close();
    return out;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** URL → tag bag. Mirrors the chrome extension's `urlTags` so saved
 *  records carry the same per-host / -path / -query / -fragment
 *  metadata regardless of which host produced them. */
function urlTags(sourceUrl: string | undefined | null): Record<string, string> {
  if (!sourceUrl) return {};
  try {
    const u = new URL(sourceUrl);
    const t: Record<string, string> = {};
    if (u.hostname) t.host = u.hostname;
    if (u.pathname && u.pathname !== "/") t.path = u.pathname;
    if (u.search) t.query = u.search.slice(1);
    if (u.hash) t.fragment = u.hash.slice(1);
    return t;
  } catch {
    return {};
  }
}

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
  /** Live URL (vs. the static `src` attribute, which doesn't
   *  update on history-driven navigations). */
  getURL?(): string;
}
