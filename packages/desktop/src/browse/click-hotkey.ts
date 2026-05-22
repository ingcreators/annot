/**
 * Click-capture + hotkey-capture session machines for the
 * Electron Browse window.
 *
 * Phase 4B of `docs/plans/desktop-browser-mode.md`. Mirrors the
 * extension's `clickState` / `hotkeyState` shape (see
 * `packages/extension/src/background/service-worker.ts`) but
 * targets Electron primitives:
 *
 *   - Click capture: a toolbar toggle. While active, every page
 *     click in the embedded `<webview>` posts a `click-detected`
 *     event from the content preload to the host. The host
 *     applies a settle delay, captures the viewport, encodes,
 *     and persists with `click.*` tags.
 *
 *   - Hotkey capture: a toolbar toggle PLUS a global Alt+Shift+C
 *     shortcut. The shortcut auto-starts the session on first
 *     press; subsequent presses fire one capture each. The
 *     `hotkey-capture-shot` IPC event is delivered from
 *     `main.ts` only when the Browse window is the focused
 *     window.
 *
 * Click + hotkey state is intentionally NOT pulled into the
 * `@ingcreators/annot-capture/orchestrate` package: each session
 * carries host-specific bookkeeping (toolbar toggle, session ids,
 * `click.*` tags) and the click / hotkey toggles are intrinsic
 * UI surfaces. The single-shot capture flow inside each handler
 * still consumes the shared host primitives via
 * `beginCapturePrep` / `host.captureViewport` / `host.encodeBatch`
 * — which is the level of abstraction the package guarantees.
 */

import { beginCapturePrep, delay, endCapturePrep } from "@ingcreators/annot-capture/orchestrate";
import type { ContentToBackgroundMessage } from "@ingcreators/annot-capture/shared";
import type { ElementTree } from "@ingcreators/annot-core";
import { encodeCapture } from "@ingcreators/annot-core/encode";
import { newIdB58 } from "@ingcreators/annot-core/utils";
import type { DesktopStore } from "../storage/desktop-store.js";
import type { createBrowseCaptureHost } from "./host.js";

type Host = ReturnType<typeof createBrowseCaptureHost>;

interface SessionState {
  active: boolean;
  count: number;
  /** Timestamp of last capture — used to debounce rapid
   *  triggers. */
  lastCaptureAt: number;
  /** uuid7-base58 session id; set at start, reused for every
   *  capture in the session. */
  sessionId: string;
}

/** Click-capture debounce (ms). Mirrors the extension's
 *  `CLICK_CAPTURE_MIN_INTERVAL_MS`. */
const CLICK_CAPTURE_MIN_INTERVAL_MS = 350;

/** Safety cap on click-capture frames per session. */
const CLICK_CAPTURE_MAX_FRAMES = 500;

/** Hotkey-capture debounce — faster than click capture because
 *  keyboard auto-repeat can fire ~10x/sec. */
const HOTKEY_CAPTURE_MIN_INTERVAL_MS = 200;

interface CaptureContext {
  url?: string;
  title?: string;
  dpr?: number;
  target?: string;
  mouse?: { x: number; y: number };
  rect?: { x: number; y: number; width: number; height: number };
}

export interface BrowseWebviewLike {
  /** Live URL (post-navigation). */
  getURL?: () => string;
  src?: string;
  /** Page title for source-tagging. */
  getTitle?: () => string;
}

export interface ClickHotkeyDeps {
  host: Host;
  webview: BrowseWebviewLike;
  getStore: () => Promise<DesktopStore>;
  /** Inbox folder under `<userData>/library/` where captured
   *  frames land. Mirrors the value `browse.ts` uses for the
   *  other modes. */
  inboxFolder: string;
  /** Toolbar buttons that toggle the sessions. The factory wires
   *  click handlers + toggles their `recording` class to mirror
   *  the active state. */
  btnClick: HTMLButtonElement;
  btnHotkey: HTMLButtonElement;
  setStatus: (text: string, kind: "busy" | "success" | "error" | null) => void;
}

export interface ClickHotkeyHandle {
  /** Programmatic toggle, used by the right-click context menu's
   *  "Toggle Click Capture" entry. */
  toggleClickCapture(): Promise<void>;
  toggleHotkeyCapture(): Promise<void>;
  /** Whether the click / hotkey listeners are currently active. */
  isClickActive(): boolean;
  isHotkeyActive(): boolean;
  /** Invoked by browse.ts when the main process posts the
   *  `hotkey-capture-shot` IPC event. Auto-starts the session
   *  on first press if not already active. */
  handleHotkeyShot(): Promise<void>;
  /** Re-issued by browse.ts on `did-finish-load` so the newly-
   *  rebuilt webview preload realm picks up the click-capture
   *  state. */
  reEnableClickCaptureAfterNavigation(): Promise<void>;
  /** Tear down the host's content-message subscription. Tests
   *  call this in `afterEach`. */
  dispose(): void;
}

