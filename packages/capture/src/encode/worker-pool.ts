/**
 * Worker-pool primitive used by the offscreen / Browse-window encode
 * surface. The host owns Worker construction (the `new URL(...,
 * import.meta.url)` idiom only resolves correctly when emitted from the
 * file that ships in the host's bundle), so this module exposes a
 * `createEncodeWorkerPool({ spawnWorker, ... })` factory rather than
 * spawning workers itself.
 *
 * The extension's offscreen document and the future Electron Browse
 * window both call `createEncodeWorkerPool` against
 * `() => new Worker(new URL("@ingcreators/annot-capture/encode/encode-worker", import.meta.url), { type: "module" })`
 * (or a host-equivalent path) and get a single shared queue + idle-list
 * pool that drains FIFO across `WORKER_COUNT` workers.
 */

import type { EncodeOptions, EncodeResult } from "@ingcreators/annot-core/encode";

export interface BatchItem {
  pngDataUrl: string;
  cropSrcY: number;
  cropHeight: number;
  fullHeight: number;
  options: EncodeOptions;
}

export interface PoolOptions {
  /** Spawn one worker. The host wires the URL via
   *  `new URL("./encode-worker.ts", import.meta.url)` so the bundler
   *  resolves it relative to the host's emitted file. */
  spawnWorker: () => Worker;
  /** Number of workers to spin up. Defaults to a reasonable function of
   *  `navigator.hardwareConcurrency`. */
  workerCount?: number;
  /** Optional debug logger; defaults to a no-op. */
  log?: (message: string, ...args: unknown[]) => void;
}

export interface EncodeWorkerPool {
  /** Encode a single item via the next idle worker. */
  encodeOne(item: BatchItem): Promise<EncodeResult>;
  /** Fan out a batch of items in parallel. Resolves once every item
   *  has resolved; rejects if any one worker reports an error. */
  encodeBatch(items: BatchItem[]): Promise<EncodeResult[]>;
}

interface PendingTask {
  item: BatchItem;
  resolve: (r: EncodeResult) => void;
  reject: (e: unknown) => void;
}

const DEFAULT_WORKER_COUNT = Math.min(
  4,
  Math.max(2, ((navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency || 4) - 1),
);

export function createEncodeWorkerPool(opts: PoolOptions): EncodeWorkerPool {
  const log = opts.log ?? (() => {});
  const workerCount = opts.workerCount ?? DEFAULT_WORKER_COUNT;
  const workers: Worker[] = [];
  const idleWorkers: Worker[] = [];
  const pendingByReqId = new Map<number, PendingTask>();
  const queue: PendingTask[] = [];
  let nextReqId = 1;
  let initialised = false;

  function ensurePool(): void {
    if (initialised) return;
    initialised = true;
    for (let i = 0; i < workerCount; i++) {
      const w = opts.spawnWorker();
      w.onmessage = (e: MessageEvent<{ reqId: number; ok?: boolean; result?: EncodeResult; error?: string }>) => {
        const { reqId, ok, result, error } = e.data;
        const task = pendingByReqId.get(reqId);
        if (task) {
          pendingByReqId.delete(reqId);
          if (ok && result) task.resolve(result);
          else task.reject(new Error(error || "encode worker returned no result"));
        }
        idleWorkers.push(w);
        drainQueue();
      };
      w.onerror = (e) => {
        // Fatal worker errors are surfaced to the host's logger so the
        // service-worker / main-process log captures them.
        console.error("[encode-pool] worker error:", e);
      };
      workers.push(w);
      idleWorkers.push(w);
    }
    log(`[encode-pool] worker pool started (${workerCount} workers)`);
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
    ensurePool();
    return new Promise<EncodeResult>((resolve, reject) => {
      queue.push({ item, resolve, reject });
      drainQueue();
    });
  }

  async function encodeBatch(items: BatchItem[]): Promise<EncodeResult[]> {
    ensurePool();
    return Promise.all(items.map((it) => encodeOne(it)));
  }

  return { encodeOne, encodeBatch };
}
