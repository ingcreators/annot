/**
 * `TabsManager` — owns the Browse window's `<webview>` instances
 * and the tab-bar UI.
 *
 * Phase 5 of `docs/plans/desktop-browser-mode.md`. The Phase 4
 * single-`<webview>` setup gave way to a container that holds N
 * webviews (one per tab); the manager renders the tab bar above
 * it and keeps exactly one webview visible at a time.
 *
 * Wiring around this module:
 *
 *   - `browse.ts` constructs one TabsManager and consumes its
 *     events (`active-tab-changed`, `url-changed`, etc.) to drive
 *     the URL bar / nav buttons / status bar against the active
 *     tab's state.
 *   - `host.ts` (renderer-side `CaptureHost`) consumes the
 *     manager's `getActiveWebview` / `getWebviewByContentsId` /
 *     `onAnyTabIpcMessage` accessors so orchestrator host calls
 *     resolve to the right tab. Targets resolved at the start of
 *     a capture stay valid even if the user switches tabs
 *     mid-capture (the orchestrator addresses them by
 *     `webContentsId`, not by "currently active").
 *   - `<webview>` window-open requests route through the chrome's
 *     main-process `setWindowOpenHandler` (see
 *     `src-electron/main.ts` `did-attach-webview` block). The
 *     handler classifies the request via
 *     `webview-popup-policy.ts` and either:
 *       (a) spawns a separate BrowserWindow with `window.opener`
 *           preserved (OAuth-pattern popups — features include
 *           `width=` / `height=`); OR
 *       (b) sends `browse.open-tab` IPC to the chrome's renderer
 *           which calls `tabs.openTab(url, { active: true })`
 *           (target="_blank" / bare `window.open(url)` —
 *           navigation intent without `window.opener`).
 *
 * Capabilities:
 *   - Open / close / switch / detach tabs
 *   - Routing of `target="_blank"` / `window.open(url)` into new
 *     tabs in the same Browse window (Phase 5)
 *   - `window.opener` preservation for OAuth popup flows
 *     (Phase 5B)
 *   - Lock tab interactions during multi-segment captures
 *
 * NOT in scope:
 *   - Lit-based tab bar. Plain DOM today; a future Lit migration
 *     would touch only this module.
 */

import type { WebviewIpcMessageEvent } from "./host.js";

/** Stable, opaque tab id used by browse.ts and TabsManager
 *  consumers to address tabs without holding webview refs
 *  directly. Generated with a monotonic counter — small enough
 *  to fit a single Browse window's lifetime, never collides. */
export type TabId = string;

export interface Tab {
  readonly id: TabId;
  readonly webview: WebviewLike;
  url: string;
  title: string;
  /** Has the embedded webview attached to a webContents yet? Set
   *  to true on the first `dom-ready` event; false initially. The
   *  host's `resolveTarget` requires the webContents id which is
   *  only available after attach. */
  ready: boolean;
  /** Currently loading state — drives the chrome's "Loading…" /
   *  "Loaded …" status bar. */
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/** Minimal `<webview>` surface the manager + host use. The
 *  Electron-shipped `<webview>` tag implements all of these; tests
 *  pass a stub. */
export interface WebviewLike extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getWebContentsId(): number;
  getURL?(): string;
  getTitle?(): string;
  send(channel: string, payload: unknown): void;
}

interface TabState {
  tab: Tab;
  /** The tab-bar `<button>` for this tab. Click activates; the
   *  inner `<button class="tab-close">` closes. */
  tabBarEl: HTMLDivElement;
  closeBtn: HTMLButtonElement;
  /** Internal wrapper events handlers that need cleanup on close. */
  cleanup: () => void;
}

