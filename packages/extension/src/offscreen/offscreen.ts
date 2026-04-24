import type { EncodeOptions, EncodeResult } from "@ingcreators/annot-core/encode";
import { MOSAIC_BLOCK_SIZE } from "@ingcreators/annot-core/utils";

// ---- Worker pool for parallel PNG-8 / JPEG / PNG encoding ----

interface BatchItem {
  pngDataUrl: string;
  cropSrcY: number;
  cropHeight: number;
  fullHeight: number;
  options: EncodeOptions;
}

interface PendingTask {
  item: BatchItem;
  resolve: (r: EncodeResult) => void;
  reject: (e: any) => void;
}

const WORKER_COUNT = Math.min(4, Math.max(2, ((navigator as any).hardwareConcurrency || 4) - 1));
const workers: Worker[] = [];
const idleWorkers: Worker[] = [];
const pendingByReqId = new Map<number, PendingTask>();
const queue: PendingTask[] = [];
let nextReqId = 1;

function ensureWorkerPool(): void {
  if (workers.length > 0) return;
  for (let i = 0; i < WORKER_COUNT; i++) {
    const w = new Worker(new URL("./encode-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<any>) => {
      const { reqId, ok, result, error } = e.data;
      const task = pendingByReqId.get(reqId);
      if (task) {
        pendingByReqId.delete(reqId);
        if (ok) task.resolve(result);
        else task.reject(new Error(error));
      }
      idleWorkers.push(w);
      drainQueue();
    };
    w.onerror = (e) => {
      console.error("[offscreen] worker error:", e);
    };
    workers.push(w);
    idleWorkers.push(w);
  }
  console.log(`[offscreen] encode worker pool started (${WORKER_COUNT} workers)`);
}

function drainQueue(): void {
  while (idleWorkers.length > 0 && queue.length > 0) {
    const w = idleWorkers.shift()!;
    const task = queue.shift()!;
    const reqId = nextReqId++;
    pendingByReqId.set(reqId, task);
    w.postMessage({
      reqId,
      pngDataUrl: task.item.pngDataUrl,
      cropSrcY: task.item.cropSrcY,
      cropHeight: task.item.cropHeight,
      fullHeight: task.item.fullHeight,
      options: task.item.options,
    });
  }
}

function encodeOne(item: BatchItem): Promise<EncodeResult> {
  ensureWorkerPool();
  return new Promise<EncodeResult>((resolve, reject) => {
    queue.push({ item, resolve, reject });
    drainQueue();
  });
}

async function handleEncodeBatch(items: BatchItem[]): Promise<EncodeResult[]> {
  ensureWorkerPool();
  return Promise.all(items.map((it) => encodeOne(it)));
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function canvasToDataUrl(
  canvas: OffscreenCanvas,
  format: string,
  quality: number,
): Promise<string> {
  return canvas.convertToBlob({ type: format, quality }).then((blob) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  });
}

async function handleStitch(
  segments: { dataUrl: string; offsetY: number }[],
  width: number,
  height: number,
): Promise<string> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  for (const seg of segments) {
    const img = await loadImage(seg.dataUrl);
    ctx.drawImage(img, 0, seg.offsetY);
  }
  // Output lossless PNG — the service worker's encodeCapture() then applies
  // the user's chosen final format (JPEG / PNG / PNG-8).
  return canvasToDataUrl(canvas, "image/png", 1);
}

async function handleCrop(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr: number,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.round(rect.width * dpr);
  const sh = Math.round(rect.height * dpr);
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  // Output lossless PNG; service-worker's encodeCapture() re-encodes.
  return canvasToDataUrl(canvas, "image/png", 1);
}

async function handleMosaic(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  blockSize: number,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  const imageData = ctx.getImageData(0, 0, rect.width, rect.height);
  const data = imageData.data;
  const bs = blockSize || MOSAIC_BLOCK_SIZE;
  for (let y = 0; y < rect.height; y += bs) {
    for (let x = 0; x < rect.width; x += bs) {
      const sampleX = Math.min(x + Math.floor(bs / 2), rect.width - 1);
      const sampleY = Math.min(y + Math.floor(bs / 2), rect.height - 1);
      const idx = (sampleY * rect.width + sampleX) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      for (let by = y; by < Math.min(y + bs, rect.height); by++) {
        for (let bx = x; bx < Math.min(x + bs, rect.width); bx++) {
          const i = (by * rect.width + bx) * 4;
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = a;
        }
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvasToDataUrl(canvas, "image/png", 1);
}

// Message handler
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "offscreen-stitch": {
        const dataUrl = await handleStitch(msg.segments, msg.width, msg.height);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-crop": {
        const dataUrl = await handleCrop(msg.dataUrl, msg.rect, msg.dpr);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-mosaic": {
        const dataUrl = await handleMosaic(msg.dataUrl, msg.rect, msg.blockSize);
        sendResponse({ dataUrl });
        break;
      }
      case "offscreen-encode-batch": {
        try {
          const results = await handleEncodeBatch(msg.items);
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
