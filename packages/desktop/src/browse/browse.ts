/**
 * Browse window renderer.
 *
 * Phase 5 of `docs/plans/desktop-browser-mode.md` lifts the
 * single-`<webview>` setup into a `TabsManager` that owns N
 * webviews. The chrome's URL bar / nav buttons / capture buttons
 * route to the manager's active tab; `new-window` events from any
 * tab spawn a new tab in the same Browse window. The capture
 * orchestrator host (`./host.ts`) takes accessor callbacks
 * (`getActiveWebview` / `getWebviewByContentsId` /
 * `onAnyTabIpcMessage`) so a capture started against tab A
 * survives a mid-capture tab switch.
 *
 * Persistence still routes through `DesktopStore.saveImage` so
 * the main editor's gallery picks up Browse-window captures via
 * its existing resync logic.
 */

import {
  runAreaCapture,
  runPerPageCapture,
  runScrollCapture,
  runVisibleCapture,
  type CaptureFrame,
  type CaptureResult,
} from "@ingcreators/annot-capture/orchestrate";
import type {
  AnnotCaptureSettingsElement,
  CaptureSettingsChangeDetail,
} from "@ingcreators/annot-host-ui/annot-capture-settings";
import "@ingcreators/annot-host-ui/annot-capture-settings";
import { newIdB58 } from "@ingcreators/annot-core/utils";
import type { DesktopStore } from "../storage/desktop-store.js";
import { createStandaloneDesktopStore } from "../storage/bootstrap.js";
import { installClickHotkeyHandlers } from "./click-hotkey.js";
import { createBrowseCaptureHost, type BrowseTargetWebview } from "./host.js";
import { TabsManager, type Tab } from "./tabs.js";

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
  tabBar: HTMLDivElement;
  newTabBtn: HTMLButtonElement;
  webviewContainer: HTMLDivElement;
  btnBack: HTMLButtonElement;
  btnForward: HTMLButtonElement;
  btnReload: HTMLButtonElement;
  urlInput: HTMLInputElement;
  btnCaptureVisible: HTMLButtonElement;
  btnCaptureArea: HTMLButtonElement;
  btnCaptureFull: HTMLButtonElement;
  btnCapturePages: HTMLButtonElement;
  btnCaptureClick: HTMLButtonElement;
  btnCaptureHotkey: HTMLButtonElement;
  btnSettings: HTMLButtonElement;
  contextMenu: HTMLDivElement;
  settingsDialog: HTMLDialogElement;
  settingsBody: HTMLDivElement;
  btnSettingsClose: HTMLButtonElement;
  statusBar: HTMLDivElement;
  statusText: HTMLSpanElement;
}

