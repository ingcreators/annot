/// <reference path="../types/chrome-extras.d.ts" />

/**
 * Chrome MV3 service worker. The capture state machines themselves
 * live in `@ingcreators/annot-capture/orchestrate` and are driven via
 * the `CaptureHost` adapter built in `./host.ts`. This file owns the
 * extension-specific concerns: popup / external / command listener
 * lifecycle, the click + hotkey session state machines, IDB persistence,
 * and the "open or reuse the PWA tab" routing.
 *
 * Phase 1B of `docs/plans/desktop-browser-mode.md`.
 */

import type { CaptureFrame } from "@ingcreators/annot-capture/orchestrate";
import {
  beginCapturePrep,
  endCapturePrep,
  runAreaCapture,
  runPerPageCapture,
  runScrollCapture,
  runVisibleCapture,
} from "@ingcreators/annot-capture/orchestrate";
import { resolveAutoCaptureOptions } from "@ingcreators/annot-core/auto-capture-options";
import { newIdB58 } from "@ingcreators/annot-core/utils";
import { logger } from "../logger.js";
import { encodeCapture } from "../shared/encode.js";
import { loadAutoCaptureOptions, loadSettings } from "../shared/settings.js";
// Static import of IDB store — used by external message API
import * as idbStore from "../storage/idb-store.js";
import { createChromeCaptureHost } from "./host.js";
import {
  ANNOTATION_URL,
  buildEditUrl,
  delay,
  HOTKEY_CAPTURE_MIN_INTERVAL_MS,
  IDB_MAX_AGE_MS,
  urlTags,
} from "./service-worker-helpers.js";

const host = createChromeCaptureHost();

// Auto-cleanup: delete images older than 7 days on startup
(async () => {
  try {
    const images = await idbStore.listImages("");
    const cutoff = Date.now() - IDB_MAX_AGE_MS;
    for (const img of images) {
      const created = new Date(img.createdAt).getTime();
      if (created < cutoff) {
        await idbStore.deleteImage(img.path);
      }
    }
  } catch {
    /* ignore on startup */
  }
})();

// ---- Capture entry points ────────────────────────────────────────

async function captureVisible(): Promise<void> {
  try {
    const result = await runVisibleCapture(host);
    if (!result || result.frames.length === 0) return;
    const frame = result.frames[0]!;
    await openEditorWithFrame(frame, result.target.url);
  } catch (err) {
    console.error("Annot: captureVisible failed", err);
  }
}

async function captureArea(): Promise<void> {
  try {
    const result = await runAreaCapture(host);
    if (!result || result.frames.length === 0) return;
    const frame = result.frames[0]!;
    await openEditorWithFrame(frame, result.target.url);
  } catch (err) {
    console.error("Annot: captureArea failed", err);
  }
}

async function captureFullPage(): Promise<void> {
  try {
    const result = await runScrollCapture(host);
    if (!result || result.frames.length === 0) return;
    const frame = result.frames[0]!;
    await saveAsScrollSession(frame, result.target.url);
  } catch (err) {
    console.error("Annot: captureFullPage failed", err);
  }
}

async function capturePages(): Promise<void> {
  try {
    const result = await runPerPageCapture(host);
    if (!result || result.frames.length === 0) return;
    await saveAsPerPageSession(result.frames, result.target.url);
  } catch (err) {
    console.error("Annot: capturePages failed", err);
  }
}

// ---- Persistence helpers ─────────────────────────────────────────

/**
 * Probe image dimensions from a data URL when the orchestrator left
 * them as 0 (visible mode currently does this so the height isn't
 * speculatively bumped during the encode pass).
 */
async function probeDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const w = bmp.width;
    const h = bmp.height;
    bmp.close();
    return { width: w, height: h };
  } catch (err) {
    logger.debug("[persist] image dimension probe failed:", err);
    return { width: 0, height: 0 };
  }
}

/** Save a single visible / area frame and open the editor on it. */
async function openEditorWithFrame(frame: CaptureFrame, sourceUrl: string): Promise<void> {
  let { width, height } = frame;
  if (!width || !height) {
    const probed = await probeDimensions(frame.dataUrl);
    width = probed.width;
    height = probed.height;
  }

  const tags: Record<string, string> = { ...urlTags(sourceUrl), captureId: newIdB58() };
  const thumbnailDataUrl = await idbStore.generateThumbnail(frame.dataUrl);
  const now = new Date().toISOString();
  const path = await idbStore.saveImage({
    originalDataUrl: frame.dataUrl,
    thumbnailDataUrl,
    annotationsSvg: "",
    width,
    height,
    sourceUrl,
    tags,
    folderPath: "",
    createdAt: now,
    updatedAt: now,
    pageMetadata: frame.pageMetadata ?? undefined,
  });

  const extId = chrome.runtime.id;
  const targetUrl = buildEditUrl(path, extId);
  await openOrReuseEditorTab(targetUrl, path, extId);
}

