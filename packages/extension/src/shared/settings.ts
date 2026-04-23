/**
 * Extension-wide user settings. Persisted in `chrome.storage.sync` so they
 * follow the user across devices.
 *
 * Consumers:
 *   - service-worker.ts reads timings and quality at each capture
 *   - content script reads overlay/scrollbar policy via `hide-for-capture`
 *     message payload
 *   - options.ts reads + writes
 */

const STORAGE_KEY = "annot.settings.v1";

export type OverlayMode = "scrollOnly" | "all" | "never";

export interface Settings {
  overlays: {
    /** When to hide `position: fixed` / `sticky` elements during capture. */
    mode: OverlayMode;
    /**
     * Comma- or newline-separated CSS selectors that must NOT be hidden
     * even when overlay hiding is active (e.g. `.must-stay, #keep-me`).
     * Empty string = no exceptions.
     */
    preservedSelectors: string;
    /**
     * Multi-segment captures only (scroll / perPage): keep overlays visible
     * on the first viewport so the stitched / first page shows the page's
     * natural header, then hide them for segments 2+ so they don't repeat.
     * Matches the behavior of Shottr / Xnapper / CleanShot.
     */
    keepFirstSegment: boolean;
  };
  scrollbars: {
    /** Hide browser scrollbars during capture for cleaner output. */
    hide: boolean;
  };
  timing: {
    /** ms to wait after scroll-to before capturing the viewport. */
    scrollSettleMs: number;
    /** ms to wait after a user click before capturing (click-capture). */
    clickSettleMs: number;
    /** ms to wait after a hotkey trigger before capturing (hotkey-capture). */
    hotkeySettleMs: number;
    /** ms pause between successive segments of scroll / per-page captures. */
    interSegmentMs: number;
  };
  quality: {
    /**
     * Output format for captured images:
     *   - "smart": palettize to PNG-8 when the image has few unique colors
     *     (UI-heavy); otherwise fall back to `smartFallback` (photo-heavy).
     *   - "png":   always save as lossless PNG-24 (Chrome-native).
     *   - "jpeg":  always save as JPEG at `jpegPercent` quality.
     */
    format: ImageFormat;
    /** Fallback format used by "smart" mode when the image is photo-heavy. */
    smartFallback: "png" | "jpeg";
    /**
     * Heuristic: if a sampled pixel pass finds more unique RGBA colors than
     * this threshold, treat the image as photo-heavy and skip PNG-8.
     * Typical UI screenshots return <5000; photo-heavy pages return >20000.
     */
    smartColorThreshold: number;
    /** JPEG quality for captured images, 60–100 (%). */
    jpegPercent: number;
    /** JPEG quality for thumbnails, 60–95 (%). */
    thumbnailPercent: number;
    /** Thumbnail max width in pixels (height is derived from 16:9). */
    thumbnailMaxWidth: number;
  };
  /**
   * Viewport emulation by physically resizing the browser window before
   * capture (via `chrome.windows.update`). No extra permissions required.
   * The window's position + size is restored after the capture completes.
   *
   * Limitations compared to DevTools-based emulation:
   *   - Can't exceed the monitor's available size (resize clamps).
   *   - No device-pixel-ratio (DPR) override — captures at the display's
   *     native DPR.
   *   - No mobile user-agent or touch-event emulation.
   *   - The user sees their window change size during capture.
   */
  emulation: {
    enabled: boolean;
    preset: EmulationPreset;
    customWidth: number;
    customHeight: number;
  };
}

export type ImageFormat = "smart" | "png" | "jpeg";
export type EmulationPreset =
  | "native"
  | "fullhd"
  | "macbook"
  | "iphonese"
  | "iphone15promax"
  | "ipad"
  | "custom";

/** Target viewport size in CSS pixels (what the page sees). */
export interface EmulationViewport {
  width: number;
  height: number;
}

const EMULATION_PRESETS: Record<Exclude<EmulationPreset, "native" | "custom">, EmulationViewport> = {
  fullhd:         { width: 1920, height: 1080 },
  macbook:        { width: 1440, height: 900  },
  iphonese:       { width: 375,  height: 667  },
  iphone15promax: { width: 430,  height: 932  },
  ipad:           { width: 1024, height: 1366 },
};

/**
 * Resolve settings → target viewport size. Returns `null` when emulation
 * is disabled or preset is "native" (i.e. don't resize the window).
 */
export function resolveEmulation(settings: Settings): EmulationViewport | null {
  if (!settings.emulation.enabled) return null;
  const p = settings.emulation.preset;
  if (p === "native") return null;
  if (p === "custom") {
    return {
      width: settings.emulation.customWidth,
      height: settings.emulation.customHeight,
    };
  }
  return EMULATION_PRESETS[p];
}

export const DEFAULT_SETTINGS: Settings = {
  overlays: {
    mode: "scrollOnly",
    preservedSelectors: "",
    keepFirstSegment: true,
  },
  scrollbars: {
    hide: true,
  },
  timing: {
    scrollSettleMs: 300,
    clickSettleMs: 250,
    hotkeySettleMs: 80,
    interSegmentMs: 200,
  },
  quality: {
    format: "smart",
    smartFallback: "png",
    smartColorThreshold: 15000,
    jpegPercent: 92,
    thumbnailPercent: 85,
    thumbnailMaxWidth: 480,
  },
  emulation: {
    enabled: false,
    preset: "native",
    customWidth: 1920,
    customHeight: 1080,
  },
};

