/**
 * Centralised logging shim for `@ingcreators/annot-web`.
 *
 * Replaces scattered `console.log` calls so that:
 *   1. Deployers / auditors see one channel rather than dozens.
 *   2. Verbose pipeline traces can be quieted at runtime via
 *      `setLogLevel("warn")` without redeploying.
 *   3. Plugins (`PluginHost`) and Storybook stories can both
 *      reach the same sink, keeping logs comparable across
 *      surfaces.
 *
 * Levels follow the standard severity ladder. `silent` is the
 * floor — nothing routes through `console.*`. The default is
 * `debug` so the existing trace volume is preserved until a
 * deployer opts in to tightening it.
 *
 * Phase 3 of `docs/plans/source-audit-cleanup.md`. Lives in
 * `packages/web` per the sign-off (the bulk of the in-scope
 * traces are gallery / editor / capture-pipeline calls already
 * in `web`; `core` stays DOM-free for the headless future).
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

let currentLevel: LogLevel = "debug";

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
