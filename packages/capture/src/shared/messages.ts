import type {
  CaptureRect,
  CaptureSegment,
  PageDimensions,
} from "@ingcreators/annot-core/utils/types";

// Popup -> Background
//
// `click-capture-*` messages were retired with the extension's
// Click Capture surface. The desktop Browse window's click+hotkey
// flow still uses `BackgroundToContentMessage["click-capture-{enable,
// disable}"]` + `ContentToBackgroundMessage["click-detected"]`
// internally; those stay below.
export type PopupMessage =
  | { type: "capture-visible" }
  | { type: "capture-area" }
  | { type: "capture-full" }
  | { type: "capture-pages" }
  | { type: "open-gallery" }
  | { type: "hotkey-capture-start" }
  | { type: "hotkey-capture-stop" }
  | { type: "hotkey-capture-status" }
  | { type: "auto-capture-start" }
  | { type: "auto-capture-stop" }
  | { type: "auto-capture-status" };

// Background -> Content
export type BackgroundToContentMessage =
  /** Health-check used by `injectContentScript` to distinguish
   *  "listener alive" from "no listener" / "orphaned listener". */
  | { type: "ping" }
  | { type: "start-area-select" }
  | { type: "get-page-dimensions" }
  | { type: "scroll-to"; x: number; y: number }
  | { type: "hide-stickies" }
  | { type: "restore-stickies" }
  | {
      type: "hide-for-capture";
      overlays: boolean;
      preservedSelectors: string[];
      scrollbars: boolean;
    }
  | { type: "restore-after-capture" }
  | { type: "show-progress"; text: string }
  | { type: "hide-progress" }
  | { type: "click-capture-enable" }
  | { type: "click-capture-disable" }
  | { type: "get-capture-context" }
  | {
      /** Activate the auto-capture content-script logic. The content
       *  script installs a `MutationObserver` on `document.body`,
       *  debounces bursts with a stable-wait, and posts
       *  `auto-capture-signal` back to the service worker each time
       *  the DOM settles after a meaningful change. */
      type: "auto-capture-enable";
      /** Resolved stable-wait duration in milliseconds, derived from
       *  the user's `AutoCaptureOptions.stableWait` preset by the
       *  service worker before injection. */
      stableWaitMs: number;
    }
  | { type: "auto-capture-disable" };

// Content -> Background
export type ContentToBackgroundMessage =
  | { type: "area-selected"; rect: CaptureRect; dpr: number }
  | { type: "area-cancelled" }
  | { type: "page-dimensions"; data: PageDimensions }
  | { type: "scroll-done" }
  | {
      type: "click-detected";
      x: number;
      y: number;
      pageX: number;
      pageY: number;
      dpr: number;
      target: string;
      url: string;
      title: string;
      /** Bounding rect of the clicked element in CSS pixels (viewport-relative). */
      rect?: { x: number; y: number; width: number; height: number };
    }
  | {
      /** Right-click handler in the embedded webview asking the host
       *  to render an in-app capture menu. The chrome extension uses
       *  Chrome's runtime context-menu API for the same UX; the
       *  desktop Browse window posts this event so the host renderer
       *  can position a custom DOM menu near the cursor. Coords are
       *  CSS pixels relative to the webview's own viewport. */
      type: "context-menu-request";
      x: number;
      y: number;
    }
  | {
      /** Fired by the auto-capture content script when DOM mutations
       *  have settled (stable-wait elapsed without new mutations).
       *  The service worker uses this as the trigger to call
       *  `captureVisible` on the active tab. Throttling +
       *  duplicate-frame dedupe live service-worker-side so the
       *  content script stays a thin signal source. */
      type: "auto-capture-signal";
    };

// Background -> Offscreen
export type OffscreenMessage =
  | { type: "offscreen-stitch"; segments: CaptureSegment[]; width: number; height: number }
  | { type: "offscreen-crop"; dataUrl: string; rect: CaptureRect; dpr: number }
  | { type: "offscreen-mosaic"; dataUrl: string; rect: CaptureRect; blockSize: number };

// Offscreen -> Background
export type OffscreenResult = { type: "offscreen-result"; dataUrl: string };

export type Message =
  | PopupMessage
  | BackgroundToContentMessage
  | ContentToBackgroundMessage
  | OffscreenMessage
  | OffscreenResult;
