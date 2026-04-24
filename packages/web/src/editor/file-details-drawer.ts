import { setTooltip } from "@ingcreators/annot-core/utils";
/**
 * FileDetailsDrawer — right-side slide-in panel consolidating every piece
 * of information about the currently-open image in one place.
 *
 * Answers "what is this image, and what do I know about it?" with:
 *   - File section: name, location, dimensions, size, timestamps, source URL
 *   - Tags section: full list of host/fragment/session/custom tags,
 *     editable via an embedded TagEditor
 *
 * Triggered from an info icon next to the filename in the editor header.
 * Mirrors the "Details" sidebar pattern familiar from Google Drive /
 * Dropbox / macOS Finder so users don't need to learn a new affordance.
 */
import { TagEditor } from "./tag-editor.js";

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
   * when the active storage exposes such links (currently only
   * `GitHubStore.getViewUrl(path)`).
   */
  externalLinks?: Array<{ label: string; url: string; icon?: string }>;
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

export class FileDetailsDrawer {
  #panel: HTMLElement;
  #backdrop: HTMLElement;
  #tagEditor: TagEditor | null = null;
  #data: FileDetailsData;
  #isOpen = false;
  /** Called when the user edits tags inside the drawer. */
  onTagsChange?: (tags: Record<string, string>) => void;
  /**
   * Called when the user commits a filename change. The host is
   * expected to call storage.renameImage, then feed the final
   * (possibly uniquified) name back via setData() so the drawer
   * reflects the truth. Reject the promise with an Error whose
   * message is shown to the user if the rename fails.
   */
  onRename?: (newFilename: string) => Promise<void>;

  constructor(container: HTMLElement, data: FileDetailsData) {
    this.#data = data;

    // Subtle backdrop — this is a COMPANION panel, not a modal, so it
    // shouldn't dim the canvas heavily. It mainly provides a click-to-close
    // affordance outside the drawer.
    this.#backdrop = document.createElement("div");
    this.#backdrop.className = "file-details-backdrop";
    this.#backdrop.addEventListener("click", () => this.close());

    this.#panel = document.createElement("aside");
    this.#panel.className = "file-details-drawer";
    this.#panel.setAttribute("role", "dialog");
    this.#panel.setAttribute("aria-label", "File details");
    this.#panel.setAttribute("aria-hidden", "true");

    container.appendChild(this.#backdrop);
    container.appendChild(this.#panel);

    this.#render();

    // Close on Escape when the drawer is focused / open
    document.addEventListener("keydown", this.#onKeydown);
  }

  #onKeydown = (e: KeyboardEvent) => {
    if (!this.#isOpen) return;
    if (e.key === "Escape") {
      // Don't steal escape from text inputs (tag add flow)
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.isContentEditable)) return;
      this.close();
    }
  };

  #render(): void {
    this.#panel.innerHTML = "";

    // ----- Header -----
    const header = document.createElement("div");
    header.className = "file-details-header";

    const title = document.createElement("h2");
    title.className = "file-details-title";
    title.textContent = "Details";
    header.appendChild(title);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "file-details-close material-symbols-outlined";
    closeBtn.textContent = "close";
    setTooltip(closeBtn, "Close details (Esc)");
    closeBtn.setAttribute("aria-label", "Close details panel");
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);

    this.#panel.appendChild(header);

