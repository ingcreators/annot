/**
 * Shared types + pure helpers for the file-details drawer + its
 * section modules. Split out of `annot-file-details-drawer.ts` as part of
 * Phase 2 of `docs/plans/_done/plugin-ui-slots.md` so the section files
 * (under `drawer-sections/`) can import the data shape without
 * pulling in the drawer host class — avoids the import cycle that
 * would otherwise form (drawer → sections → drawer).
 */

import type { IconSpec } from "@ingcreators/annot-core";

export interface FileDetailsData {
  filename: string;
  folderPath: string; // "" = root
  width: number;
  height: number;
  fileSizeBytes: number; // approximated from the dataUrl length
  createdAt?: string; // ISO; may be undefined for not-yet-persisted images
  updatedAt?: string; // ISO
  sourceUrl?: string; // captured page URL, if known
  tags: Record<string, string>;
  /**
   * Storage-level links (e.g. "View on GitHub"). Rendered in their
   * own section at the bottom of the drawer. Populated by the host
   * when the active storage exposes such links.
   */
  externalLinks?: Array<{ label: string; url: string; icon?: IconSpec }>;
  /**
   * Last-commit metadata for the current file. Populated
   * asynchronously by the host after the drawer is constructed —
   * the first render omits the section, and `setLastCommit()`
   * refreshes just that block when the info arrives. GitHub is the
   * only backend that exposes this today.
   */
  lastCommit?: LastCommitInfo;
}

export interface LastCommitInfo {
  /** `author.name` or fallback login. */
  authorName: string;
  /** `https://github.com/<login>.png` or equivalent; optional. */
  authorAvatarUrl?: string;
  /** First line of the commit message. */
  messageHeadline: string;
  /** ISO timestamp from the commit. */
  date: string;
  /** 7-char abbreviated SHA. */
  shortSha: string;
  /** `https://github.com/<owner>/<repo>/commit/<sha>`. */
  url?: string;
}

/**
 * Return null if the filename is acceptable, or a short human-readable
 * error string if not. Mirrors the checks the storage providers apply
 * (POSIX-unsafe chars, reserved names), so the user gets immediate
 * feedback without a round trip to the backend.
 *
 * Exported so the header inline-rename UI can share the same rules.
 */
export function validateFilename(name: string): string | null {
  if (!name) return "Name cannot be empty.";
  if (name === "." || name === "..") return "That name is reserved.";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — POSIX / Windows filename validation.
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) {
    return 'Name cannot contain  < > : " / \\ | ? *';
  }
  if (name.length > 200) return "Name is too long.";
  return null;
}

/** Approximate the byte size of a data URL payload (base64 → bytes). */
export function estimateDataUrlBytes(dataUrl: string): number {
  if (!dataUrl) return 0;
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return dataUrl.length;
  const body = dataUrl.substring(commaIdx + 1);
  // Base64 encodes 3 bytes into 4 chars. Padding "=" chars subtract
  // 1 byte each. Count trailing `=` with a tight reverse walk
  // rather than `body.match(/=+$/)` — the regex is linear per
  // attempt but `.match()` retries from each start position, which
  // CodeQL flags as polynomial on adversarial inputs that contain
  // many `=` runs not at the end (`js/polynomial-redos`).
  let padding = 0;
  for (let i = body.length - 1; i >= 0 && body.charCodeAt(i) === 61; i--) {
    padding++;
  }
  return Math.max(0, Math.floor(body.length * 0.75) - padding);
}
