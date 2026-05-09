import { builtinIcon } from "@ingcreators/annot-core";
import "./annot-icon.js";

/**
 * `<annot-file-details-drawer>` — right-side slide-in panel that
 * consolidates every piece of information about the currently-open
 * image in one place.
 *
 * The drawer is a thin host that:
 *
 *   1. Owns the chrome (backdrop + panel + close button + Esc handler).
 *   2. Composes built-in sections + plugin-registered sections (from
 *      `getPluginSections`), filters by `isBuiltinSectionDisabled`
 *      and per-section `visible(ctx)` predicates, and sorts by
 *      `priority`.
 *   3. Mounts each section into a section frame and tracks the
 *      lifecycle for teardown / `update(ctx)` dispatch.
 *
 * Lit Phase 1 — the class facade became this Lit element. The
 * public API is preserved as properties + methods on the element:
 *
 *   - `.data = …` triggers a full re-render (matches pre-Lit
 *     behaviour; sections opting into reactive lifecycle remount
 *     with fresh state).
 *   - `.setLastCommit(info)` likewise (visibility-affecting).
 *   - `.notifyUpdate()` — lightweight path: dispatches
 *     `update(ctx)` to reactive sections without re-rendering
 *     the DOM.
 *   - `.destroy()` alias for `.remove()` so pre-Lit callers
 *     don't move.
 *
 * Triggered from an info icon next to the filename in the editor
 * header. Mirrors the "Details" sidebar pattern familiar from
 * Google Drive / Dropbox / macOS Finder so users don't need to
 * learn a new affordance.
 */

import { createExternalLinksSection } from "./drawer-sections/external-links-section.js";
import { createFileSection } from "./drawer-sections/file-section.js";
import { createLastCommitSection } from "./drawer-sections/last-commit-section.js";
import { createTagsSection } from "./drawer-sections/tags-section.js";
import type { FileDetailsData, LastCommitInfo } from "./file-details-drawer-types.js";
import { html, LitElement } from "./lit.js";
import type { UISection, UISectionContext, UISectionLifecycle } from "./ui-section.js";

export type { FileDetailsData, LastCommitInfo } from "./file-details-drawer-types.js";
export {
  estimateDataUrlBytes,
  validateFilename,
} from "./file-details-drawer-types.js";

/** Built-in section ids exposed by the drawer. Used by
 *  `App.init({ disableBuiltinUISections })` to opt out of any
 *  given section without touching plugin code. Documented in
 *  `docs/plans/_done/plugin-ui-slots.md`. */
export const BUILTIN_DRAWER_SECTION_IDS = [
  "drawer.file",
  "drawer.tags",
  "drawer.last-commit",
  "drawer.external-links",
] as const;

const EMPTY_DATA: FileDetailsData = {
  filename: "",
  folderPath: "",
  width: 0,
  height: 0,
  fileSizeBytes: 0,
  tags: {},
};

interface MountedSection {
  section: UISection;
  /** Outer `<section>` element including heading. Removed during
   *  teardown so visibility transitions don't leak DOM. */
  sectionEl: HTMLElement;
  /** Body container the section's `mount` rendered into. */
  bodyEl: HTMLElement;
  /** The lifecycle returned from `mount`. */
  lifecycle: UISectionLifecycle;
  /** True when the lifecycle is the reactive object shape. */
  reactive: boolean;
}

export class AnnotFileDetailsDrawerElement extends LitElement {
  static override properties = {
    data: { attribute: false },
    isOpen: { state: true },
    getPluginSections: { attribute: false },
    isBuiltinSectionDisabled: { attribute: false },
    onRename: { attribute: false },
    onTagsChange: { attribute: false },
  };

