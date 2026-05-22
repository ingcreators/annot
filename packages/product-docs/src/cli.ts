// Command-line interface for `@ingcreators/annot-product-docs`.
//
// Phase 1 PR 4 of `docs/plans/living-product-docs.md`. Provides
// the three commands the plan calls out:
//
//   annot docs init      Scaffold annot-docs.config.ts + a sample
//                        tour spec + a starter screen MDX.
//
//   annot docs sync      For every MDX with `annot:` frontmatter,
//                        re-capture aria-snapshot + attribute
//                        blocks via Playwright. Writes back to
//                        the source MDX in place.
//
//   annot docs lint      Same walk as `sync`, but reports drift
//                        against the live page instead of
//                        rewriting. Exit code is non-zero when
//                        any `error`-severity finding fires.
//
// Phase 4 polishes the `--ci` / `--fix` / JSON output of `lint`;
// this PR ships the human-readable form so the workflow is
// end-to-end usable today.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Browser, Page } from "playwright-core";
import { parseAnnotationsYaml } from "./annotations-yaml.js";
import {
  type DriftFinding,
  type DriftSeverity,
  detectDrift,
  lintableScreens,
  summariseDrift,
} from "./drift.js";
import { syncProductDocs } from "./fixture.js";
import { parseMdxFile } from "./mdx.js";
import { migrateMdxFile } from "./migrate-to-element-tree.js";
import { parseSnapshot } from "./resolver.js";
import type { ScreenSpec } from "./types.js";

export interface CliOptions {
  cwd?: string;
  /** Write target for diagnostic output (defaults to process.stderr). */
  stderr?: (line: string) => void;
  stdout?: (line: string) => void;
  /** Override Playwright launch (used in tests). Returns an already-open `Page`. */
  newPage?: (url: string) => Promise<{ page: Page; close: () => Promise<void> }>;
}

/**
 * `main(argv)` entrypoint. Returns the process exit code so the
 * bin script (`bin/annot-docs.mjs`) can `process.exit(...)`. Also
 * usable from vitest by passing custom `stdout` / `stderr` / `cwd`.
 */
export async function main(argv: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((l: string) => process.stdout.write(`${l}\n`));
  const stderr = options.stderr ?? ((l: string) => process.stderr.write(`${l}\n`));
  const cwd = options.cwd ?? process.cwd();

  const [, , verb, ...rest] = argv;
  if (verb !== "init" && verb !== "sync" && verb !== "lint" && verb !== "migrate-to-element-tree") {
    stderr(USAGE);
    return verb ? 1 : 0;
  }

  try {
    switch (verb) {
      case "init":
        return await runInit(rest, { cwd, stdout, stderr });
      case "sync":
        return await runSync(rest, { ...options, cwd, stdout, stderr });
      case "lint":
        return await runLint(rest, { ...options, cwd, stdout, stderr });
      case "migrate-to-element-tree":
        return await runMigrateToElementTree(rest, { cwd, stdout, stderr });
    }
  } catch (err) {
    stderr(`annot docs ${verb}: ${(err as Error).message}`);
    return 1;
  }
}

const USAGE = [
  "annot docs <command> [options]",
  "",
  "Commands:",
  "  init                       Scaffold annot-docs.config.ts + sample files",
  "  sync   --url <baseUrl>     Re-capture snapshot + attrs into every annot MDX",
  "  lint   --url <baseUrl>     Report drift between annot MDXs and the live page",
  "  migrate-to-element-tree    Convert legacy annot:snapshot / annot:attributes",
  "                             MDX blocks into PNG XMP annot:elementTree chunks",
  "                             (one-time, per Phase 1g of",
  "                             docs/plans/living-spec-authoring-roadmap.md)",
  "",
  "Options:",
  "  --url <baseUrl>            Base URL Playwright navigates to (sync / lint)",
  "  --root <dir>               Override MDX search root (default: docs/)",
  "  --dry-run                  migrate-to-element-tree only — report what would",
  "                             be changed without writing back",
  "  --check-descriptions       lint only — also validate <AnnotCallout for> IDs",
  "                             against the screen's annotations yaml overlays[]",
  "                             (Phase 2c of living-spec-authoring-roadmap.md)",
  "  --help                     Show this help",
].join("\n");

