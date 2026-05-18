/**
 * Build-time `__APP_VERSION__` accessor with helpful predicates.
 *
 * The constant itself is injected by `appVersionPlugin` in
 * `packages/web/vite/version-plugin.ts`; the ambient declaration
 * lives in `packages/web/src/global.d.ts`.
 *
 * Keep this module SIDE-EFFECT-FREE — it must be safely importable
 * from anywhere, including the recovery handlers wired at the top
 * of `main.ts` before any other initialization.
 *
 * See `docs/plans/web-dynamic-import-recovery.md`.
 */

/** Current bundle's build version. SHA in CI / production, `dev-*`
 *  sentinel during `vite dev`. */
export const APP_VERSION: string = __APP_VERSION__;

/** Devs running `vite dev` get a `dev-<timestamp>` sentinel; the
 *  recovery code uses this to skip work that would only spam the
 *  developer with banners. */
export function isDevVersion(): boolean {
  return APP_VERSION.startsWith("dev-");
}