/**
 * Save a Scroll-Capture result as a session with one frame, then open
 * Annot in Split Editor mode. Users can split the tall capture into
 * multiple page-sized images.
 */
async function saveAsScrollSession(frame: CaptureFrame, sourceUrl: string): Promise<void> {
  const thumbnailDataUrl = await idbStore.generateThumbnail(frame.dataUrl);
  const now = new Date().toISOString();
  const sessionId = newIdB58();
  await idbStore.saveImage({
    originalDataUrl: frame.dataUrl,
    thumbnailDataUrl,
    annotationsSvg: "",
    width: frame.width,
    height: frame.height,
    sourceUrl,
    tags: {
      ...urlTags(sourceUrl),
      captureId: newIdB58(),
      session: sessionId,
      sessionKind: "scroll",
      sessionIndex: "0",
      sessionTotal: "1",
      page: "1",
    },
    folderPath: "",
    createdAt: now,
    updatedAt: now,
    pageMetadata: frame.pageMetadata,
  });
  await openOrReuseAnnotTab(chrome.runtime.id, sessionId);
}

/** Save N per-page frames as a session, then open Annot in Bulk
 *  Editor mode. */
async function saveAsPerPageSession(frames: CaptureFrame[], sourceUrl: string): Promise<void> {
  const baseTags: Record<string, string> = { ...urlTags(sourceUrl) };
  const sessionId = newIdB58();
  const total = frames.length;

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]!;
    const thumbnailDataUrl = await idbStore.generateThumbnail(frame.dataUrl);
    const now = new Date().toISOString();
    await idbStore.saveImage({
      originalDataUrl: frame.dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: frame.width,
      height: frame.height,
      sourceUrl,
      tags: {
        ...baseTags,
        page: String(i + 1),
        captureId: newIdB58(),
        session: sessionId,
        sessionKind: "perPage",
        sessionIndex: String(i),
        sessionTotal: String(total),
      },
      folderPath: "",
      createdAt: now,
      updatedAt: now,
      pageMetadata: frame.pageMetadata,
    });
  }

  await openOrReuseAnnotTab(chrome.runtime.id, sessionId);
}

// ---- Editor tab routing ──────────────────────────────────────────

/**
 * Locate an open Annot tab. Relaxed status check — even a loading tab
 * is fine.
 */
async function findAnnotTab(): Promise<chrome.tabs.Tab | undefined> {
  try {
    const results = await chrome.tabs.query({ url: `${ANNOTATION_URL}/*` });
    if (results.length > 0) {
      // Prefer the most-recently-active tab
      results.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
      return results.find((t) => t.id != null);
    }
  } catch (e) {
    console.warn("[findAnnotTab] filtered query failed, falling back:", e);
  }
  // Fallback: full scan + manual filter
  const all = await chrome.tabs.query({});
  return (
    all.find((t) => t.id && t.url?.startsWith(`${ANNOTATION_URL}/`)) ||
    all.find((t) => t.id != null && t.url === ANNOTATION_URL) ||
    all.find((t) => t.id != null && t.url?.startsWith(ANNOTATION_URL))
  );
}

/**
 * Open the editor at `targetUrl` (full edit URL) — reuse the existing
 * Annot tab and dispatch an `annot-capture` event when one's open;
 * otherwise create a new tab.
 */
async function openOrReuseEditorTab(targetUrl: string, path: string, extId: string): Promise<void> {
  const existing = await findAnnotTab();
  if (existing?.id) {
    try {
      await chrome.windows.update(existing.windowId!, { focused: true }).catch(() => {});
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: existing.id },
        // chrome-types declares `func: () => void` without a generic for
        // args, so we cast. Chrome passes `args` at runtime regardless.
        func: ((editPath: string, ext: string) => {
          window.dispatchEvent(
            new CustomEvent("annot-capture", {
              detail: { editPath, extId: ext },
            }),
          );
        }) as () => void,
        args: [path, extId],
      });
      logger.debug("[openEditor] reused existing tab", existing.id, existing.url);
      return;
    } catch (e) {
      console.warn("[openEditor] executeScript failed, opening new tab:", e);
    }
  }
  logger.debug("[openEditor] no existing Annot tab found, opening new");
  chrome.tabs.create({ url: targetUrl });
}

