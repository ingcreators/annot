import type {
  CaptureRect,
  CaptureSegment,
  PageDimensions,
} from "@ingcreators/annot-core/utils/types";

// Popup -> Background
export type PopupMessage =
  | { type: "capture-visible" }
  | { type: "capture-area" }
  | { type: "capture-full" }
  | { type: "capture-pages" }
  | { type: "open-gallery" }
  | { type: "click-capture-start" }
  | { type: "click-capture-stop" }
  | { type: "click-capture-status" }
  | { type: "hotkey-capture-start" }
  | { type: "hotkey-capture-stop" };

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
  | { type: "get-capture-context" };

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