/** Deep-merge partial settings onto defaults (only known keys). */
export function mergeSettings(partial: any): Settings {
  const p = partial || {};
  return {
    overlays: {
      mode: (p.overlays?.mode as OverlayMode) ?? DEFAULT_SETTINGS.overlays.mode,
      preservedSelectors:
        typeof p.overlays?.preservedSelectors === "string"
          ? p.overlays.preservedSelectors
          : DEFAULT_SETTINGS.overlays.preservedSelectors,
      keepFirstSegment: typeof p.overlays?.keepFirstSegment === "boolean"
        ? p.overlays.keepFirstSegment
        : DEFAULT_SETTINGS.overlays.keepFirstSegment,
    },
    scrollbars: {
      hide: typeof p.scrollbars?.hide === "boolean"
        ? p.scrollbars.hide
        : DEFAULT_SETTINGS.scrollbars.hide,
    },
    timing: {
      scrollSettleMs: clampNumber(p.timing?.scrollSettleMs, 100, 2000, DEFAULT_SETTINGS.timing.scrollSettleMs),
      clickSettleMs: clampNumber(p.timing?.clickSettleMs, 50, 1500, DEFAULT_SETTINGS.timing.clickSettleMs),
      hotkeySettleMs: clampNumber(p.timing?.hotkeySettleMs, 0, 500, DEFAULT_SETTINGS.timing.hotkeySettleMs),
      interSegmentMs: clampNumber(p.timing?.interSegmentMs, 0, 500, DEFAULT_SETTINGS.timing.interSegmentMs),
    },
    quality: {
      format: pickEnum<ImageFormat>(p.quality?.format, ["smart", "png", "jpeg"], DEFAULT_SETTINGS.quality.format),
      smartFallback: pickEnum<"png" | "jpeg">(p.quality?.smartFallback, ["png", "jpeg"], DEFAULT_SETTINGS.quality.smartFallback),
      smartColorThreshold: clampNumber(p.quality?.smartColorThreshold, 500, 200000, DEFAULT_SETTINGS.quality.smartColorThreshold),
      jpegPercent: clampNumber(p.quality?.jpegPercent, 60, 100, DEFAULT_SETTINGS.quality.jpegPercent),
      thumbnailPercent: clampNumber(p.quality?.thumbnailPercent, 60, 95, DEFAULT_SETTINGS.quality.thumbnailPercent),
      thumbnailMaxWidth: pickEnum(p.quality?.thumbnailMaxWidth, [360, 480, 640, 960], DEFAULT_SETTINGS.quality.thumbnailMaxWidth),
    },
    emulation: {
      enabled: typeof p.emulation?.enabled === "boolean" ? p.emulation.enabled : DEFAULT_SETTINGS.emulation.enabled,
      preset: pickEnum<EmulationPreset>(
        p.emulation?.preset,
        ["native", "fullhd", "macbook", "iphonese", "iphone15promax", "ipad", "custom"],
        DEFAULT_SETTINGS.emulation.preset,
      ),
      customWidth: clampNumber(p.emulation?.customWidth, 320, 4096, DEFAULT_SETTINGS.emulation.customWidth),
      customHeight: clampNumber(p.emulation?.customHeight, 320, 4096, DEFAULT_SETTINGS.emulation.customHeight),
    },
  };
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function pickEnum<T>(v: unknown, allowed: T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}

/** Load settings, always returning a validated object (with defaults filled in). */
export async function loadSettings(): Promise<Settings> {
  try {
    const res = await chrome.storage.sync.get([STORAGE_KEY]);
    return mergeSettings(res[STORAGE_KEY]);
  } catch {
    try {
      const res = await chrome.storage.local.get([STORAGE_KEY]);
      return mergeSettings(res[STORAGE_KEY]);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}

/** Overwrite settings. Callers should pass a fully-formed Settings object. */
export async function saveSettings(settings: Settings): Promise<void> {
  const clean = mergeSettings(settings);
  try {
    await chrome.storage.sync.set({ [STORAGE_KEY]: clean });
  } catch {
    await chrome.storage.local.set({ [STORAGE_KEY]: clean });
  }
}

/**
 * Listen for settings changes (e.g. when the options page writes).
 * Returns an unsubscribe function.
 */
export function onSettingsChange(cb: (s: Settings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "sync" && area !== "local") return;
    if (!(STORAGE_KEY in changes)) return;
    cb(mergeSettings(changes[STORAGE_KEY]!.newValue));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/**
 * Parse a comma- or newline-separated CSS selector list into individual
 * selectors. Empty/whitespace-only entries are dropped.
 */
export function parseSelectorList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export type CaptureKind = "visible" | "area" | "scroll" | "perPage" | "click" | "hotkey";

/**
 * Whether to hide overlays for a capture of this kind, given the current
 * settings AND the current segment index (0-based).
 *
 * When `overlays.keepFirstSegment` is true, overlays stay visible on
 * segment 0 of scroll/perPage captures so the first viewport renders
 * naturally; they're hidden from segment 1 onward to avoid repeating the
 * same fixed header in subsequent shots.
 */
export function shouldHideOverlaysFor(
  kind: CaptureKind,
  mode: OverlayMode,
  segmentIndex: number = 0,
  keepFirstSegment: boolean = false,
): boolean {
  if (mode === "never") return false;
  const multiSegment = kind === "scroll" || kind === "perPage";
  const modeApplies = mode === "all" || multiSegment;
  if (!modeApplies) return false;
  if (multiSegment && keepFirstSegment && segmentIndex === 0) return false;
  return true;
}