/**
 * Reuse an existing Annot tab if one is open, otherwise create a new
 * one. Uses the given `extId` as a query param so the app can transfer
 * pending Extension IDB images to local storage on load (or in an
 * existing tab, triggers the same transfer via popstate).
 */
async function openOrReuseAnnotTab(extId: string, sessionId?: string): Promise<void> {
  const existing = await findAnnotTab();
  if (existing?.id) {
    try {
      await chrome.windows.update(existing.windowId!, { focused: true }).catch(() => {});
      await chrome.tabs.update(existing.id, { active: true });
      await chrome.scripting.executeScript({
        target: { tabId: existing.id },
        func: ((ext: string, sid: string | null) => {
          const url = new URL(location.href);
          url.searchParams.set("extId", ext);
          if (sid) url.searchParams.set("session", sid);
          history.replaceState({}, "", url.toString());
          window.dispatchEvent(new PopStateEvent("popstate"));
        }) as () => void,
        args: [extId, sessionId ?? null],
      });
      logger.debug("[openOrReuseAnnotTab] reused tab", existing.id, "session=", sessionId);
      return;
    } catch (e) {
      console.warn("[openOrReuseAnnotTab] executeScript failed, opening new tab:", e);
    }
  }
  const params = new URLSearchParams({ extId });
  if (sessionId) params.set("session", sessionId);
  chrome.tabs.create({ url: `${ANNOTATION_URL}?${params.toString()}` });
}

async function openGallery(): Promise<void> {
  await openOrReuseAnnotTab(chrome.runtime.id);
}

// ---- Session state ───────────────────────────────────────────────

/**
 * Hotkey Capture session shape. One active session per service
 * worker; each press of the `hotkey` command (configurable in the
 * browser's extension shortcuts page, default `Alt+Shift+Z`) fires
 * `hotkeyCaptureShot` which appends a frame to the IDB session
 * bound by `sessionId`. The Click Capture surface (which previously
 * shared this shape) was retired in
 * `docs/plans/browser-extension-web-optimized-pudding.md`.
 */
interface HotkeyCaptureState {
  active: boolean;
  count: number;
  /** Timestamp of last capture — used to debounce rapid presses. */
  lastCaptureAt: number;
  /** uuid7-base58 session id; set at start, reused for every capture. */
  sessionId: string;
}

const hotkeyState: HotkeyCaptureState = {
  active: false,
  count: 0,
  lastCaptureAt: 0,
  sessionId: "",
};

/**
 * Auto Capture session state. The session itself is one continuous
 * stream of captures; the MutationObserver follows the
 * currently-active tab so the user can walk between tabs and have
 * their workflow recorded as a single session. `tabId` is the tab
 * the observer is currently installed on (= the active tab at the
 * last `tabs.onActivated` / `windows.onFocusChanged`), or `null`
 * while focus is on a non-injectable URL (chrome://, devtools, etc.)
 * — in that case captures are dormant but the session is still
 * "active" and will resume when the user returns to an injectable
 * page.
 *
 * Chrome's `chrome.tabs.captureVisibleTab` only ever captures the
 * window's active tab; pure multi-observer designs can't actually
 * produce frames from backgrounded tabs anyway, so "session follows
 * the active tab" is the natural multi-tab model.
 */
interface AutoCaptureState {
  active: boolean;
  count: number;
  lastCaptureAt: number;
  sessionId: string;
  /** Tab currently hosting the observer. `null` while focus is on a
   *  non-injectable URL or between tab switches. Always reset to
   *  `null` when the session ends. */
  tabId: number | null;
  /** Hash of the most recently captured frame (for dedupe). Cleared
   *  on tab switch so the first frame on a new tab can never be
   *  deduped against a leftover hash from the previous tab. */
  lastFrameHash: string;
  /** Resolved min-interval between captures in milliseconds. Global
   *  to the session — switching tabs does NOT bypass it, otherwise a
   *  user rapidly cycling tabs could swamp the encoder. */
  minIntervalMs: number;
  /** Resolved stable-wait in milliseconds (passed to the content
   *  script so it can tune its MutationObserver debounce). */
  stableWaitMs: number;
}

const autoState: AutoCaptureState = {
  active: false,
  count: 0,
  lastCaptureAt: 0,
  sessionId: "",
  tabId: null,
  lastFrameHash: "",
  minIntervalMs: 0,
  stableWaitMs: 0,
};

function getHotkeyCaptureStatus(): { active: boolean; count: number } {
  return { active: hotkeyState.active, count: hotkeyState.count };
}

