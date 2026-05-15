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
 * worker; each Alt+Shift+C press fires `hotkeyCaptureShot` which
 * appends a frame to the IDB session bound by `sessionId`. The
 * Click Capture surface (which previously shared this shape) was
 * retired in `docs/plans/browser-extension-web-optimized-pudding.md`.
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
  /** Whether the session should install a persistent scrollbar-hide
   *  style on each tab it observes. Captured from
   *  `Settings.scrollbars.hide` at session start. The hide stays
   *  installed for the entire duration we observe a tab — captures
   *  themselves no longer flick scrollbars on/off (which produced
   *  visible flicker and a self-perpetuating capture loop on
   *  reactively-laid-out pages). Restored at tab unbind / session
   *  end. */
  scrollbarsHidden: boolean;
}

/** Tabs we've sent `hide-for-capture` to during the current session.
 *  Tracked independently of `autoState.tabId` (which only points at
 *  the currently-observed tab) so we can definitively restore every
 *  tab the session touched when it stops — even if `autoState.tabId`
 *  was cleared in between (e.g. the user navigated to a chrome://
 *  page or the bound tab closed mid-session). The Set is drained on
 *  every `restore-after-capture` send and on `stopAutoCapture`. */
const autoHiddenTabs = new Set<number>();

const autoState: AutoCaptureState = {
  active: false,
  count: 0,
  lastCaptureAt: 0,
  sessionId: "",
  tabId: null,
  lastFrameHash: "",
  minIntervalMs: 0,
  stableWaitMs: 0,
  scrollbarsHidden: false,
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
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// Restore hotkey-capture state across service-worker restarts.
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

/** Triggered by the Alt+Shift+C hotkey. Auto-starts the session on first press. */
async function hotkeyCaptureShot(firedTab?: chrome.tabs.Tab): Promise<void> {
  logger.debug(
    "[hotkey-capture] shot fired, active=",
    hotkeyState.active,
    "firedTab=",
    firedTab?.id,
  );
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
    console.warn("[hotkey-capture] no active tab found");
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
      logger.debug("[hotkey-capture] context query failed:", e);
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
    logger.debug("[hotkey-capture] capturing window", tab.windowId);
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
    console.error("[hotkey-capture] capture failed:", e);
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
    // Persistent scrollbar hide for the entire time we observe this
    // tab. Sent BEFORE `auto-capture-enable` so the `MutationObserver`
    // starts watching AFTER the page has reacted to the scrollbar
    // gutter disappearing — otherwise the reactive re-layout (React /
    // Vue / ResizeObserver-driven components etc.) would trip the
    // observer and produce a spurious capture on every tab bind.
    //
    // We deliberately pass `overlays: false` so stickies stay visible
    // during the user's interaction — they can be load-bearing UI
    // (cookie banners, modal triggers) and hiding them for the whole
    // session is too invasive. Scrollbars are the only chrome we
    // actually want gone from every frame.
    if (autoState.scrollbarsHidden) {
      await host
        .sendToContent(target, {
          type: "hide-for-capture",
          overlays: false,
          preservedSelectors: [],
          scrollbars: true,
        })
        .catch(() => undefined);
      autoHiddenTabs.add(tabId);
    }
    await host.sendToContent(target, {
      type: "auto-capture-enable",
      stableWaitMs: autoState.stableWaitMs,
    });
    autoState.tabId = tabId;
    logger.debug("[auto-capture] observer installed on tab", tabId);
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
    logger.debug("[auto-capture] observer install failed on tab", tabId, e);
    autoState.tabId = null;
  }
}

/** Best-effort disable of the observer on `tabId`. Silent if the tab
 *  has closed or is otherwise unreachable. Also restores the
 *  scrollbar-hide style we installed at observer bind so the user's
 *  page is left in its natural state when the session migrates away
 *  / ends. */
async function deactivateObserverOn(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const target = { id: tabId, windowId: tab.windowId, url: tab.url ?? "" };
    await host.sendToContent(target, { type: "auto-capture-disable" }).catch(() => undefined);
    // Always attempt restore — `restoreAfterCapture` is idempotent
    // (`restoreScrollbars` is `getElementById(...)?.remove()`), and
    // dropping the conditional shaves a class of bugs where
    // `autoState.scrollbarsHidden` could be cleared before
    // `deactivateObserverOn` runs.
    await host.sendToContent(target, { type: "restore-after-capture" }).catch(() => undefined);
  } catch {
    // tab gone — observer cleanup happens implicitly on tab destruction
  }
  autoHiddenTabs.delete(tabId);
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
    console.warn("[auto-capture] no active tab");
    return;
  }

  const opts = await loadAutoCaptureOptions();
  const resolved = resolveAutoCaptureOptions(opts);
  // Capture the scrollbar-hide preference at session start so the
  // user toggling it mid-session doesn't leave the observed tab in
  // an inconsistent state (some tabs hidden, the next ones not).
  const settings = await loadSettings();

  autoState.active = true;
  autoState.count = 0;
  autoState.lastCaptureAt = 0;
  autoState.sessionId = newIdB58();
  autoState.tabId = null;
  autoState.lastFrameHash = "";
  autoState.minIntervalMs = resolved.intervalMs;
  autoState.stableWaitMs = resolved.stableWaitMs;
  autoState.scrollbarsHidden = settings.scrollbars.hide;

  await activateObserverOn(tab.id, tab.windowId, tab.url ?? "");
  updateBadge();
  logger.debug("[auto-capture] started", { tab: tab.id, ...resolved });
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
  // Belt-and-suspenders: drain any tab still in `autoHiddenTabs`
  // after the explicit `deactivateObserverOn`. Covers edge cases
  // where the bound tab churned (navigated, closed, or focus moved
  // to chrome://) without the corresponding `deactivateObserverOn`
  // landing — e.g. `tabs.onRemoved` clears `autoState.tabId` to
  // null but doesn't run the per-tab restore (the page died with
  // the tab in that path), and `autoState.tabId === null` lets
  // `stopAutoCapture` skip the explicit deactivate above.
  const stragglers = [...autoHiddenTabs];
  autoHiddenTabs.clear();
  for (const tabId of stragglers) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const target = { id: tabId, windowId: tab.windowId, url: tab.url ?? "" };
      await host.sendToContent(target, { type: "restore-after-capture" }).catch(() => undefined);
    } catch {
      // Tab gone — page took the style with it. Nothing to restore.
    }
  }
  autoState.scrollbarsHidden = false;

  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Fired by the content script's MutationObserver when DOM
 *  mutations have settled for `stableWaitMs`. Service worker
 *  applies the min-interval throttle + duplicate-frame dedupe, then
 *  saves a frame and increments the session count. */
