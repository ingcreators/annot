/// <reference lib="webworker" />
/**
 * Worker-side counterpart of `encode-client.ts`.
 *
 * We deliberately keep the message protocol thin: the caller posts a
 * `pngDataUrl + options` tuple, we run the existing `encodeCapture`
 * verbatim, and post the returned `EncodeResult` back. No Transferable
 * tricks for now — the payloads are modest (a few hundred KB at most
 * for real screenshots) and the structured-clone cost is dwarfed by
 * the WASM quantization + DEFLATE-9 pass that this file exists to
 * move off the main thread.
 */
import {
  type EncodeOptions,
  type EncodeResult,
  encodeCapture,
} from "@ingcreators/annot-core/encode";

type EncodeRequest = {
  type: "encode";
  id: number;
  pngDataUrl: string;
  options: EncodeOptions;
};

type EncodeResponse =
  | { type: "result"; id: number; result: EncodeResult }
  | { type: "error"; id: number; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", async (e: MessageEvent<EncodeRequest>) => {
  const req = e.data;
  if (!req || req.type !== "encode") return;
  try {
    const result = await encodeCapture(req.pngDataUrl, req.options);
    const reply: EncodeResponse = { type: "result", id: req.id, result };
    ctx.postMessage(reply);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const reply: EncodeResponse = { type: "error", id: req.id, message };
    ctx.postMessage(reply);
  }
});
