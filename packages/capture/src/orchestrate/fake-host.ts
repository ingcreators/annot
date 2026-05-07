/**
 * Test-only fake `CaptureHost` for orchestrator unit tests.
 *
 * The fake records every host call so tests can assert call order,
 * argument shapes, and DPR propagation. Returned values come from
 * an `overrides` object so individual tests can inject specific
 * behaviour (e.g. a constant DPR, a synthetic `area-selected`
 * event) without writing a fresh fake every time.
 *
 * Lives next to the orchestrators rather than in a `__tests__/`
 * sibling so consumers (the desktop host, future Electron
 * integration tests) can reuse it.
 */

import type { PageMetadata } from "@ingcreators/annot-core";
import type {
  CaptureRect,
  CaptureSegment,
  PageDimensions,
} from "@ingcreators/annot-core/utils/types";
import type { BatchItem } from "../encode/worker-pool.js";
import type {
  CaptureEncodeResult,
  CaptureHost,
  CapturedViewport,
  CaptureTargetRef,
} from "../host.js";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from "../shared/messages.js";
import { DEFAULT_SETTINGS, type Settings } from "../shared/settings.js";

export type FakeCall =
  | { kind: "resolveTarget" }
  | { kind: "captureViewport"; target: CaptureTargetRef }
  | {
      kind: "setEmulatedViewport";
      target: CaptureTargetRef;
      size: { width: number; height: number } | null;
    }
  | { kind: "sendToContent"; target: CaptureTargetRef; msg: BackgroundToContentMessage }
  | { kind: "injectContentScript"; target: CaptureTargetRef }
  | { kind: "requestPageMetadata"; target: CaptureTargetRef; area: CaptureRect | undefined }
  | {
      kind: "stitchSegments";
      segments: CaptureSegment[];
      width: number;
      height: number;
    }
  | { kind: "cropRect"; dataUrl: string; rect: CaptureRect; dpr: number }
  | { kind: "encodeBatch"; items: BatchItem[] }
  | { kind: "loadSettings" }
  | { kind: "saveSettings"; settings: Settings }
  | { kind: "log"; level: "debug" | "info" | "warn" | "error"; args: unknown[] };

export interface FakeHostOverrides {
  /** Resolved target. `null` means "no capturable surface" — the
   *  orchestrator will short-circuit. */
  target?: CaptureTargetRef | null;
  /** DPR returned by `captureViewport`. Defaults to 1. */
  dpr?: number;
  /** PNG data URL returned by `captureViewport`. Defaults to a
   *  recognisable sentinel so test assertions are self-evident. */
  pngDataUrl?: string;
  /** Per-call `sendToContent` response factory. The default returns
   *  a synthetic `PageDimensions` for `get-page-dimensions` and
   *  `undefined` otherwise. */
  sendToContent?: (msg: BackgroundToContentMessage) => unknown;
  /** Per-call `requestPageMetadata` factory. */
  pageMetadata?: PageMetadata | null;
  /** Settings returned by `loadSettings`. Defaults to `DEFAULT_SETTINGS`. */
  settings?: Settings;
  /** Crop result. Defaults to a recognisable sentinel. */
  cropResult?: string;
  /** Stitch result. Defaults to a recognisable sentinel. */
  stitchResult?: string;
  /** EncodeBatch result factory — defaults to passing the
   *  pngDataUrl through. */
  encodeBatch?: (items: BatchItem[]) => CaptureEncodeResult[];
  /** Content-event emitter — tests call `emitContentEvent(...)`
   *  on the returned host to drive area-select / area-cancelled
   *  events. */
}

export interface FakeHost {
  host: CaptureHost;
  /** Recorded call log in chronological order. */
  calls: FakeCall[];
  /** Drive a `ContentToBackgroundMessage` into every subscriber
   *  registered via `host.onContentMessage`. Tests use this to
   *  simulate area-select events. */
  emitContentEvent(msg: ContentToBackgroundMessage): void;
  /** Queue a content event to fire as soon as a listener subscribes
   *  (the orchestrator's `host.onContentMessage` call). Avoids
   *  ordering races between the test driver and the orchestrator's
   *  await chain. */
  enqueueContentEvent(msg: ContentToBackgroundMessage): void;
}