function getAutoCaptureStatus(): {
  active: boolean;
  count: number;
  stableWaitMs: number;
  minIntervalMs: number;
} {
  return {
    active: autoState.active,
    count: autoState.count,
    stableWaitMs: autoState.stableWaitMs,
    minIntervalMs: autoState.minIntervalMs,
  };
}

function updateBadge(): void {
  if (hotkeyState.active) {
    chrome.action.setBadgeBackgroundColor({ color: "#e44" });
    chrome.action.setBadgeText({ text: String(hotkeyState.count) });
  } else if (autoState.active) {
    chrome.action.setBadgeBackgroundColor({ color: "#e44" });
    chrome.action.setBadgeText({ text: String(autoState.count) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Restore the Hotkey session across service-worker restarts.
(async () => {
  try {
    const res = await chrome.storage.local.get(["hotkeyCaptureActive", "hotkeyCaptureSession"]);
    if (res.hotkeyCaptureActive) {
      hotkeyState.active = true;
      hotkeyState.sessionId = res.hotkeyCaptureSession || newIdB58();
    }
    updateBadge();
  } catch (err) {
    logger.debug("[startup] capture-state restore failed:", err);
  }
})();

// ---- Hotkey Capture ──────────────────────────────────────────────

async function startHotkeyCapture(): Promise<void> {
  if (hotkeyState.active) return;
  hotkeyState.active = true;
  hotkeyState.count = 0;
  hotkeyState.lastCaptureAt = 0;
  hotkeyState.sessionId = newIdB58();
  await chrome.storage.local.set({
    hotkeyCaptureActive: true,
    hotkeyCaptureSession: hotkeyState.sessionId,
  });
  updateBadge();
}

async function stopHotkeyCapture(): Promise<void> {
  if (!hotkeyState.active) return;
  hotkeyState.active = false;
  await chrome.storage.local.set({ hotkeyCaptureActive: false });
  const finalCount = hotkeyState.count;
  hotkeyState.sessionId = "";
  updateBadge();

  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Triggered by the `hotkey` command (default `Alt+Shift+Z`).
 *  Auto-starts the session on first press. */
async function hotkeyCaptureShot(firedTab?: chrome.tabs.Tab): Promise<void> {
  logger.debug("[hotkey] shot fired, active=", hotkeyState.active, "firedTab=", firedTab?.id);
  if (!hotkeyState.active) {
    await startHotkeyCapture();
  }

  const now = Date.now();
  if (now - hotkeyState.lastCaptureAt < HOTKEY_CAPTURE_MIN_INTERVAL_MS) return;
  hotkeyState.lastCaptureAt = now;

  // Prefer the tab that Chrome reports with the command (MV3 supplies
  // it), then fall back to queries. lastFocusedWindow is more reliable
  // than currentWindow when focus has moved to a non-Chrome app.
  let tab = firedTab;
  if (!tab?.id) {
    const byCurrent = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = byCurrent[0];
  }
  if (!tab?.id) {
    const byLast = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = byLast[0];
  }
  if (!tab?.id) {
    const anyActive = await chrome.tabs.query({ active: true });
    tab = anyActive[0];
  }
  if (!tab?.id || tab.windowId == null) {
    console.warn("[hotkey] no active tab found");
    return;
  }

  const target = { id: tab.id, windowId: tab.windowId, url: tab.url ?? "" };

  // Query content script for mouse / focused-element context (best-effort).
  // Fails silently on pages we can't inject into (chrome://, PDF viewer, etc.)
  interface CaptureContext {
    url?: string;
    title?: string;
    dpr?: number;
    target?: string;
    mouse?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  }
  let context: CaptureContext | null = null;
  const injectable = !!tab.url && /^(https?|file):/.test(tab.url);
  if (injectable) {
    try {
      await host.injectContentScript(target);
      context = (await host
        .sendToContent<CaptureContext>(target, { type: "get-capture-context" })
        .catch(() => null)) as CaptureContext | null;
    } catch (e) {
      logger.debug("[hotkey] context query failed:", e);
    }
  }

  const settings = await loadSettings();

  if (injectable) {
    await beginCapturePrep(host, target, "hotkey", settings, 0);
  }

  // Small settle delay so menus/hover states render
  await delay(settings.timing.hotkeySettleMs);
  if (!hotkeyState.active) {
    if (injectable) await endCapturePrep(host, target);
    return;
  }

  try {
    logger.debug("[hotkey] capturing window", tab.windowId);
    const captured = await host.captureViewport(target);
    if (injectable) await endCapturePrep(host, target);
    const encoded = await encodeCapture(captured.pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;
    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);

    const { width: w, height: h } = await probeDimensions(dataUrl);

    const ts = new Date().toISOString();
    const url = context?.url || tab.url || "";
    const title = (context?.title || tab.title || "").slice(0, 120);
    const dpr = Number(context?.dpr) || 1;

    const tags: Record<string, string> = {
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
    Object.assign(tags, urlTags(url));

    const meta = injectable ? await host.requestPageMetadata(target) : null;

    await idbStore.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: url,
      tags,
      folderPath: "",
      createdAt: ts,
      updatedAt: ts,
      pageMetadata: meta ?? undefined,
    });

    hotkeyState.count += 1;
    updateBadge();
  } catch (e) {
    console.error("[hotkey] capture failed:", e);
    if (injectable) await endCapturePrep(host, target);
  }
}

// ---- Auto Capture (DOM-mutation-driven) ───────────────────────────

/** SHA-256 of the data URL — used to dedupe identical successive
 *  frames. Hash on the encoded data URL rather than a downscaled
 *  bitmap because the encoder + Save Size preset already collapse
 *  visually-equivalent frames to identical bytes most of the time;
 *  this stays a cheap "did anything change at all" gate. */
async function hashDataUrl(dataUrl: string): Promise<string> {
  // Strip the `data:image/...;base64,` prefix before hashing so the
  // hash is stable across format changes that re-encode identical
  // pixels (rare, but worth being defensive).
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(payload));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Inject the content script + enable its MutationObserver on the
 *  given tab. Idempotent: returns early if the observer is already
 *  installed there. Failures (chrome://, no permission, etc.) leave
 *  the session "active but dormant" — `tabId` becomes `null` and the
 *  next tab switch retries. */
async function activateObserverOn(tabId: number, windowId: number, url: string): Promise<void> {
  if (!autoState.active) return;
  if (autoState.tabId === tabId) return; // already on this tab

  // Tear down the previous tab's observer first so we don't leave
  // orphan listeners on tabs the user has moved away from.
  if (autoState.tabId != null && autoState.tabId !== tabId) {
    await deactivateObserverOn(autoState.tabId);
  }

  // Reset per-tab dedupe baseline — different tab, different content;
  // the first frame on the new tab should never be deduped against a
  // leftover hash from the previous tab.
  autoState.lastFrameHash = "";

  const injectable = /^(https?|file):/.test(url);
  if (!injectable) {
    autoState.tabId = null;
    return;
  }

  const target = { id: tabId, windowId, url };
  try {
    await host.injectContentScript(target);
    await host.sendToContent(target, {
      type: "auto-capture-enable",
      stableWaitMs: autoState.stableWaitMs,
    });
    autoState.tabId = tabId;
    logger.debug("[auto] observer installed on tab", tabId);
    // Initial baseline frame for the newly-bound tab. Without it
    // the session's first IDB image would be "page state after
    // the first DOM mutation" — no record of the starting state,
    // which doesn't match "I just hit Auto, save what I'm looking
    // at now". This also captures the new tab's baseline after a
    // tab switch / navigation rebind, so the timeline reads as
    // "Step N: I switched to / loaded this page, here's what it
    // looked like before I did anything".
    void autoCaptureShot(tabId);
  } catch (e) {
    logger.debug("[auto] observer install failed on tab", tabId, e);
    autoState.tabId = null;
  }
}

/** Best-effort disable of the observer on `tabId`. Silent if the tab
 *  has closed or is otherwise unreachable. */
async function deactivateObserverOn(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const target = { id: tabId, windowId: tab.windowId, url: tab.url ?? "" };
    await host.sendToContent(target, { type: "auto-capture-disable" }).catch(() => undefined);
  } catch {
    // tab gone — observer cleanup happens implicitly on tab destruction
  }
}

async function startAutoCapture(): Promise<void> {
  if (autoState.active) return;

  // Pick the active tab when the session starts. The observer
  // installs there and then follows the user across tab / window
  // switches via the `tabs.onActivated` / `windows.onFocusChanged`
  // listeners below.
  const byCurrent = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = byCurrent[0];
  if (!tab?.id) {
    const byLast = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tab = byLast[0];
  }
  if (!tab?.id || tab.windowId == null) {
    console.warn("[auto] no active tab");
    return;
  }

  const opts = await loadAutoCaptureOptions();
  const resolved = resolveAutoCaptureOptions(opts);

  autoState.active = true;
  autoState.count = 0;
  autoState.lastCaptureAt = 0;
  autoState.sessionId = newIdB58();
  autoState.tabId = null;
  autoState.lastFrameHash = "";
  autoState.minIntervalMs = resolved.intervalMs;
  autoState.stableWaitMs = resolved.stableWaitMs;

  await activateObserverOn(tab.id, tab.windowId, tab.url ?? "");
  updateBadge();
  logger.debug("[auto] started", { tab: tab.id, ...resolved });
}

async function stopAutoCapture(): Promise<void> {
  if (!autoState.active) return;

  const lastTabId = autoState.tabId;
  const finalCount = autoState.count;

  autoState.active = false;
  autoState.tabId = null;
  autoState.sessionId = "";
  autoState.lastFrameHash = "";
  updateBadge();

  if (lastTabId != null) {
    await deactivateObserverOn(lastTabId);
  }

  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Fired by the content script's MutationObserver when DOM
 *  mutations have settled for `stableWaitMs`. Applies the
 *  min-interval throttle + duplicate-frame dedupe, then delegates
 *  to `performAutoCapture` for the shared capture + save + count
 *  increment work. */
async function autoCaptureShot(senderTabId?: number): Promise<void> {
  if (!autoState.active) return;
  if (senderTabId != null && senderTabId !== autoState.tabId) return; // ignore other tabs

  const now = Date.now();
  if (now - autoState.lastCaptureAt < autoState.minIntervalMs) return;
  autoState.lastCaptureAt = now;

  await performAutoCapture({ manual: false });
}

/** Manual "Add Capture" press from the popup's `autoActive` view.
 *  Skips the sender-tab check (no senderTabId), the min-interval
 *  throttle, and the duplicate-frame dedupe — the user explicitly
 *  asked for this frame, even if the page hasn't visibly mutated.
 *  Still uses `autoState.tabId` for the capture target so the
 *  session stays bound to its original tab (cross-tab safety: if
 *  the popup is currently on a different tab, we still capture the
 *  session's tab, not the popup's). */
async function autoCaptureManual(): Promise<void> {
  if (!autoState.active) return;
  if (autoState.tabId == null) {
    console.warn("[auto] manual capture skipped — session has no bound tab");
    return;
  }
  await performAutoCapture({ manual: true });
}

/** Shared capture path for both observer-driven (`autoCaptureShot`)
 *  and manual (`autoCaptureManual`) entries. Both flows resolve the
 *  tab from `autoState.tabId`, prep/restore stickies and scrollbars,
 *  call `host.captureViewport`, encode + thumb + save with session
 *  tags, then increment the session count + update the badge. The
 *  `manual` flag controls whether the duplicate-frame dedupe runs
 *  and gets recorded in `auto.trigger`. */
async function performAutoCapture(opts: { manual: boolean }): Promise<void> {
  const { manual } = opts;
  const tabId = autoState.tabId;
  if (tabId == null) return;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    // Tab closed mid-session — stop gracefully.
    await stopAutoCapture();
    return;
  }
  if (tab.windowId == null) return;
  const target = { id: tabId, windowId: tab.windowId, url: tab.url ?? "" };

  interface CaptureContext {
    url?: string;
    title?: string;
    dpr?: number;
    target?: string;
    mouse?: { x: number; y: number };
    rect?: { x: number; y: number; width: number; height: number };
  }
  const context = (await host
    .sendToContent<CaptureContext>(target, { type: "get-capture-context" })
    .catch(() => null)) as CaptureContext | null;

  const settings = await loadSettings();
  // Per-shot hide/restore — same flow Visible / Select / Whole Page
  // use. Each shot briefly hides scrollbars + stickies (per
  // `Settings.scrollbars.hide` + `Settings.overlays.mode`), waits a
  // paint flush, captures, restores. The Rolldown mangler bug that
  // earlier caused `restoreScrollbars` to silently no-op (and made
  // session-wide hide a necessary workaround) is fixed at the
  // build-config level in `vite.content.config.ts`
  // (`output.minify.mangle.keepNames: true`); the per-shot path now
  // restores reliably.
  await beginCapturePrep(host, target, "hotkey", settings, 0);
  await delay(settings.timing.hotkeySettleMs);
  if (!autoState.active) {
    await endCapturePrep(host, target);
    return;
  }

  try {
    const captured = await host.captureViewport(target);
    await endCapturePrep(host, target);
    const encoded = await encodeCapture(captured.pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;

    // Manual presses bypass dedupe — the user explicitly wants this
    // frame even if the pixels match the last one. Observer-driven
    // presses still dedupe so micro-mutations don't flood storage.
    if (!manual) {
      const frameHash = await hashDataUrl(dataUrl);
      if (frameHash === autoState.lastFrameHash) {
        logger.debug("[auto] dropping duplicate frame");
        return;
      }
      autoState.lastFrameHash = frameHash;
    } else {
      // Keep `lastFrameHash` in sync so the next observer tick
      // doesn't reject the page state that the manual frame just
      // captured.
      autoState.lastFrameHash = await hashDataUrl(dataUrl);
    }

    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);
    const { width: w, height: h } = await probeDimensions(dataUrl);
    const ts = new Date().toISOString();
    const url = context?.url || tab.url || "";
    const title = (context?.title || tab.title || "").slice(0, 120);

    const tags: Record<string, string> = {
      "auto.seq": String(autoState.count + 1).padStart(3, "0"),
      "auto.trigger": manual ? "manual" : "observer",
      "click.title": title,
      "click.url": url,
      captureId: newIdB58(),
      session: autoState.sessionId,
      sessionKind: "auto",
      sessionIndex: String(autoState.count),
    };
    Object.assign(tags, urlTags(url));

    const meta = await host.requestPageMetadata(target);

    await idbStore.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: url,
      tags,
      folderPath: "",
      createdAt: ts,
      updatedAt: ts,
      pageMetadata: meta ?? undefined,
    });

    autoState.count += 1;
    updateBadge();
  } catch (e) {
    console.error("[auto] capture failed:", e);
    await endCapturePrep(host, target);
  }
}

// ---- External-message API (for annotating.work / noting.work) ─────

async function handleExternalMessage(msg: any): Promise<any> {
  switch (msg.action) {
    // Images (path-based)
    case "listImages":
      return idbStore.listImages(msg.folderPath ?? "");
    case "getImage":
      return idbStore.getImage(msg.path);
    case "saveImage":
      return idbStore.saveImage(msg.data, msg.opts);
    case "updateImage":
      return idbStore.updateImage(msg.path, msg.updates);
    case "moveImage":
      return idbStore.moveImage(msg.path, msg.newFolderPath ?? "");
    case "renameImage":
      return idbStore.renameImage(msg.path, msg.name);
    case "deleteImage":
      return idbStore.deleteImage(msg.path);

    // Folders (path-based)
    case "listFolders":
      return idbStore.listFolders(msg.parentPath ?? "");
    case "getFolder":
      return idbStore.getFolder(msg.path);
    case "createFolder":
      return idbStore.createFolder(msg.parentPath ?? "", msg.name);
    case "renameFolder":
      return idbStore.renameFolder(msg.path, msg.name);
    case "moveFolder":
      return idbStore.moveFolder(msg.path, msg.newParentPath ?? "");
    case "deleteFolder":
      return idbStore.deleteFolder(msg.path);
    case "getBreadcrumb":
      return idbStore.getBreadcrumb(msg.path ?? "");

    // Thumbnail
    case "generateThumbnail":
      return idbStore.generateThumbnail(msg.dataUrl, msg.maxWidth);

    // Ping — check extension is alive
    case "ping":
      return { ok: true, version: "2.0.0" };

    default:
      return { error: `Unknown action: ${msg.action}` };
  }
}

// ---- Listener registrations ──────────────────────────────────────

// chrome.runtime listener payloads are untyped on the wire — every
// concrete handler narrows by `msg.type` below.
chrome.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
  switch (msg.type) {
    case "visible-area":
      captureVisible();
      break;
    case "select-region":
      captureArea();
      break;
    case "whole-page-stitched":
      captureFullPage();
      break;
    case "whole-page-per-screen":
      capturePages();
      break;
    case "open-gallery":
      openGallery();
      break;

    // ---- Hotkey Capture ----
    case "hotkey-start":
      startHotkeyCapture();
      break;
    case "hotkey-stop":
      stopHotkeyCapture();
      break;
    case "hotkey-status":
      sendResponse(getHotkeyCaptureStatus());
      return false;
    // Manual "Add Capture" press from the popup's `hotkeyActive`
    // view. `hotkeyCaptureShot(undefined)` already auto-starts the
    // session, falls through `chrome.tabs.query` for the active
    // tab, and applies the 100ms debounce — no new logic needed.
    case "hotkey-capture-now":
      hotkeyCaptureShot();
      break;

    // ---- Auto Capture (DOM-mutation-driven) ----
    case "auto-start":
      startAutoCapture();
      break;
    case "auto-stop":
      stopAutoCapture();
      break;
    case "auto-status":
      sendResponse(getAutoCaptureStatus());
      return false;
    // Manual "Add Capture" press from the popup's `autoActive`
    // view. Skips throttle + dedupe so purely-visual changes that
    // the MutationObserver missed (CSS hover, transitions) still
    // produce a frame.
    case "auto-capture-now":
      autoCaptureManual();
      break;
    // `auto-capture-signal` is a content → background message (the
    // content-script enablement protocol), not a popup IPC type, so
    // it keeps the `auto-capture-` prefix shared with its
    // `auto-capture-{enable,disable}` siblings in
    // `BackgroundToContentMessage`.
    case "auto-capture-signal":
      autoCaptureShot(sender.tab?.id);
      break;
  }
  return undefined;
});

