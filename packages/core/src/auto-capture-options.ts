/**
 * Auto Capture engine settings — shared between
 * `@ingcreators/annot-web` (live) and `@ingcreators/annot-extension`
 * (future, when the extension grows its own Auto Capture surface).
 *
 * Three discrete-choice presets cover the spec §6.6 settings —
 * raw millisecond / ratio numbers stay internal so the UI can
 * surface readable labels and the encoder doesn't have to validate
 * arbitrary user input.
 *
 * Persistence shape on each host:
 * - Web: `localStorage["annot-auto-capture-options"]` mirrors this
 *   `AutoCaptureOptions` blob 1:1, with `loadAutoCaptureOptions()`
 *   doing the merge / validation.
 * - Extension (future): one nested record under
 *   `Settings.autoCapture` in `chrome.storage.sync`, mirroring the
 *   `Settings.quality` precedent.
 *
 * The engine consumes the resolved milliseconds via the Tier C
 * `<annot-capture-workspace>` wiring; this Tier A leaf is pure
 * data + helpers so it pulls into a Node test harness without the
 * DOM / Lit / engine code.
 */

/** Sampling cadence — how often the engine grabs a comparison
 *  frame. Faster catches sub-second flickers; slower reduces
 *  CPU pressure on low-end machines. */
export type CaptureIntervalPreset = "fast" | "standard" | "slow";

/** How aggressively the engine treats a frame diff as "meaningful".
 *  - sensitive: small UI changes (a button hover) trigger captures
 *  - standard: typical procedure-doc flow (page navigation, dialog open)
 *  - major: only obvious changes (full-page navigation, modal swap) */
export type ChangeSensitivityPreset = "sensitive" | "standard" | "major";

/** How long the engine waits for the screen to settle before
 *  capturing — protects against capturing mid-animation frames.
 *  - none: capture immediately when diff drops below threshold
 *  - short: spec default (700ms)
 *  - long: animation-heavy sites that take >1s to settle */
export type StableWaitPreset = "none" | "short" | "long";

export interface AutoCaptureOptions {
  /** Sampling cadence preset. */
  interval: CaptureIntervalPreset;
  /** Diff-detection threshold preset. */
  sensitivity: ChangeSensitivityPreset;
  /** Stable-wait duration preset. */
  stableWait: StableWaitPreset;
  /** When true, frames whose only change is a localized cursor-
   *  shaped region are dropped (no candidate created). Default
   *  on — most users want stable workflow captures, not cursor
   *  movements. */
  ignoreCursorOnlyChanges: boolean;
}

export const DEFAULT_AUTO_CAPTURE_OPTIONS: AutoCaptureOptions = {
  interval: "standard",
  sensitivity: "standard",
  stableWait: "short",
  ignoreCursorOnlyChanges: true,
};

/** Preset → millisecond mapping. Engine consumes the resolved
 *  milliseconds; UI surfaces the preset key + the human label
 *  via {@link CAPTURE_INTERVAL_LABEL}. */
export const CAPTURE_INTERVAL_MS: Record<CaptureIntervalPreset, number> = {
  fast: 500,
  standard: 1000,
  slow: 2000,
};

export const CAPTURE_INTERVAL_LABEL: Record<CaptureIntervalPreset, string> = {
  fast: "Fast (0.5s)",
  standard: "Standard (1s)",
  slow: "Slow (2s)",
};

/** Preset → diff ratio threshold. Higher = more change required
 *  before the engine treats the frame as meaningful. */
export const CHANGE_SENSITIVITY_RATIO: Record<ChangeSensitivityPreset, number> = {
  sensitive: 0.01,
  standard: 0.03,
  major: 0.1,
};

export const CHANGE_SENSITIVITY_LABEL: Record<ChangeSensitivityPreset, string> = {
  sensitive: "Sensitive (small changes)",
  standard: "Standard",
  major: "Major changes only",
};

/** Preset → stable-wait milliseconds. */
export const STABLE_WAIT_MS: Record<StableWaitPreset, number> = {
  none: 0,
  short: 700,
  long: 1500,
};

export const STABLE_WAIT_LABEL: Record<StableWaitPreset, string> = {
  none: "None (capture immediately)",
  short: "Short (0.7s)",
  long: "Long (1.5s)",
};

/** Engine-facing resolved values. The Tier C
 *  `<annot-capture-workspace>` calls this once when starting the
 *  engine and passes the result into `AutoCaptureEngine`. */
export interface ResolvedAutoCaptureSettings {
  intervalMs: number;
  changeRatioThreshold: number;
  stableWaitMs: number;
  ignoreCursorOnlyChanges: boolean;
}

export function resolveAutoCaptureOptions(
  opts: AutoCaptureOptions = DEFAULT_AUTO_CAPTURE_OPTIONS,
): ResolvedAutoCaptureSettings {
  return {
    intervalMs: CAPTURE_INTERVAL_MS[opts.interval],
    changeRatioThreshold: CHANGE_SENSITIVITY_RATIO[opts.sensitivity],
    stableWaitMs: STABLE_WAIT_MS[opts.stableWait],
    ignoreCursorOnlyChanges: opts.ignoreCursorOnlyChanges,
  };
}

/** Type guards — useful for the persistence layer's merge step. */
export function isCaptureIntervalPreset(v: unknown): v is CaptureIntervalPreset {
  return v === "fast" || v === "standard" || v === "slow";
}
export function isChangeSensitivityPreset(v: unknown): v is ChangeSensitivityPreset {
  return v === "sensitive" || v === "standard" || v === "major";
}
export function isStableWaitPreset(v: unknown): v is StableWaitPreset {
  return v === "none" || v === "short" || v === "long";
}