export function installClickHotkeyHandlers(deps: ClickHotkeyDeps): ClickHotkeyHandle {
  const clickState: SessionState = {
    active: false,
    count: 0,
    lastCaptureAt: 0,
    sessionId: "",
  };
  const hotkeyState: SessionState = {
    active: false,
    count: 0,
    lastCaptureAt: 0,
    sessionId: "",
  };

  function refreshButtons(): void {
    setRecordingClass(deps.btnClick, clickState.active);
    deps.btnClick.textContent = clickState.active ? `🖱 Click ■ (${clickState.count})` : "🖱 Click ▶";

    setRecordingClass(deps.btnHotkey, hotkeyState.active);
    deps.btnHotkey.textContent = hotkeyState.active
      ? `⌨ Hotkey ■ (${hotkeyState.count})`
      : "⌨ Hotkey ▶";
  }

  function resolveLiveUrl(): string {
    if (typeof deps.webview.getURL === "function") return deps.webview.getURL();
    return deps.webview.src ?? "";
  }

  function resolveLiveTitle(): string {
    if (typeof deps.webview.getTitle === "function") return deps.webview.getTitle();
    return document.title;
  }

  // ---- Click capture ─────────────────────────────────────────
  //
  // The host's `onContentMessage` listener fires for `click-detected`
  // events arriving from the webview's preload (Phase 4A). We
  // accumulate frames per session, applying the same debounce +
  // max-frames safeguards the extension uses.

  const unsubscribe = deps.host.onContentMessage((msg) => {
    void handleContentMessage(msg);
  });

  async function handleContentMessage(msg: ContentToBackgroundMessage): Promise<void> {
    if (msg.type === "click-detected") {
      await handleClickDetected(msg);
    }
  }

  async function handleClickDetected(
    msg: Extract<ContentToBackgroundMessage, { type: "click-detected" }>,
  ): Promise<void> {
    if (!clickState.active) return;
    if (clickState.count >= CLICK_CAPTURE_MAX_FRAMES) {
      console.warn("[click-capture] max frames reached, auto-stopping");
      await stopClickCapture();
      return;
    }
    const now = Date.now();
    if (now - clickState.lastCaptureAt < CLICK_CAPTURE_MIN_INTERVAL_MS) return;
    clickState.lastCaptureAt = now;

    const target = await deps.host.resolveTarget();
    if (!target) return;
    const settings = await deps.host.loadSettings();

    // Sticky / scrollbar prep so post-click toasts / menus aren't
    // baked into the captured pixels — same dance the orchestrator
    // does for visible-mode.
    await beginCapturePrep(deps.host, target, "click", settings, 0);
    await delay(settings.timing.clickSettleMs);
    if (!clickState.active) {
      await endCapturePrep(deps.host, target);
      return;
    }

    let elementTree: ElementTree | undefined;
    try {
      const captured = await deps.host.captureViewport(target);
      elementTree = (await deps.host.requestElementTree(target)) ?? undefined;
      await endCapturePrep(deps.host, target);
      const encoded = await encodeCapture(captured.pngDataUrl, {
        format: settings.quality.format,
        smartFallback: settings.quality.smartFallback,
        smartColorThreshold: settings.quality.smartColorThreshold,
        jpegPercent: settings.quality.jpegPercent,
      });
      await persistClickFrame({
        dataUrl: encoded.dataUrl,
        clickMsg: msg,
        elementTree,
      });
      clickState.count += 1;
      refreshButtons();
      deps.setStatus(`Click ${clickState.count} captured`, "success");
    } catch (err) {
      try {
        await endCapturePrep(deps.host, target);
      } catch {
        /* ignore */
      }
      console.error("[click-capture] capture failed:", err);
      deps.setStatus(`Click capture failed: ${(err as Error).message}`, "error");
    }
  }

  async function persistClickFrame(args: {
    dataUrl: string;
    clickMsg: Extract<ContentToBackgroundMessage, { type: "click-detected" }>;
    elementTree: ElementTree | undefined;
  }): Promise<void> {
    const { dataUrl, clickMsg, elementTree } = args;
    const probed = await probeDataUrlDimensions(dataUrl);
    const sourceUrl = clickMsg.url || resolveLiveUrl();
    const title = (clickMsg.title || resolveLiveTitle()).slice(0, 120);
    const dpr = clickMsg.dpr || 1;

    const tags: Record<string, string> = {
      ...urlTags(sourceUrl),
      "click.target": clickMsg.target,
      "click.seq": String(clickState.count + 1).padStart(3, "0"),
      "click.url": sourceUrl,
      "click.title": title,
      "click.x": String(Math.round(clickMsg.x * dpr)),
      "click.y": String(Math.round(clickMsg.y * dpr)),
      "click.pageX": String(Math.round(clickMsg.pageX * dpr)),
      "click.pageY": String(Math.round(clickMsg.pageY * dpr)),
      captureId: newIdB58(),
      session: clickState.sessionId,
      sessionKind: "click",
      sessionIndex: String(clickState.count),
    };
    if (clickMsg.rect) {
      tags["click.rect.x"] = String(Math.round(clickMsg.rect.x * dpr));
      tags["click.rect.y"] = String(Math.round(clickMsg.rect.y * dpr));
      tags["click.rect.w"] = String(Math.round(clickMsg.rect.width * dpr));
      tags["click.rect.h"] = String(Math.round(clickMsg.rect.height * dpr));
    }

    const store = await deps.getStore();
    const ts = new Date().toISOString();
    await store.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: probed.width,
      height: probed.height,
      sourceUrl,
      tags,
      folderPath: deps.inboxFolder,
      createdAt: ts,
      updatedAt: ts,
      elementTree,
    });
  }

  async function startClickCapture(): Promise<void> {
    if (clickState.active) return;
    clickState.active = true;
    clickState.count = 0;
    clickState.lastCaptureAt = 0;
    clickState.sessionId = newIdB58();
    refreshButtons();
    deps.setStatus("Click capture armed — click anything in the page", "busy");
    const target = await deps.host.resolveTarget();
    if (target) {
      try {
        await deps.host.sendToContent(target, { type: "click-capture-enable" });
      } catch {
        /* preload might not be ready yet — re-issued on next navigation */
      }
    }
  }

  async function stopClickCapture(): Promise<void> {
    if (!clickState.active) return;
    clickState.active = false;
    refreshButtons();
    const finalCount = clickState.count;
    clickState.sessionId = "";
    const target = await deps.host.resolveTarget();
    if (target) {
      try {
        await deps.host.sendToContent(target, { type: "click-capture-disable" });
      } catch {
        /* preload may have torn down on the last navigation; ignore */
      }
    }
    deps.setStatus(
      finalCount > 0
        ? `Click capture stopped (${finalCount} saved to ${deps.inboxFolder}/)`
        : "Click capture stopped",
      finalCount > 0 ? "success" : null,
    );
  }

  // ---- Hotkey capture ────────────────────────────────────────
  //
  // The hotkey is registered in `main.ts` (`globalShortcut`); the
  // chrome receives a `hotkey-capture-shot` IPC event when the
  // hotkey fires AND the Browse window is focused. Pressing the
  // hotkey while inactive auto-starts the session — matches the
  // extension's `hotkeyCaptureShot` ergonomics.

  async function handleHotkeyShot(): Promise<void> {
    if (!hotkeyState.active) {
      await startHotkeyCapture();
    }
    const now = Date.now();
    if (now - hotkeyState.lastCaptureAt < HOTKEY_CAPTURE_MIN_INTERVAL_MS) return;
    hotkeyState.lastCaptureAt = now;

    const target = await deps.host.resolveTarget();
    if (!target) {
      deps.setStatus("Hotkey: no target webview", "error");
      return;
    }
    const settings = await deps.host.loadSettings();

    // Pull capture context (mouse position, focused element)
    // BEFORE the prep dance so the rect we record matches the
    // page state the user wanted to mark.
    let context: CaptureContext | null = null;
    try {
      context = await deps.host.sendToContent<CaptureContext>(target, {
        type: "get-capture-context",
      });
    } catch {
      /* preload not ready / page unloading — context is best-effort */
    }

    await beginCapturePrep(deps.host, target, "hotkey", settings, 0);
    await delay(settings.timing.hotkeySettleMs);
    if (!hotkeyState.active) {
      await endCapturePrep(deps.host, target);
      return;
    }

    try {
      const captured = await deps.host.captureViewport(target);
      const elementTree = (await deps.host.requestElementTree(target)) ?? undefined;
      await endCapturePrep(deps.host, target);
      const encoded = await encodeCapture(captured.pngDataUrl, {
        format: settings.quality.format,
        smartFallback: settings.quality.smartFallback,
        smartColorThreshold: settings.quality.smartColorThreshold,
        jpegPercent: settings.quality.jpegPercent,
      });
      await persistHotkeyFrame({
        dataUrl: encoded.dataUrl,
        context,
        elementTree,
      });
      hotkeyState.count += 1;
      refreshButtons();
      deps.setStatus(`Hotkey ${hotkeyState.count} captured`, "success");
    } catch (err) {
      try {
        await endCapturePrep(deps.host, target);
      } catch {
        /* ignore */
      }
      console.error("[hotkey] capture failed:", err);
      deps.setStatus(`Hotkey capture failed: ${(err as Error).message}`, "error");
    }
  }

  async function persistHotkeyFrame(args: {
    dataUrl: string;
    context: CaptureContext | null;
    elementTree: ElementTree | undefined;
  }): Promise<void> {
    const { dataUrl, context, elementTree } = args;
    const probed = await probeDataUrlDimensions(dataUrl);
    const url = context?.url || resolveLiveUrl();
    const title = (context?.title || resolveLiveTitle()).slice(0, 120);
    const dpr = Number(context?.dpr) || 1;

    const tags: Record<string, string> = {
      ...urlTags(url),
      "hotkey.seq": String(hotkeyState.count + 1).padStart(3, "0"),
      "click.title": title,
      "click.url": url,
      "click.target": context?.target || "",
      captureId: newIdB58(),
      session: hotkeyState.sessionId,
      sessionKind: "hotkey",
      sessionIndex: String(hotkeyState.count),
    };
    if (context?.mouse) {
      tags["click.x"] = String(Math.round(context.mouse.x * dpr));
      tags["click.y"] = String(Math.round(context.mouse.y * dpr));
    }
    if (context?.rect) {
      tags["click.rect.x"] = String(Math.round(context.rect.x * dpr));
      tags["click.rect.y"] = String(Math.round(context.rect.y * dpr));
      tags["click.rect.w"] = String(Math.round(context.rect.width * dpr));
      tags["click.rect.h"] = String(Math.round(context.rect.height * dpr));
    }

    const store = await deps.getStore();
    const ts = new Date().toISOString();
    await store.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl: "",
      annotationsSvg: "",
      width: probed.width,
      height: probed.height,
      sourceUrl: url,
      tags,
      folderPath: deps.inboxFolder,
      createdAt: ts,
      updatedAt: ts,
      elementTree,
    });
  }

  async function startHotkeyCapture(): Promise<void> {
    if (hotkeyState.active) return;
    hotkeyState.active = true;
    hotkeyState.count = 0;
    hotkeyState.lastCaptureAt = 0;
    hotkeyState.sessionId = newIdB58();
    refreshButtons();
    deps.setStatus(
      "Hotkey capture armed — press Alt+Shift+C while focused on this window to take a shot",
      "busy",
    );
  }

  async function stopHotkeyCapture(): Promise<void> {
    if (!hotkeyState.active) return;
    hotkeyState.active = false;
    refreshButtons();
    const finalCount = hotkeyState.count;
    hotkeyState.sessionId = "";
    deps.setStatus(
      finalCount > 0
        ? `Hotkey capture stopped (${finalCount} saved to ${deps.inboxFolder}/)`
        : "Hotkey capture stopped",
      finalCount > 0 ? "success" : null,
    );
  }

  // ---- Wire toolbar ──────────────────────────────────────────

  deps.btnClick.addEventListener("click", () => {
    if (clickState.active) {
      void stopClickCapture();
    } else {
      void startClickCapture();
    }
  });

  deps.btnHotkey.addEventListener("click", () => {
    if (hotkeyState.active) {
      void stopHotkeyCapture();
    } else {
      void startHotkeyCapture();
    }
  });

  refreshButtons();

  return {
    async toggleClickCapture(): Promise<void> {
      if (clickState.active) {
        await stopClickCapture();
      } else {
        await startClickCapture();
      }
    },
    async toggleHotkeyCapture(): Promise<void> {
      if (hotkeyState.active) {
        await stopHotkeyCapture();
      } else {
        await startHotkeyCapture();
      }
    },
    isClickActive: () => clickState.active,
    isHotkeyActive: () => hotkeyState.active,
    handleHotkeyShot,
    async reEnableClickCaptureAfterNavigation(): Promise<void> {
      if (!clickState.active) return;
      const target = await deps.host.resolveTarget();
      if (!target) return;
      try {
        await deps.host.sendToContent(target, { type: "click-capture-enable" });
      } catch {
        /* still loading; will retry on next navigation */
      }
    },
    dispose(): void {
      unsubscribe();
    },
  };
}

function setRecordingClass(btn: HTMLButtonElement, active: boolean): void {
  if (active) btn.classList.add("recording");
  else btn.classList.remove("recording");
}

async function probeDataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
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

/** Mirrors the `urlTags` helper in `browse.ts` — kept duplicated
 *  rather than imported so the module is self-contained for
 *  testing and so a future browse.ts refactor can pull this
 *  helper out without breaking click-hotkey. */
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
