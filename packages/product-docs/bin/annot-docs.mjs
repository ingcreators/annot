#!/usr/bin/env node

// `annot-docs` CLI shim. The actual logic lives in
// `../dist/index.js` after `vite build`; during workspace
// development run `pnpm --filter @ingcreators/annot-product-docs
// build` before invoking the bin.
//
// Commands:
//   annot docs init                  Scaffold config + sample files
//   annot docs sync --url <baseUrl>  Re-capture snapshot/attrs into MDXs
//   annot docs lint --url <baseUrl>  Report drift; non-zero exit on errors

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

// Windows dynamic import requires a `file://` URL; passing the raw
// absolute path triggers `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Use
// `pathToFileURL` so the same code works on Linux / macOS / Windows.
const mod = await import(pathToFileURL(entry).href);
process.exit(await mod.main(process.argv));
