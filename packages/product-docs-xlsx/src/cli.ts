// CLI for `@ingcreators/annot-product-docs-xlsx`.
//
// Phase 3 PR 6 of `docs/plans/living-product-docs.md`. Provides
// the `annot-docs-xlsx render` command that walks a docs root,
// groups MDXs by book, and emits one `<book>.xlsx` per group:
//
//   annot-docs-xlsx render --root docs --out dist/xlsx
//   annot-docs-xlsx render --root docs --book "Screen spec"
//
// Per-book template configuration comes from the project's
// `annot-docs.config.ts` when present; otherwise the default
// no-template layout is applied.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type AnnotDocsConfig, parseMdxFile } from "@ingcreators/annot-product-docs";

import { applyDefaultLayout } from "./default-layout.js";
import { type ExcelMdxBundle, extractFromParsed } from "./extract.js";
import { applyTemplateLayout, loadTemplateWorkbook } from "./template.js";
import { buildEmptyWorkbook, groupBundlesByBook, writeWorkbookToBytes } from "./workbook.js";

export interface CliOptions {
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

const USAGE = [
  "annot-docs-xlsx <command> [options]",
  "",
  "Commands:",
  "  render              Walk MDXs and emit one .xlsx per book",
  "",
  "Options:",
  "  --root <dir>        MDX search root (default: docs)",
  "  --out <dir>         Output dir for .xlsx files (default: dist/xlsx)",
  "  --book <name>       Restrict to a single book name",
  "  --config <file>     Path to annot-docs.config.ts (default: ./annot-docs.config.ts)",
  "  --help              Show this help",
].join("\n");

/**
 * `main(argv)` entrypoint. Returns the process exit code so the
 * bin script can `process.exit(...)`. Also driveable from
 * vitest via custom `stdout` / `stderr` / `cwd`.
 */
export async function main(argv: string[], options: CliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? ((l: string) => process.stdout.write(`${l}\n`));
  const stderr = options.stderr ?? ((l: string) => process.stderr.write(`${l}\n`));
  const cwd = options.cwd ?? process.cwd();

  const [, , verb, ...rest] = argv;
  if (verb !== "render") {
    stderr(USAGE);
    return verb ? 1 : 0;
  }
  const flags = parseFlags(rest);
  try {
    return await runRender(cwd, flags, stdout);
  } catch (err) {
    stderr(`annot-docs-xlsx render: ${(err as Error).message}`);
    return 1;
  }
}

interface ParsedFlags {
  root: string;
  out: string;
  book: string | undefined;
  config: string;
}

function parseFlags(args: string[]): ParsedFlags {
  let root = "docs";
  let out = "dist/xlsx";
  let book: string | undefined;
  let config = "annot-docs.config.ts";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = args[++i] ?? root;
    else if (arg === "--out") out = args[++i] ?? out;
    else if (arg === "--book") book = args[++i];
    else if (arg === "--config") config = args[++i] ?? config;
  }
  return { root, out, book, config };
}

async function runRender(
  cwd: string,
  flags: ParsedFlags,
  stdout: (line: string) => void,
): Promise<number> {
  const config = await loadConfigOrEmpty(resolve(cwd, flags.config), stdout);
  const mdxFiles = await walkMdx(resolve(cwd, flags.root));
  const bundles = await extractBundles(mdxFiles);
  if (bundles.length === 0) {
    stdout(`annot-docs-xlsx render: no MDX files with \`annot:\` frontmatter under ${flags.root}.`);
    return 0;
  }

  const grouped = groupBundlesByBook(bundles, config.xlsx?.defaultBook);
  const outDir = resolve(cwd, flags.out);
  await mkdir(outDir, { recursive: true });

  let emitted = 0;
  for (const [book, bookBundles] of grouped.entries()) {
    if (flags.book && book !== flags.book) continue;
    const wb = buildEmptyWorkbook({ book, bundles: bookBundles });
    const bookConfig = config.xlsx?.books?.[book];
    const templatePath = bookConfig?.template;
    if (templatePath) {
      const template = await loadTemplateWorkbook(resolve(cwd, templatePath));
      applyTemplateLayout({
        workbook: wb,
        template,
        bookConfig,
        bundles: bookBundles,
        substitute: { projectMeta: config.meta, renderTime: new Date() },
      });
    } else {
      applyDefaultLayout({ workbook: wb, bundles: bookBundles });
    }
    const bytes = await writeWorkbookToBytes(wb);
    const outFile = join(outDir, `${sanitiseFileName(book)}.xlsx`);
    await writeFile(outFile, bytes);
    stdout(`  wrote ${outFile} (${bookBundles.length} MDX file(s))`);
    emitted++;
  }

  if (flags.book && emitted === 0) {
    stdout(
      `annot-docs-xlsx render: book "${flags.book}" not found (had: ${[...grouped.keys()].join(", ")}).`,
    );
    return 1;
  }
  stdout(`annot-docs-xlsx render: emitted ${emitted} workbook(s) to ${flags.out}`);
  return 0;
}

async function loadConfigOrEmpty(
  configPath: string,
  stdout: (line: string) => void,
): Promise<AnnotDocsConfig> {
  try {
    const mod = await import(pathToFileURL(configPath).href);
    const config = (mod.default ?? mod) as AnnotDocsConfig;
    return config;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      stdout(`annot-docs-xlsx render: no config at ${configPath} — using defaults.`);
      return {};
    }
    throw err;
  }
}

async function walkMdx(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
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

async function extractBundles(paths: string[]): Promise<ExcelMdxBundle[]> {
  const out: ExcelMdxBundle[] = [];
  for (const path of paths) {
    try {
      const parsed = await parseMdxFile(path);
      if (parsed) out.push(extractFromParsed(parsed, path));
    } catch {
      // Skip un-parseable files; the CLI's `--strict` mode is a
      // Phase 4 polish item per the plan.
    }
  }
  return out;
}

function sanitiseFileName(name: string): string {
  return name.replace(/[\\/?*[\]:<>|"]/g, "_");
}
