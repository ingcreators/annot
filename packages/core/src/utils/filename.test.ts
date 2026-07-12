import { describe, expect, it } from "vitest";
import {
  ANNOT_FILENAME_PREFIX,
  defaultAnnotFilenameStem,
  defaultAnnotImageFilename,
  formatLocalTimestamp,
  normalizeAnnotImageFilename,
} from "./filename.js";

describe("formatLocalTimestamp", () => {
  it("zero-pads every field, including 3-digit milliseconds", () => {
    // Local-time constructor — works on every dev's machine because
    // we read the same fields back through `getFullYear()` etc.
    const d = new Date(2026, 0, 5, 3, 4, 9, 7); // 2026-01-05 03:04:09.007 local
    expect(formatLocalTimestamp(d)).toBe("20260105-030409-007");
  });

  it("preserves chronological order under lexicographic compare", () => {
    const earlier = formatLocalTimestamp(new Date(2026, 4, 1, 9, 0, 0, 0));
    const later = formatLocalTimestamp(new Date(2026, 4, 1, 9, 0, 0, 1));
    expect(later > earlier).toBe(true);
  });
});

describe("defaultAnnotFilenameStem", () => {
  it("prefixes the timestamp with the canonical brand token", () => {
    const d = new Date(2026, 3, 28, 14, 30, 22, 123);
    expect(defaultAnnotFilenameStem(d)).toBe(`${ANNOT_FILENAME_PREFIX}-20260428-143022-123`);
  });
});

describe("defaultAnnotImageFilename", () => {
  const d = new Date(2026, 3, 28, 14, 30, 22, 123);

  it("emits .annot.png for a PNG data URL", () => {
    expect(defaultAnnotImageFilename("data:image/png;base64,AAAA", d)).toBe(
      "annot-20260428-143022-123.annot.png",
    );
  });

  it("emits .annot.jpg for a JPEG data URL", () => {
    expect(defaultAnnotImageFilename("data:image/jpeg;base64,AAAA", d)).toBe(
      "annot-20260428-143022-123.annot.jpg",
    );
  });

  it("falls back to .annot.png for unknown data URLs", () => {
    // Defensive: anything that isn't `data:image/jpeg` is treated as
    // PNG (lossless fallback). Matches DeviceStore / GitHubStore /
    // GoogleDriveStore's prior detection logic.
    expect(defaultAnnotImageFilename("data:image/webp;base64,AAAA", d)).toBe(
      "annot-20260428-143022-123.annot.png",
    );
  });
});

describe("normalizeAnnotImageFilename", () => {
  it("inserts the .annot. infix before a plain raster extension", () => {
    expect(normalizeAnnotImageFilename("uploaded.png")).toBe("uploaded.annot.png");
    expect(normalizeAnnotImageFilename("photo.jpg")).toBe("photo.annot.jpg");
    expect(normalizeAnnotImageFilename("photo.jpeg")).toBe("photo.annot.jpeg");
    expect(normalizeAnnotImageFilename("diagram.svg")).toBe("diagram.annot.svg");
  });

  it("passes already-normalized names through unchanged", () => {
    expect(normalizeAnnotImageFilename("shot.annot.png")).toBe("shot.annot.png");
    expect(normalizeAnnotImageFilename("shot.annot.jpg")).toBe("shot.annot.jpg");
  });

  it("lowercases the extension while normalizing", () => {
    expect(normalizeAnnotImageFilename("Screen.PNG")).toBe("Screen.annot.png");
  });

  it("appends .annot.png when no recognizable extension exists", () => {
    expect(normalizeAnnotImageFilename("mystery")).toBe("mystery.annot.png");
  });

  it("keeps dot-bearing stems intact", () => {
    expect(normalizeAnnotImageFilename("v1.2-final.png")).toBe("v1.2-final.annot.png");
  });
});
