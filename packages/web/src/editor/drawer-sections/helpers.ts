/**
 * Shared helpers used across drawer-section modules — extracted from
 * the previous monolithic `FileDetailsDrawer` so each section file
 * stays focused on its own DOM. Pure formatting / row-building
 * utilities; no drawer state.
 */

import { setTooltip } from "@ingcreators/annot-core/utils";

/** Build the standard "section frame" (heading + body container)
 *  that every drawer section renders into. The drawer host calls
 *  this so built-in and plugin sections share the same chrome. */
export function createDrawerSectionFrame(title: string): {
  section: HTMLElement;
  body: HTMLElement;
  heading: HTMLElement;
} {
  const section = document.createElement("section");
  section.className = "file-details-section";
  const heading = document.createElement("h3");
  heading.className = "file-details-section-title";
  heading.textContent = title;
  section.appendChild(heading);
  const body = document.createElement("div");
  body.className = "file-details-section-body";
  section.appendChild(body);
  return { section, body, heading };
}

export interface RowOptions {
  selectable?: boolean;
  mono?: boolean;
  link?: boolean;
}

/** Standard label / value row — a label on the left, a value on
 *  the right. `link: true` renders the value as a clickable
 *  external link when it looks like an http(s) URL. */
export function makeRow(label: string, value: string, opts: RowOptions = {}): HTMLElement {
  const row = document.createElement("div");
  row.className = "file-details-row";

  const lbl = document.createElement("span");
  lbl.className = "file-details-row-label";
  lbl.textContent = label;
  row.appendChild(lbl);

  let valEl: HTMLElement;
  if (opts.link && /^https?:\/\//i.test(value)) {
    const a = document.createElement("a");
    a.href = value;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = value;
    valEl = a;
  } else {
    valEl = document.createElement("span");
    valEl.textContent = value;
  }
  valEl.className = `file-details-row-value${opts.mono ? " mono" : ""}${opts.selectable ? " selectable" : ""}`;
  setTooltip(valEl, value);
  row.appendChild(valEl);

  return row;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
