import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import type { Plugin } from "vite";

/**
 * Resolves a build version + plumbs it through Vite as both:
 *
 *  1. A bare constant `__APP_VERSION__` via `define`, available in
 *     the bundle as a string literal. The recovery / poller modules
 *     compare to this at runtime.
 *  2. A `version.txt` file in `publicDir` (default
 *     `packages/web/public/`) so Vite copies it verbatim into
 *     `dist/version.txt`. Cloudflare Workers Static Assets serves it
 *     un-hashed at `/version.txt`; the runtime poller fetches it on
 *     visibility change to detect that a new deploy has landed
 *     (different hash on the server vs the bundled constant).
 *
 * Resolution order:
 *  - `GITHUB_SHA` env var (CI builds set this).
 *  - `git rev-parse HEAD` (local dev when in a repo).
 *  - `dev-${Date.now()}` (tarball builds with no git available).
 *
 * The `dev-` prefix is load-bearing — `version-poller.ts` skips
 * polling entirely when `__APP_VERSION__.startsWith("dev-")`, so
 * `vite dev` never spams a "new version available" banner just
 * because the constant and the file disagree on timestamps.
 *
 * Resolution happens once when this module is imported (i.e. when
 * Vite loads `vite.config.ts`). Both `define` and the file write
 * read from the same captured value so they cannot drift.
 *
 * See `docs/plans/web-dynamic-import-recovery.md`.
 */
export function appVersionPlugin(): Plugin {
  const version = resolveAppVersion();
  return {
    name: "annot-app-version",
    config() {
      return {
        define: {
          __APP_VERSION__: JSON.stringify(version),
        },
      };
    },
    configResolved(config) {
      // `configResolved` fires for both `vite dev` and `vite build`,
      // so the file is in place before the dev server starts serving
      // and before the build copy step runs. Vite copies `publicDir`
      // contents verbatim into `outDir` on build.
      const target = resolvePath(config.publicDir, "version.txt");
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${version}\n`, "utf8");
    },
  };
}

function resolveAppVersion(): string {
  const fromEnv = process.env.GITHUB_SHA?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return `dev-${Date.now()}`;
  }
}