function resolveDom(): BrowseDom {
  const tabBar = document.getElementById("browse-tabs") as HTMLDivElement | null;
  const newTabBtn = document.getElementById("btn-new-tab") as HTMLButtonElement | null;
  const webviewContainer = document.getElementById(
    "browse-target-host",
  ) as HTMLDivElement | null;
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
  const btnCaptureClick = document.getElementById(
    "btn-capture-click",
  ) as HTMLButtonElement | null;
  const btnCaptureHotkey = document.getElementById(
    "btn-capture-hotkey",
  ) as HTMLButtonElement | null;
  const btnSettings = document.getElementById(
    "btn-settings",
  ) as HTMLButtonElement | null;
  const contextMenu = document.getElementById(
    "annot-context-menu",
  ) as HTMLDivElement | null;
  const settingsDialog = document.getElementById(
    "capture-settings-dialog",
  ) as HTMLDialogElement | null;
  const settingsBody = document.getElementById(
    "capture-settings-body",
  ) as HTMLDivElement | null;
  const btnSettingsClose = document.getElementById(
    "btn-settings-close",
  ) as HTMLButtonElement | null;
  const statusBar = document.getElementById("browse-status") as HTMLDivElement | null;
  const statusText = document.getElementById("browse-status-text") as HTMLSpanElement | null;

  if (
    !tabBar ||
    !newTabBtn ||
    !webviewContainer ||
    !btnBack ||
    !btnForward ||
    !btnReload ||
    !urlInput ||
    !btnCaptureVisible ||
    !btnCaptureArea ||
    !btnCaptureFull ||
    !btnCapturePages ||
    !btnCaptureClick ||
    !btnCaptureHotkey ||
    !btnSettings ||
    !contextMenu ||
    !settingsDialog ||
    !settingsBody ||
    !btnSettingsClose ||
    !statusBar ||
    !statusText
  ) {
    throw new Error("[browse] expected DOM elements not found in browse.html");
  }

  return {
    tabBar,
    newTabBtn,
    webviewContainer,
    btnBack,
    btnForward,
    btnReload,
    urlInput,
    btnCaptureVisible,
    btnCaptureArea,
    btnCaptureFull,
    btnCapturePages,
    btnCaptureClick,
    btnCaptureHotkey,
    btnSettings,
    contextMenu,
    settingsDialog,
    settingsBody,
    btnSettingsClose,
    statusBar,
    statusText,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const dom = resolveDom();

  // ---- TabsManager (Phase 5) ─────────────────────────────────────

  const tabs = new TabsManager({
    container: dom.webviewContainer,
    tabBar: dom.tabBar,
    newTabBtn: dom.newTabBtn,
    defaultUrl: HOME_URL,
  });

  // Open the initial tab. The user-visible URL bar starts at
  // `HOME_URL` (about:blank); the user types a URL to navigate.
  const initialTab = tabs.openTab(HOME_URL, { active: true });

  // ---- Wire URL bar + nav buttons to the ACTIVE tab ─────────────

  function navigateActiveTo(rawUrl: string): void {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    // Be permissive: accept bare hostnames and prepend `https://`,
    // mirroring how mainstream browsers' address bars behave.
    const url =
      /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("about:")
        ? trimmed
        : `https://${trimmed}`;
    const active = tabs.getActiveTab();
    if (active) active.webview.src = url;
  }

  dom.urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateActiveTo(dom.urlInput.value);
    }
  });

  dom.btnBack.addEventListener("click", () => {
    const t = tabs.getActiveTab();
    if (t?.webview.canGoBack()) t.webview.goBack();
  });
  dom.btnForward.addEventListener("click", () => {
    const t = tabs.getActiveTab();
    if (t?.webview.canGoForward()) t.webview.goForward();
  });
  dom.btnReload.addEventListener("click", () => {
    const t = tabs.getActiveTab();
    if (t) t.webview.reload();
  });

  function refreshNavButtonsAgainst(tab: Tab | null): void {
    dom.btnBack.disabled = !(tab?.canGoBack ?? false);
    dom.btnForward.disabled = !(tab?.canGoForward ?? false);
  }

  function setUrlBar(tab: Tab | null): void {
    dom.urlInput.value = tab?.url ?? "";
  }

  // ---- TabsManager event subscriptions ───────────────────────────

  tabs.addEventListener("active-tab-changed", (event: Event) => {
    const tab = (event as CustomEvent<Tab | null>).detail;
    setUrlBar(tab);
    refreshNavButtonsAgainst(tab);
    if (tab) {
      document.title = tab.title ? `${tab.title} · Annot Browse` : "Annot Browse";
      setStatus(tab.loading ? `Loading ${tab.url}…` : `Active: ${tab.url}`, tab.loading ? "busy" : null);
    } else {
      document.title = "Annot Browse";
      setStatus("No tabs open", null);
    }
  });

  tabs.addEventListener("url-changed", (event: Event) => {
    const { tab, url } = (event as CustomEvent<{ tab: Tab; url: string }>).detail;
    if (tab.id !== tabs.activeTabId) return;
    setUrlBar(tab);
    setStatus(`Loaded ${url}`, "success");
  });

  tabs.addEventListener("loading-changed", (event: Event) => {
    const { tab, loading } = (event as CustomEvent<{ tab: Tab; loading: boolean }>).detail;
    if (tab.id !== tabs.activeTabId) return;
    if (loading) setStatus("Loading…", "busy");
  });

  tabs.addEventListener("title-changed", (event: Event) => {
    const { tab, title } = (event as CustomEvent<{ tab: Tab; title: string }>).detail;
    if (tab.id !== tabs.activeTabId) return;
    document.title = title ? `${title} · Annot Browse` : "Annot Browse";
  });

  tabs.addEventListener("nav-state-changed", (event: Event) => {
    const tab = (event as CustomEvent<Tab>).detail;
    if (tab.id !== tabs.activeTabId) return;
    refreshNavButtonsAgainst(tab);
  });

  tabs.addEventListener("load-failed", (event: Event) => {
    const { tab, errorDescription } = (
      event as CustomEvent<{ tab: Tab; errorCode: number; errorDescription: string }>
    ).detail;
    if (tab.id !== tabs.activeTabId) return;
    setStatus(`Load failed: ${errorDescription}`, "error");
  });

  // Detach a tab via its right-click — the TabsManager fires this
  // event and the renderer asks the main process to spawn a fresh
  // Browse window pointed at the tab's URL. The tab itself is
  // already removed by the manager.
  tabs.addEventListener("detach-requested", (event: Event) => {
    const { url } = (event as CustomEvent<{ url: string }>).detail;
    void api().invoke("browse.open", { url });
  });

  // Initialise the URL bar / nav state from the initial tab.
  setUrlBar(initialTab);
  refreshNavButtonsAgainst(initialTab);

  // ---- Capture wiring ────────────────────────────────────────────

  // The host receives accessor callbacks rather than a single
  // webview reference (Phase 5). `getActiveWebview` resolves to the
  // currently-active tab; `getWebviewByContentsId` looks up the
  // originating tab when an in-flight capture sends back to a
  // specific webContents id; `onAnyTabIpcMessage` forwards events
  // from every tab so the host's request-response correlation map
  // settles regardless of which tab responded.
  const host = createBrowseCaptureHost({
    getActiveWebview: () => {
      const t = tabs.getActiveWebview();
      return t ? (t as unknown as BrowseTargetWebview) : null;
    },
    getWebviewByContentsId: (id) => {
      const w = tabs.getWebviewByContentsId(id);
      return w ? (w as unknown as BrowseTargetWebview) : null;
    },
    onAnyTabIpcMessage: (handler) => tabs.onAnyTabIpcMessage(handler),
  });

  /** Disable every capture button while a capture is in flight so
   *  multi-segment runs can't be retriggered mid-flow. The 4
   *  single-shot modes share a single guard; click + hotkey use
   *  the click-hotkey module's own button-state logic. */
  function setCaptureBusy(busy: boolean): void {
    dom.btnCaptureVisible.disabled = busy;
    dom.btnCaptureArea.disabled = busy;
    dom.btnCaptureFull.disabled = busy;
    dom.btnCapturePages.disabled = busy;
  }

  type ModeRunner = (host: ReturnType<typeof createBrowseCaptureHost>) => Promise<CaptureResult | null>;

  /** Modes that span multiple captures or scroll the page; the
   *  user can't safely close / switch tabs mid-flow without
   *  orphaning the orchestrator. */
  const MULTI_SEGMENT_MODES = new Set<string>(["full page", "per-page"]);

  async function runMode(label: string, runner: ModeRunner): Promise<void> {
    setCaptureBusy(true);
    const lockTabs = MULTI_SEGMENT_MODES.has(label);
    if (lockTabs) tabs.setLocked(true);
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
      if (lockTabs) tabs.setLocked(false);
      setCaptureBusy(false);
    }
  }

  // Lazy-init the DesktopStore on first capture. Construction reads
  // the library root via IPC + initialises the index file, both of
  // which take a few hundred ms — defer until the user actually
  // clicks a capture button so the chrome's first paint isn't
  // gated on it.
  let storePromise: Promise<DesktopStore> | null = null;
  function getStore(): Promise<DesktopStore> {
    if (!storePromise) {
      storePromise = createStandaloneDesktopStore();
    }
    return storePromise;
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

  // ---- Click + Hotkey session machines (Phase 4B) ────────────────

  const clickHotkey = installClickHotkeyHandlers({
    host,
    webview: {
      // Resolve from the active tab on each call so URL/title
      // reflect the user's current context (e.g. a click captured
      // on tab B uses tab B's URL, not the tab the session started
      // on).
      getURL: () => tabs.getActiveTab()?.webview.getURL?.() ?? tabs.getActiveTab()?.url ?? "",
      getTitle: () => document.title,
    },
    getStore,
    inboxFolder: INBOX_FOLDER,
    btnClick: dom.btnCaptureClick,
    btnHotkey: dom.btnCaptureHotkey,
    setStatus,
  });

  // Re-enable click capture in any tab's preload realm after every
  // navigation. The preload runs fresh on each page load, so its
  // `clickListenerActive` resets to false; the chrome carries the
  // user-facing "click capture is recording" flag and re-issues
  // `click-capture-enable` so the listener comes back up before the
  // user starts clicking around the new page. Phase 5: also
  // re-enables on the NEW active tab after a tab switch.
  function reEnableClickCaptureSoon(): void {
    void clickHotkey.reEnableClickCaptureAfterNavigation();
  }

  // Per-tab navigation events: TabsManager doesn't expose
  // `did-finish-load` directly, but it emits `loading-changed`
  // which transitions to `false` once the page settles. We can
  // leverage that for the "navigation done" trigger.
  tabs.addEventListener("loading-changed", (event: Event) => {
    const { loading } = (event as CustomEvent<{ tab: Tab; loading: boolean }>).detail;
    if (!loading) reEnableClickCaptureSoon();
  });
  // Switching tabs effectively re-enters the new tab's preload
  // realm from the click-listener's perspective; reissue
  // click-capture-enable so the new active tab starts dispatching
  // click-detected events.
  tabs.addEventListener("active-tab-changed", reEnableClickCaptureSoon);

  // Hotkey shot delivered from main.ts when the user presses
  // Alt+Shift+C while the Browse window is focused.
  api().on("hotkey-capture-shot", () => {
    void clickHotkey.handleHotkeyShot();
  });

  // ---- Right-click context menu (Phase 4B) ──────────────────────

  function showContextMenu(viewportX: number, viewportY: number): void {
    const active = tabs.getActiveTab();
    if (!active) return;
    const rect = active.webview.getBoundingClientRect();
    const chromeX = rect.left + viewportX;
    const chromeY = rect.top + viewportY;
    dom.contextMenu.style.display = "block";
    dom.contextMenu.style.left = `${chromeX}px`;
    dom.contextMenu.style.top = `${chromeY}px`;
    const menuRect = dom.contextMenu.getBoundingClientRect();
    if (chromeX + menuRect.width > window.innerWidth) {
      dom.contextMenu.style.left = `${window.innerWidth - menuRect.width - 8}px`;
    }
    if (chromeY + menuRect.height > window.innerHeight) {
      dom.contextMenu.style.top = `${window.innerHeight - menuRect.height - 8}px`;
    }
    dom.contextMenu.setAttribute("aria-hidden", "false");
  }

  function hideContextMenu(): void {
    dom.contextMenu.style.display = "none";
    dom.contextMenu.setAttribute("aria-hidden", "true");
  }

  host.onContentMessage((msg) => {
    if (msg.type === "context-menu-request") {
      showContextMenu(msg.x, msg.y);
    }
  });

  dom.contextMenu.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest("button[data-mode]") as HTMLButtonElement | null;
    if (!button) return;
    hideContextMenu();
    const mode = button.dataset.mode;
    switch (mode) {
      case "visible":
        void runMode("visible viewport", runVisibleCapture);
        break;
      case "area":
        void runMode("selected area", runAreaCapture);
        break;
      case "full":
        void runMode("full page", runScrollCapture);
        break;
      case "pages":
        void runMode("per-page", runPerPageCapture);
        break;
      case "click":
        void clickHotkey.toggleClickCapture();
        break;
      case "hotkey":
        void clickHotkey.toggleHotkeyCapture();
        break;
    }
  });

  document.addEventListener(
    "click",
    (e) => {
      if (dom.contextMenu.style.display !== "block") return;
      const target = e.target as HTMLElement | null;
      if (target && dom.contextMenu.contains(target)) return;
      hideContextMenu();
    },
    { capture: true },
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dom.contextMenu.style.display === "block") {
      hideContextMenu();
    }
  });
  window.addEventListener("scroll", hideContextMenu, true);

  // ---- Capture-settings dialog (Phase 6) ────────────────────────
  //
  // The settings UI is a Lit `<annot-capture-settings>` element
  // embedded in a `<dialog>`. The element emits `settings-changed`
  // on every input — we autosave through the host (which IPC's to
  // the main process). No "Save" button: the form value IS the
  // persisted state, mirroring the chrome extension's options.html
  // ergonomics.

  const settingsEl = document.createElement("annot-capture-settings") as AnnotCaptureSettingsElement;
  dom.settingsBody.appendChild(settingsEl);

  // Lazy-init the form on first open. Loading settings reads a
  // file and merges defaults; deferring until the user clicks ⚙
  // keeps boot fast.
  let settingsLoaded = false;
  async function ensureSettingsLoaded(): Promise<void> {
    if (settingsLoaded) return;
    settingsLoaded = true;
    try {
      settingsEl.settings = await host.loadSettings();
    } catch (err) {
      console.warn("[browse] settings load failed; using defaults:", err);
    }
  }

  settingsEl.addEventListener("settings-changed", (e: Event) => {
    const detail = (e as CustomEvent<CaptureSettingsChangeDetail>).detail;
    void host.saveSettings(detail.settings).catch((err) => {
      console.warn("[browse] settings save failed:", err);
      setStatus(`Settings save failed: ${(err as Error).message}`, "error");
    });
  });

  dom.btnSettings.addEventListener("click", () => {
    void ensureSettingsLoaded().then(() => {
      if (!dom.settingsDialog.open) dom.settingsDialog.showModal();
    });
  });
  dom.btnSettingsClose.addEventListener("click", () => {
    dom.settingsDialog.close();
  });
  // Native `<dialog>` close on click-outside isn't a default —
  // wire it manually so click-on-backdrop dismisses (matching
  // the right-click context menu's UX).
  dom.settingsDialog.addEventListener("click", (e) => {
    if (e.target === dom.settingsDialog) {
      dom.settingsDialog.close();
    }
  });

  // ---- Programmatic navigation from main process ────────────────
  //
  // The main process broadcasts `browse.navigate` when a user
  // chooses "Open URL in Browse" or when the menu spawns a new
  // window with a URL. Phase 5: open the URL in a NEW tab rather
  // than replacing the active tab — matches the convention of
  // routing external open-URL requests as their own tabs.
  api().on("browse.navigate", (payload) => {
    const p = payload as { url?: string } | undefined;
    if (p?.url) tabs.openTab(p.url, { active: true });
  });

  // ---- Initial state ────────────────────────────────────────────

  setStatus("Ready", null);

  // ---- Helpers ──────────────────────────────────────────────────

  function setStatus(text: string, kind: "busy" | "success" | "error" | null): void {
    dom.statusText.textContent = text;
    dom.statusBar.classList.remove("busy", "success", "error");
    if (kind) dom.statusBar.classList.add(kind);
  }

  // Tear down listeners on window close so HMR / reload doesn't
  // accumulate orphaned subscribers.
  window.addEventListener("beforeunload", () => {
    clickHotkey.dispose();
    tabs.dispose();
  });
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