export interface TabsManagerEvents {
  /** Tab list mutated (open / close / detach). */
  "tabs-changed": undefined;
  /** A different tab became active. The host re-resolves
   *  `getActiveWebview` for any subsequent operations. */
  "active-tab-changed": Tab | null;
  /** Active tab's URL changed (did-navigate / did-navigate-in-page).
   *  Drives the URL bar's value. */
  "url-changed": { tab: Tab; url: string };
  /** Active tab's loading state changed. */
  "loading-changed": { tab: Tab; loading: boolean };
  /** Active tab's title changed. Drives `document.title`. */
  "title-changed": { tab: Tab; title: string };
  /** Any tab's nav state changed (canGoBack / canGoForward). The
   *  consumer typically just refreshes the back/forward buttons
   *  against the active tab. */
  "nav-state-changed": Tab;
  /** Embedded page failed to load. */
  "load-failed": { tab: Tab; errorCode: number; errorDescription: string };
}

/** Strongly-typed `EventTarget` wrapper. We use `CustomEvent` with
 *  the typed `detail` so consumers can `manager.addEventListener
 *  ("active-tab-changed", e => ...)` and get `e.detail` as the
 *  declared payload. */
type EventName = keyof TabsManagerEvents;
type EventPayload<E extends EventName> = TabsManagerEvents[E];

export class TabsManager extends EventTarget {
  #tabs: Tab[] = [];
  #activeId: TabId | null = null;
  #locked = false;
  #nextNumericId = 1;
  /** Subscribers registered via `onAnyTabIpcMessage`. The manager
   *  hooks each tab's `ipc-message` listener and fans out to
   *  these. */
  #ipcListeners = new Set<(event: WebviewIpcMessageEvent) => void>();
  #stateById = new Map<TabId, TabState>();
  #container: HTMLElement;
  #tabBar: HTMLElement;
  #newTabBtn: HTMLButtonElement;

  constructor(opts: {
    /** Container element where `<webview>` tags are appended.
     *  `display: none` is toggled per-tab so only the active one
     *  renders. */
    container: HTMLElement;
    /** Tab-bar element. The manager creates per-tab buttons +
     *  close-X children inside it. The "+" new-tab button is
     *  passed in pre-rendered (browse.html owns its position so
     *  it appears at the trailing edge). */
    tabBar: HTMLElement;
    /** Pre-rendered "+" new-tab button. The manager wires its
     *  `click` handler internally — the host doesn't have to. */
    newTabBtn: HTMLButtonElement;
    /** Default URL for new tabs spawned manually (the "+"
     *  button). Tabs spawned from main-process `browse.open-tab`
     *  IPC events also use this entry point with the requested URL.
     *  Defaults to `about:blank`. */
    defaultUrl?: string;
  }) {
    super();
    this.#container = opts.container;
    this.#tabBar = opts.tabBar;
    this.#newTabBtn = opts.newTabBtn;
    this.#defaultUrl = opts.defaultUrl ?? "about:blank";

    this.#newTabBtn.addEventListener("click", () => {
      if (this.#locked) return;
      this.openTab(this.#defaultUrl, { active: true });
    });
  }

  #defaultUrl: string;

  /** Tabs in stable order (oldest first). Callers should treat the
   *  returned array as read-only; mutations on the manager itself
   *  go through `openTab` / `closeTab`. */
  get tabs(): readonly Tab[] {
    return this.#tabs;
  }

  get activeTabId(): TabId | null {
    return this.#activeId;
  }

