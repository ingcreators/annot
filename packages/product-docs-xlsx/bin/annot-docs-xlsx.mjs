#!/usr/bin/env node

// `annot-docs-xlsx` CLI shim. Same shape as `annot-docs` /
// `annot-mcp`. Resolves the bundled entry and dispatches argv.

import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

const mod = await import(pathToFileURL(entry).href);
process.exit(await mod.main(process.argv));
