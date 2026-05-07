/**
 * Web Worker that performs crop + smart-encode (PNG-8 / JPEG / PNG) for a
 * single captured viewport. Spun up N times by the host's offscreen
 * document (extension) or main renderer (Electron Browse window) to
 * parallelize compression across CPU cores.
 *
 * Each worker imports `@ingcreators/annot-core/encode` which loads its own
 * copy of the libimagequant WASM module — WASM is single-instance-per-realm,
 * so N workers give N parallel quantizers.
 */
import {
  type EncodeOptions,
  type EncodeResult,
  encodeCapture,
} from "@ingcreators/annot-core/encode";

interface WorkerTask {
  reqId: number;
  pngDataUrl: string;
  cropSrcY: number;
  cropHeight: number;
  fullHeight: number;
  options: EncodeOptions;
}

interface WorkerResponseOk {
  reqId: number;
  ok: true;
  result: EncodeResult;
}

interface WorkerResponseErr {
  reqId: number;
  ok: false;
  error: string;
}

self.onmessage = async (e: MessageEvent<WorkerTask>) => {
  const { reqId, pngDataUrl, cropSrcY, cropHeight, fullHeight, options } = e.data;
  try {
    let dataUrl = pngDataUrl;

    // Crop first if the slice is smaller than the full viewport.
    if (cropSrcY > 0 || (cropHeight > 0 && cropHeight < fullHeight)) {
      dataUrl = await cropPngVertical(pngDataUrl, cropSrcY, cropHeight);
    }

    const result = await encodeCapture(dataUrl, options);
    const resp: WorkerResponseOk = { reqId, ok: true, result };
    (self as unknown as Worker).postMessage(resp);
  } catch (err: any) {
    const resp: WorkerResponseErr = {
      reqId,
      ok: false,
      error: err?.message || String(err),
    };
    (self as unknown as Worker).postMessage(resp);
  }
};

async function cropPngVertical(
  pngDataUrl: string,
  srcY: number,
  keepHeight: number,
): Promise<string> {
  const blob = await (await fetch(pngDataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width;
  const yClamped = Math.max(0, Math.min(srcY, bmp.height));
  const h = Math.max(0, Math.min(keepHeight, bmp.height - yClamped));
  if (h <= 0) {
    bmp.close();
    return pngDataUrl;
  }
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, yClamped, w, h, 0, 0, w, h);
  bmp.close();
  const outBlob = await canvas.convertToBlob({ type: "image/png" });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(outBlob);
  });
}