// ─── init ──────────────────────────────────────────────────────

interface InitDeps {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

async function runInit(_args: string[], deps: InitDeps): Promise<number> {
  const { cwd, stdout } = deps;
  const targets: Array<{ path: string; content: string }> = [
    { path: "annot-docs.config.ts", content: SCAFFOLD_CONFIG },
    { path: "tests/docs/example.spec.ts", content: SCAFFOLD_TOUR },
    { path: "docs/books/example/SC-001-login.mdx", content: SCAFFOLD_SCREEN_MDX },
  ];

  let wrote = 0;
  for (const target of targets) {
    const abs = resolve(cwd, target.path);
    try {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, target.content, { flag: "wx" });
      stdout(`  created ${target.path}`);
      wrote++;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        stdout(`  exists  ${target.path} (skipped)`);
      } else {
        throw err;
      }
    }
  }
  stdout(
    wrote === 0
      ? "annot docs init: nothing to do (all targets exist)"
      : `annot docs init: wrote ${wrote} file(s)`,
  );
  return 0;
}

const SCAFFOLD_CONFIG = `// Living product docs config for annot.
// See https://github.com/ingcreators/annot/blob/main/docs/plans/living-product-docs.md
import { defineConfig } from "@ingcreators/annot-product-docs";

export default defineConfig({
  meta: {
    projectName: "Example",
  },
  xlsx: {
    defaultBook: "Screen spec",
    books: {
      "Screen spec": {
        // Drop your customer-supplied template here (Phase 3) and
        // the Excel adapter will fill it. Until then the OSS
        // default layout applies.
        // template: "./templates/customer-screen-spec.xlsx",
      },
    },
  },
});
`;

const SCAFFOLD_TOUR = `// Tour file — runs through every screen and refreshes the
// matching MDX's annot:snapshot / annot:attributes blocks.
//
// Run with: pnpm playwright test tests/docs/

import { test } from "@ingcreators/annot-product-docs";

test.describe.configure({ mode: "serial" });

test("login flow", async ({ page, productDocs }) => {
  await page.goto("/login");
  await productDocs.sync({
    id: "login",
    mdxPath: "docs/books/example/SC-001-login.mdx",
  });
});
`;

const SCAFFOLD_SCREEN_MDX = `---
annot:
  id: SC-001
  title: Login screen
  meta:
    author: TODO
  xlsx:
    book: Screen spec
    sheet: SC-001 Login
    role: screen
    order: 100
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# Login screen

Enter your credentials to access the system.

<Screen id="login" src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**Email** — Enter your registered email address.
</Overlay>

<Overlay match={{ role: "button", name: "Sign in" }} intent="action" number={2}>
Click to sign in.
</Overlay>

</Screen>
`;

// ─── sync / lint ───────────────────────────────────────────────

interface RunDeps {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  newPage?: CliOptions["newPage"];
}

async function runSync(args: string[], deps: RunDeps): Promise<number> {
  const { cwd, stdout, stderr } = deps;
  const flags = parseFlags(args);
  if (!flags.url) {
    stderr("annot docs sync: --url <baseUrl> is required.");
    return 1;
  }
  const mdxFiles = await walkMdx(resolve(cwd, flags.root ?? "docs"));
  const annotMdxs = await filterAnnotMdxFiles(mdxFiles);
  if (annotMdxs.length === 0) {
    stdout(
      `annot docs sync: no MDX files with \`annot:\` frontmatter under ${flags.root ?? "docs"}.`,
    );
    return 0;
  }
  stdout(`annot docs sync: ${annotMdxs.length} MDX file(s) → ${flags.url}`);

  const { newPage, close } = await openBrowser(flags.url, deps);
  try {
    for (const mdx of annotMdxs) {
      const parsed = await parseMdxFile(mdx);
      if (!parsed) continue;
      const screens = lintableScreens(parsed.screens);
      if (screens.length === 0) {
        stdout(`  skip   ${relative(cwd, mdx)} (no <Screen> blocks)`);
        continue;
      }
      for (const screen of screens) {
        const { page, dispose } = await newPage(screen.src ?? "/");
        try {
          await syncProductDocs(page, { id: screen.id, mdxPath: mdx });
          stdout(`  synced ${relative(cwd, mdx)} (screen=${screen.id})`);
        } finally {
          await dispose();
        }
      }
    }
  } finally {
    await close();
  }
  return 0;
}

