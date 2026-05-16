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

/** Minimal CaptureHost surface session-emulation needs. The real
 *  host implements much more, but a narrow interface here keeps the
 *  caller honest + makes the module trivially mockable in tests. */
export interface SessionEmulationHost {
  setEmulatedViewport(
    target: { id: number; windowId: number; url: string },
    size: { width: number; height: number } | null,
  ): Promise<void>;
}

/**
 * Apply the user's emulated viewport to `windowId` if the current
 * settings request it. Returns `windowId` on success so the caller
 * can persist it as the "currently emulated window", or `null` when
 * emulation is disabled / the preset is `native` / the resize call
 * fails.
 */
export async function applySessionEmulation(
  host: SessionEmulationHost,
  windowId: number,
  settings: Settings,
): Promise<number | null> {
  const targetVp = resolveEmulation(settings);
  if (!targetVp) return null;
  try {
    await host.setEmulatedViewport({ id: 0, windowId, url: "" }, targetVp);
    await delay(EMULATION_REFLOW_MS);
    logger.debug("[emulation] applied", targetVp, "to window", windowId);
    return windowId;
  } catch (err) {
    logger.debug("[emulation] apply failed:", err);
    return null;
  }
}

/**
 * Restore the saved geometry for `windowId`. Safe to call with a
 * `null` argument (no-op) so callers can drive it from the optional
 * `state.emulatedWindowId` field without an extra null check.
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
  newWindowId: number,
  settings: Settings,
): Promise<number | null> {
  if (prevWindowId === newWindowId) return prevWindowId;
  if (prevWindowId !== null) {
    await restoreSessionEmulation(host, prevWindowId);
  }
  return applySessionEmulation(host, newWindowId, settings);
}
