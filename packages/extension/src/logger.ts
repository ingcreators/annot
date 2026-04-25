/**
 * Centralised logging shim for `@ingcreators/annot-extension`.
 *
 * Mirror of `packages/web/src/logger.ts` but separate so the
 * extension stays self-contained (no cross-package import that
 * would make the bundler pull `@ingcreators/annot-web` into a
 * service-worker chunk).
 *
 * Default level is `debug` in development builds and `warn` in
 * production. Vite injects `import.meta.env.PROD` as a build-time
 * boolean per the active mode (`vite build` → PROD=true,
 * `vite build --mode development` → PROD=false). Production
 * `console.log` / `console.info` calls become no-ops without
 * needing a wrapping `if (__DEV__)` at every site.
 *
 * Phase 3 of `docs/plans/source-audit-cleanup.md`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const isProd: boolean =
  (import.meta as { env?: { PROD?: boolean } }).env?.PROD ?? false;

let currentLevel: LogLevel = isProd ? "warn" : "debug";

function shouldLog(level: LogLevel): boolean {
  return RANK[level] >= RANK[currentLevel];
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog("debug")) console.log(...args);
  },
  info(...args: unknown[]): void {
    if (shouldLog("info")) console.info(...args);
  },
  warn(...args: unknown[]): void {
    if (shouldLog("warn")) console.warn(...args);
  },
  error(...args: unknown[]): void {
    if (shouldLog("error")) console.error(...args);
  },
};

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}
