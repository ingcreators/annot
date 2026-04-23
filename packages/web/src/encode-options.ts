/**
 * Web-app side loader for shared image encoding preferences.
 *
 * The browser-extension keeps its own copy in `chrome.storage.sync`; the
 * Annot PWA uses localStorage as a lightweight mirror. Defaults match
 * `@ingcreators/annot-core/encode`'s `DEFAULT_ENCODE_OPTIONS`.
 *
 * Used by:
 *   - app.ts (initial capture / SplitEditor Apply)
 *   - storage providers (device-store / google-drive-store) when re-encoding
 *     the flattened "render with annotations baked in" output.
 */
import { DEFAULT_ENCODE_OPTIONS, type EncodeOptions } from "@ingcreators/annot-core/encode";

const STORAGE_KEY = "annot-encode-options";

export function loadEncodeOptions(): EncodeOptions {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ENCODE_OPTIONS;
    const parsed = JSON.parse(raw);
    return {
      format: parsed.format === "png" || parsed.format === "jpeg" || parsed.format === "smart"
        ? parsed.format
        : DEFAULT_ENCODE_OPTIONS.format,
      smartFallback: parsed.smartFallback === "jpeg" ? "jpeg" : "png",
      smartColorThreshold: typeof parsed.smartColorThreshold === "number"
        ? parsed.smartColorThreshold
        : DEFAULT_ENCODE_OPTIONS.smartColorThreshold,
      jpegPercent: typeof parsed.jpegPercent === "number"
        ? parsed.jpegPercent
        : DEFAULT_ENCODE_OPTIONS.jpegPercent,
    };
  } catch {
    return DEFAULT_ENCODE_OPTIONS;
  }
}

export function saveEncodeOptions(options: EncodeOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch { /* ignore */ }
}