  declare data: FileDetailsData;
  declare isOpen: boolean;
  /** Plugin-registered drawer sections. Combined with built-ins
   *  before sort + filter. Optional — desktop / embedded shells
   *  that don't load plugins can skip it. */
  declare getPluginSections: (() => UISection[]) | null;
  /** Built-in section ids the deployment opted out of via
   *  `App.init({ disableBuiltinUISections })`. Optional. */
  declare isBuiltinSectionDisabled: ((id: string) => boolean) | null;
  /**
   * Called when the user commits a filename change. The host is
   * expected to call storage.renameImage, then feed the final
   * (possibly uniquified) name back via `.data` so the drawer
   * reflects the truth. Reject the promise with an Error whose
   * message is shown to the user if the rename fails.
   */
  declare onRename: ((newFilename: string) => Promise<void>) | null;
  /** Called when the user edits tags inside the drawer. */
  declare onTagsChange: ((tags: Record<string, string>) => void) | null;

  #builtinSections: UISection[];
  #mounted: MountedSection[] = [];

  constructor() {
    super();
    this.data = EMPTY_DATA;
    this.isOpen = false;
    this.getPluginSections = null;
    this.isBuiltinSectionDisabled = null;
    this.onRename = null;
    this.onTagsChange = null;

    // Built-in sections: factories take getters so each section
    // reads the latest data on every render / update, not a
    // snapshot from constructor time.
    this.#builtinSections = [
      createFileSection({
        getData: () => this.data,
        onRename: (next) => this.onRename?.(next) ?? Promise.resolve(),
      }),
      createTagsSection({
        getData: () => this.data,
        onTagsChange: (t) => {
          this.data = { ...this.data, tags: t };
          this.onTagsChange?.(t);
        },
      }),
      createLastCommitSection({ getData: () => this.data }),
      createExternalLinksSection({ getData: () => this.data }),
    ];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("keydown", this.#onKeydown);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("keydown", this.#onKeydown);
    this.#disposeSections();
    super.disconnectedCallback();
  }

  override render() {
    const backdropClass = this.isOpen ? "file-details-backdrop open" : "file-details-backdrop";
    const panelClass = this.isOpen ? "file-details-drawer open" : "file-details-drawer";
    return html`
      <div class=${backdropClass} @click=${this.close}></div>
      <aside
        class=${panelClass}
        role="dialog"
        aria-label="File details"
        aria-hidden=${this.isOpen ? "false" : "true"}
      >
        <div class="file-details-header">
          <h2 class="file-details-title">Details</h2>
          <button type="button"
            class="file-details-close"
            data-tooltip="Close details (Esc)"
            aria-label="Close details panel"
            @click=${this.close}>
            <annot-icon .spec=${builtinIcon("close")}></annot-icon>
          </button>
        </div>
        <div class="file-details-sections"></div>
      </aside>
    `;
  }

