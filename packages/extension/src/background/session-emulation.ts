/**
 * Session-level viewport emulation for the Auto Capture and Hotkey
 * Capture state machines.
 *
 * The one-shot capture modes (Visible / Area / Scroll / PerPage) wrap
 * each invocation in `withEmulatedViewport`, which applies the
 * emulated size, reflows for 400 ms, runs the capture, and restores
 * the window geometry. For session-based modes that fire many
 * captures over the session's lifetime, that per-capture cycle would
 * flicker the window dimensions and burn the 400 ms reflow budget on
 * every shot.
 *
 * Instead we hold the emulated viewport for the entire session: apply
 * once at session start, optionally migrate to a different window
 * mid-session (Auto's tab-/window-following path), restore once at
 * session stop.
 */

import { EMULATION_REFLOW_MS } from "@ingcreators/annot-capture/orchestrate";
import type { Settings } from "@ingcreators/annot-capture/shared";
import { resolveEmulation } from "@ingcreators/annot-capture/shared";
import { logger } from "../logger.js";
import { delay } from "./service-worker-helpers.js";

/** Target a session-emulation call addresses. A real `tabId` is
 *  required (not just a windowId) because the host's
 *  `setEmulatedViewport` probes the page via
 *  `chrome.tabs.sendMessage(target.id, ...)` to measure the browser
 *  chrome overhead. Passing a synthetic `id: 0` makes that probe
 *  throw silently and the host falls back to a zero chrome-delta,
 *  which sizes the OUTER window to the user's CSS-pixel target —
 *  leaving the INNER viewport short by however much tab strip +
 *  address bar take up (≈87 px on a typical desktop Chrome). The
 *  one-shot capture paths don't hit this because they pass the
 *  resolved real-tab `CaptureTargetRef` from `host.resolveTarget()`. */
export interface SessionEmulationTarget {
  id: number;
  windowId: number;
  url: string;
}

/** Minimal CaptureHost surface session-emulation needs. The real
 *  host implements much more, but a narrow interface here keeps the
 *  caller honest + makes the module trivially mockable in tests. */
export interface SessionEmulationHost {
  setEmulatedViewport(
    target: SessionEmulationTarget,
    size: { width: number; height: number } | null,
  ): Promise<void>;
}

/**
 * Apply the user's emulated viewport to `target.windowId` if the
 * current settings request it. Returns `target.windowId` on success
 * so the caller can persist it as the "currently emulated window",
 * or `null` when emulation is disabled / the preset is `native` /
 * the resize call fails.
 */
export async function applySessionEmulation(
  host: SessionEmulationHost,
  target: SessionEmulationTarget,
  settings: Settings,
): Promise<number | null> {
  const targetVp = resolveEmulation(settings);
  if (!targetVp) return null;
  try {
    await host.setEmulatedViewport(target, targetVp);
    await delay(EMULATION_REFLOW_MS);
    logger.debug("[emulation] applied", targetVp, "to window", target.windowId);
    return target.windowId;
  } catch (err) {
    logger.debug("[emulation] apply failed:", err);
    return null;
  }
}

/**
 * Restore the saved geometry for `windowId`. Safe to call with a
 * `null` argument (no-op) so callers can drive it from the optional
 * `state.emulatedWindowId` field without an extra null check.
 *
 * Restore only needs the `windowId`: the host's saved-geometry map
 * is keyed by it, and the chrome-delta probe that requires a real
 * tab id only fires on apply.
 */
export async function restoreSessionEmulation(
  host: SessionEmulationHost,
  windowId: number | null,
): Promise<void> {
  if (windowId == null) return;
  try {
    await host.setEmulatedViewport({ id: 0, windowId, url: "" }, null);
    logger.debug("[emulation] restored window", windowId);
  } catch (err) {
    logger.debug("[emulation] restore failed:", err);
  }
}

/**
 * Move emulation from one window to another. Used by Auto Capture's
 * `activateObserverOn` path so a session that walks across tabs /
 * windows keeps capturing at the user's chosen viewport without
 * flickering whenever the active tab changes within a single window.
 *
 * Returns the new "currently emulated window" id (or `null` when
 * emulation isn't configured / apply failed on the new window).
 */
export async function migrateSessionEmulation(
  host: SessionEmulationHost,
  prevWindowId: number | null,
  newTarget: SessionEmulationTarget,
  settings: Settings,
): Promise<number | null> {
  if (prevWindowId === newTarget.windowId) return prevWindowId;
  if (prevWindowId !== null) {
    await restoreSessionEmulation(host, prevWindowId);
  }
  return applySessionEmulation(host, newTarget, settings);
}