  getActiveTab(): Tab | null {
    if (this.#activeId === null) return null;
    return this.#stateById.get(this.#activeId)?.tab ?? null;
  }

  getActiveWebview(): WebviewLike | null {
    return this.getActiveTab()?.webview ?? null;
  }

  /** Find a tab by its webContents id (Electron `<webview>`
   *  `getWebContentsId()`). Used by the host's `sendToContent`
   *  path to address the originating tab even after the user
   *  switched tabs. Returns null when the tab isn't ready yet
   *  (no webContents) or has been closed. */
  getTabByContentsId(id: number): Tab | null {
    for (const t of this.#tabs) {
      if (!t.ready) continue;
      try {
        if (t.webview.getWebContentsId() === id) return t;
      } catch {
        /* still attaching */
      }
    }
    return null;
  }

  getWebviewByContentsId(id: number): WebviewLike | null {
    return this.getTabByContentsId(id)?.webview ?? null;
  }

  /** Lock or unlock interactive tab-bar affordances (close, switch,
   *  new). Used by browse.ts during multi-segment captures so the
   *  user can't pull the rug out from under the orchestrator. */
  setLocked(locked: boolean): void {
    this.#locked = locked;
    this.#newTabBtn.disabled = locked;
    for (const state of this.#stateById.values()) {
      state.tabBarEl.classList.toggle("tab-locked", locked);
      state.closeBtn.disabled = locked;
    }
  }

  isLocked(): boolean {
    return this.#locked;
  }

  /** Subscribe to ipc-message events on every existing AND future
   *  tab. Returns an unsubscribe fn. The host's content-bridge
   *  uses this to receive responses + events from any tab without
   *  re-attaching listeners on each tab change. */
  onAnyTabIpcMessage(handler: (event: WebviewIpcMessageEvent) => void): () => void {
    this.#ipcListeners.add(handler);
    return () => {
      this.#ipcListeners.delete(handler);
    };
  }

  /** Open a new tab, optionally activating it. Returns the new
   *  tab's id for callers that want to defer activation or close
   *  programmatically (e.g. drop into right-click "open in new
   *  tab" without focus-stealing). */
  openTab(url: string, opts: { active?: boolean } = {}): Tab {
    const id = this.#newId();
    const webview = this.#createWebview(url);
    const tab: Tab = {
      id,
      webview,
      url,
      title: url,
      ready: false,
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const tabBarEl = document.createElement("div");
    tabBarEl.className = "browse-tab";
    tabBarEl.setAttribute("role", "tab");
    tabBarEl.dataset.tabId = id;
    const titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = url;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "tab-close";
    closeBtn.setAttribute("aria-label", "Close tab");
    closeBtn.textContent = "×";
    tabBarEl.appendChild(titleEl);
    tabBarEl.appendChild(closeBtn);
    // Insert before the "+" button so new tabs land at the end of
    // the existing-tab strip but before the trailing add affordance.
    this.#tabBar.insertBefore(tabBarEl, this.#newTabBtn);

    const handleTabClick = (e: MouseEvent): void => {
      if (this.#locked) return;
      if ((e.target as HTMLElement)?.closest(".tab-close")) return;
      this.activateTab(id);
    };
    tabBarEl.addEventListener("click", handleTabClick);
    const handleClose = (e: MouseEvent): void => {
      e.stopPropagation();
      if (this.#locked) return;
      this.closeTab(id);
    };
    closeBtn.addEventListener("click", handleClose);

    // Right-click on a tab → detach into a new Browse window. The
    // manager just emits an event; the consumer (browse.ts) calls
    // the `browse.open` IPC because IPC isn't a TabsManager
    // concern.
    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      if (this.#locked) return;
      this.detachTab(id);
    };
    tabBarEl.addEventListener("contextmenu", handleContextMenu);

    // ---- Per-tab webview lifecycle listeners ─────────────────

    const onDomReady = (): void => {
      tab.ready = true;
    };
    const onDidNavigate = (event: Event): void => {
      const e = event as unknown as { url: string };
      tab.url = e.url;
      this.#refreshTitleEl(tab, titleEl);
      this.#emit("url-changed", { tab, url: e.url });
      this.#refreshNavState(tab);
    };
    const onDidNavInPage = (event: Event): void => {
      const e = event as unknown as { url: string };
      tab.url = e.url;
      this.#refreshTitleEl(tab, titleEl);
      this.#emit("url-changed", { tab, url: e.url });
    };
    const onLoadStart = (): void => {
      tab.loading = true;
      this.#emit("loading-changed", { tab, loading: true });
    };
    const onLoadStop = (): void => {
      tab.loading = false;
      this.#emit("loading-changed", { tab, loading: false });
      this.#refreshNavState(tab);
    };
    const onLoadFail = (event: Event): void => {
      const e = event as unknown as { errorCode: number; errorDescription: string };
      // -3 (ERR_ABORTED) fires on every Back/Forward navigation
      // that the user explicitly cancels via clicking another link
      // mid-load; not a user-visible failure.
      if (e.errorCode === -3) return;
      this.#emit("load-failed", {
        tab,
        errorCode: e.errorCode,
        errorDescription: e.errorDescription,
      });
    };
    const onTitle = (event: Event): void => {
      const e = event as unknown as { title: string };
      tab.title = e.title || tab.url;
      this.#refreshTitleEl(tab, titleEl);
      this.#emit("title-changed", { tab, title: tab.title });
    };
    // Note: there's intentionally NO renderer-side `new-window`
    // listener (Phase 5B of `desktop-browser-mode.md`). Window-
    // open requests from embedded pages route through the
    // chrome's main-process `setWindowOpenHandler` (see
    // `main.ts`'s `did-attach-webview` block). The classifier
    // there decides:
    //
    //   - OAuth-style popups (window features include
    //     `width=` / `height=`) → Electron spawns a separate
    //     BrowserWindow with `window.opener` preserved.
    //   - Plain navigation (`target="_blank"` / bare
    //     `window.open(url)`) → the main forwards via
    //     `browse.open-tab` IPC, the chrome's renderer calls
    //     `tabs.openTab(url, { active: true })`.
    //
    // Either way, the renderer's webview tag never sees a
    // `new-window` event — main intercepts first.
    const onIpcMessage = (event: Event): void => {
      const e = event as unknown as WebviewIpcMessageEvent;
      for (const cb of this.#ipcListeners) {
        try {
          cb(e);
        } catch (err) {
          console.debug("[tabs] ipc-message listener threw:", err);
        }
      }
    };

    webview.addEventListener("dom-ready", onDomReady);
    webview.addEventListener("did-navigate", onDidNavigate);
    webview.addEventListener("did-navigate-in-page", onDidNavInPage);
    webview.addEventListener("did-start-loading", onLoadStart);
    webview.addEventListener("did-stop-loading", onLoadStop);
    webview.addEventListener("did-fail-load", onLoadFail);
    webview.addEventListener("page-title-updated", onTitle);
    webview.addEventListener("ipc-message", onIpcMessage);

    const cleanup = (): void => {
      webview.removeEventListener("dom-ready", onDomReady);
      webview.removeEventListener("did-navigate", onDidNavigate);
      webview.removeEventListener("did-navigate-in-page", onDidNavInPage);
      webview.removeEventListener("did-start-loading", onLoadStart);
      webview.removeEventListener("did-stop-loading", onLoadStop);
      webview.removeEventListener("did-fail-load", onLoadFail);
      webview.removeEventListener("page-title-updated", onTitle);
      webview.removeEventListener("ipc-message", onIpcMessage);
      tabBarEl.removeEventListener("click", handleTabClick);
      tabBarEl.removeEventListener("contextmenu", handleContextMenu);
      closeBtn.removeEventListener("click", handleClose);
    };

    this.#tabs.push(tab);
    this.#stateById.set(id, { tab, tabBarEl, closeBtn, cleanup });

    if (opts.active !== false) {
      this.activateTab(id);
    } else {
      // New tab in background: keep its webview hidden.
      webview.style.display = "none";
    }

    this.#emit("tabs-changed", undefined);
    return tab;
  }

  /** Close a tab. If the closed tab was active, the next tab to
   *  the left (or right if it was the leftmost) becomes active.
   *  Closing the last tab fires `active-tab-changed` with `null`;
   *  consumers typically open a new about:blank tab in response
   *  so the chrome doesn't render a tabless container. */
  closeTab(id: TabId): void {
    const idx = this.#tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const state = this.#stateById.get(id);
    if (!state) return;
    state.cleanup();
    state.tabBarEl.remove();
    state.tab.webview.remove();
    this.#tabs.splice(idx, 1);
    this.#stateById.delete(id);

    if (this.#activeId === id) {
      // Pick a fallback: prefer the tab to the LEFT (idx-1),
      // fall back to the new-leftmost. Matches Chrome's tab-close
      // behaviour.
      const next = this.#tabs[idx - 1] ?? this.#tabs[0] ?? null;
      this.#activeId = next?.id ?? null;
      if (next) {
        this.#showTab(next);
      }
      this.#emit("active-tab-changed", next);
    }
    this.#emit("tabs-changed", undefined);
  }

  /** Make `id` the active tab. No-op if it's already active. */
  activateTab(id: TabId): void {
    if (this.#activeId === id) return;
    const state = this.#stateById.get(id);
    if (!state) return;
    // Hide previously-active tab.
    if (this.#activeId !== null) {
      const prev = this.#stateById.get(this.#activeId);
      if (prev) {
        prev.tab.webview.style.display = "none";
        prev.tabBarEl.classList.remove("tab-active");
      }
    }
    this.#activeId = id;
    this.#showTab(state.tab);
    this.#emit("active-tab-changed", state.tab);
  }

  /** Detach a tab into its own new Browse window. The manager
   *  emits a `detach-requested` event (consumed by browse.ts which
   *  calls `browse.open` IPC) and closes the tab. The new window
   *  starts fresh — `window.opener` doesn't carry through. */
  detachTab(id: TabId): void {
    const tab = this.#stateById.get(id)?.tab;
    if (!tab) return;
    const url = tab.url;
    this.dispatchEvent(
      new CustomEvent("detach-requested", { detail: { url } }),
    );
    this.closeTab(id);
  }

  /** Tear down every tab + listener. Called from browse.ts on
   *  beforeunload to prevent leaked listeners across HMR /
   *  reload. */
  dispose(): void {
    for (const id of [...this.#tabs.map((t) => t.id)]) {
      this.closeTab(id);
    }
    this.#ipcListeners.clear();
  }

  // ---- Internals ────────────────────────────────────────────

  #newId(): TabId {
    return `tab-${this.#nextNumericId++}`;
  }

  #createWebview(url: string): WebviewLike {
    const el = document.createElement("webview") as unknown as WebviewLike;
    el.classList.add("browse-webview");
    // Attributes mirror the original `<webview>` from browse.html.
    el.setAttribute("src", url);
    el.setAttribute("allowpopups", "");
    el.setAttribute("disablewebsecurity", "false");
    // The element fills the container; `display: none` toggles
    // visibility per active state.
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.border = "0";
    el.style.display = "none";
    this.#container.appendChild(el);
    return el;
  }

  #showTab(tab: Tab): void {
    tab.webview.style.display = "";
    const state = this.#stateById.get(tab.id);
    if (state) state.tabBarEl.classList.add("tab-active");
  }

  #refreshTitleEl(tab: Tab, titleEl: HTMLSpanElement): void {
    const text = (tab.title || tab.url || "").trim();
    titleEl.textContent = text || "(untitled)";
    titleEl.title = text;
  }

  #refreshNavState(tab: Tab): void {
    try {
      tab.canGoBack = tab.webview.canGoBack();
    } catch {
      tab.canGoBack = false;
    }
    try {
      tab.canGoForward = tab.webview.canGoForward();
    } catch {
      tab.canGoForward = false;
    }
    this.#emit("nav-state-changed", tab);
  }

  #emit<E extends EventName>(name: E, detail: EventPayload<E>): void {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