  protected override updated(changed: Map<string, unknown>): void {
    // Section re-mount triggers on any data / deps / section-list
    // change. The reactive `notifyUpdate` path is a separate hot
    // channel for cases where only the section contents changed
    // and visibility didn't flip.
    const relevant =
      changed.has("data") ||
      changed.has("getPluginSections") ||
      changed.has("isBuiltinSectionDisabled");
    if (relevant) {
      this.#renderSections();
    }
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (e.key === "Escape") {
      // Don't steal Escape from text inputs (tag add flow)
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === "INPUT" || active.isContentEditable)) return;
      this.close();
    }
  };

  /** Section context handed to every `mount` / `update` call. The
   *  `path` / `mode` are placeholders for now — the drawer doesn't
   *  currently receive them; the editor session can pass them in
   *  via props in a follow-up if a plugin section needs them.
   *  Tags are the live `data.tags` snapshot. */
  #ctx(): UISectionContext {
    return {
      path: "",
      mode: "",
      tags: this.data.tags,
      setTitle: (newTitle) => {
        // Find the most-recently-mounted section that asked to
        // override its title. Plugins typically call this from
        // inside `mount`, so the freshest entry in `#mounted` is
        // theirs.
        const last = this.#mounted[this.#mounted.length - 1];
        if (!last) return;
        const heading = last.sectionEl.querySelector(".file-details-section-title");
        if (heading) heading.textContent = newTitle;
      },
    };
  }

  #composeSections(): UISection[] {
    const isDisabled = this.isBuiltinSectionDisabled ?? (() => false);
    const builtins = this.#builtinSections.filter((s) => !isDisabled(s.id));
    const plugins = this.getPluginSections?.() ?? [];
    const all = [...builtins, ...plugins];
    return all.sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
  }

  /** Tear down existing section mounts and rebuild from the
   *  current `#composeSections()`. Matches the pre-Lit full
   *  re-render behaviour on any visibility-affecting change. */
  #renderSections(): void {
    const host = this.querySelector(".file-details-sections") as HTMLElement | null;
    if (!host) return;
    this.#disposeSections();
    host.innerHTML = "";

    const ctx = this.#ctx();
    for (const section of this.#composeSections()) {
      if (section.visible && !section.visible(ctx)) continue;
      const sectionEl = document.createElement("section");
      sectionEl.className = "file-details-section";
      const heading = document.createElement("h3");
      heading.className = "file-details-section-title";
      heading.textContent = section.title;
      sectionEl.appendChild(heading);
      const body = document.createElement("div");
      body.className = "file-details-section-body";
      sectionEl.appendChild(body);
      host.appendChild(sectionEl);
      try {
        const lifecycle = section.mount(body, ctx);
        this.#mounted.push({
          section,
          sectionEl,
          bodyEl: body,
          lifecycle,
          reactive: typeof lifecycle === "object",
        });
      } catch (e) {
        console.error(`[drawer] section "${section.id}" mount threw:`, e);
        sectionEl.remove();
      }
    }
  }

  #disposeSections(): void {
    for (const state of this.#mounted) {
      try {
        if (typeof state.lifecycle === "function") state.lifecycle();
        else state.lifecycle.unmount();
      } catch (e) {
        console.error(`[drawer] section "${state.section.id}" unmount threw:`, e);
      }
    }
    this.#mounted = [];
  }

  /**
   * Patch in last-commit info after the drawer is already rendered.
   * The metadata lookup (GitHub commits API) is async and cheap to
   * race against the initial editor open, so the host fetches it
   * in the background and calls this when the result lands.
   */
  setLastCommit(info: LastCommitInfo | undefined): void {
    // Assign via `.data` so Lit's reactive property triggers the
    // normal updated() → section remount path.
    this.data = { ...this.data, lastCommit: info };
  }

  /** Replace the full data set. Equivalent to `.data = data` but
   *  preserves the pre-Lit method surface callers still use. */
  setData(data: FileDetailsData): void {
    this.data = data;
  }

  /**
   * Lightweight refresh: dispatch `update(ctx)` to every reactive
   * section without re-rendering the chrome. Use when only data
   * inside an existing section changed and visibility didn't flip
   * (e.g. tag changes pushed from outside, file size update).
   *
   * Sections that returned a teardown function rather than a
   * reactive object don't see the call.
   */
  notifyUpdate(): void {
    const ctx = this.#ctx();
    for (const state of this.#mounted) {
      if (state.reactive) {
        const lifecycle = state.lifecycle as { update?(c: UISectionContext): void };
        if (lifecycle.update) {
          try {
            lifecycle.update(ctx);
          } catch (e) {
            console.error(`[drawer] section "${state.section.id}" update threw:`, e);
          }
        }
      }
    }
  }

  open(): void {
    this.isOpen = true;
  }

  close(): void {
    this.isOpen = false;
  }

  toggle(): void {
    this.isOpen = !this.isOpen;
  }

  /** Pre-Lit API parity — callers can still `drawer.destroy()`
   *  to tear down. Equivalent to `.remove()`: the
   *  `disconnectedCallback` handles section teardown + keydown
   *  listener cleanup. */
  destroy(): void {
    this.remove();
  }
}

if (!customElements.get("annot-file-details-drawer")) {
  customElements.define("annot-file-details-drawer", AnnotFileDetailsDrawerElement);
}

declare global {
  interface HTMLElementTagNameMap {
    "annot-file-details-drawer": AnnotFileDetailsDrawerElement;
  }
}
