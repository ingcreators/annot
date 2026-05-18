/**
 * Build-time constants injected by Vite plugins.
 *
 * The companion definition + values live in `packages/web/vite/`.
 */

/**
 * Build version of the running bundle. See
 * `packages/web/vite/version-plugin.ts`.
 *
 *  - CI builds: `GITHUB_SHA` (full 40-char commit hash).
 *  - Local `vite build`: `git rev-parse HEAD` output.
 *  - `vite dev` / tarball with no git: `dev-<timestamp>`.
 *
 * Modules that gate on dev mode should check
 * `__APP_VERSION__.startsWith("dev-")`.
 */
declare const __APP_VERSION__: string;
