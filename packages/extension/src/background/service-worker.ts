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

import {
  beginCapturePrep,
  endCapturePrep,
  runAreaCapture,
  runPerPageCapture,
  runScrollCapture,
  runVisibleCapture,
} from "@ingcreators/annot-capture/orchestrate";
import type { CaptureFrame } from "@ingcreators/annot-capture/orchestrate";
import { newIdB58 } from "@ingcreators/annot-core/utils";
import { logger } from "../logger.js";
import { encodeCapture } from "../shared/encode.js";
import { loadSettings } from "../shared/settings.js";
// Static import of IDB store — used by external message API
import * as idbStore from "../storage/idb-store.js";
import { createChromeCaptureHost } from "./host.js";
import {
  ANNOTATION_URL,
  buildEditUrl,
  CLICK_CAPTURE_MAX_FRAMES,
  CLICK_CAPTURE_MIN_INTERVAL_MS,
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
async function openOrReuseEditorTab(
  targetUrl: string,
  path: string,
  extId: string,
): Promise<void> {
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

// ---- Click Capture ───────────────────────────────────────────────

interface ClickCaptureState {
  active: boolean;
  count: number;
  /** Timestamp of last capture — used to debounce rapid clicks. */
  lastCaptureAt: number;
  /** uuid7-base58 session id; set at start, reused for every capture. */
  sessionId: string;
}

const clickState: ClickCaptureState = { active: false, count: 0, lastCaptureAt: 0, sessionId: "" };
const hotkeyState: ClickCaptureState = { active: false, count: 0, lastCaptureAt: 0, sessionId: "" };

function getClickCaptureStatus(): ClickCaptureState & {
  hotkeyActive: boolean;
  hotkeyCount: number;
} {
  return { ...clickState, hotkeyActive: hotkeyState.active, hotkeyCount: hotkeyState.count };
}

function updateBadge(): void {
  const anyActive = clickState.active || hotkeyState.active;
  if (anyActive) {
    chrome.action.setBadgeBackgroundColor({ color: "#e44" });
    const total = clickState.count + hotkeyState.count;
    chrome.action.setBadgeText({ text: String(total) });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

async function broadcastClickCapture(enable: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const msgType = enable ? "click-capture-enable" : "click-capture-disable";
  for (const t of tabs) {
    if (!t.id || !t.url) continue;
    if (!/^https?:|^file:/.test(t.url)) continue;
    try {
      // Ensure content script is present for http(s) pages
      if (enable) {
        await host.injectContentScript({ id: t.id, windowId: t.windowId, url: t.url ?? "" });
      }
      await chrome.tabs.sendMessage(t.id, { type: msgType }).catch(() => {});
    } catch (err) {
      logger.debug("[click-capture] broadcast to tab failed:", t.id, err);
    }
  }
}

async function startClickCapture(): Promise<void> {
  if (clickState.active) return;
  clickState.active = true;
  clickState.count = 0;
  clickState.lastCaptureAt = 0;
  clickState.sessionId = newIdB58();
  await chrome.storage.local.set({
    clickCaptureActive: true,
    clickCaptureSession: clickState.sessionId,
  });
  updateBadge();
  await broadcastClickCapture(true);
}

async function stopClickCapture(): Promise<void> {
  if (!clickState.active) return;
  clickState.active = false;
  await chrome.storage.local.set({ clickCaptureActive: false });
  await broadcastClickCapture(false);
  const finalCount = clickState.count;
  clickState.sessionId = "";
  updateBadge();

  // Open Annot so user can review + transfer captured frames.
  if (finalCount > 0) {
    await openOrReuseAnnotTab(chrome.runtime.id);
  }
}

/** Handle a click reported by a content script: capture + save. */
async function handleClickDetected(
  msg: {
    x: number;
    y: number;
    pageX: number;
    pageY: number;
    dpr: number;
    target: string;
    url: string;
    title: string;
    rect?: { x: number; y: number; width: number; height: number };
  },
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  if (!clickState.active) return;
  if (clickState.count >= CLICK_CAPTURE_MAX_FRAMES) {
    console.warn("[click-capture] max frames reached, auto-stopping");
    stopClickCapture();
    return;
  }

  const now = Date.now();
  if (now - clickState.lastCaptureAt < CLICK_CAPTURE_MIN_INTERVAL_MS) return;
  clickState.lastCaptureAt = now;

  const tabId = sender.tab?.id;
  const windowId = sender.tab?.windowId;
  if (tabId == null || windowId == null) return;

  const settings = await loadSettings();

  // Click capture uses host primitives directly rather than going
  // through `runVisibleCapture` because:
  //   - it needs custom tag bookkeeping (click coords, sessionIndex)
  //   - the settle delay is per-click rather than per-mode
  //   - no "open the editor" step (frames accumulate; editor opens
  //     on `stopClickCapture`)
  const target = { id: tabId, windowId, url: sender.tab?.url ?? "" };
  // Mirror the orchestrators' beginCapturePrep / endCapturePrep dance
  // so stickies / scrollbars don't bake into the capture.
  await beginCapturePrep(host, target, "click", settings, 0);
  await delay(settings.timing.clickSettleMs);

  if (!clickState.active) {
    await endCapturePrep(host, target);
    return;
  }

  try {
    const captured = await host.captureViewport(target);
    await endCapturePrep(host, target);
    const encoded = await encodeCapture(captured.pngDataUrl, settings);
    const dataUrl = encoded.dataUrl;
    const thumbnailDataUrl = await idbStore.generateThumbnail(dataUrl);

    // Dimensions from image
    const { width: w, height: h } = await probeDimensions(dataUrl);

    // Re-query the tab AFTER the settle delay so the recorded URL/title
    // reflects the captured page (post-navigation), not the page the
    // click was dispatched on. The pre-click URL/title is kept
    // separately in `click.from*` tags for reference.
    let capturedUrl = msg.url;
    let capturedTitle = msg.title;
    try {
      const updated = await chrome.tabs.get(tabId);
      if (updated?.url) capturedUrl = updated.url;
      if (updated?.title) capturedTitle = updated.title;
    } catch {
      /* ignore — fall back to click-time values */
    }

    // Did the page navigate between click and capture? If so, click
    // coordinates/rect are on a different layout and would draw a
    // misplaced marker on the captured image — omit them.
    const navigated = !!msg.url && msg.url !== capturedUrl;

    const ts = new Date().toISOString();
    const tags: Record<string, string> = {
      "click.target": msg.target,
      "click.seq": String(clickState.count + 1).padStart(3, "0"),
      // URL/title at capture time (matches the image)
      "click.url": capturedUrl,
      "click.title": capturedTitle.slice(0, 120),
      captureId: newIdB58(),
      session: clickState.sessionId,
      sessionKind: "click",
      sessionIndex: String(clickState.count),
    };
    if (!navigated) {
      tags["click.x"] = String(Math.round(msg.x * msg.dpr));
      tags["click.y"] = String(Math.round(msg.y * msg.dpr));
      tags["click.pageX"] = String(Math.round(msg.pageX * msg.dpr));
      tags["click.pageY"] = String(Math.round(msg.pageY * msg.dpr));
      if (msg.rect) {
        tags["click.rect.x"] = String(Math.round(msg.rect.x * msg.dpr));
        tags["click.rect.y"] = String(Math.round(msg.rect.y * msg.dpr));
        tags["click.rect.w"] = String(Math.round(msg.rect.width * msg.dpr));
        tags["click.rect.h"] = String(Math.round(msg.rect.height * msg.dpr));
      }
    } else {
      // Page navigated — record the originating URL/title for traceability
      tags["click.fromUrl"] = msg.url;
      tags["click.fromTitle"] = msg.title.slice(0, 120);
    }
    Object.assign(tags, urlTags(capturedUrl));

    // Snapshot DOM metadata while the page state matches the
    // screenshot (same scroll, same hidden stickies). Click capture
    // doesn't open the editor immediately, but the user opens these
    // later from the gallery — at that point the Elements sidebar
    // is useful.
    const meta = await host.requestPageMetadata(target);

    await idbStore.saveImage({
      originalDataUrl: dataUrl,
      thumbnailDataUrl,
      annotationsSvg: "",
      width: w,
      height: h,
      sourceUrl: capturedUrl,
      tags,
      folderPath: "",
      createdAt: ts,
      updatedAt: ts,
      pageMetadata: meta ?? undefined,
    });

    clickState.count += 1;
    updateBadge();
  } catch (e) {
    console.error("[click-capture] capture failed:", e);
    await endCapturePrep(host, target);
  }
}

// Auto-inject content script into newly loaded tabs while click
// capture is active.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete") return;
  if (!clickState.active) return;
  if (!tab.url || !/^https?:|^file:/.test(tab.url)) return;
  host
    .injectContentScript({ id: tabId, windowId: tab.windowId, url: tab.url })
    .then(() => {
      chrome.tabs.sendMessage(tabId, { type: "click-capture-enable" }).catch(() => {});
    });
});

// Restore click-capture state across service-worker restarts.
(async () => {
  try {
    const res = await chrome.storage.local.get([
      "clickCaptureActive",
      "clickCaptureSession",
      "hotkeyCaptureActive",
      "hotkeyCaptureSession",
    ]);
    if (res.clickCaptureActive) {
      clickState.active = true;
      clickState.sessionId = res.clickCaptureSession || newIdB58();
    }
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

    // ---- Click Capture ----
    case "click-capture-start":
      startClickCapture();
      break;
    case "click-capture-stop":
      stopClickCapture();
      break;
    case "click-capture-status":
      sendResponse(getClickCaptureStatus());
      return false;
    case "click-detected":
      handleClickDetected(msg, sender);
      break;

    // ---- Hotkey Capture ----
    case "hotkey-capture-start":
      startHotkeyCapture();
      break;
    case "hotkey-capture-stop":
      stopHotkeyCapture();
      break;
  }
  return undefined;
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