// ---- Auto Capture: follow the active tab ────────────────────────
//
// The session is one continuous stream of captures. As the user
// walks between tabs, the observer migrates with them. Listeners
// below cover the four ways the "currently observed tab" can
// change: tab activation within a window, window-focus change
// between windows, the observed tab being closed, and the observed
// tab navigating to a new top-frame URL.

chrome.tabs.onActivated.addListener((info) => {
  if (!autoState.active) return;
  void (async () => {
    try {
      const tab = await chrome.tabs.get(info.tabId);
      await activateObserverOn(info.tabId, info.windowId, tab.url ?? "");
    } catch (e) {
      logger.debug("[auto] onActivated handler failed:", e);
    }
  })();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!autoState.active) return;
  // Chrome fires `WINDOW_ID_NONE` when focus leaves Chrome entirely
  // (user switched to another app). Keep the observer in place —
  // when they come back, focus returns and a real id arrives.
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void (async () => {
    try {
      const [active] = await chrome.tabs.query({ active: true, windowId });
      if (!active?.id) return;
      await activateObserverOn(active.id, windowId, active.url ?? "");
    } catch (e) {
      logger.debug("[auto] onFocusChanged handler failed:", e);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (!autoState.active) return;
  if (autoState.tabId !== tabId) return;
  // The observed tab is gone — the MutationObserver died with the
  // page. Clear the slot; the next `tabs.onActivated` /
  // `windows.onFocusChanged` will rebind the observer on whatever
  // tab the user lands on next.
  autoState.tabId = null;
  autoState.lastFrameHash = "";
});

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!autoState.active) return;
  if (info.status !== "complete" || !tab.url) return;

  // Case 1: top-frame navigation in the currently-observed tab —
  // observer is gone with the old page. Re-install on the new
  // page.
  if (autoState.tabId === tabId) {
    autoState.tabId = null; // force re-activation path inside activateObserverOn
    void activateObserverOn(tabId, tab.windowId, tab.url);
    return;
  }

  // Case 2: observer is dormant (no tab currently bound) AND this
  // tab is active in its window — catch up. The most common path
  // here is "user clicked a link that opened a new tab":
  // `tabs.onActivated` fires for the new tab almost immediately
  // with `tab.url === "about:blank"`, which fails the injectability
  // gate in `activateObserverOn` and leaves `autoState.tabId`
  // null. By the time the navigation completes and `onUpdated`
  // fires with the real URL, nothing has rebound the observer.
  // This branch picks it back up.
  if (autoState.tabId === null && tab.active) {
    void activateObserverOn(tabId, tab.windowId, tab.url);
  }
});

