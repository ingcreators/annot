import { afterEach, describe, expect, it, vi } from "vitest";
import { probeRasterDims } from "./raster-dims.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeRasterDims", () => {
  it("returns the decoded bitmap's dimensions and closes it", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 640, height: 400, close })),
    );

    await expect(probeRasterDims(new Blob([new Uint8Array([1, 2, 3])]))).resolves.toEqual({
      width: 640,
      height: 400,
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("fails soft to 0×0 when decoding is unavailable or the bytes are unparseable", async () => {
    vi.stubGlobal("createImageBitmap", () => {
      throw new Error("no decoder in this environment");
    });

    await expect(probeRasterDims(new Blob([new Uint8Array([1, 2, 3])]))).resolves.toEqual({
      width: 0,
      height: 0,
    });
  });
});
