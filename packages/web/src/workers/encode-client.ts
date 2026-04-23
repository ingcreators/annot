/**
 * Main-thread client for `encode.worker.ts`.
 *
 * Lazily spawns a single encoder worker on first call, routes each
 * request through a numeric id so overlapping encodes can coexist,
 * and falls back to synchronous in-thread encoding if the worker
 * can't be constructed (restrictive CSP, disabled workers, etc.).
 *
 * Callers should use `encodeCaptureInWorker` instead of importing
 * `encodeCapture` from core directly — the worker version is the
 * default for all save paths in the web package because PNG-8
 * quantization + pako DEFLATE-9 otherwise freezes the UI for
 * multi-megapixel screenshots.
 */
import type { EncodeOptions, EncodeResult } from "@ingcreators/annot-core/encode";

type EncodeRequest = {
  type: "encode";
  id: number;
  pngDataUrl: string;
  options: EncodeOptions;
};

type EncodeResponse =
  | { type: "result"; id: number; result: EncodeResult }
  | { type: "error"; id: number; message: string };

let worker: Worker | null = null;
let workerUnusable = false;
let nextId = 1;
const pending = new Map<number, { resolve: (r: EncodeResult) => void; reject: (e: Error) => void }>();

function ensureWorker(): Worker | null {
  if (workerUnusable) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./encode.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent<EncodeResponse>) => {
      const msg = e.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.type === "result") entry.resolve(msg.result);
      else entry.reject(new Error(msg.message));
    });
    worker.addEventListener("error", (e) => {
      // Fatal worker error: reject everyone outstanding and poison the
      // worker so future calls take the main-thread fallback path.
      for (const entry of pending.values()) entry.reject(new Error(e.message || "encode worker crashed"));
      pending.clear();
      worker?.terminate();
      worker = null;
      workerUnusable = true;
    });
    return worker;
  } catch (e) {
    console.warn("[encode-client] Worker unavailable, falling back to main thread:", e);
    workerUnusable = true;
    return null;
  }
}

/**
 * Encode a capture PNG data URL per the given options, running the
 * WASM quantization + DEFLATE pass off the main thread. Falls back
 * transparently to an in-thread `encodeCapture` call if the worker
 * can't be constructed.
 */
export async function encodeCaptureInWorker(
  pngDataUrl: string,
  options: EncodeOptions,
): Promise<EncodeResult> {
  const w = ensureWorker();
  if (!w) {
    const { encodeCapture } = await import("@ingcreators/annot-core/encode");
    return encodeCapture(pngDataUrl, options);
  }
  const id = nextId++;
  return new Promise<EncodeResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const req: EncodeRequest = { type: "encode", id, pngDataUrl, options };
    w.postMessage(req);
  });
}