chrome.commands.onCommand.addListener((command, tab) => {
  logger.debug("[cmd]", command, "tab:", tab?.id, tab?.url);
  // Command names mirror the popup button labels (kebab-cased) so
  // they read coherently in chrome://extensions/shortcuts. The
  // `PopupMessage` types use the same base names so the two
  // listeners line up by eye.
  switch (command) {
    case "visible-area":
      captureVisible();
      break;
    case "select-region":
      captureArea();
      break;
    case "whole-page":
      captureFullPage();
      break;
    case "hotkey":
      // Auto Capture takes precedence: when an Auto session is
      // already running, the Hotkey shortcut routes its capture
      // into that session via the same `autoCaptureManual` path
      // the popup's "Add Capture" button uses. Without this guard
      // the legacy behaviour was to start a parallel Hotkey session
      // — two independent sessionIds writing into IDB concurrently,
      // which surfaced as two separate review groups for the user.
      if (autoState.active) {
        autoCaptureManual();
      } else {
        hotkeyCaptureShot(tab);
      }
      break;
  }
});

chrome.runtime.onMessageExternal.addListener(
  // External callers post arbitrary JSON over `runtime.sendMessage`;
  // the dispatch below validates `msg.action` before doing anything.
  (msg: any, _sender, sendResponse: (response: any) => void) => {
    if (!msg || typeof msg.action !== "string") {
      sendResponse({ error: "Invalid message" });
      return true;
    }
    handleExternalMessage(msg)
      .then(sendResponse)
      .catch((e) => {
        sendResponse({ error: String(e) });
      });
    return true; // keep channel open for async response
  },
);