async function runLint(args: string[], deps: RunDeps): Promise<number> {
  const { cwd, stdout, stderr } = deps;
  const flags = parseFlags(args);
  if (!flags.url) {
    stderr("annot docs lint: --url <baseUrl> is required.");
    return 1;
  }
  const mdxFiles = await walkMdx(resolve(cwd, flags.root ?? "docs"));
  const annotMdxs = await filterAnnotMdxFiles(mdxFiles);
  if (annotMdxs.length === 0) {
    if (!flags.json) {
      stdout(
        `annot docs lint: no MDX files with \`annot:\` frontmatter under ${flags.root ?? "docs"}.`,
      );
    } else {
      stdout(JSON.stringify({ findings: [], summary: { errors: 0, warnings: 0, infos: 0 } }));
    }
    return 0;
  }
  if (!flags.json) {
    stdout(`annot docs lint: ${annotMdxs.length} MDX file(s) → ${flags.url}`);
  }

  interface FileFinding {
    file: string;
    finding: DriftFinding;
  }
  const allFindings: FileFinding[] = [];
  const filesWithDrift = new Set<string>();

  const { newPage, close } = await openBrowser(flags.url, deps);
  try {
    for (const mdx of annotMdxs) {
      const parsed = await parseMdxFile(mdx);
      if (!parsed) continue;
      for (const screen of lintableScreens(parsed.screens)) {
        const { page, dispose } = await newPage(screen.src ?? "/");
        try {
          const yaml = await page.locator("body").ariaSnapshot({ mode: "ai" });
          const liveSnapshot = parseSnapshot(yaml);
          const yamlOverlays = flags.checkDescriptions
            ? await tryLoadYamlOverlays(screen, mdx, stderr)
            : undefined;
          const findings = detectDrift({ screen, liveSnapshot, yamlOverlays });
          for (const f of findings) {
            allFindings.push({ file: relative(cwd, mdx), finding: f });
            filesWithDrift.add(mdx);
          }
        } finally {
          await dispose();
        }
      }
    }
  } finally {
    await close();
  }

  if (flags.json) {
    const summary = summariseDrift(allFindings.map((f) => f.finding));
    stdout(
      JSON.stringify({
        findings: allFindings.map(({ file, finding }) => ({
          file,
          severity: finding.severity,
          kind: finding.kind,
          screenId: finding.screenId,
          message: finding.message,
          match: finding.match,
          suggestion: finding.suggestion,
        })),
        summary,
      }),
    );
  } else {
    for (const { file, finding } of allFindings) {
      stdout(
        `${formatSeverity(finding.severity)} ${file} [${finding.screenId}] ${finding.kind}: ${finding.message}`,
      );
    }
    const summary = summariseDrift(allFindings.map((f) => f.finding));
    stdout(
      `annot docs lint: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info(s).`,
    );
  }

  // `--fix` re-runs syncProductDocs for every file that produced
  // any drift finding. That refreshes the stored snapshot +
  // attributes blocks so the next `lint` is clean. It does NOT
  // rewrite `<Overlay match>` keys — renames are author
  // decisions, not pipeline fixes.
  let fixedCount = 0;
  if (flags.fix && filesWithDrift.size > 0) {
    const { newPage: newPageFix, close: closeFix } = await openBrowser(flags.url, deps);
    try {
      for (const mdx of filesWithDrift) {
        const parsed = await parseMdxFile(mdx);
        if (!parsed) continue;
        for (const screen of lintableScreens(parsed.screens)) {
          const { page, dispose } = await newPageFix(screen.src ?? "/");
          try {
            await syncProductDocs(page, { id: screen.id, mdxPath: mdx });
            fixedCount++;
          } finally {
            await dispose();
          }
        }
      }
    } finally {
      await closeFix();
    }
    if (!flags.json) {
      stdout(`annot docs lint --fix: refreshed snapshot/attributes for ${fixedCount} screen(s).`);
    }
  }

  const summary = summariseDrift(allFindings.map((f) => f.finding));
  // --ci treats warnings as failures too. --fix excuses errors
  // it actually fixed (attribute-drift); for non-trivial drifts
  // (removed / duplicated) we still want a non-zero exit so the
  // CI run flags the docs as out-of-sync.
  if (flags.ci) {
    return summary.errors + summary.warnings > 0 ? 1 : 0;
  }
  return summary.errors > 0 ? 1 : 0;
}