    // ----- File section -----
    const fileSection = this.#createSection("File");
    fileSection.appendChild(this.#makeNameRow());
    fileSection.appendChild(
      this.#makeRow("Location", this.#data.folderPath || "(root)", {
        selectable: true,
        mono: true,
      }),
    );
    fileSection.appendChild(
      this.#makeRow("Dimensions", `${this.#data.width} × ${this.#data.height} px`),
    );
    fileSection.appendChild(this.#makeRow("File size", formatBytes(this.#data.fileSizeBytes)));
    if (this.#data.createdAt) {
      fileSection.appendChild(this.#makeRow("Created", formatDate(this.#data.createdAt)));
    }
    if (this.#data.updatedAt) {
      fileSection.appendChild(this.#makeRow("Modified", formatDate(this.#data.updatedAt)));
    }
    if (this.#data.sourceUrl) {
      fileSection.appendChild(
        this.#makeRow("Source", this.#data.sourceUrl, { selectable: true, mono: true, link: true }),
      );
    }
    this.#panel.appendChild(fileSection);

    // ----- Tags section -----
    const tagsSection = this.#createSection("Tags");
    const tagsContent = document.createElement("div");
    tagsContent.className = "file-details-tags-editor";
    tagsSection.appendChild(tagsContent);
    this.#panel.appendChild(tagsSection);

    this.#tagEditor = new TagEditor(tagsContent);
    this.#tagEditor.setTags(this.#data.tags);
    this.#tagEditor.onTagsChange = (t) => {
      this.#data.tags = t;
      this.onTagsChange?.(t);
    };

    // ----- Last commit section (backend-provided, currently GitHub) -----
    if (this.#data.lastCommit) {
      this.#panel.appendChild(this.#renderLastCommitSection(this.#data.lastCommit));
    }

    // ----- External links section (e.g. "View on GitHub") -----
    if (this.#data.externalLinks && this.#data.externalLinks.length > 0) {
      this.#panel.appendChild(this.#renderLinksSection(this.#data.externalLinks));
    }
  }

  #renderLastCommitSection(commit: LastCommitInfo): HTMLElement {
    const section = this.#createSection("Last commit");

    // Author row: avatar + name side by side when we have the avatar.
    const authorRow = document.createElement("div");
    authorRow.className = "file-details-row";
    const authorLbl = document.createElement("span");
    authorLbl.className = "file-details-row-label";
    authorLbl.textContent = "Author";
    authorRow.appendChild(authorLbl);
    const authorVal = document.createElement("span");
    authorVal.className = "file-details-row-value selectable";
    if (commit.authorAvatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "file-details-avatar";
      avatar.src = commit.authorAvatarUrl;
      avatar.alt = "";
      avatar.width = 16;
      avatar.height = 16;
      authorVal.appendChild(avatar);
    }
    const authorText = document.createTextNode(commit.authorName);
    authorVal.appendChild(authorText);
    authorRow.appendChild(authorVal);
    section.appendChild(authorRow);

    section.appendChild(this.#makeRow("Date", formatDate(commit.date)));

    // Message: clickable link to the commit when we have a URL,
    // plain text otherwise. Short SHA shown in monospace alongside.
    const msgRow = document.createElement("div");
    msgRow.className = "file-details-row";
    const msgLbl = document.createElement("span");
    msgLbl.className = "file-details-row-label";
    msgLbl.textContent = "Message";
    msgRow.appendChild(msgLbl);
    const msgWrap = document.createElement("span");
    msgWrap.className = "file-details-row-value selectable";
    if (commit.url) {
      const a = document.createElement("a");
      a.href = commit.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = commit.messageHeadline;
      msgWrap.appendChild(a);
    } else {
      msgWrap.appendChild(document.createTextNode(commit.messageHeadline));
    }
    msgWrap.appendChild(document.createTextNode(" "));
    const sha = document.createElement("code");
    sha.className = "file-details-sha";
    sha.textContent = commit.shortSha;
    msgWrap.appendChild(sha);
    setTooltip(msgWrap, commit.messageHeadline);
    msgRow.appendChild(msgWrap);
    section.appendChild(msgRow);

    return section;
  }

  #renderLinksSection(links: Array<{ label: string; url: string; icon?: string }>): HTMLElement {
    const section = this.#createSection("Links");
    for (const link of links) {
      const row = document.createElement("div");
      row.className = "file-details-row file-details-link-row";
      const a = document.createElement("a");
      a.href = link.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "file-details-external-link";
      if (link.icon) {
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined";
        icon.textContent = link.icon;
        icon.setAttribute("aria-hidden", "true");
        a.appendChild(icon);
      }
      a.appendChild(document.createTextNode(link.label));
      setTooltip(a, link.url);
      row.appendChild(a);
      section.appendChild(row);
    }
    return section;
  }

  /**
   * Patch in last-commit info after the drawer is already rendered.
   * The metadata lookup (GitHub commits API) is async and cheap to
   * race against the initial editor open, so the host fetches it
   * in the background and calls this when the result lands.
   */
  setLastCommit(info: LastCommitInfo | undefined): void {
    this.#data = { ...this.#data, lastCommit: info };
    this.#render();
  }

  #createSection(title: string): HTMLElement {
    const section = document.createElement("section");
    section.className = "file-details-section";
    const heading = document.createElement("h3");
    heading.className = "file-details-section-title";
    heading.textContent = title;
    section.appendChild(heading);
    return section;
  }

  /**
   * The Name row is special: it's inline-editable. The rest of the row
   * behaves like any other read-only metadata display until the user
   * focuses the value, at which point the span becomes a text input.
   *
   * Commit rules:
   *   - Enter or blur → commit (calls onRename)
   *   - Escape       → cancel (restores original)
   *   - Empty / unchanged name → silently cancel
   *   - Invalid chars (/\:*?"<>|) → stay in editing mode, show inline error
   *
   * Extension is preserved across edits but NOT protected from the
   * user — advanced users can change extensions if they really want,
   * which matches Finder / Explorer behavior.
   */
  #makeNameRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "file-details-row";

    const lbl = document.createElement("span");
    lbl.className = "file-details-row-label";
    lbl.textContent = "Name";
    row.appendChild(lbl);

    const wrap = document.createElement("div");
    wrap.className = "file-details-name-wrap";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "file-details-name-input";
    input.value = this.#data.filename;
    input.spellcheck = false;
    input.autocomplete = "off";
    setTooltip(input, "Click to rename. Enter to save, Esc to cancel.");
    input.setAttribute("aria-label", "File name, editable");

    const errorEl = document.createElement("div");
    errorEl.className = "file-details-name-error";
    errorEl.setAttribute("aria-live", "polite");

    // Select only the base name (before the last dot) when the user
    // focuses — matches Finder / Explorer "rename" behavior so users
    // don't accidentally wipe the extension.
    input.addEventListener("focus", () => {
      const dot = input.value.lastIndexOf(".");
      if (dot > 0) {
        // defer so browser's default all-select is overridden
        setTimeout(() => input.setSelectionRange(0, dot), 0);
      }
    });

    const commit = async () => {
      const next = input.value.trim();
      if (!next || next === this.#data.filename) {
        input.value = this.#data.filename; // restore
        errorEl.textContent = "";
        return;
      }
      const err = validateFilename(next);
      if (err) {
        errorEl.textContent = err;
        input.focus();
        return;
      }
      try {
        input.disabled = true;
        errorEl.textContent = "";
        await this.onRename?.(next);
        // setData() from the host will refresh input.value with the
        // final (possibly uniquified) name.
      } catch (e: any) {
        errorEl.textContent = e?.message || "Rename failed";
        input.value = this.#data.filename; // restore
      } finally {
        input.disabled = false;
      }
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur(); // triggers commit via blur listener
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = this.#data.filename; // cancel
        errorEl.textContent = "";
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      commit();
    });

    wrap.appendChild(input);
    wrap.appendChild(errorEl);
    row.appendChild(wrap);

    return row;
  }

  #makeRow(
    label: string,
    value: string,
    opts: { selectable?: boolean; mono?: boolean; link?: boolean } = {},
  ): HTMLElement {
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

  /** Replace the full data set and re-render. */
  setData(data: FileDetailsData): void {
    this.#data = data;
    this.#render();
  }

  open(): void {
    this.#isOpen = true;
    this.#panel.classList.add("open");
    this.#backdrop.classList.add("open");
    this.#panel.setAttribute("aria-hidden", "false");
  }

  close(): void {
    this.#isOpen = false;
    this.#panel.classList.remove("open");
    this.#backdrop.classList.remove("open");
    this.#panel.setAttribute("aria-hidden", "true");
  }

  toggle(): void {
    if (this.#isOpen) this.close();
    else this.open();
  }

  destroy(): void {
    document.removeEventListener("keydown", this.#onKeydown);
    this.#panel.remove();
    this.#backdrop.remove();
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
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
  // Base64 encodes 3 bytes into 4 chars. Padding "=" chars subtract 1 byte each.
  const paddingMatch = body.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  return Math.max(0, Math.floor(body.length * 0.75) - padding);
}