const SYNTHETIC_PNG = "data:image/png;base64,fake-viewport";

const SYNTHETIC_DIMS: PageDimensions = {
  scrollWidth: 1024,
  scrollHeight: 2048,
  viewportWidth: 1024,
  viewportHeight: 768,
  devicePixelRatio: 1,
  scrollX: 0,
  scrollY: 0,
};

export function createFakeCaptureHost(overrides: FakeHostOverrides = {}): FakeHost {
  const calls: FakeCall[] = [];
  const listeners = new Set<(msg: ContentToBackgroundMessage) => void>();
  const pendingContentEvents: ContentToBackgroundMessage[] = [];

  const target: CaptureTargetRef =
    overrides.target === null
      ? { id: -1, windowId: -1, url: "", title: "" }
      : (overrides.target ?? {
          id: 1,
          windowId: 100,
          url: "https://example.com/",
          title: "Example",
        });

  const host: CaptureHost = {
    async resolveTarget() {
      calls.push({ kind: "resolveTarget" });
      return overrides.target === null ? null : target;
    },

    async captureViewport(t): Promise<CapturedViewport> {
      calls.push({ kind: "captureViewport", target: t });
      return {
        pngDataUrl: overrides.pngDataUrl ?? SYNTHETIC_PNG,
        dpr: overrides.dpr ?? 1,
      };
    },

    async setEmulatedViewport(t, size) {
      calls.push({ kind: "setEmulatedViewport", target: t, size });
    },

    async sendToContent<T = unknown>(t: CaptureTargetRef, msg: BackgroundToContentMessage) {
      calls.push({ kind: "sendToContent", target: t, msg });
      if (overrides.sendToContent) {
        return overrides.sendToContent(msg) as T;
      }
      // Default: respond to `get-page-dimensions` with synthetic
      // dims; everything else returns undefined.
      if (msg.type === "get-page-dimensions") {
        return SYNTHETIC_DIMS as unknown as T;
      }
      return undefined as T;
    },

    onContentMessage(handler) {
      listeners.add(handler);
      // Drain any pending content events the test queued before the
      // orchestrator's await chain reached `host.onContentMessage`.
      // Each event is dispatched on a microtask so the orchestrator
      // is past the `subscribe` call when the listener fires —
      // matches real-world ordering where the runtime listener
      // actually fires asynchronously after the message arrives.
      if (pendingContentEvents.length > 0) {
        const drained = pendingContentEvents.splice(0, pendingContentEvents.length);
        queueMicrotask(() => {
          for (const msg of drained) handler(msg);
        });
      }
      return () => listeners.delete(handler);
    },

    async injectContentScript(t) {
      calls.push({ kind: "injectContentScript", target: t });
    },

    async requestPageMetadata(t, area) {
      calls.push({ kind: "requestPageMetadata", target: t, area });
      return overrides.pageMetadata ?? null;
    },

    async stitchSegments(segments, width, height) {
      calls.push({ kind: "stitchSegments", segments, width, height });
      return overrides.stitchResult ?? "data:image/png;base64,fake-stitch";
    },

    async cropRect(dataUrl, rect, dpr) {
      calls.push({ kind: "cropRect", dataUrl, rect, dpr });
      return overrides.cropResult ?? "data:image/png;base64,fake-crop";
    },

    async encodeBatch(items: BatchItem[]) {
      calls.push({ kind: "encodeBatch", items });
      if (overrides.encodeBatch) return overrides.encodeBatch(items);
      // Default: pass the input dataUrl through as the encoded
      // output. Tests that care about the encode shape inject
      // their own.
      return items.map((it) => ({ dataUrl: it.pngDataUrl, chosen: "png" as const }));
    },

    async loadSettings() {
      calls.push({ kind: "loadSettings" });
      return overrides.settings ?? DEFAULT_SETTINGS;
    },

    async saveSettings(s) {
      calls.push({ kind: "saveSettings", settings: s });
    },

    onSettingsChange() {
      return () => {};
    },

    log(level, ...args) {
      calls.push({ kind: "log", level, args });
    },
  };

  return {
    host,
    calls,
    emitContentEvent(msg) {
      for (const cb of listeners) cb(msg);
    },
    enqueueContentEvent(msg) {
      pendingContentEvents.push(msg);
    },
  };
}