/**
 * Phase 2c. Load `<Screen annotations="…">`-referenced yaml off
 * disk, returning the parsed overlays for the drift detector to
 * consume. Returns `undefined` when the screen has no `annotations`
 * prop — the drift detector then falls back to the legacy inline
 * `<Overlay>` path. A parse / IO error logs a warning to stderr
 * and returns `undefined` so a malformed yaml doesn't sink the
 * entire lint run; the next regeneration cycle (or a focused
 * `parseAnnotationsYaml` test) surfaces the diagnostic.
 */
async function tryLoadYamlOverlays(
  screen: ScreenSpec,
  mdxPath: string,
  stderr: (line: string) => void,
): Promise<import("./annotations-yaml.js").OverlayEntry[] | undefined> {
  if (!screen.annotations) return undefined;
  const abs = isAbsolute(screen.annotations)
    ? screen.annotations
    : resolve(dirname(mdxPath), screen.annotations);
  try {
    const source = await readFile(abs, "utf8");
    const file = parseAnnotationsYaml(source);
    return file.overlays;
  } catch (err) {
    stderr(
      `annot docs lint --check-descriptions: failed to load ${abs} (${(err as Error).message}). Skipping description cross-refs for this screen.`,
    );
    return undefined;
  }
}

interface OpenedBrowser {
  newPage(navigate: string): Promise<{ page: Page; dispose: () => Promise<void> }>;
  close(): Promise<void>;
}

async function openBrowser(baseUrl: string, deps: RunDeps): Promise<OpenedBrowser> {
  if (deps.newPage) {
    // Test-injected page factory — bypass Playwright.
    return {
      async newPage(navigate) {
        const { page, close } = await deps.newPage!(joinUrl(baseUrl, navigate));
        return { page, dispose: close };
      },
      async close() {
        /* no-op */
      },
    };
  }
  // Real Playwright launch.
  const { chromium } = await import("playwright-core");
  const browser: Browser = await chromium.launch({ headless: true });
  return {
    async newPage(navigate) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(joinUrl(baseUrl, navigate));
      return {
        page,
        dispose: async () => {
          await ctx.close();
        },
      };
    },
    async close() {
      await browser.close();
    },
  };
}

// ─── migrate-to-element-tree (Phase 1g) ────────────────────────

