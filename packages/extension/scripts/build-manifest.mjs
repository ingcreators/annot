#!/usr/bin/env node
// Generate `dist/manifest.json` from `manifests/chrome.json` +
// repo-root `.env*` overrides.
//
// Why a script instead of `cp`: the manifest's
// `externally_connectable.matches` is the gate that lets a web
// page call `chrome.runtime.sendMessage(EXT_ID, ...)`. Self-
// hosters who deploy the PWA under a different domain MUST
// include their domain here, otherwise their PWA can't talk to
// the extension. Inline-`cp` of the static JSON can't express
// that.
//
// Inputs:
//   - `manifests/chrome.json`                — base manifest
//   - `VITE_EXT_EXTERNALLY_CONNECTABLE_MATCHES` (env, from
//      repo-root `.env*` files) — comma-separated list of match
//      patterns. When set, REPLACES the default
//      `["https://annot.work/*", "http://localhost:3000/*"]`.
//
// The script is invoked from `packages/extension/package.json`'s
// `build` script after the two Vite passes.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "../..");

// ── Load env from repo-root `.env*` files ───────────────────
// Minimal in-tree dotenv reader — no `dotenv` dep. Reads in the
// order Vite's `loadEnv` would: `.env`, `.env.local`,
// `.env.<mode>`, `.env.<mode>.local`. Later files win.
const MODE = process.env.NODE_ENV === "development" ? "development" : "production";
for (const file of [".env", ".env.local", `.env.${MODE}`, `.env.${MODE}.local`]) {
  loadDotEnv(resolve(REPO_ROOT, file));
}

const manifestSrc = resolve(PKG_ROOT, "manifests/chrome.json");
const manifestDst = resolve(PKG_ROOT, "dist/manifest.json");
const manifest = JSON.parse(readFileSync(manifestSrc, "utf8"));

// The source manifest carries the canonical-deployment defaults
// (`https://annot.work/*` + `http://localhost:3000/*`). Self-
// hosters override via the env var below; otherwise the source
// values flow through untouched.
const overridden = (process.env.VITE_EXT_EXTERNALLY_CONNECTABLE_MATCHES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (overridden.length > 0) {
  manifest.externally_connectable = { matches: overridden };
  console.log(
    `[annot-extension] manifest externally_connectable.matches = ${JSON.stringify(overridden)}`,
  );
}

writeFileSync(manifestDst, `${JSON.stringify(manifest, null, 2)}\n`);

function loadDotEnv(path) {
  let txt;
  try {
    txt = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Don't override values already set in the parent process env
    // — env vars on the shell take precedence over the dotenv file.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
