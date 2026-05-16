/**
 * `withEmulatedViewport` — wrap a capture flow so the host's window
 * renders at the user's chosen target viewport size before `fn` runs,
 * and restores the previous geometry on unwind (success or failure).
 *
 * The chrome / dpr / chrome-delta / saved-geometry math lives inside
 * the host's `setEmulatedViewport` implementation. The orchestrator
 * just resolves the user's preset to a CSS-pixel viewport and pairs
 * `set(target, vp)` … `set(target, null)`.
 */

import type { CaptureHost, CaptureTargetRef } from "../host.js";
import { resolveEmulation, type Settings } from "../shared/settings.js";
import { delay } from "./constants.js";

/** Time to wait after the host's viewport resize so the page can
 *  reflow lazy images / media queries / flex layouts. The same
 *  400 ms the legacy extension service-worker used. Exported so
 *  long-lived sessions (extension Auto / Hotkey) that manage their
 *  own apply/restore lifecycle reuse the same settle budget. */
export const EMULATION_REFLOW_MS = 400;

export async function withEmulatedViewport<T>(
  host: CaptureHost,
  target: CaptureTargetRef,
  settings: Settings,
  fn: () => Promise<T>,
): Promise<T> {
  const targetVp = resolveEmulation(settings);
  if (!targetVp) return fn();

  let didResize = false;
  try {
    await host.setEmulatedViewport(target, targetVp);
    didResize = true;
    await delay(EMULATION_REFLOW_MS);
    return await fn();
  } finally {
    if (didResize) {
      try {
        await host.setEmulatedViewport(target, null);
      } catch {
        /* best-effort restore */
      }
    }
  }
}