interface MigrateDeps {
  cwd: string;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

async function runMigrateToElementTree(args: string[], deps: MigrateDeps): Promise<number> {
  const { cwd, stdout, stderr } = deps;
  const flags = parseFlags(args);
  const mdxFiles = await walkMdx(resolve(cwd, flags.root ?? "docs"));
  const annotMdxs = await filterAnnotMdxFiles(mdxFiles);
  if (annotMdxs.length === 0) {
    stdout(
      `annot docs migrate-to-element-tree: no MDX files with \`annot:\` frontmatter under ${flags.root ?? "docs"}.`,
    );
    return 0;
  }
  stdout(
    `annot docs migrate-to-element-tree: ${annotMdxs.length} MDX file(s)${flags.dryRun ? " (dry run)" : ""}`,
  );

  let xmpWrites = 0;
  let mdxRewrites = 0;
  let skips = 0;

  for (const mdx of annotMdxs) {
    try {
      const result = await migrateMdxFile(mdx, { dryRun: flags.dryRun });
      for (const s of result.screens) {
        if (s.xmpWritten) {
          xmpWrites++;
          stdout(`  xmp     ${relative(cwd, mdx)} (screen=${s.id})`);
        } else if (s.skipReason) {
          skips++;
          stdout(`  skip    ${relative(cwd, mdx)} (screen=${s.id}, ${s.skipReason})`);
        }
      }
      if (result.mdxRewritten) {
        mdxRewrites++;
        stdout(`  rewrote ${relative(cwd, mdx)} (legacy blocks stripped)`);
      }
    } catch (err) {
      stderr(
        `annot docs migrate-to-element-tree: ${relative(cwd, mdx)}: ${(err as Error).message}`,
      );
      return 1;
    }
  }
  stdout(
    `annot docs migrate-to-element-tree: ${xmpWrites} XMP write(s), ${mdxRewrites} MDX rewrite(s), ${skips} skip(s).`,
  );
  return 0;
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/")) {
    return base.replace(/\/$/, "") + path;
  }
  // Relative `./shots/...` references on a `<Screen>` block are
  // image paths, not URLs. Default to the base URL itself.
  return base;
}

// ─── helpers ───────────────────────────────────────────────────

interface ParsedFlags {
  url?: string;
  root?: string;
  /** Phase 4: emit machine-readable JSON to stdout instead of
   *  human-readable lines. Useful for editor / CI integrations. */
  json?: boolean;
  /** Phase 4: also fail on warnings (used by `--ci`). */
  ci?: boolean;
  /** Phase 4: auto-fix safe drift kinds (attribute-drift,
   *  refresh stored snapshot). Equivalent to running
   *  `annot docs sync` against the same URL, but scoped to the
   *  files where lint found drift. */
  fix?: boolean;
  /** Phase 1g `migrate-to-element-tree` only: report what would
   *  change without writing back to disk. */
  dryRun?: boolean;
  /** Phase 2c of `docs/plans/living-spec-authoring-roadmap.md`:
   *  enable description cross-ref drift findings
   *  (`description-missing` / `description-orphan`) for screens
   *  that carry an `annotations="…"` yaml ref. Default: off, so
   *  authors mid-migration aren't spammed before they've populated
   *  every callout body. */
  checkDescriptions?: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  const out: ParsedFlags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--url" || arg === "-u") {
      out.url = args[++i];
    } else if (arg === "--root" || arg === "-r") {
      out.root = args[++i];
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--ci") {
      out.ci = true;
    } else if (arg === "--fix") {
      out.fix = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--check-descriptions") {
      out.checkDescriptions = true;
    }
  }
  return out;
}

/**
 * Walk the directory tree below `root` and return every `*.mdx`
 * absolute path. Uses `readdir({ withFileTypes: true })` for a
 * single syscall per directory — no external glob dep.
 */
export async function walkMdx(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    for (const entry of entries) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        stack.push(abs);
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

/**
 * Filter a list of MDX paths down to the ones with `annot:`
 * frontmatter — i.e. the files the CLI should act on.
 */
export async function filterAnnotMdxFiles(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const path of paths) {
    try {
      const parsed = await parseMdxFile(path);
      if (parsed) out.push(path);
    } catch {
      // Skip files that fail to parse — `annot docs lint` may
      // later add a `--strict` flag that surfaces them; for now,
      // a broken file shouldn't crash the whole walk.
    }
  }
  return out;
}

function formatSeverity(severity: DriftSeverity): string {
  switch (severity) {
    case "error":
      return "ERROR  ";
    case "warning":
      return "WARN   ";
    case "info":
      return "INFO   ";
  }
}

// Stop biome from flagging `sep` as unused — we keep it imported
// so the Windows / POSIX path handling in `relative` works the
// same regardless of the host's `path.sep`.
void sep;
