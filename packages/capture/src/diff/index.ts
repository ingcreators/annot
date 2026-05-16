/**
 * `@ingcreators/annot-capture/diff` — pixel-delta + cursor-only
 * heuristics for Auto Capture's "did the page visibly change?"
 * decision. Pure functions over `ImageData`, callable from any host
 * that can produce two same-size `ImageData` buffers (web's
 * `AutoCaptureEngine`, the extension's offscreen document, future
 * desktop / VSCode hosts).
 */
export * from "./diff-detection.js";
