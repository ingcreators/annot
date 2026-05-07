import {
  applyMosaic,
  cropRect,
  createEncodeWorkerPool,
  stitchSegments,
  type BatchItem,
} from "@ingcreators/annot-capture/encode";
import { logger } from "../logger.js";

// `new URL("./encode-worker.ts", import.meta.url)` resolves to the
// extension's bundled worker chunk. The worker entry just imports
// `@ingcreators/annot-capture/encode/encode-worker` (which has the
// `self.onmessage` body); keeping a local entry file is what lets
// Vite emit a chunk co-located with this offscreen entry.
const pool = createEncodeWorkerPool({
  spawnWorker: () =>
    new Worker(new URL("./encode-worker.ts", import.meta.url), { type: "module" }),
  log: logger.debug,
});

// Message handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "offscreen-stitch": {
        const dataUrl = await stitchSegments(msg.segments, msg.width, msg.height);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-crop": {
        const dataUrl = await cropRect(msg.dataUrl, msg.rect, msg.dpr);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-mosaic": {
        const dataUrl = await applyMosaic(msg.dataUrl, msg.rect, msg.blockSize);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-encode-batch": {
        try {
          const items = msg.items as BatchItem[];
          const results = await pool.encodeBatch(items);
          sendResponse({ results });
        } catch (e: any) {
          sendResponse({ error: e?.message || String(e) });
        }
        break;
      }
    }
  })();
  return true;
});