async function autoCaptureShot(senderTabId?: number): Promise<void> {
  if (!autoState.active) return;
  if (senderTabId != null && senderTabId !== autoState.tabId) return; // ignore other tabs

  const now = Date.now();
  if (now - autoState.lastCaptureAt < autoState.minIntervalMs) return;
  autoState.lastCaptureAt = now;

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
  // Auto Capture intentionally skips per-shot `beginCapturePrep` /
  // `endCapturePrep`. The scrollbar hide is installed ONCE when
  // we bind to a tab (in `activateObserverOn`) and restored ONCE
  // when we unbind (in `deactivateObserverOn`) — so the captured
  // image stays scrollbar-clean without the hide/restore cycle
  // firing on every shot. Two reasons that mattered: (a) visible
  // flicker as the scrollbar disappeared+reappeared on the ~1s
  // capture cadence, and (b) a self-perpetuating loop on
  // reactively-laid-out pages where the page's own React / Vue /
  // ResizeObserver code reacted to the scrollbar gutter coming
  // back, which produced a body-tree mutation, which the auto
  // observer picked up, which triggered the next capture, which
  // hid the scrollbar again, ... and so on indefinitely. The
  // content-script-side `stableWait` already guarantees DOM
  // mutations have settled before the signal fires, so we don't
  // need the extra `hotkeySettleMs` paint flush either.

  try {
    const captured = await host.captureViewport(target);
    const encoded = await encodeCapture(captured.pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;

    const frameHash = await hashDataUrl(dataUrl);
    if (frameHash === autoState.lastFrameHash) {
      logger.debug("[auto-capture] dropping duplicate frame");
      return;
    }
    autoState.lastFrameHash = frameHash;

    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);
    const { width: w, height: h } = await probeDimensions(dataUrl);
    const ts = new Date().toISOString();
    const url = context?.url || tab.url || "";
    const title = (context?.title || tab.title || "").slice(0, 120);

    const tags: Record<string, string> = {
      "auto.seq": String(autoState.count + 1).padStart(3, "0"),
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
    console.error("[auto-capture] capture failed:", e);
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
    case "capture-visible":
      captureVisible();
      break;
    case "capture-area":
      captureArea();
      break;
    case "capture-full":
      captureFullPage();
      break;
    case "capture-pages":
      capturePages();
      break;
    case "open-gallery":
      openGallery();
      break;

    // ---- Hotkey Capture ----
    case "hotkey-capture-start":
      startHotkeyCapture();
      break;
    case "hotkey-capture-stop":
      stopHotkeyCapture();
      break;
    case "hotkey-capture-status":
      sendResponse(getHotkeyCaptureStatus());
      return false;

    // ---- Auto Capture (DOM-mutation-driven) ----
    case "auto-capture-start":
      startAutoCapture();
      break;
    case "auto-capture-stop":
      stopAutoCapture();
      break;
    case "auto-capture-status":
      sendResponse(getAutoCaptureStatus());
      return false;
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
      logger.debug("[auto-capture] onActivated handler failed:", e);
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
      logger.debug("[auto-capture] onFocusChanged handler failed:", e);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  // Whatever happens to the rest of the session state, the page is
  // gone and took our injected scrollbar style with it. Drop the
  // tab from our tracking set so `stopAutoCapture` doesn't later
  // try to restore a non-existent tab.
  autoHiddenTabs.delete(tabId);
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
  if (autoState.tabId !== tabId) return;
  // Top-frame navigation in the observed tab — observer is gone with
  // the old page (along with our injected scrollbar style). Re-install
  // when the new page completes loading.
  if (info.status !== "complete" || !tab.url) return;
  autoHiddenTabs.delete(tabId); // old page is gone; remove stale tracking
  autoState.tabId = null; // force re-activation path inside activateObserverOn
  void activateObserverOn(tabId, tab.windowId, tab.url);
});

chrome.commands.onCommand.addListener((command, tab) => {
  logger.debug("[cmd]", command, "tab:", tab?.id, tab?.url);
  switch (command) {
    case "capture-visible":
      captureVisible();
      break;
    case "capture-pages":
      capturePages();
      break;
    case "capture-area":
      captureArea();
      break;
    case "capture-full":
      captureFullPage();
      break;
    case "hotkey-capture":
      hotkeyCaptureShot(tab);
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
