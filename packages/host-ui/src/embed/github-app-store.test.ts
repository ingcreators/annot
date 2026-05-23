/**
 * @vitest-environment happy-dom
 */
// Tests for `embed/github-app-store.ts` — Phase 6 follow-up 5y-3.

import { describe, expect, it } from "vitest";
import {
  EmbedStorageUnsupportedError,
  GitHubAppStorageProvider,
  pngBase64ToDataUrl,
  pngDimensionsFromBase64,
} from "./github-app-store.js";

/** Build a minimal valid PNG (8-byte signature + IHDR) for a
 *  given width / height. Sufficient for the IHDR-only dimension
 *  parser; not a renderable image. */
function buildTinyPng(width: number, height: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const chunkLen = [0, 0, 0, 13]; // IHDR length
  const ihdrType = [0x49, 0x48, 0x44, 0x52]; // "IHDR"
  const widthBytes = [
    (width >>> 24) & 0xff,
    (width >>> 16) & 0xff,
    (width >>> 8) & 0xff,
    width & 0xff,
  ];
  const heightBytes = [
    (height >>> 24) & 0xff,
    (height >>> 16) & 0xff,
    (height >>> 8) & 0xff,
    height & 0xff,
  ];
  const rest = [8, 6, 0, 0, 0, 0, 0, 0, 0]; // bit depth + color type + compression + filter + interlace + CRC stub
  return new Uint8Array([...sig, ...chunkLen, ...ihdrType, ...widthBytes, ...heightBytes, ...rest]);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

describe("pngBase64ToDataUrl", () => {
  it("prepends the data-URL prefix", () => {
    expect(pngBase64ToDataUrl("ABCDEF")).toBe("data:image/png;base64,ABCDEF");
  });

  it("strips newlines", () => {
    expect(pngBase64ToDataUrl("AB\nCD\nEF")).toBe("data:image/png;base64,ABCDEF");
  });
});

describe("pngDimensionsFromBase64", () => {
  it("reads width + height from an IHDR chunk", () => {
    const png = buildTinyPng(640, 480);
    const dims = pngDimensionsFromBase64(bytesToBase64(png));
    expect(dims).toEqual({ width: 640, height: 480 });
  });

  it("throws on too-short input", () => {
    expect(() => pngDimensionsFromBase64(bytesToBase64(new Uint8Array(10)))).toThrow(/too short/);
  });

  it("throws on non-PNG signature", () => {
    const fake = new Uint8Array(24);
    expect(() => pngDimensionsFromBase64(bytesToBase64(fake))).toThrow(/signature mismatch/);
  });
});

describe("GitHubAppStorageProvider", () => {
  it("getImage POSTs /api/embed/load + materialises an ImageRecord", async () => {
    const png = buildTinyPng(100, 200);
    const pngB64 = bytesToBase64(png);
    let capturedUrl = "";
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "octocat/myrepo",
      pngPath: "docs/login.png",
      annotationsPath: "docs/login.annotations.yaml",
      fetchImpl: (async (input: Request | URL | string) => {
        capturedUrl =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return new Response(
          JSON.stringify({
            ok: true,
            installationId: 42,
            pngBase64: pngB64,
            annotationsYaml: "version: 1\noverlays: []\n",
            repoState: {
              branch: "main",
              pngSha: "abc",
              annotationsSha: "def",
              private: false,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }) as typeof fetch,
    });
    const record = await store.getImage("docs/login.png");
    expect(record).toBeDefined();
    expect(capturedUrl).toContain("https://annot.work/api/embed/load?");
    expect(capturedUrl).toContain("repo=octocat%2Fmyrepo");
    expect(record?.path).toBe("docs/login.png");
    expect(record?.folderPath).toBe("docs");
    expect(record?.width).toBe(100);
    expect(record?.height).toBe(200);
    expect(record?.originalDataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(record?.annotationsSvg).toBe("");
    expect(record?.sourceUrl).toBe("https://github.com/octocat/myrepo/blob/main/docs/login.png");
    expect(store.repoState).toMatchObject({
      branch: "main",
      pngSha: "abc",
      annotationsSha: "def",
      installationId: 42,
      private: false,
      annotationsYaml: "version: 1\noverlays: []\n",
    });
  });

  it("getImage throws when asked for a different path", async () => {
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
      fetchImpl: (async () => new Response("{}", { status: 200 })) as typeof fetch,
    });
    await expect(store.getImage("other.png")).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
  });

  it("updateImage throws (5y-4 lights this up)", async () => {
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
    });
    await expect(store.updateImage("a.png", {})).rejects.toBeInstanceOf(
      EmbedStorageUnsupportedError,
    );
  });

  it("trims a trailing slash off cloudUrl", async () => {
    const png = bytesToBase64(buildTinyPng(1, 1));
    let captured = "";
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work/",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
      fetchImpl: (async (input: Request | URL | string) => {
        captured =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return new Response(
          JSON.stringify({
            ok: true,
            installationId: 1,
            pngBase64: png,
            annotationsYaml: "",
            repoState: { branch: "main", pngSha: "p", annotationsSha: "a", private: false },
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await store.getImage("a.png");
    expect(captured).toContain("https://annot.work/api/embed/load?");
    expect(captured).not.toContain("annot.work//");
  });

  it("setAnnotationsYaml updates repoState after load", async () => {
    const png = bytesToBase64(buildTinyPng(1, 1));
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            ok: true,
            installationId: 1,
            pngBase64: png,
            annotationsYaml: "version: 1\n",
            repoState: { branch: "main", pngSha: "p", annotationsSha: "a", private: false },
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    await store.getImage("a.png");
    store.setAnnotationsYaml("version: 1\noverlays:\n  - id: o1\n");
    expect(store.repoState?.annotationsYaml).toContain("o1");
  });

  it("most unsupported operations throw EmbedStorageUnsupportedError", async () => {
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
    });
    await expect(store.saveImage()).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
    await expect(store.moveImage()).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
    await expect(store.renameImage()).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
    await expect(store.deleteImage()).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
    await expect(store.createFolder()).rejects.toBeInstanceOf(EmbedStorageUnsupportedError);
  });

  it("benign empty-list / undefined returns for read methods", async () => {
    const store = new GitHubAppStorageProvider({
      cloudUrl: "https://annot.work",
      repo: "o/r",
      pngPath: "a.png",
      annotationsPath: "a.yaml",
    });
    expect(await store.listImages()).toEqual([]);
    expect(await store.listFolders()).toEqual([]);
    expect(await store.getFolder()).toBeUndefined();
    expect(await store.getBreadcrumb()).toEqual([]);
  });
});
