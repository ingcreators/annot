/**
 * Extension-side Web Worker entry for the encode pipeline.
 *
 * The actual `self.onmessage` body lives in
 * `@ingcreators/annot-capture/encode/encode-worker` so other hosts
 * (future Electron Browse window) reuse it verbatim. This file is the
 * Vite bundling entry point so `new Worker(new URL("./encode-worker.ts",
 * import.meta.url), { type: "module" })` resolves to a chunk in the
 * extension's `dist/` output.
 */

import "@ingcreators/annot-capture/encode/encode-worker";
