/**
 * Local HTTP server for the Chrome-extension capture handoff —
 * Phase 2 of `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of `packages/desktop/src-tauri/src/http_server.rs`.
 * Listens on `127.0.0.1:19530`, serves three things:
 *
 *   - `OPTIONS *`     CORS preflight (Allow-Origin: `*`).
 *   - `GET /ping`     `{"status":"ok","app":"annot"}` health-check.
 *   - `POST /capture` Accepts a `CaptureRequest` JSON body, saves
 *                     the data URL to `<userData>/data/incoming/`,
 *                     emits `chrome-capture` on the renderer, and
 *                     calls `bringToFront()` so the window
 *                     surfaces from the tray / taskbar.
 *
 * Body cap: 50 MB (the Rust impl's exact value — the extension's
 * full-page capture path can hit ~30 MB on long pages, so leaving
 * headroom). Bodies above the cap respond `413 Body too large`.
 *
 * Filename shape: `annot-YYYYMMDD-HHMMSS-mmm.jpg` to match
 * `defaultAnnotFilenameStem` in
 * `packages/core/src/utils/filename.ts`. Per-capture metadata
 * sidecar at `<filename>.json` with `source_url` / `width` /
 * `height` for the renderer's incoming-sweep code path.
 */

import { promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";

export const HTTP_SERVER_PORT = 19530;
const MAX_BODY_BYTES = 50 * 1024 * 1024;

export interface CaptureRequest {
  /** Base64 data URL or raw base64 of the captured image. */
  data: string;
  source_url?: string;
  width?: number;
  height?: number;
}

export interface HttpServerHooks {
  /** Called once a `POST /capture` body has been parsed and
   *  written to disk. Production wiring emits the
   *  `chrome-capture` IPC event into the renderer here. */
  onCapture?(payload: { source_url: string; width: number; height: number }): void;
  /** Called after a successful capture so the main window
   *  surfaces from the tray / taskbar. Production wiring runs
   *  `BrowserWindow.show() + restore() + focus()`. */
  bringToFront?(): void;
}

export interface HttpServerOptions extends HttpServerHooks {
  /** `<userData>/` resolved by the main process. The server
   *  writes captures under `<userData>/data/incoming/`. */
  userDataDir: string;
  /** Override the listening port. Production uses 19530;
   *  tests pass `0` for an ephemeral port. */
  port?: number;
  /** Override the host. Defaults to 127.0.0.1 — never bind
   *  to 0.0.0.0 since the extension always talks via
   *  localhost. */
  host?: string;
}

export interface HttpServerHandle {
  /** Resolved port the server is listening on. Useful for
   *  the ephemeral-port test cases. */
  readonly port: number;
  /** Stop the server. Returns a promise that resolves once
   *  every active connection has finished. */
  close(): Promise<void>;
}

export async function startHttpServer(opts: HttpServerOptions): Promise<HttpServerHandle> {
  const incomingDir = join(opts.userDataDir, "data", "incoming");
  await fs.mkdir(incomingDir, { recursive: true });

  const server: Server = createServer((req, res) => {
    void handleRequest(req, res, { ...opts, incomingDir }).catch((err) => {
      console.error("[annot-http] handler error:", err);
      writeJsonResponse(res, 500, { success: false, error: String(err) });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? HTTP_SERVER_PORT, opts.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort =
    address && typeof address === "object" ? address.port : opts.port ?? HTTP_SERVER_PORT;

  return {
    port: resolvedPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

interface ResolvedOptions extends HttpServerOptions {
  incomingDir: string;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOptions,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";

  if (method === "OPTIONS") {
    setCorsHeaders(res);
    res.statusCode = 200;
    res.end();
    return;
  }

  if (method === "GET" && url === "/ping") {
    setCorsHeaders(res);
    res.setHeader("Content-Type", "application/json");
    res.statusCode = 200;
    res.end(JSON.stringify({ status: "ok", app: "annot" }));
    return;
  }

  if (method === "POST" && url === "/capture") {
    await handleCapture(req, res, opts);
    return;
  }

  setCorsHeaders(res);
  res.statusCode = 404;
  res.end("Not found");
}

async function handleCapture(
  req: IncomingMessage,
  res: ServerResponse,
  opts: ResolvedOptions,
): Promise<void> {
  const declaredLen = Number.parseInt(req.headers["content-length"] ?? "0", 10);
  if (declaredLen > MAX_BODY_BYTES) {
    setCorsHeaders(res);
    res.statusCode = 413;
    res.end("Body too large");
    return;
  }

  const bodyBuf = await readBodyCapped(req, MAX_BODY_BYTES);
  if (bodyBuf === "too-large") {
    setCorsHeaders(res);
    res.statusCode = 413;
    res.end("Body too large");
    return;
  }

  let capture: CaptureRequest;
  try {
    capture = JSON.parse(bodyBuf.toString("utf-8")) as CaptureRequest;
  } catch (err) {
    setCorsHeaders(res);
    res.statusCode = 400;
    res.end(`JSON error: ${(err as Error).message}`);
    return;
  }

  let savedPath: string | null = null;
  let saveError: string | null = null;
  try {
    savedPath = await saveIncomingCapture(capture, opts.incomingDir);
  } catch (err) {
    saveError = (err as Error).message;
  }

  // Notify the renderer + bring the window forward whether or
  // not the on-disk save succeeded — the renderer's incoming-
  // sweep code path tolerates a missing file (no-op skip), and
  // surfacing the window matches the user's expectation that
  // hitting "send to local desktop" focuses the app.
  opts.onCapture?.({
    source_url: capture.source_url ?? "",
    width: capture.width ?? 0,
    height: capture.height ?? 0,
  });
  opts.bringToFront?.();

  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 200;
  if (savedPath !== null) {
    res.end(JSON.stringify({ success: true, path: savedPath }));
  } else {
    res.end(JSON.stringify({ success: false, error: saveError }));
  }
}

async function saveIncomingCapture(capture: CaptureRequest, incomingDir: string): Promise<string> {
  const dataPart = capture.data.includes(",")
    ? (capture.data.split(",")[1] ?? capture.data)
    : capture.data;
  const bytes = Buffer.from(dataPart, "base64");
  if (bytes.length === 0) {
    throw new Error("empty capture body");
  }

  // Match `defaultAnnotFilenameStem` in
  // `packages/core/src/utils/filename.ts`:
  // `annot-YYYYMMDD-HHMMSS-mmm`. Local time, not UTC — the
  // capture stem is user-visible and stable across host
  // languages.
  const stem = formatLocalTimestampStem(new Date());
  const filename = `${stem}.jpg`;
  const filePath = join(incomingDir, filename);
  await fs.writeFile(filePath, bytes);

  const meta = {
    filename,
    path: filePath,
    source_url: capture.source_url ?? "",
    width: capture.width ?? 0,
    height: capture.height ?? 0,
  };
  // Sidecar is best-effort — same as the Rust impl which calls
  // `.ok()` on the metadata write.
  try {
    await fs.writeFile(`${filePath}.json`, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    /* ignored */
  }

  return filePath;
}

function readBodyCapped(req: IncomingMessage, cap: number): Promise<Buffer | "too-large"> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        req.destroy();
        resolve("too-large");
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function writeJsonResponse(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  setCorsHeaders(res);
  res.setHeader("Content-Type", "application/json");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function formatLocalTimestampStem(now: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const y = now.getFullYear();
  const mo = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  const ms = pad(now.getMilliseconds(), 3);
  return `annot-${y}${mo}${d}-${h}${mi}${s}-${ms}`;
}
