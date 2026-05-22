// CLI tests — covers `init` (filesystem only, no Playwright) and
// the MDX-walking helpers (`walkMdx`, `filterAnnotMdxFiles`).
//
// `sync` and `lint` need a Playwright browser, which we don't
// boot in CI; the `runLint` / `runSync` code paths accept a
// `newPage` factory override so a future PR can wire them up
// against a stub Page if needed.

import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { filterAnnotMdxFiles, main, walkMdx } from "./cli.js";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "annot-docs-cli-test-"));
}

describe("main: usage", () => {
  it("prints usage and exits 0 when no command is given", async () => {
    const lines: string[] = [];
    const exit = await main(["node", "annot-docs"], {
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
    });
    expect(exit).toBe(0);
    expect(lines.join("\n")).toMatch(/annot docs <command>/);
  });

  it("prints usage and exits 1 for an unknown command", async () => {
    const lines: string[] = [];
    const exit = await main(["node", "annot-docs", "bogus"], {
      stdout: (l) => lines.push(l),
      stderr: (l) => lines.push(l),
    });
    expect(exit).toBe(1);
  });
});

describe("main: init", () => {
  it("scaffolds the three default files into an empty dir", async () => {
    const cwd = await makeTempDir();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exit = await main(["node", "annot-docs", "init"], {
      cwd,
      stdout: (l) => stdout.push(l),
      stderr: (l) => stderr.push(l),
    });
    expect(exit).toBe(0);
    expect(stdout.join("\n")).toMatch(/wrote 3 file/);

    const configBytes = await readFile(join(cwd, "annot-docs.config.ts"), "utf8");
    expect(configBytes).toMatch(/defineConfig/);

    const tourBytes = await readFile(join(cwd, "tests", "docs", "example.spec.ts"), "utf8");
    expect(tourBytes).toMatch(/productDocs\.sync/);

    const screenBytes = await readFile(
      join(cwd, "docs", "books", "example", "SC-001-login.mdx"),
      "utf8",
    );
    expect(screenBytes).toMatch(/<Screen id="login"/);
    expect(screenBytes).toMatch(/annot:/);
  });

  it("is idempotent — re-running on an initialised dir skips existing files", async () => {
    const cwd = await makeTempDir();
    await main(["node", "annot-docs", "init"], {
      cwd,
      stdout: () => {},
      stderr: () => {},
    });
    const stdout: string[] = [];
    const exit = await main(["node", "annot-docs", "init"], {
      cwd,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(exit).toBe(0);
    expect(stdout.join("\n")).toMatch(/nothing to do/);
    const message = stdout.join("\n");
    expect((message.match(/exists/g) ?? []).length).toBe(3);
  });
});

describe("walkMdx", () => {
  it("returns absolute paths of every .mdx file under root, sorted", async () => {
    const cwd = await makeTempDir();
    await mkdir(join(cwd, "books", "a"), { recursive: true });
    await mkdir(join(cwd, "books", "b"), { recursive: true });
    await mkdir(join(cwd, "books", "node_modules"), { recursive: true });
    await mkdir(join(cwd, "books", ".hidden"), { recursive: true });
    await writeFile(join(cwd, "books", "a", "screen-1.mdx"), "stub");
    await writeFile(join(cwd, "books", "a", "screen-2.mdx"), "stub");
    await writeFile(join(cwd, "books", "b", "cover.mdx"), "stub");
    await writeFile(join(cwd, "books", "b", "not-mdx.txt"), "stub");
    await writeFile(join(cwd, "books", "node_modules", "ignored.mdx"), "stub");
    await writeFile(join(cwd, "books", ".hidden", "hidden.mdx"), "stub");

    const out = await walkMdx(cwd);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/screen-1\.mdx$/);
    expect(out[1]).toMatch(/screen-2\.mdx$/);
    expect(out[2]).toMatch(/cover\.mdx$/);
  });

  it("returns an empty array for a non-existent root", async () => {
    const out = await walkMdx(join(await makeTempDir(), "does", "not", "exist"));
    expect(out).toEqual([]);
  });
});

describe("filterAnnotMdxFiles", () => {
  it("keeps only files with annot frontmatter; non-annot MDX is skipped", async () => {
    const cwd = await makeTempDir();
    const annotMdx = join(cwd, "with-annot.mdx");
    const plainMdx = join(cwd, "plain.mdx");
    await writeFile(annotMdx, "---\nannot:\n  id: X\n---\n\n# Hi\n");
    await writeFile(plainMdx, "# Just plain MDX\n");

    const filtered = await filterAnnotMdxFiles([annotMdx, plainMdx]);
    expect(filtered).toEqual([annotMdx]);
  });

  it("does not throw on files that fail to parse — they're skipped", async () => {
    const cwd = await makeTempDir();
    const annotMdx = join(cwd, "ok.mdx");
    const brokenMdx = join(cwd, "broken.mdx");
    await writeFile(annotMdx, "---\nannot:\n  id: OK\n---\n\n# Hi\n");
    await writeFile(brokenMdx, "---\nannot:\n  id: ''\n---\n\n# bad\n");

    const filtered = await filterAnnotMdxFiles([annotMdx, brokenMdx]);
    expect(filtered).toEqual([annotMdx]);
  });
});

describe("main: sync / lint require --url", () => {
  it("sync without --url prints an error and exits 1", async () => {
    const cwd = await makeTempDir();
    const stderr: string[] = [];
    const exit = await main(["node", "annot-docs", "sync"], {
      cwd,
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(exit).toBe(1);
    expect(stderr.join("\n")).toMatch(/--url <baseUrl> is required/);
  });

  it("lint without --url prints an error and exits 1", async () => {
    const cwd = await makeTempDir();
    const stderr: string[] = [];
    const exit = await main(["node", "annot-docs", "lint"], {
      cwd,
      stdout: () => {},
      stderr: (l) => stderr.push(l),
    });
    expect(exit).toBe(1);
    expect(stderr.join("\n")).toMatch(/--url <baseUrl> is required/);
  });
});

describe("main: lint --json output shape", () => {
  it("emits empty JSON object when no annot MDXs", async () => {
    const cwd = await makeTempDir();
    const stdout: string[] = [];
    const exit = await main(
      ["node", "annot-docs", "lint", "--url", "http://localhost:1234", "--json"],
      {
        cwd,
        stdout: (l) => stdout.push(l),
        stderr: () => {},
      },
    );
    expect(exit).toBe(0);
    const out = JSON.parse(stdout[0]!);
    expect(out).toEqual({ findings: [], summary: { errors: 0, warnings: 0, infos: 0 } });
  });
});

describe("main: lint --ci flag affects exit code", () => {
  it("with no findings + --ci still exits 0", async () => {
    const cwd = await makeTempDir();
    const exit = await main(
      ["node", "annot-docs", "lint", "--url", "http://localhost:1234", "--ci"],
      {
        cwd,
        stdout: () => {},
        stderr: () => {},
      },
    );
    expect(exit).toBe(0);
  });
});

describe("main: sync / lint with no annot MDXs", () => {
  it("sync exits 0 with a friendly message when no annot MDX exists", async () => {
    const cwd = await makeTempDir();
    const stdout: string[] = [];
    const exit = await main(["node", "annot-docs", "sync", "--url", "http://localhost:1234"], {
      cwd,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(exit).toBe(0);
    expect(stdout.join("\n")).toMatch(/no MDX files with `annot:` frontmatter/);
  });

  it("lint exits 0 when no annot MDX exists", async () => {
    const cwd = await makeTempDir();
    const stdout: string[] = [];
    const exit = await main(["node", "annot-docs", "lint", "--url", "http://localhost:1234"], {
      cwd,
      stdout: (l) => stdout.push(l),
      stderr: () => {},
    });
    expect(exit).toBe(0);
    expect(stdout.join("\n")).toMatch(/no MDX files with `annot:` frontmatter/);
  });
});

// Sanity check that the init scaffold produces a parseable
// `annot:` frontmatter and a working <Screen> JSX block. If
// the snippets in `cli.ts` drift, this fails fast.
describe("init scaffolded screen MDX is well-formed", () => {
  it("parses through filterAnnotMdxFiles", async () => {
    const cwd = await makeTempDir();
    await main(["node", "annot-docs", "init"], { cwd, stdout: () => {}, stderr: () => {} });
    const allMdxs = await walkMdx(join(cwd, "docs"));
    const annotMdxs = await filterAnnotMdxFiles(allMdxs);
    expect(annotMdxs.length).toBe(1);
  });

  it("places the file at the documented path", async () => {
    const cwd = await makeTempDir();
    await main(["node", "annot-docs", "init"], { cwd, stdout: () => {}, stderr: () => {} });
    const entries = await readdir(join(cwd, "docs", "books", "example"));
    expect(entries).toContain("SC-001-login.mdx");
  });
});
