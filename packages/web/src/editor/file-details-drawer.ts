/**
 * FileDetailsDrawer — right-side slide-in panel consolidating every piece
 * of information about the currently-open image in one place.
 *
 * Phase 2 of `docs/plans/plugin-ui-slots.md` migrated the previous
 * hardcoded section blocks (File / Tags / Last commit / Links) into
 * `UISection` modules under `./drawer-sections/`. The drawer is now
 * a thin host that:
 *
 *   1. Owns the chrome (backdrop + panel + close button + Esc handler).
 *   2. Composes built-in sections + plugin-registered sections (from
 *      `getPluginSections`), filters by `disableBuiltinUISections`
 *      and per-section `visible(ctx)` predicates, and sorts by
 *      `priority`.
 *   3. Mounts each section into a section frame and tracks the
 *      lifecycle for teardown / `update(ctx)` dispatch.
 *
 * Existing public API is preserved byte-for-byte:
 *   - `setData(data)` triggers a full re-render (matches today's
 *     behavior; sections that opt into reactive lifecycle will
 *     remount with fresh state).
 *   - `setLastCommit(info)` likewise (visibility-affecting).
 *   - `notifyUpdate()` is the new lightweight path: dispatches
 *     `update(ctx)` to reactive sections without re-rendering DOM.
 *     Phase 2 doesn't call it from inside the drawer; future
 *     callers (rename / save observers, plugins) can use it.
 *
 * Triggered from an info icon next to the filename in the editor
 * header. Mirrors the "Details" sidebar pattern familiar from
 * Google Drive / Dropbox / macOS Finder so users don't need to
 * learn a new affordance.
 */

import { setTooltip } from "@ingcreators/annot-core/utils";
import type { UISection, UISectionContext, UISectionLifecycle } from "../app/plugin-host.js";
import { createDrawerSectionFrame } from "./drawer-sections/helpers.js";
import { createExternalLinksSection } from "./drawer-sections/external-links-section.js";
import { createFileSection } from "./drawer-sections/file-section.js";
import { createLastCommitSection } from "./drawer-sections/last-commit-section.js";
import { createTagsSection } from "./drawer-sections/tags-section.js";
import type { FileDetailsData, LastCommitInfo } from "./file-details-drawer-types.js";

export type { FileDetailsData, LastCommitInfo } from "./file-details-drawer-types.js";
export {
  validateFilename,
  estimateDataUrlBytes,
} from "./file-details-drawer-types.js";

/** Built-in section ids exposed by the drawer. Used by
 *  `App.init({ disableBuiltinUISections })` to opt out of any
 *  given section without touching plugin code. Documented in
 *  `docs/plans/plugin-ui-slots.md`. */
export const BUILTIN_DRAWER_SECTION_IDS = [
  "drawer.file",
  "drawer.tags",
  "drawer.last-commit",
  "drawer.external-links",
] as const;

export interface FileDetailsDrawerDeps {
  /** Plugin-registered drawer sections. Combined with built-ins
   *  before sort + filter. Optional — desktop / embedded shells
   *  that don't load plugins can skip it. */
  getPluginSections?(): UISection[];
  /** Built-in section ids the deployment opted out of via
   *  `App.init({ disableBuiltinUISections })`. Optional. */
  isBuiltinSectionDisabled?(id: string): boolean;
}

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

export class FileDetailsDrawer {
  #panel: HTMLElement;
  #backdrop: HTMLElement;
  #data: FileDetailsData;
  #isOpen = false;
  #deps: FileDetailsDrawerDeps;
  #builtinSections: UISection[];
  #mounted: MountedSection[] = [];

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

  constructor(container: HTMLElement, data: FileDetailsData, deps: FileDetailsDrawerDeps = {}) {
    this.#data = data;
    this.#deps = deps;

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

    // Built-in sections: factories take a `getData` getter so each
    // section reads the latest `#data` on every render / update,
    // not a snapshot from constructor time.
    this.#builtinSections = [
      createFileSection({
        getData: () => this.#data,
        onRename: (next) => this.onRename?.(next) ?? Promise.resolve(),
      }),
      createTagsSection({
        getData: () => this.#data,
        onTagsChange: (t) => {
          this.#data = { ...this.#data, tags: t };
          this.onTagsChange?.(t);
        },
      }),
      createLastCommitSection({ getData: () => this.#data }),
      createExternalLinksSection({ getData: () => this.#data }),
    ];

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

  /** Section context handed to every `mount` / `update` call. The
   *  `path` / `mode` are placeholders for now — the drawer doesn't
   *  currently receive them; the editor session can pass them in
   *  via deps in a follow-up if a plugin section needs them. Tags
   *  are the live `#data.tags` snapshot. */
  #ctx(): UISectionContext {
    return {
      path: "",
      mode: "",
      tags: this.#data.tags,
      setTitle: (newTitle) => {
        // Find the most-recently-mounted section that asked to
        // override its title. Plugins typically call this from
        // inside `mount` (as the host-supplied DOM is being set
        // up), so the freshest entry in `#mounted` is theirs.
        const last = this.#mounted[this.#mounted.length - 1];
        if (!last) return;
        const heading = last.sectionEl.querySelector(".file-details-section-title");
        if (heading) heading.textContent = newTitle;
      },
    };
  }

  #composeSections(): UISection[] {
    const isDisabled = this.#deps.isBuiltinSectionDisabled ?? (() => false);
    const builtins = this.#builtinSections.filter((s) => !isDisabled(s.id));
    const plugins = this.#deps.getPluginSections?.() ?? [];
    const all = [...builtins, ...plugins];
    return all.sort((a, b) => {
      const ap = Number.isFinite(a.priority) ? a.priority : Number.POSITIVE_INFINITY;
      const bp = Number.isFinite(b.priority) ? b.priority : Number.POSITIVE_INFINITY;
      return ap - bp;
    });
  }

  #render(): void {
    this.#disposeSections();
    this.#panel.innerHTML = "";

    // ----- Header chrome (stays out of the section system) -----
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

    // ----- Sections (built-in + plugin, sorted by priority) -----
    const ctx = this.#ctx();
    for (const section of this.#composeSections()) {
      if (section.visible && !section.visible(ctx)) continue;
      const { section: sectionEl, body } = createDrawerSectionFrame(section.title);
      this.#panel.appendChild(sectionEl);
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
    this.#data = { ...this.#data, lastCommit: info };
    // Visibility-affecting (the section renders only when commit
    // info is present), so do a full re-render rather than a
    // notifyUpdate-only path.
    this.#render();
  }

  /** Replace the full data set and re-render. */
  setData(data: FileDetailsData): void {
    this.#data = data;
    this.#render();
  }

  /**
   * Lightweight refresh: dispatch `update(ctx)` to every reactive
   * section without re-rendering the DOM. Use when only data
   * inside an existing section changed and visibility didn't
   * flip (e.g. tag changes pushed from outside, file size update).
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
    this.#disposeSections();
    document.removeEventListener("keydown", this.#onKeydown);
    this.#panel.remove();
    this.#backdrop.remove();
  }
}
