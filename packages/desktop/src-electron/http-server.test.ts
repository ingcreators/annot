/**
 * Unit tests for the Phase 2 extension-handoff HTTP server.
 *
 * The server is a plain `node:http` listener — tests can boot it
 * on an ephemeral port (`port: 0`), fire real `fetch` requests at
 * it, and inspect both the response body and the side effects
 * (file written to `<userData>/data/incoming/`, `onCapture`
 * callback invoked, `bringToFront` called).
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HttpServerHandle, startHttpServer } from "./http-server.js";

let userDataDir: string;
let server: HttpServerHandle;
let onCaptureLog: Array<{ source_url: string; width: number; height: number }>;
let bringToFrontCount: number;

async function start(): Promise<HttpServerHandle> {
  return startHttpServer({
    userDataDir,
    port: 0,
    onCapture: (payload) => onCaptureLog.push(payload),
    bringToFront: () => {
      bringToFrontCount += 1;
    },
  });
}

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(join(tmpdir(), "annot-http-userdata-"));
  onCaptureLog = [];
  bringToFrontCount = 0;
  server = await start();
});

afterEach(async () => {
  await server.close();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

const tinyPngB64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("HTTP server — health + CORS", () => {
  it("GET /ping returns the OK envelope", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/ping`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ status: "ok", app: "annot" });
  });

  it("OPTIONS preflight returns 200 with CORS headers", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/capture`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("Unknown route returns 404", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/unknown`);
    expect(res.status).toBe(404);
  });
});

describe("HTTP server — POST /capture", () => {
  it("writes the capture to <userData>/data/incoming and returns success", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: `data:image/png;base64,${tinyPngB64}`,
        source_url: "https://example.com/article",
        width: 1280,
        height: 720,
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; path: string };
    expect(json.success).toBe(true);

    // File on disk is the decoded base64 bytes.
    const written = await fs.readFile(json.path);
    expect(written.length).toBe(68); // tinyPng decodes to 68 bytes.

    // Sidecar metadata next to the capture.
    const meta = JSON.parse(await fs.readFile(`${json.path}.json`, "utf-8")) as {
      source_url: string;
      width: number;
      height: number;
    };
    expect(meta.source_url).toBe("https://example.com/article");
    expect(meta.width).toBe(1280);
    expect(meta.height).toBe(720);

    // Side-effect hooks fired exactly once.
    expect(onCaptureLog).toEqual([
      { source_url: "https://example.com/article", width: 1280, height: 720 },
    ]);
    expect(bringToFrontCount).toBe(1);
  });

  it("accepts raw base64 (no data URL prefix)", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: tinyPngB64 }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(true);
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an over-cap declared Content-Length with 413", async () => {
    // Modern `fetch` (undici) refuses to send mismatched body /
    // Content-Length, so use the raw `http.request` path to
    // exercise the defence-in-depth Content-Length pre-check.
    const status = await new Promise<number>((resolve, reject) => {
      const http = require("node:http") as typeof import("node:http");
      const req = http.request(
        {
          host: "127.0.0.1",
          port: server.port,
          path: "/capture",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(60 * 1024 * 1024),
          },
        },
        (res) => {
          // Drain the response so the socket can close cleanly.
          res.on("data", () => {});
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ data: tinyPngB64 }));
    });
    expect(status).toBe(413);
  });

  it("filenames follow the annot-YYYYMMDD-HHMMSS-mmm shape", async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/capture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: tinyPngB64 }),
    });
    const json = (await res.json()) as { path: string };
    const basename = json.path.split(/[\\/]/).pop() ?? "";
    expect(basename).toMatch(/^annot-\d{8}-\d{6}-\d{3}\.jpg$/);
  });
});
