// Pull in the `__anno_*` window-global declarations so the four
// host-bridge reads below typecheck without `(window as any)` casts.
// The `<reference>` directive is needed because downstream packages
// that compile this file (e.g. `@ingcreators/annot-desktop` via the
// `Toolbar` import) don't see web's `.d.ts` files through their own
// tsconfig `include` glob — only files explicitly referenced by the
// compiled module are picked up.
/// <reference path="../types/anno-window.d.ts" />

/**
 * `Toolbar` — the editor's vertical tool rail (Select / Crop /
 * Shape / Arrow / Text / Highlight / Redact / Marker / Draw)
 * plus its tool-properties side-panel renderer.
 *
 * Lit Phase 5a — relocated from `@ingcreators/annot-core` to
 * `@ingcreators/annot-web`. Pre-Lit, this 3,500-line module
 * was the only browser-only surface still living in core; the
 * relocation hardens core's DOM-free guarantee so the headless
 * entry point doesn't need a build-time exclusion.
 *
 * Phase 5a is mechanical — no behaviour changes. Phases 5b
 * (Lit shell + tool buttons) and 5c (Lit variant flyouts +
 * property dropdowns) follow in their own PRs.
 */

// Lit Phase 5b — outer shell + per-tool button primitives.
// Phase 5c adds the variant / color flyouts (`<annot-tool-flyout>`)
// + the save dropdown (`<annot-save-menu>`); badge state machine
// stays imperative because it co-evolves with the per-tool preset
// state (toolbar-internal concern, no public surface to slot into
// declaratively).
import type { ChipSelectDetail } from "./annot-tool-flyout.js";
import "./annot-save-menu.js";
import "./annot-tool-flyout.js";
import "./annot-toolbar.js";

// Cross-package imports use the published `@ingcreators/annot-core`
// surface where available; deep subpaths (`./editor/*`,
// `./editor/tools/*`) reach the bits that aren't re-exported via
// the top-level barrel.
import {
  highlightColorLabel,
  presetFromWire,
  presetToWire,
  readUniversalStyleAttrs,
  TOOL_REGISTRY,
} from "@ingcreators/annot-core/editor";
import type { ToolOptions } from "@ingcreators/annot-core/editor/tool-options";
import {
  type CanvasManager,
  copyAsImage,
  createThemeToggle,
  getPngDataUrl,
  type History,
  openAnchoredPopover,
  saveToFile,
  type SelectionManager,
  type ToolBase,
} from "@ingcreators/annot-editor";
import {
  DEFAULT_FILL_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_STROKE_COLOR,
  DEFAULT_STROKE_WIDTH,
} from "@ingcreators/annot-core/utils";
import {
  type AnnotationShape,
  copyAsOffice,
  isTauri,
  loadToolPresets,
  saveToolPresets,
  type ToolPreset,
} from "@ingcreators/annot-core/tauri-bridge";
import { setTooltip } from "@ingcreators/annot-editor/tooltip";
import type { AnnotToolbarButtonElement, AnnotToolbarElement } from "./annot-toolbar.js";
import { populateToolPropertyPanel } from "./tool-property-renderer.js";
import { openCanvasRightClickMenu } from "./toolbar-canvas-menu.js";
import {
  applyPresetStyleAttrs,
  elementKeyFromElement,
  mergePresetForVariantChange,
  migrateLegacyPresetKey,
  seedPresetFromElement,
} from "./toolbar-preset-helpers.js";
import { openToolbarSaveMenu } from "./toolbar-save-menu.js";
import {
  TOOL_FACTORIES,
  type ToolDef,
  type ToolFactoryDeps,
  toolIdForElement,
} from "./tool-factories.js";

// Minimal ambient declaration for the Chrome extension API surface
// referenced at runtime below (all call sites are gated by
// `typeof chrome !== "undefined"`). Declared in this file so downstream
// packages that typecheck through bundler resolution pick it up too.
declare namespace chrome {
  namespace storage {
    interface StorageArea {
      get(keys: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    }
    const local: StorageArea;
  }
}

// Tool metadata (label / icon / variants / preset fields / element
// classifier / style extractor) lives in
// `@ingcreators/annot-core`'s `TOOL_REGISTRY`. The Tier C bridge
// (`ToolDef`, `TOOL_FACTORIES`, `toolIdForElement`) lives in
// `./tool-factories.ts`. Phases 1–5 of
// `docs/plans/_done/toolbar-schema.md` migrated everything off the
// old `toolbar-variants.ts` (now deleted).

// `openAnchoredPopover` lives in `@ingcreators/annot-core` (see
// `packages/core/src/editor/anchored-popover.ts`). It's imported
// at the top of this file alongside the other shared editor
// helpers; this comment marks the spot where the inline
// definition used to live before Phase 5a.

/**
 * Constructor-time switches for hosts that provide some of the toolbar's
 * chrome themselves. Defaults keep backwards-compatible behavior so
 * existing callers (e.g. the desktop app) don't need changes.
 */
export interface ToolbarOptions {
  /** Append the built-in theme toggle. Default true. Set false when the
   *  host provides its own toggle elsewhere (e.g. the web app's editor
   *  header) to avoid duplicate controls. */
  showThemeToggle?: boolean;
  /** Append the "Gallery" button (web-only). Default true. Set false when
   *  the host provides navigation via a breadcrumb or other affordance. */
  showGalleryButton?: boolean;
  /** Append the Open / Copy / Save group. Default true. Set false when
   *  the host renders these actions in a document-level chrome area
   *  (e.g. the editor header) so they aren't duplicated here. */
  showSaveGroup?: boolean;
  /** Layout direction. Default "horizontal" (single top bar). Set to
   *  "vertical" to render as a left-side tool strip — tools stack
   *  vertically, separators become horizontal rules, the spacer grows
   *  vertically so trailing items (history) anchor to the bottom. */
  orientation?: "horizontal" | "vertical";
  /** Suppress the per-tool ▼ dropdown arrows. Default false. Set true
   *  when the host renders tool properties elsewhere (e.g. a persistent
   *  right panel) so the sidebar doesn't duplicate affordances. */
  hideToolDropdowns?: boolean;
  /** Optional callback that returns the filename of the image the
   *  editor is currently working on (e.g. `"foo.png"`, `"bar.annot.jpg"`).
   *  Passed to `saveToFile` / `saveAsEditableImage` / `downloadAsImage`
   *  so direct downloads reuse the open file's base name instead of
   *  generating a fresh `annot-<timestamp>.annot.<ext>`. Return
   *  `undefined` (or omit the option) for fresh captures that haven't
   *  been saved yet — the export functions fall back to the timestamp
   *  default in that case. */
  getCurrentFilename?: () => string | undefined;
}

// computeDasharray imported from shared/dash-utils

export class Toolbar {
  #container: HTMLElement;
  #canvas: CanvasManager;
  #history: History;
  #selection: SelectionManager;
  #options: ToolOptions;
  /** Preset map. Keys are ELEMENT KEYS (e.g. "shape.rect",
   *  "shape.rounded", "arrow.end"), NOT raw tool IDs. Each element
   *  variant gets its own defaults so a user can (say) set red for
   *  rectangles and blue for ellipses without the two overwriting
   *  each other via rubber-band propagation.
   *
   *  Tools WITHOUT variants (crop, highlight) use the bare tool ID as
   *  the element key. Legacy preset files that stored presets keyed
   *  by tool ID are migrated on load by promoting each entry to the
   *  tool's DEFAULT variant key (see `#loadPresetsFromFile`). */
  #presets: Map<string, ToolOptions> = new Map();
  /** Which variant was last active per tool. Used to decide which
   *  variant's preset to load when the tool is re-selected from the
   *  toolbar. Persisted alongside presets so the user's "last used
   *  Shape" (rect vs rounded vs ellipse) survives across sessions. */
  #lastVariantByTool: Map<string, string> = new Map();
  #activeBtn: HTMLButtonElement | null = null;
  #selectBtn: HTMLButtonElement | null = null;
  #tools: Map<string, ToolDef> = new Map();
  /** Per-tool main button refs so we can swap their icon when the user
   *  picks a variant from the flyout (sticky-tool UX — parent button
   *  reflects the last-used variant). */
  #toolButtons: Map<string, HTMLButtonElement> = new Map();
  /** Host-registered extra buttons inserted between the tool group and
   *  the undo/redo group. Populated via `registerExtraToolButton`. */
  #extraButtons: HTMLButtonElement[] = [];
  /** The DOM group that the extra buttons live in, so registrations
   *  after initial render still attach to the right container. */
  #extraButtonGroup: HTMLElement | null = null;
  /** Invoked whenever the active tool changes. `toolId` is the registered
   *  tool id (e.g. "rect", "arrow") or null for Select / deactivation. */
  #onToolChange?: (name: string, toolId: string | null) => void;
  #showThemeToggle: boolean;
  #showGalleryButton: boolean;
  #showSaveGroup: boolean;
  #orientation: "horizontal" | "vertical";
  #hideToolDropdowns: boolean;
  #getCurrentFilename?: () => string | undefined;

  constructor(
    container: HTMLElement,
    canvas: CanvasManager,
    history: History,
    selection: SelectionManager,
    onToolChange?: (name: string, toolId: string | null) => void,
    options: ToolbarOptions = {},
  ) {
    this.#container = container;
    this.#canvas = canvas;
    this.#history = history;
    this.#selection = selection;
    this.#onToolChange = onToolChange;
    this.#showThemeToggle = options.showThemeToggle ?? true;
    this.#showGalleryButton = options.showGalleryButton ?? true;
    this.#showSaveGroup = options.showSaveGroup ?? true;
    this.#orientation = options.orientation ?? "horizontal";
    this.#hideToolDropdowns = options.hideToolDropdowns ?? false;
    this.#getCurrentFilename = options.getCurrentFilename;

    this.#options = {
      strokeColor: DEFAULT_STROKE_COLOR,
      fillColor: DEFAULT_FILL_COLOR,
      strokeWidth: DEFAULT_STROKE_WIDTH,
      fontSize: DEFAULT_FONT_SIZE,
      strokeDasharray: "",
      fillOpacity: 1.0,
    };

    this.#registerTools();

    // Seed the Highlight tool preset with the default yellow color +
    // 40% fill opacity + no stroke. Keyed by `highlight.<color>` so
    // it matches the per-color preset scheme — Highlight's variant
    // IS its fill hex (`TOOL_REGISTRY.highlight.defaultVariant`
    // resolves to the first palette entry). Without this, the first
    // click on the Highlight button would pick up the global
    // fillColor (the user's last Rect fill) and look like a normal
    // filled rect, not a highlighter.
    const defaultHighlightColor = TOOL_REGISTRY.highlight!.defaultVariant!;
    this.#presets.set(`highlight.${defaultHighlightColor}`, {
      ...this.#options,
      shapeType: "highlight",
      highlightColor: defaultHighlightColor,
      fillOpacity: 0.4,
      strokeColor: "none",
      strokeWidth: 0,
    });

    this.#render();

    // Load presets — backend depends on the runtime:
    //   Tauri desktop  → YAML file in app data dir
    //   Browser ext    → chrome.storage.local
    //   Plain web / PWA → localStorage (fallback so dev & deployed
    //                     Web still remember per-variant defaults)
    if (isTauri) {
      this.#loadPresetsFromFile();
    } else if (chrome?.storage?.local) {
      this.#loadPresetsFromStorage();
    } else if (typeof localStorage !== "undefined") {
      this.#loadPresetsFromLocalStorage();
    }

    // Right-click on the canvas → "Insert here" menu. Lets users drop
    // a shape of their choice at the exact click point without first
    // having to switch tools in the toolbar. The menu is populated
    // from the same tool/variant registry that builds the toolbar, so
    // adding a new tool automatically makes it appear here too.
    this.#canvas.onContextMenu = (e, pt) => {
      this.#openInsertHereMenu(e, pt);
    };
  }

  #registerTools(): void {
    // Phase 3 of `docs/plans/toolbar-schema.md`. Loops over every
    // entry in core's `TOOL_REGISTRY` and pairs the metadata
    // (`label` / `icon`) with the matching Tier C factory in
    // `TOOL_FACTORIES`. Adding a new tool is one entry in each —
    // the toolbar registration code never changes.
    const deps: ToolFactoryDeps = {
      canvas: this.#canvas,
      history: this.#history,
      selection: this.#selection,
    };
    for (const id of Object.keys(TOOL_REGISTRY)) {
      const meta = TOOL_REGISTRY[id]!;
      const factory = TOOL_FACTORIES[id];
      if (!factory) continue; // metadata-only registry entries (none today)
      this.#tools.set(id, {
        label: meta.label,
        icon: meta.icon,
        factory: (opts) => factory(opts, deps),
      });
    }
  }

  /** Reference to the `<annot-toolbar>` host that wraps the
   *  buttons. Created in `#render` and reused by code paths that
   *  previously talked to `#container` directly (extras
   *  registration, save-menu anchor lookup). */
  #shellEl: AnnotToolbarElement | null = null;

  /** Build a `<annot-toolbar-button>` Lit element + return it.
   *  The inner `<button class="toolbar-btn">` is queryable via
   *  `el.getButton()` so the existing imperative wiring (click
   *  handlers, `data-tool`, variant badges) continues unchanged
   *  against the inner button. */
  #toolButton(icon: string, title: string, dataTool = ""): AnnotToolbarButtonElement {
    const el = document.createElement("annot-toolbar-button");
    el.icon = icon;
    el.tooltip = title;
    el.dataTool = dataTool;
    return el;
  }

  #render(): void {
    this.#container.innerHTML = "";
    // Tag the container so CSS can swap the layout between the default
    // horizontal toolbar and the vertical left-side strip variant.
    // The orientation class lands on `<annot-toolbar>`, not the
    // outer container, so multiple toolbars can coexist with
    // independent orientations on a single page.
    const shell = document.createElement("annot-toolbar");
    shell.setAttribute("orientation", this.#orientation);
    this.#container.appendChild(shell);
    this.#shellEl = shell;

    // Select button
    const selectEl = this.#toolButton("arrow_selector_tool", "Select (V)");
    selectEl.active = true;
    const selectBtn = selectEl.getButton()!;
    this.#activeBtn = selectBtn;
    this.#selectBtn = selectBtn;
    selectBtn.addEventListener("click", () => this.#activate(null, selectBtn, "Select"));
    shell.appendChild(selectEl);

    shell.appendChild(this.#sep());

    // Tool buttons with dropdown
    const toolGroup = this.#div("toolbar-group");
    for (const [id, def] of this.#tools) {
      const wrap = document.createElement("div");
      wrap.className = "tool-btn-wrap";

      const btnEl = this.#toolButton(def.icon, def.label, id);
      const btn = btnEl.getButton()!;
      btn.addEventListener("click", (e) => {
        // If the click landed on the variant badge (nested inside
        // the button), the badge's own handler opens its flyout and
        // we should NOT also activate the tool. We detect this via
        // the event target rather than having the badge call
        // stopPropagation — stopping propagation would also prevent
        // OTHER open popovers' document-level click listeners from
        // hearing the click, so they'd fail to close. Letting the
        // event bubble normally keeps the "clicking another badge
        // auto-closes the previous flyout" behavior working.
        const target = e.target as Element | null;
        if (target?.closest?.(".tool-btn-badge")) return;
        // Load this tool's preset FOR THE CURRENT VARIANT (e.g.
        // "shape.rect" vs "shape.rounded"). Each variant has its own
        // defaults — the user's red rectangles and blue ellipses
        // don't bleed into each other via rubber-band.
        const preset = this.#getCurrentPreset(id);
        Object.assign(this.#options, preset);
        const tool = def.factory(this.#options);
        tool.onShapeComplete = (el?: SVGElement) => {
          this.#saveCurrentPreset(id, this.#options);
          this.#savePresetsToFile();
          this.#activate(null, selectBtn, "Select");
          if (el) this.#selection.select(el);
        };
        this.#activate(tool, btn, def.label);
      });
      // `data-tool` is mirrored on the host element via the Lit
      // property; setting it on the inner button too keeps the
      // existing imperative read paths (`btn.dataset.tool`) working.
      btn.dataset["tool"] = id;
      this.#toolButtons.set(id, btn);
      wrap.appendChild(btnEl);

      // Variant flyout affordance — for tools with a variant group
      // (shape / arrow / text / freehand / redact) OR for the
      // Highlight tool (which uses a custom color-swatch flyout).
      //
      // UX: the variant BADGE in the bottom-right corner of the
      // button serves DOUBLE DUTY as (a) the current-variant
      // indicator AND (b) the flyout trigger. Clicking the badge
      // opens the flyout; clicking anywhere else on the button
      // activates the tool with the current variant. This mirrors
      // Affinity / Photoshop's sub-variant indicator pattern and
      // eliminates the previous ~20×10 `tool-dropdown-arrow` which
      // was too small to hit reliably and visually muted.
      //
      // The actual click handler is attached to the badge element in
      // `#syncToolButtonIcon` (where the badge is created). The badge
      // stops propagation so the main tool-activation click on the
      // button doesn't also fire.
      // Highlight's variants ARE registered in TOOL_REGISTRY (one
      // entry per palette color) so the legacy `id === "highlight"`
      // OR is no longer needed.
      const hasVariantFlyout = (TOOL_REGISTRY[id]?.variants?.length ?? 0) > 0;
      // Mark the wrap so #syncToolButtonIcon knows to make its badge
      // interactive. (Tools without a flyout, e.g. Crop, don't have
      // badges at all, so this is a no-op for them.)
      if (!this.#hideToolDropdowns && hasVariantFlyout) {
        wrap.dataset.hasFlyout = "1";
      }

      toolGroup.appendChild(wrap);

      // Initial icon sync — reflect any persisted variant from the
      // loaded preset. (Loaded async in the constructor, so this also
      // runs from #applyLoadedPreset once the storage read returns.)
      this.#syncToolButtonIcon(id);
    }
    shell.appendChild(toolGroup);

    // Host-registered extra buttons (e.g. Scratchpad). They live in
    // their own group between the core tool buttons and the history
    // group so the visual grouping reads "create stuff / reusable
    // stuff / history".
    this.#extraButtonGroup = this.#div("toolbar-group toolbar-extra-group");
    for (const btn of this.#extraButtons) {
      this.#extraButtonGroup.appendChild(btn);
    }
    if (this.#extraButtons.length > 0) {
      shell.appendChild(this.#extraButtonGroup);
    }

    // Spacer
    const spacer = document.createElement("div");
    spacer.className = "toolbar-spacer";
    shell.appendChild(spacer);

    // Undo / Redo
    const histGroup = this.#div("toolbar-group");
    const undoBtn = this.#btn("undo", "Undo (Ctrl+Z)");
    undoBtn.addEventListener("click", () => this.#history.undo());
    histGroup.appendChild(undoBtn);

    const redoBtn = this.#btn("redo", "Redo (Ctrl+Y)");
    redoBtn.addEventListener("click", () => this.#history.redo());
    histGroup.appendChild(redoBtn);
    shell.appendChild(histGroup);

    // Whether the host provides the __anno_showGallery hook that
    // gates the Gallery button. Pre-computed so the two places that
    // need the check (condition below + actual render) stay in sync.
    const hasGalleryHook = !isTauri && typeof window.__anno_showGallery === "function";

    // Open / Copy / Save group. The host can suppress this if it
    // renders these actions at the document-chrome level (e.g. the
    // web app's editor header right cluster).
    if (this.#showSaveGroup) {
      shell.appendChild(this.#sep());
      const exportGroup = this.#div("toolbar-group");

      if (!isTauri && typeof window.__anno_openFile === "function") {
        const openBtn = this.#btn("folder_open", "Open File");
        openBtn.addEventListener("click", () => window.__anno_openFile?.());
        exportGroup.appendChild(openBtn);
      }

      const copyBtn = this.#btn("content_copy", "Copy (Ctrl+C)");
      copyBtn.addEventListener("click", () => this.#copyAll());
      exportGroup.appendChild(copyBtn);

      const saveWrap = document.createElement("div");
      saveWrap.className = "tool-btn-wrap";
      const saveBtn = this.#btn("save", "Save (Ctrl+S)");
      saveBtn.addEventListener("click", () => {
        if (!isTauri && typeof window.__anno_saveAnnotations === "function") {
          window.__anno_saveAnnotations();
        } else {
          saveToFile(this.#canvas, this.#getCurrentFilename?.());
        }
      });
      saveWrap.appendChild(saveBtn);

      const saveArrow = document.createElement("button");
      saveArrow.className = "tool-dropdown-arrow material-symbols-outlined";
      saveArrow.textContent = "expand_more";
      setTooltip(saveArrow, "Save options");
      saveArrow.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#showSaveMenu(saveWrap);
      });
      saveWrap.appendChild(saveArrow);
      exportGroup.appendChild(saveWrap);
      shell.appendChild(exportGroup);
    }

    // Separator before the theme / gallery group — only add when one
    // of them will actually render.
    if (this.#showThemeToggle || (this.#showGalleryButton && hasGalleryHook)) {
      shell.appendChild(this.#sep());
    }

    // Theme toggle (shared factory — reads current theme on init so the icon
    // reflects the actual state instead of always rendering "dark_mode").
    // The host may suppress this if it renders its own toggle elsewhere.
    if (this.#showThemeToggle) {
      shell.appendChild(createThemeToggle());
    }

    // Gallery button (extension only). The host may suppress this in favor
    // of a breadcrumb / back-link rendered outside the toolbar.
    if (this.#showGalleryButton && hasGalleryHook) {
      const galleryBtn = this.#btn("grid_view", "Gallery");
      galleryBtn.addEventListener("click", () => window.__anno_showGallery?.());
      shell.appendChild(galleryBtn);
    }

    // Keyboard shortcuts
    this.#setupShortcuts();
  }

  #activate(tool: ToolBase | null, btn: HTMLButtonElement, label: string): void {
    // Only clear the selection on actual context changes. Clicking the
    // already-active button (e.g. pressing "V" while already in Select
    // mode) shouldn't wipe the user's current selection.
    const contextChanged = this.#activeBtn !== btn;

    this.#activeBtn?.classList.remove("active");
    btn.classList.add("active");
    this.#activeBtn = btn;
    this.#canvas.setActiveTool(tool);

    // Clearing selection on any tool change unifies the UX: the old
    // object's handles implied "next action targets me", which
    // contradicts a new tool's "I'm about to create/place something".
    // Drawing tools that want to select the freshly-drawn shape just
    // call selection.select(el) AFTER #activate(null, ...) — the
    // temporary clear is immediately superseded by the new selection.
    if (contextChanged) {
      this.#selection.select(null);
    }

    // Flush any preset edits the user made in the property panel for
    // the previous tool before switching. Cheap — a no-op when nothing
    // changed.
    this.#savePresetsToFile();
    // Pass both label (for status text) and toolId (for hosts rendering
    // tool properties). Select / deactivation → toolId is null.
    const toolId = btn.dataset.tool ?? null;
    this.#onToolChange?.(label, toolId);
  }

  #setupShortcuts(): void {
    document.addEventListener("keydown", (e) => {
      // Don't trigger shortcuts when typing in inputs
      if (
        (e.target as HTMLElement).tagName === "INPUT" ||
        (e.target as HTMLElement).isContentEditable
      )
        return;

      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        this.#history.undo();
      } else if (e.ctrlKey && e.key === "y") {
        e.preventDefault();
        this.#history.redo();
      } else if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (!isTauri && typeof window.__anno_saveAnnotations === "function") {
          window.__anno_saveAnnotations();
        } else {
          saveToFile(this.#canvas, this.#getCurrentFilename?.());
        }
      } else if (e.ctrlKey && e.key === "c" && !window.getSelection()?.toString()) {
        e.preventDefault();
        this.#copyAll();
      } else if (e.key === "v" || e.key === "Escape") {
        // Select mode
        const selectBtn = this.#container.querySelector(".toolbar-btn") as HTMLButtonElement;
        if (selectBtn) this.#activate(null, selectBtn, "Select");
      }
    });
  }

  /** Programmatically return to Select mode — used by hosts that run
   *  one-shot tools outside the toolbar (e.g. a scratchpad paste
   *  action) and want to leave the UI in a clean Select state afterward. */
  activateSelectMode(): void {
    if (this.#selectBtn) {
      this.#activate(null, this.#selectBtn, "Select");
    }
  }

  /** Remove the "active" highlight from whichever toolbar button
   *  currently has it, and report a new tool label to the host.
   *  Used when a tool is activated directly on the canvas (bypassing
   *  the toolbar — e.g. scratchpad paste) so the toolbar UI + status
   *  indicator still reflect the active context.
   *
   *  Does NOT touch canvas.setActiveTool or selection — the caller
   *  has already set the canvas up. This method is UI-state only. */
  setExternalToolActive(label: string, toolId: string | null): void {
    this.#activeBtn?.classList.remove("active");
    this.#activeBtn = null;
    this.#onToolChange?.(label, toolId);
  }

  /** Exposed so hosts that render the save button outside the Toolbar
   *  (e.g. in a document-chrome header) can reuse the exact same menu. */
  showSaveMenu(anchor: HTMLElement): void {
    this.#showSaveMenu(anchor);
  }

  /** Exposed so host-rendered save buttons can trigger the canonical
   *  save path instead of re-implementing it. */
  saveNow(): void {
    if (!isTauri && typeof window.__anno_saveAnnotations === "function") {
      window.__anno_saveAnnotations();
    } else {
      saveToFile(this.#canvas, this.#getCurrentFilename?.());
    }
  }

  /** Exposed so host-rendered copy buttons can trigger the canonical
   *  copy path (GVML + PNG in Tauri, PNG fallback in browser). */
  copyNow(): Promise<void> {
    return this.#copyAll();
  }

  #showSaveMenu(anchor: HTMLElement): void {
    openToolbarSaveMenu(anchor, {
      canvas: this.#canvas,
      getCurrentFilename: this.#getCurrentFilename,
    });
  }

  /** Copy: GVML + PNG via Win32 API in one clipboard session */
  async #copyAll(): Promise<void> {
    if (isTauri) {
      try {
        await this.#copyForOffice();
      } catch (err) {
        console.error("Copy failed:", err);
      }
    } else {
      // Browser fallback (non-Tauri)
      try {
        await copyAsImage(this.#canvas);
      } catch (err) {
        console.error("PNG copy failed:", err);
      }
    }
  }

  async #copyForOffice(): Promise<void> {
    const shapes: AnnotationShape[] = [];
    const annos = this.#canvas.annotations.childNodes;

    // Apply a group's "transform=translate(tx, ty)" when pulling out
    // coordinates, so the Office shape lands at the same screen
    // position the user sees in the editor. Reads the canonical
    // data-tx/data-ty (set by the transform-utils layer) so this works
    // even when the visual transform attr has been rewritten as a
    // matrix(...) for rotation/flip support.
    const translateOf = (el: SVGElement): { tx: number; ty: number } => {
      const dtx = el.getAttribute("data-tx");
      const dty = el.getAttribute("data-ty");
      if (dtx != null || dty != null) {
        return { tx: Number.parseFloat(dtx || "0") || 0, ty: Number.parseFloat(dty || "0") || 0 };
      }
      const t = el.getAttribute("transform") || "";
      const m = t.match(/translate\(([\d.-]+),?\s*([\d.-]+)\)/);
      return m ? { tx: Number.parseFloat(m[1]!), ty: Number.parseFloat(m[2]!) } : { tx: 0, ty: 0 };
    };

    // Pull rotation/flip state for the Office side. Returned only when
    // non-default so the JSON payload stays compact for the common case.
    const transformOf = (el: SVGElement): Partial<AnnotationShape> => {
      const out: Partial<AnnotationShape> = {};
      const rot = Number.parseFloat(el.getAttribute("data-rot") || "0");
      if (rot) out.rotation_deg = rot;
      if (el.getAttribute("data-flip-h") === "1") out.flip_h = true;
      if (el.getAttribute("data-flip-v") === "1") out.flip_v = true;

      // Line polish — arrow shape/size per end, linecap, linejoin,
      // stroke opacity, gradients. Only attached when non-default so
      // the payload stays trim for unstyled shapes.
      const ss = el.getAttribute("data-arrow-start-shape");
      const es = el.getAttribute("data-arrow-end-shape");
      const sw = el.getAttribute("data-arrow-start-width");
      const sl = el.getAttribute("data-arrow-start-length");
      const ew = el.getAttribute("data-arrow-end-width");
      const eL = el.getAttribute("data-arrow-end-length");
      if (ss) out.arrow_shape_start = ss as AnnotationShape["arrow_shape_start"];
      if (es) out.arrow_shape_end = es as AnnotationShape["arrow_shape_end"];
      if (sw) out.arrow_width_start = sw as AnnotationShape["arrow_width_start"];
      if (sl) out.arrow_length_start = sl as AnnotationShape["arrow_length_start"];
      if (ew) out.arrow_width_end = ew as AnnotationShape["arrow_width_end"];
      if (eL) out.arrow_length_end = eL as AnnotationShape["arrow_length_end"];

      const cap = el.getAttribute("stroke-linecap");
      if (cap === "butt" || cap === "round" || cap === "square") {
        out.stroke_linecap = cap;
      }
      const join = el.getAttribute("stroke-linejoin");
      if (join === "miter" || join === "round" || join === "bevel") {
        out.stroke_linejoin = join;
      }
      // Line transparency may live on `opacity` (new canonical form
      // — lets markers fade with the line) or `stroke-opacity`
      // (legacy). Prefer whichever is present; emit the value only
      // when non-default so solid lines stay unchanged in the
      // Office paste payload.
      const opacityRaw = el.getAttribute("opacity") ?? el.getAttribute("stroke-opacity");
      const so = Number.parseFloat(opacityRaw || "");
      if (Number.isFinite(so) && so < 1) out.stroke_opacity_value = so;

      const sgRaw = el.getAttribute("data-stroke-gradient");
      if (sgRaw) {
        try {
          out.stroke_gradient = JSON.parse(sgRaw);
        } catch {
          /* skip */
        }
      }
      const fgRaw = el.getAttribute("data-fill-gradient");
      if (fgRaw) {
        try {
          out.fill_gradient = JSON.parse(fgRaw);
        } catch {
          /* skip */
        }
      }
      return out;
    };

    for (const node of Array.from(annos)) {
      const el = node as SVGElement;
      const tag = el.tagName;
      const { tx, ty } = translateOf(el);
      const xform = transformOf(el);

      const isArrowPath = tag === "g" && el.getAttribute("data-type") === "arrow";
      if (isArrowPath) {
        // ArrowTool's composed `<g data-type="arrow">` — endpoints +
        // per-end shape attrs in `data-*` form, so Office paste can
        // emit the matching OOXML preset.
        const x1 = Number.parseFloat(el.getAttribute("data-x1") || "0");
        const y1 = Number.parseFloat(el.getAttribute("data-y1") || "0");
        const x2 = Number.parseFloat(el.getAttribute("data-x2") || "0");
        const y2 = Number.parseFloat(el.getAttribute("data-y2") || "0");
        const startShape = el.getAttribute("data-arrow-start-shape");
        const endShape = el.getAttribute("data-arrow-end-shape");
        const headStart = startShape != null && startShape !== "none";
        const headEnd = endShape != null && endShape !== "none";
        shapes.push({
          type: headEnd || headStart ? "arrow" : "line",
          x1: x1 + tx,
          y1: y1 + ty,
          x2: x2 + tx,
          y2: y2 + ty,
          stroke: el.getAttribute("stroke") || "#ff0000",
          stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
          stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
          has_arrow: headEnd,
          arrow_head_start: headStart,
          arrow_head_end: headEnd,
          ...xform,
        });
      } else if (tag === "rect") {
        // Rect covers three product-level cases:
        //   1. Shape "rect"     → type="rect",        corner_radius=0
        //   2. Shape "rounded"  → type="rounded-rect", corner_radius=rx
        //   3. Redact "solid"   → type="rect",        redact_style="solid"
        // Type string stays "rect" / "rounded-rect" for back-compat with
        // the desktop Office-clipboard handler; the new `corner_radius`
        // / `redact_style` fields add finer-grained info without
        // breaking existing Rust code paths.
        const rx = Number.parseFloat(el.getAttribute("rx") || "0");
        const isRedactSolid = el.getAttribute("data-redact-style") === "solid";
        const isRounded = el.hasAttribute("data-rounded") || rx > 0;
        shapes.push({
          type: isRounded && !isRedactSolid ? "rounded-rect" : "rect",
          x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
          y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
          width: Number.parseFloat(el.getAttribute("width") || "0"),
          height: Number.parseFloat(el.getAttribute("height") || "0"),
          stroke: el.getAttribute("stroke") || "none",
          stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "0"),
          stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
          fill: el.getAttribute("fill") || "none",
          fill_opacity: Number.parseFloat(el.getAttribute("fill-opacity") || "1"),
          corner_radius: rx,
          redact_style: isRedactSolid ? "solid" : undefined,
          ...xform,
        });
      } else if (tag === "ellipse") {
        shapes.push({
          type: "ellipse",
          cx: Number.parseFloat(el.getAttribute("cx") || "0") + tx,
          cy: Number.parseFloat(el.getAttribute("cy") || "0") + ty,
          rx: Number.parseFloat(el.getAttribute("rx") || "0"),
          ry: Number.parseFloat(el.getAttribute("ry") || "0"),
          stroke: el.getAttribute("stroke") || "#ff0000",
          stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
          stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
          fill: el.getAttribute("fill") || "none",
          fill_opacity: Number.parseFloat(el.getAttribute("fill-opacity") || "1"),
          ...xform,
        });
      } else if (tag === "image") {
        // Redact image — mosaic or blur. The style tag distinguishes
        // them so the desktop side can choose a different Office
        // picture-effect preset if it wants; both carry a baked-in
        // PNG in image_data_url.
        const style = el.getAttribute("data-redact-style") as "mosaic" | "blur" | null;
        const href = el.getAttribute("href") || "";
        shapes.push({
          type: style === "blur" ? "blur_image" : "mosaic_image",
          x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
          y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
          width: Number.parseFloat(el.getAttribute("width") || "0"),
          height: Number.parseFloat(el.getAttribute("height") || "0"),
          image_data_url: href,
          // The Rust-side OOXML emitter currently reads the data URL
          // off `text` (its `AnnotationShape` struct doesn't model
          // `image_data_url`). Both fields carry the same value
          // until that ABI is widened.
          text: href,
          redact_style: style || "mosaic",
          ...xform,
        });
      } else if (tag === "path") {
        // Freehand — pen or highlighter. stroke_opacity carries the
        // transparency so Office can render a translucent shape.
        const drawStyle =
          (el.getAttribute("data-draw-style") as "pen" | "highlighter" | null) ||
          (Number.parseFloat(el.getAttribute("stroke-opacity") || "1") < 0.99
            ? "highlighter"
            : "pen");
        shapes.push({
          type: "freehand",
          text: el.getAttribute("d") || "",
          stroke: el.getAttribute("stroke") || "#ff0000",
          stroke_width: Number.parseFloat(el.getAttribute("stroke-width") || "3"),
          stroke_dasharray: el.getAttribute("stroke-dasharray") || "",
          stroke_opacity: Number.parseFloat(el.getAttribute("stroke-opacity") || "1"),
          draw_style: drawStyle,
          ...xform,
        });
      } else if (tag === "text") {
        shapes.push({
          type: "text",
          x: Number.parseFloat(el.getAttribute("x") || "0") + tx,
          y: Number.parseFloat(el.getAttribute("y") || "0") + ty,
          text: el.textContent || "",
          font_size: Number.parseFloat(el.getAttribute("font-size") || "24"),
          font_family: el.getAttribute("font-family") || undefined,
          fill: el.getAttribute("fill") || "#ff0000",
          text_variant: "plain",
          ...xform,
        });
      } else if (tag === "g") {
        if (el.getAttribute("data-type") === "textbox") {
          // Unified Textbox — plain / sticky / callout. All three
          // share the same <g> skeleton with a <rect> + optional
          // <path> tail; the variant is the discriminator for Office.
          const textEl = el.querySelector("text");
          const bgRect = el.querySelector("rect");
          const variant =
            (el.getAttribute("data-text-variant") as "plain" | "sticky" | "callout" | null) ||
            "sticky";
          if (textEl) {
            const tspans = textEl.querySelectorAll("tspan");
            const bx =
              Number.parseFloat(bgRect?.getAttribute("x") || tspans[0]?.getAttribute("x") || "0") +
              tx;
            const by = Number.parseFloat(bgRect?.getAttribute("y") || "0") + ty;
            const bw = Number.parseFloat(bgRect?.getAttribute("width") || "200");
            const bh = Number.parseFloat(bgRect?.getAttribute("height") || "40");
            const tailXRaw = el.getAttribute("data-tail-x");
            const tailYRaw = el.getAttribute("data-tail-y");
            shapes.push({
              type: "text",
              x: bx,
              y: by,
              width: bw,
              height: bh,
              text: el.getAttribute("data-text") || textEl.textContent || "",
              font_size: Number.parseFloat(
                textEl.getAttribute("font-size") || el.getAttribute("data-font-size") || "24",
              ),
              font_family:
                textEl.getAttribute("font-family") ||
                el.getAttribute("data-font-family") ||
                undefined,
              fill: textEl.getAttribute("fill") || el.getAttribute("data-color") || "#ff0000",
              // The Rust-side OOXML emitter reads the textbox's
              // sticky bg color off `stroke`. Carrier field — keep
              // populated until the ABI is widened to a dedicated
              // bg-color field.
              stroke: variant === "plain" ? "" : bgRect?.getAttribute("fill") || "",
              text_variant: variant,
              tail_x: tailXRaw != null ? Number.parseFloat(tailXRaw) + tx : undefined,
              tail_y: tailYRaw != null ? Number.parseFloat(tailYRaw) + ty : undefined,
              ...xform,
            });
          }
        } else {
          // Marker / Counter — circle or rect background with a numbered
          // label. The outer <g>'s translate() (from user drags) is
          // added here so the Office shape lands at the user-visible
          // position, not at the initial drawing coordinate.
          const bgCircle = el.querySelector("circle");
          const bgRect = el.querySelector("rect");
          const bgEl = bgCircle || bgRect;
          if (bgEl) {
            // `data-shape` on the outer <g> is the authoritative
            // shape flag (written by MarkerTool). It can be "circle",
            // "rect", or "rounded". Fall back to bg tagName for
            // legacy content missing the data attr.
            const dataShape = el.getAttribute("data-shape");
            const shapeName: "circle" | "rect" | "rounded" =
              dataShape === "rounded"
                ? "rounded"
                : dataShape === "rect"
                  ? "rect"
                  : dataShape === "circle"
                    ? "circle"
                    : bgRect && !bgCircle
                      ? "rect"
                      : "circle";
            const isRectLike = shapeName === "rect" || shapeName === "rounded";
            let mcx: number;
            let mcy: number;
            if (isRectLike) {
              const rx = Number.parseFloat(bgRect!.getAttribute("x") || "0");
              const ry = Number.parseFloat(bgRect!.getAttribute("y") || "0");
              const rw = Number.parseFloat(bgRect!.getAttribute("width") || "0");
              const rh = Number.parseFloat(bgRect!.getAttribute("height") || "0");
              mcx = rx + rw / 2;
              mcy = ry + rh / 2;
            } else {
              mcx = Number.parseFloat(bgCircle!.getAttribute("cx") || "0");
              mcy = Number.parseFloat(bgCircle!.getAttribute("cy") || "0");
            }
            const textEl = el.querySelector("text");
            const fs = Number.parseFloat(textEl?.getAttribute("font-size") || "13");
            shapes.push({
              type: "marker",
              cx: mcx + tx,
              cy: mcy + ty,
              fill: bgEl.getAttribute("fill") || "#ff0000",
              label: textEl?.textContent || "",
              font_size: fs,
              marker_shape: shapeName,
              // The Rust-side OOXML emitter reads the marker's
              // shape name off `stroke` (its `AnnotationShape` struct
              // doesn't model `marker_shape`). Both fields carry the
              // same value until that ABI is widened.
              stroke: shapeName,
              ...xform,
            });
          }
        }
      }
    }
    try {
      const screenshotData = this.#canvas.imageEl.getAttribute("href") || undefined;
      const pngDataUrl = await getPngDataUrl(this.#canvas);
      await copyAsOffice(
        shapes,
        this.#canvas.imageWidth,
        this.#canvas.imageHeight,
        screenshotData,
        pngDataUrl,
      );
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }

  /**
   * Public API: render a tool's property controls INTO `container`.
   * Hosts use this to display tool properties in a persistent right
   * panel (Phase 2 of the editor UI refactor) instead of the popover
   * dropdown. The caller owns the container and is responsible for
   * clearing it between calls.
   *
   * Changes persist to the in-memory preset map immediately; disk
   * flush happens either via the popover close handler (horizontal
   * mode) or when the host decides (e.g. when switching tools).
   */
  renderToolProperties(toolId: string, container: HTMLElement): void {
    populateToolPropertyPanel(toolId, container, {
      canvas: this.#canvas,
      options: this.#options,
      getCurrentPreset: (id) => this.#getCurrentPreset(id),
      saveCurrentPreset: (id, p) => this.#saveCurrentPreset(id, p),
      handlePanelVariantChange: (id, v, p) => this.#handlePanelVariantChange(id, v, p),
    });
  }

  /** Concrete, user-facing ELEMENT name for what the tool is about to
   *  create — e.g. "Rectangle" / "Arrow" / "Callout". Used by hosts
   *  as the dynamic header of the properties panel, and intentionally
   *  MATCHES the naming convention used when the same kind of element
   *  is selected. So "pick the Shape tool with rect variant" and
   *  "select a rectangle" produce the SAME title, reinforcing the
   *  user's mental model that the properties panel is just "what this
   *  thing is" regardless of how the user got there.
   *
   *  This is distinct from the variant LABEL (e.g. "Line (no arrow)")
   *  which is tuned for compact flyout chips. The title here is tuned
   *  for reading as a noun ("Line" / "Arrow" / "Callout"). */
  getToolDisplayTitle(toolId: string): string {
    const toolDef = this.#tools.get(toolId);
    if (!toolDef) return toolId;
    const preset = this.#getCurrentPreset(toolId);
    switch (toolId) {
      case "shape":
        switch (preset.shapeType) {
          case "rect":
            return "Rectangle";
          case "rounded":
            return "Rounded rectangle";
          case "ellipse":
            return "Ellipse";
          case "highlight":
            return "Highlight";
          default:
            return "Rectangle";
        }
      case "arrow":
        switch (preset.arrowHead) {
          case "none":
            return "Line";
          case "end":
            return "Arrow";
          case "both":
            return "Double arrow";
          default:
            return "Arrow";
        }
      case "text":
        switch (preset.textVariant) {
          case "plain":
            return "Text";
          case "sticky":
            return "Sticky note";
          case "callout":
            return "Callout";
          default:
            return "Text";
        }
      case "freehand":
        // Match the "<Tool> (<variant>)" convention used by Counter
        // (Counter (Circle)), Highlight (Highlight (Yellow)), etc.
        // — "Draw (Pen)" / "Draw (Highlighter)" instead of the bare
        // variant noun, so the tool family is identifiable from the
        // title alone.
        return preset.drawStyle === "highlighter" ? "Draw (Highlighter)" : "Draw (Pen)";
      case "marker":
        // Counter variants share the base noun "Counter" and append
        // the shape in parens (see right-panel's #elementTypeName
        // for the matching Selection-mode formatter).
        switch (preset.markerShape) {
          case "rect":
            return "Counter (Square)";
          case "rounded":
            return "Counter (Rounded square)";
          default:
            return "Counter (Circle)";
        }
      case "redact":
        switch (preset.redactStyle) {
          case "mosaic":
            return "Mosaic";
          case "solid":
            return "Solid redaction";
          case "blur":
            return "Blur";
          default:
            return "Redaction";
        }
      case "highlight": {
        // Mirror the Selection-side "Highlight (Yellow)" formatter:
        // include the current color's palette label in parens so the
        // toolbar tooltip reads as a name, not a raw hex.
        const label = highlightColorLabel(preset.highlightColor);
        return label ? `Highlight (${label})` : "Highlight";
      }
      case "crop":
        return "Crop";
      default:
        return toolDef.label;
    }
  }

  /** Persist preset changes. Exposed so hosts using the render API
   *  directly can flush on tool-change boundaries. */
  savePresets(): void {
    this.#savePresetsToFile();
  }

  /** Apply the element's current variant PRESET (color / width / dash
   *  / opacity / …) to the DOM element. Used by the host after a
   *  variant switch in the selection property panel: changing an
   *  Arrow to a Double arrow should also load the Double arrow
   *  preset's saved style, matching how that variant was last drawn.
   *
   *  The element's elementKey is derived from its current data
   *  attributes (post variant change, so we look up the NEW variant's
   *  preset).
   *
   *  If no preset is stored for the new variant yet (first-time use),
   *  we seed one by inheriting style from the current element's OWN
   *  attributes (which reflect the shape's current on-canvas state).
   *  This mirrors `#changeVariant`'s seed behavior for toolbar flyout
   *  switches — first switch = same color as you were using, which
   *  then becomes the variant's baseline for future sessions. */
  applyElementVariantPreset(el: SVGElement): void {
    const toolId = toolIdForElement(el);
    if (!toolId) return;
    const elementKey = elementKeyFromElement(el, toolId);
    let preset = this.#presets.get(elementKey);
    if (!preset) {
      // First use of this variant — seed from the element's current
      // attrs so the conversion starts from a familiar baseline.
      // Style attrs like stroke / fill / width aren't touched by the
      // variant-change machinery (that only touches variant-defining
      // attrs like data-arrow-*-shape), so reading them off `el`
      // yields the user's pre-conversion style.
      preset = seedPresetFromElement(el, toolId, elementKey, this.#options);
      this.#presets.set(elementKey, preset);
      this.#savePresetsToFile();
    }
    // Update the last-used variant tracking so the next toolbar
    // activation for this tool picks the same variant.
    if (elementKey.includes(".")) {
      const variant = elementKey.slice(elementKey.indexOf(".") + 1);
      this.#lastVariantByTool.set(toolId, variant);
    }
    applyPresetStyleAttrs(el, preset);
    // Refresh the tool button's badge so the sidebar reflects the
    // newly-active variant. Without this, converting a Counter from
    // Circle → Rounded via the property-panel Type picker leaves the
    // toolbar badge still showing the circle glyph, which confuses
    // the "what's next click going to create?" reading.
    this.#syncToolButtonIcon(toolId);
  }

  /** Show a compact variant picker for tools whose flyout is just a
   *  small set of sub-shapes (shape / arrow / text / freehand /
   *  redact). Clicking a chip sets the variant on the tool's preset,
   *  updates the parent button icon, closes the popover, and
   *  activates the tool — a one-click path from "pick variant" to
   *  "start drawing it". Full property editing lives in the right
   *  panel; this is intentionally NOT a miniature property panel. */
  #showVariantFlyout(toolId: string, anchor: HTMLElement): void {
    const meta = TOOL_REGISTRY[toolId];
    if (!meta?.variants || !meta.variantField || !meta.defaultVariant) return;

    const preset = this.#getCurrentPreset(toolId);
    const current = (preset[meta.variantField] as string) || meta.defaultVariant;
    const placement = this.#orientation === "vertical" ? "right" : "below";

    const close = openAnchoredPopover(
      anchor,
      (root) => {
        const flyout = document.createElement("annot-tool-flyout");
        flyout.layout = "variant";
        flyout.active = current;
        flyout.chips = meta.variants!.map((v) => ({
          value: v.value,
          icon: v.icon,
          svg: v.svg,
          label: v.label,
        }));
        flyout.addEventListener("chip-select", (e: Event) => {
          const detail = (e as CustomEvent<ChipSelectDetail>).detail;
          // Switch variant: save current at old key, load new (or
          // seed) at new key. Updates #lastVariantByTool so future
          // tool activations pick this variant by default.
          const next = this.#changeVariant(toolId, detail.value, preset);
          // Mutate the captured preset reference so anything inside
          // this closure that still reads `preset` sees the new
          // values.
          Object.keys(preset).forEach(
            (k) => delete (preset as unknown as Record<string, unknown>)[k],
          );
          Object.assign(preset, next);
          this.#savePresetsToFile();
          this.#syncToolButtonIcon(toolId);
          close();
          this.#activateToolById(toolId);
        });
        root.appendChild(flyout);
      },
      { placement, className: "tool-flyout-variant" },
    );
  }

  /** Sync the tool button's variant indicator to reflect the currently-
   *  selected variant.
   *
   *  Design choice: the MAIN icon stays FIXED (so the tool's identity
   *  is always visible — "Shape is always the shapes icon"). Variant
   *  is shown as a small badge in the bottom-right corner of the
   *  button. Rationale:
   *    - Tool identity must be constant for visual scanning + muscle
   *      memory (Figma / Miro / PowerPoint pattern)
   *    - Changing the main icon per-variant (Illustrator "sticky
   *      tool" pattern) is problematic for casual / short-session
   *      use like screenshot annotation, because the user has no
   *      time to memorize which icon maps to which tool
   *    - The caret (▼) + badge together tell the user "sub-variants
   *      exist, current one is X" without hiding the tool identity
   *
   *  Highlight tool is special-cased: it uses a bottom color bar
   *  instead of a badge (the "variant" is a color, which reads more
   *  naturally as a color swatch than as an icon glyph). */
  /** Ensure the variant badge exists on `btn`, attaching the flyout-
   *  opening click handler the first time it's created.
   *
   *  The badge serves double duty as (a) the current-variant indicator
   *  and (b) the flyout trigger. Attaching the click handler here
   *  (rather than on the main button) lets us `stopPropagation` cleanly
   *  — the tool-activation handler bound to the button never sees the
   *  click when the user targets the badge, so a badge click opens the
   *  flyout without also activating the tool. */
  #ensureBadge(btn: HTMLButtonElement, toolId: string): HTMLSpanElement {
    let badge = btn.querySelector<HTMLSpanElement>(":scope > .tool-btn-badge");
    if (badge) return badge;
    badge = document.createElement("span");
    // Aria-hidden because the parent button's aria-label already
    // includes the variant name — the badge is visual shorthand for
    // the same info and would double-announce if voiced.
    badge.setAttribute("aria-hidden", "true");
    // No separate tooltip on the badge: the PARENT button's tooltip
    // (e.g. "Shape (Rectangle)") already covers the semantic info,
    // and a second tooltip with "Click for variants" would (a) fire
    // simultaneously with the parent's on hover since CSS :hover
    // cascades to ancestors, and (b) in vertical mode land visually
    // on top of the NEXT tool icon stacked below. Discoverability of
    // the flyout affordance is handled visually: the badge shows
    // cursor: pointer and scales on hover, which reads as "clickable"
    // without needing text.
    // Only attach the click handler when the enclosing wrap is
    // marked as having a flyout (set in #render). Tools without a
    // flyout (Crop) never reach this codepath anyway — the badge is
    // only created from inside #syncToolButtonIcon, which is only
    // called for tools whose `TOOL_REGISTRY` entry carries a
    // `variants` catalogue. Still, guard for safety.
    const wrap = btn.closest<HTMLElement>(".tool-btn-wrap");
    if (wrap?.dataset.hasFlyout === "1") {
      badge.addEventListener("click", (e) => {
        // Intentionally NO stopPropagation — the click needs to
        // bubble up to document so other open popovers' outside-
        // click listeners can close themselves. The parent button's
        // click handler already short-circuits when the event target
        // is inside a badge (see #render), so the tool won't
        // accidentally activate. `preventDefault` is kept only for
        // form-submission edge cases if the button were ever placed
        // inside a <form>.
        e.preventDefault();
        // Phase 2 of `docs/plans/toolbar-highlight-flyout-kind.md`:
        // dispatch on the registry's `flyoutKind` discriminator
        // instead of the literal `toolId === "highlight"`. Tools with
        // `flyoutKind === "color"` open the swatch-row flyout (today
        // only Highlight); every other tool with a variant catalog
        // opens the icon-chip flyout via the legacy path.
        if (TOOL_REGISTRY[toolId]?.flyoutKind === "color") {
          this.#showColorFlyout(toolId, wrap);
        } else {
          this.#showVariantFlyout(toolId, wrap);
        }
      });
    }
    btn.appendChild(badge);
    return badge;
  }

  #syncToolButtonIcon(toolId: string): void {
    const btn = this.#toolButtons.get(toolId);
    if (!btn) return;

    // Highlight: color-swatch badge in the bottom-right corner — same
    // position + size as other tools' variant badges, but renders as
    // a solid-color circle (no icon glyph) because the "variant" IS a
    // color. This unifies Highlight with the Pattern-A badge scheme
    // used elsewhere; the previous bottom-underline approach put the
    // color indicator in a different spot from every other tool's
    // indicator, which was visually inconsistent.
    if (toolId === "highlight") {
      const preset = this.#getCurrentPreset(toolId);
      const color =
        (preset.highlightColor as string) || TOOL_REGISTRY.highlight!.defaultVariant!;
      const badge = this.#ensureBadge(btn, toolId);
      badge.className = "tool-btn-badge tool-btn-badge-color";
      badge.textContent = ""; // no glyph — color lives in ::after
      // The badge itself keeps the circular panel-colored frame (so
      // it matches every other tool's variant badge shape); the inner
      // color swatch is rendered as a rounded square via
      // .tool-btn-badge-color::after, driven by this custom property.
      // Clear any legacy inline background from before the
      // circle-containing-square redesign.
      badge.style.background = "";
      badge.style.setProperty("--swatch-color", color);
      // Keep the button's title informative — tools with variants go
      // through the block below but highlight early-returns, so we
      // set it directly here. The palette LABEL ("Yellow") is shown
      // instead of the raw hex so it matches the Selection-side
      // "Selected Highlight (Yellow)" formatter; for colors outside
      // the preset palette, highlightColorLabel falls back to the
      // hex string automatically.
      const toolDef = this.#tools.get(toolId);
      if (toolDef) {
        const label = highlightColorLabel(color);
        const composed = label ? `${toolDef.label} (${label})` : toolDef.label;
        setTooltip(btn, composed);
        btn.setAttribute("aria-label", composed);
      }
      return;
    }

    const meta = TOOL_REGISTRY[toolId];
    if (!meta?.variants || !meta.variantField || !meta.defaultVariant) return;
    const preset = this.#getCurrentPreset(toolId);
    const current = (preset[meta.variantField] as string) || meta.defaultVariant;
    const variant = meta.variants.find((v) => v.value === current);
    if (!variant) return;

    const badge = this.#ensureBadge(btn, toolId);
    // Variants with inline SVG swap the class set so the badge's font
    // rules (Material Symbols ligature rendering + font-variation)
    // don't interfere with the SVG glyph.
    if (variant.svg) {
      badge.className = "tool-btn-badge tool-btn-badge-svg";
      badge.innerHTML = variant.svg;
    } else {
      badge.className = "tool-btn-badge material-symbols-outlined";
      badge.textContent = variant.icon;
    }

    // Update title/aria-label so the variant is announced alongside
    // the tool identity. Putting tool name FIRST ("Shape (Rounded
    // rectangle)") ensures screen-reader users hear the tool's
    // identity before its current variant — matching the visual
    // priority of main icon > badge.
    const toolDef = this.#tools.get(toolId);
    if (toolDef) {
      const composed = `${toolDef.label} (${variant.label})`;
      setTooltip(btn, composed);
      btn.setAttribute("aria-label", composed);
    }
  }

  /** Color-swatch flyout for tools whose variants are colors rather
   *  than icon glyphs (today: Highlight). Renders one round chip per
   *  registry variant; click writes the canonical (mixed-case)
   *  variant value into `preset[meta.variantField]`, updates the
   *  button's swatch indicator, and activates the tool so the user
   *  can start drawing immediately with the new color.
   *
   *  Symmetric with `#showVariantFlyout`: same popover scaffolding,
   *  same chip-select event shape, same close-then-activate flow.
   *  Diverges only in (a) `flyout.layout = "color"` vs `"variant"`,
   *  (b) chip mapping uses `meta.chipColorForVariant?.(v.value) ??
   *  v.value` for the swatch fill (defaulting to identity for
   *  Highlight where the variant value IS the hex), and (c) chip
   *  values are lower-cased for case-insensitive active-state
   *  matching with the canonical look-up on chip-select.
   *
   *  Phase 2 of `docs/plans/toolbar-highlight-flyout-kind.md`:
   *  replaces `#showHighlightColorFlyout`. The HIGHLIGHT_COLORS
   *  import was the previous chip source; chips now derive from
   *  `meta.variants` so future color-flyout tools (Stamp, Pen
   *  color, …) inherit the same path without copy-paste. */
  #showColorFlyout(toolId: string, anchor: HTMLElement): void {
    const meta = TOOL_REGISTRY[toolId];
    if (!meta?.variants || !meta.variantField || !meta.defaultVariant) return;

    const preset = this.#getCurrentPreset(toolId);
    const currentRaw = (preset[meta.variantField] as string) || meta.defaultVariant;
    const current = currentRaw.toLowerCase();
    const placement = this.#orientation === "vertical" ? "right" : "below";
    const variantField = meta.variantField;

    const close = openAnchoredPopover(
      anchor,
      (root) => {
        const flyout = document.createElement("annot-tool-flyout");
        flyout.layout = "color";
        flyout.active = current;
        flyout.chips = meta.variants!.map((v) => ({
          value: v.value.toLowerCase(),
          color: meta.chipColorForVariant?.(v.value) ?? v.value,
          label: v.label,
        }));
        flyout.addEventListener("chip-select", (e: Event) => {
          const detail = (e as CustomEvent<ChipSelectDetail>).detail;
          // The chip's value is normalised lower-case; look up the
          // canonical (mixed-case) variant value from `meta.variants`
          // so the saved preset matches the catalogue entry. Falls
          // through to `detail.value` if the chip isn't in the
          // registry (e.g. legacy ad-hoc hex preserved across reloads).
          const canonical =
            meta.variants!.find((v) => v.value.toLowerCase() === detail.value)?.value ??
            detail.value;
          (preset as unknown as Record<string, unknown>)[variantField as string] = canonical;
          // Highlight-specific: ShapeTool's highlight rendering path
          // requires `shapeType === "highlight"` — without this the
          // underlying ShapeTool would dispatch to the regular rect
          // path and lose the highlighter look. Preserved for byte-
          // equivalence; future "color" tools without a ShapeTool
          // backing leave shapeType untouched.
          if (toolId === "highlight") preset.shapeType = "highlight";
          this.#saveCurrentPreset(toolId, preset);
          this.#savePresetsToFile();
          this.#syncToolButtonIcon(toolId);
          close();
          this.#activateToolById(toolId);
        });
        root.appendChild(flyout);
      },
      { placement, className: "tool-flyout-color" },
    );
  }

  /**
   * Rubber-band propagation: read the element's current style attrs
   * and update the MATCHING tool's preset so the next shape drawn
   * with that tool inherits the same look. Called by the host after
   * PropertyPanel fires its `onStyleChanged` callback.
   *
   * Example: the user drew a red arrow, then edited it to blue via
   * the Selection panel. Without this, the NEXT arrow would still be
   * red (preset untouched). With this, the arrow preset's
   * `strokeColor` is updated to blue, so the next draw matches the
   * user's most recent deliberate choice.
   */
  syncPresetFromElement(el: SVGElement): void {
    const toolId = toolIdForElement(el);
    if (!toolId) return;
    // Per-variant preset: route the update to the SPECIFIC variant
    // preset (e.g. "shape.rounded") rather than the tool-level preset.
    // This way editing a rounded rectangle's color doesn't overwrite
    // the sharp-rectangle default.
    const elementKey = elementKeyFromElement(el, toolId);
    const preset = { ...(this.#presets.get(elementKey) || this.#options) };

    // Universal style attrs that map 1:1 onto ToolOptions fields.
    // The reader resolves freehand groups to their last-`<path>`
    // child internally so the rubber-band reflects "what the user
    // just drew". Tool-id-agnostic — anything per-tool is delegated
    // to the registry's `extractStyleFromElement` below.
    readUniversalStyleAttrs(el, preset);

    // Tool-specific extras delegated to the registry. Each tool's
    // `extractStyleFromElement` mutates `preset` in place with
    // values the universal reader can't capture (text font from a
    // child `<text>`, arrow per-end state, marker bg primitive,
    // highlight's fill → highlightColor routing, etc.).
    TOOL_REGISTRY[toolId]?.extractStyleFromElement?.(el, preset);

    // Save back at the same element key the read used, and update
    // the last-used variant tracking so re-selecting this tool picks
    // the same variant the user just edited.
    this.#presets.set(elementKey, preset);
    const meta = TOOL_REGISTRY[toolId];
    if (meta?.variants && elementKey.includes(".")) {
      const variant = elementKey.slice(elementKey.indexOf(".") + 1);
      this.#lastVariantByTool.set(toolId, variant);
    }
    Object.assign(this.#options, preset);
    this.#savePresetsToFile();
    this.#syncToolButtonIcon(toolId);
  }

  /** Register a host-provided extra button on the toolbar (e.g. the
   *  Scratchpad library). The button is appended to a dedicated group
   *  between the tool group and the undo/redo group so the visual
   *  rhythm stays "create / reusable / history". `onClick` gets the
   *  anchor element so the host can open a popover against it. */
  registerExtraToolButton(opts: {
    id: string;
    icon: string;
    title: string;
    onClick: (anchor: HTMLButtonElement) => void;
  }): HTMLButtonElement {
    const btn = this.#btn(opts.icon, opts.title);
    btn.dataset.extraTool = opts.id;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      opts.onClick(btn);
    });
    this.#extraButtons.push(btn);
    if (this.#extraButtonGroup) {
      this.#extraButtonGroup.appendChild(btn);
      if (!this.#extraButtonGroup.isConnected) {
        // If the group wasn't attached (no extras at render time),
        // slot it in between the tool group and the undo/redo group.
        // Lookup the spacer inside the `<annot-toolbar>` shell so
        // the insertion lands in the right parent (the shell, not
        // the outer host div).
        const root = this.#shellEl ?? this.#container;
        const sep = root.querySelector(".toolbar-spacer");
        if (sep?.parentElement) sep.parentElement.insertBefore(this.#extraButtonGroup, sep);
        else root.appendChild(this.#extraButtonGroup);
      }
    }
    return btn;
  }

  // --- Preset persistence ---
  //
  // Phase 2 of `docs/plans/toolbar-schema.md`. The four save / load
  // pairs now route every field copy through `presetToWire` /
  // `presetFromWire` (driven by `TOOL_REGISTRY[toolId].presetFields`)
  // instead of hand-rolling per-method 20-field mappings. Adding a
  // new persisted field is one entry in the matching tool's
  // `presetFields` array — the marshallers pick it up automatically.

  /** Look up a preset key's tool id and resolve its `presetFields`.
   *  The element-key format is `${toolId}.${variant}` (or just
   *  `${toolId}` for variantless tools). Returns an empty array for
   *  unknown tool ids — callers skip those entries so corrupt /
   *  stale storage doesn't pollute the in-memory preset map. */
  #presetFieldsForKey(elementKey: string): ReadonlyArray<keyof ToolOptions> {
    const dotIdx = elementKey.indexOf(".");
    const toolId = dotIdx === -1 ? elementKey : elementKey.slice(0, dotIdx);
    return TOOL_REGISTRY[toolId]?.presetFields ?? [];
  }

  /** Merge a wire-loaded partial onto a defaults base so the stored
   *  preset is a full `ToolOptions`. The base is `this.#options` at
   *  load time (which IS the constructor defaults for the universal
   *  fields), so a missing field on disk falls back to the same
   *  default the legacy `?? DEFAULT_*` chain produced. */
  #presetFromPartial(partial: Partial<ToolOptions>): ToolOptions {
    return { ...this.#options, ...partial };
  }

  async #loadPresetsFromFile(): Promise<void> {
    try {
      const data = await loadToolPresets();
      if (data.tools) {
        for (const [rawKey, p] of Object.entries(data.tools)) {
          // Migrate legacy tool-ID-keyed entries (e.g. "shape") to
          // the tool's default-variant element key (e.g. "shape.rect").
          const key = migrateLegacyPresetKey(rawKey);
          const fields = this.#presetFieldsForKey(key);
          if (fields.length === 0) continue;
          const partial = presetFromWire(p as Record<string, unknown>, fields, "snake");
          this.#presets.set(key, this.#presetFromPartial(partial));
        }
      }
      if (data.last_variants) {
        for (const [toolId, variant] of Object.entries(data.last_variants)) {
          this.#lastVariantByTool.set(toolId, variant);
        }
      }
      // Reflect the just-loaded variants on the tool buttons.
      for (const id of this.#tools.keys()) this.#syncToolButtonIcon(id);
    } catch {
      // No file or parse error, use defaults
    }
  }

  #savePresetsToFile(): void {
    if (isTauri) {
      const tools: Record<string, ToolPreset> = {};
      for (const [id, opts] of this.#presets) {
        const fields = this.#presetFieldsForKey(id);
        if (fields.length === 0) continue;
        tools[id] = presetToWire(opts, fields, "snake") as ToolPreset;
      }
      const last_variants: Record<string, string> = {};
      for (const [toolId, variant] of this.#lastVariantByTool) {
        last_variants[toolId] = variant;
      }
      saveToolPresets({ tools, last_variants }).catch(() => {});
    } else if (chrome?.storage?.local) {
      this.#savePresetsToStorage();
    } else if (typeof localStorage !== "undefined") {
      this.#savePresetsToLocalStorage();
    }
  }

  async #loadPresetsFromStorage(): Promise<void> {
    try {
      const data = await chrome.storage.local.get(["toolPresets", "toolLastVariants"]);
      const presets = data.toolPresets as Record<string, unknown> | undefined;
      if (presets) {
        for (const [rawId, p] of Object.entries(presets)) {
          const id = migrateLegacyPresetKey(rawId);
          const fields = this.#presetFieldsForKey(id);
          if (fields.length === 0) continue;
          const partial = presetFromWire(p as Record<string, unknown>, fields, "camel");
          this.#presets.set(id, this.#presetFromPartial(partial));
        }
      }
      const lastVariants = data.toolLastVariants as Record<string, string> | undefined;
      if (lastVariants) {
        for (const [toolId, variant] of Object.entries(lastVariants)) {
          this.#lastVariantByTool.set(toolId, variant);
        }
      }
      for (const id of this.#tools.keys()) this.#syncToolButtonIcon(id);
    } catch {
      // Storage error, use defaults
    }
  }

  #savePresetsToStorage(): void {
    const presets: Record<string, unknown> = {};
    for (const [id, opts] of this.#presets) {
      const fields = this.#presetFieldsForKey(id);
      if (fields.length === 0) continue;
      presets[id] = presetToWire(opts, fields, "camel");
    }
    const lastVariants: Record<string, string> = {};
    for (const [toolId, variant] of this.#lastVariantByTool) {
      lastVariants[toolId] = variant;
    }
    chrome.storage.local
      .set({
        toolPresets: presets,
        toolLastVariants: lastVariants,
      })
      .catch(() => {});
  }

  /** Storage key for the plain-Web persistence backend. Namespaced
   *  (`annot.` prefix) so it doesn't collide with other site data on
   *  the same origin. Versioned so a future schema migration can be
   *  detected by reading an alternate key. */
  static #LOCAL_STORAGE_KEY = "annot.toolPresets.v1";

  /** Load presets + last-used variants from `localStorage`. Used by
   *  plain-Web and PWA runtimes that don't have Tauri's filesystem
   *  API or the extension's `chrome.storage`. */
  #loadPresetsFromLocalStorage(): void {
    try {
      const raw = localStorage.getItem(Toolbar.#LOCAL_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as {
        tools?: Record<string, Record<string, unknown>>;
        lastVariants?: Record<string, string>;
      };
      if (data.tools) {
        for (const [rawKey, p] of Object.entries(data.tools)) {
          const key = migrateLegacyPresetKey(rawKey);
          const fields = this.#presetFieldsForKey(key);
          if (fields.length === 0) continue;
          const partial = presetFromWire(p, fields, "camel");
          this.#presets.set(key, this.#presetFromPartial(partial));
        }
      }
      if (data.lastVariants) {
        for (const [toolId, variant] of Object.entries(data.lastVariants)) {
          this.#lastVariantByTool.set(toolId, variant);
        }
      }
      for (const id of this.#tools.keys()) this.#syncToolButtonIcon(id);
    } catch {
      // Corrupted JSON or storage quota — fall back to defaults.
    }
  }

  /** Persist presets + last-used variants to `localStorage`. Payload
   *  is small (usually < 10KB total) so we don't worry about the
   *  5-10MB quota here. Writes are best-effort — if quota is
   *  exhausted we silently drop the save rather than blocking
   *  interaction. */
  #savePresetsToLocalStorage(): void {
    try {
      const tools: Record<string, unknown> = {};
      for (const [id, opts] of this.#presets) {
        const fields = this.#presetFieldsForKey(id);
        if (fields.length === 0) continue;
        tools[id] = presetToWire(opts, fields, "camel");
      }
      const lastVariants: Record<string, string> = {};
      for (const [toolId, variant] of this.#lastVariantByTool) {
        lastVariants[toolId] = variant;
      }
      localStorage.setItem(Toolbar.#LOCAL_STORAGE_KEY, JSON.stringify({ tools, lastVariants }));
    } catch {
      // Quota exceeded or storage disabled (private mode / 3rd-party
      // context) — silent. Presets still work in-session via the
      // in-memory Map; they just won't survive a reload.
    }
  }

  /** Activate a tool by its ID (used after closing dropdown) */
  #activateToolById(toolId: string): void {
    const def = this.#tools.get(toolId);
    if (!def) return;
    const btn = this.#container.querySelector(
      `[data-tool="${toolId}"]`,
    ) as HTMLButtonElement | null;
    if (!btn) return;

    // Same as the main btn click handler: load the preset for this
    // tool's CURRENT VARIANT, then activate.
    const preset = this.#getCurrentPreset(toolId);
    Object.assign(this.#options, preset);

    const tool = def.factory(this.#options);
    tool.onShapeComplete = (el?: SVGElement) => {
      this.#saveCurrentPreset(toolId, this.#options);
      this.#savePresetsToFile();
      if (this.#selectBtn) this.#activate(null, this.#selectBtn, "Select");
      if (el) this.#selection.select(el);
    };
    this.#activate(tool, btn, def.label);
  }

  // =======================================================================
  // Per-element preset helpers.
  //
  // The preset system is keyed by "element key" — a string like
  // "shape.rect" / "arrow.end" / "text.callout" that uniquely identifies
  // both the tool AND its currently-active variant. Element keys:
  //   - Tools with variants:  `${toolId}.${variant}`
  //   - Tools without variants: `${toolId}` (e.g. "crop", "highlight")
  //
  // The helpers below hide the key computation from callers: they just
  // say "give me the preset for tool X" and the right one for the
  // current variant is returned.
  // =======================================================================

  /** Compute the element key for a tool based on the currently-tracked
   *  last-used variant. Returns the bare tool ID for tools without
   *  variants. */
  #currentElementKey(toolId: string): string {
    const meta = TOOL_REGISTRY[toolId];
    if (!meta?.variants || !meta.defaultVariant) return toolId;
    const variant = this.#lastVariantByTool.get(toolId) || meta.defaultVariant;
    return `${toolId}.${variant}`;
  }

  /** Read the preset for a tool's current variant. Falls back to a
   *  copy of the global defaults (`this.#options`) when no preset has
   *  been saved for this (tool, variant) combination yet — this is
   *  the first-use seed path. */
  #getCurrentPreset(toolId: string): ToolOptions {
    const key = this.#currentElementKey(toolId);
    const stored = this.#presets.get(key);
    return stored ? { ...stored } : { ...this.#options };
  }

  /** Persist a preset under the tool's CURRENT variant key. */
  #saveCurrentPreset(toolId: string, preset: ToolOptions): void {
    const key = this.#currentElementKey(toolId);
    this.#presets.set(key, { ...preset });
  }

  /** Switch a tool to a different variant. Saves the CURRENT preset
   *  under the OLD variant's key (capturing any in-flight edits),
   *  then returns the NEW variant's preset — loaded from storage if
   *  one exists, or seeded from the current preset (with the variant
   *  field updated) if this is the first use.
   *
   *  Callers should `Object.assign(this.#options, returnedPreset)` (or
   *  mutate their local preset object) and then re-activate the tool
   *  so the change takes effect. */
  #changeVariant(toolId: string, newVariant: string, currentPreset: ToolOptions): ToolOptions {
    const meta = TOOL_REGISTRY[toolId];
    if (!meta?.variants) {
      // No-op for tools without variants — just return current preset.
      return currentPreset;
    }

    // Step 1: save current preset under OLD variant's key.
    const oldKey = this.#currentElementKey(toolId);
    this.#presets.set(oldKey, { ...currentPreset });

    // Step 2: update last-used variant tracking.
    this.#lastVariantByTool.set(toolId, newVariant);

    // Step 3: load new variant's preset, or seed from current.
    // Pure merge + invariant normalisation lives in
    // `mergePresetForVariantChange` (toolbar-preset-helpers) so the
    // logic can be unit-tested without standing up a Toolbar.
    const newKey = this.#currentElementKey(toolId);
    const stored = this.#presets.get(newKey);
    const result = mergePresetForVariantChange(currentPreset, stored, toolId, newVariant);
    // Persist so later reads (e.g. #activateToolById via
    // #getCurrentPreset) see the same values the caller is about to
    // apply.
    this.#presets.set(newKey, result);
    return result;
  }

  /** In-panel variant chip handler — swap the tool's variant, mutate
   *  the captured preset reference so sibling controls stay in sync,
   *  persist, and re-activate the tool so the right panel re-renders
   *  with the new variant's saved values. Without the re-activate,
   *  the panel's other controls (Color / Width / …) would continue
   *  to show the OLD variant's values and writes to them would
   *  overwrite the just-switched-to variant's preset. */
  #handlePanelVariantChange(toolId: string, newVariant: string, preset: ToolOptions): void {
    const next = this.#changeVariant(toolId, newVariant, preset);
    // Mutate the captured `preset` object in place so any closures
    // that still hold a reference see the new values.
    for (const k of Object.keys(preset)) delete (preset as unknown as Record<string, unknown>)[k];
    Object.assign(preset, next);
    this.#savePresetsToFile();
    this.#syncToolButtonIcon(toolId);
    // Re-activate to trigger a panel re-render with the new variant's
    // saved style (Color / Width / etc.). Without this, the other
    // property controls would still show the OLD variant's values.
    this.#activateToolById(toolId);
  }

  #btn(icon: string, title: string): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = "toolbar-btn material-symbols-outlined";
    // Custom CSS tooltip (via data-tooltip) + aria-label, NOT the
    // native `title` attribute. See utils/tooltip.ts for rationale.
    setTooltip(b, title);
    b.textContent = icon;
    return b;
  }

  #sep(): HTMLDivElement {
    const d = document.createElement("div");
    d.className = "toolbar-separator";
    return d;
  }

  #div(cls: string): HTMLDivElement {
    const d = document.createElement("div");
    d.className = cls;
    return d;
  }

  // =======================================================================
  // Canvas right-click context menu.
  //
  // Two modes, decided by what the user right-clicked on:
  //
  // (1) RIGHT-CLICK ON EMPTY CANVAS — "toolbox menu".
  //     Mirrors the toolbar 1:1: every tool button becomes a top-level
  //     row, with submenus for tools that have toolbar flyouts. Click
  //     activates the tool (and remembers the variant), just like the
  //     toolbar button.
  //
  // (2) RIGHT-CLICK ON AN ANNOTATION — "selection action menu".
  //     If the clicked element isn't already in the selection, it
  //     becomes the new selection first. The menu then exposes the
  //     actions already bound to keyboard shortcuts — clipboard,
  //     duplicate, delete, z-order, align/distribute, group, flip —
  //     so they're discoverable without memorizing shortcuts.
  // =======================================================================

  /** Entry point for canvas right-clicks. Branches on whether the
   *  click landed on an annotation (→ selection menu) or empty space
   *  (→ toolbox menu). `pt` is in SVG-viewBox space; only used by
   *  future actions that care about the click location. */
  #openInsertHereMenu(e: MouseEvent, pt: DOMPoint): void {
    openCanvasRightClickMenu(e, pt, {
      canvas: this.#canvas,
      selection: this.#selection,
      history: this.#history,
      tools: this.#tools,
      getCurrentPreset: (id) => this.#getCurrentPreset(id),
      activateToolWithVariant: (id, v) => this.#activateToolWithVariant(id, v),
    });
  }

  /** Activate a tool (optionally switching its variant) — behaviorally
   *  identical to clicking the tool's button (and, when `variant` is
   *  given, its flyout chip) in the toolbar. We:
   *   1. Record the chosen variant as last-used so `#getCurrentPreset`
   *      returns the matching preset.
   *   2. Refresh the toolbar button icon so the user sees the new
   *      variant reflected there too.
   *   3. Delegate to `#activateToolById`, which loads the preset,
   *      creates the tool instance, wires `onShapeComplete`, and
   *      marks the button active. */
  #activateToolWithVariant(toolId: string, variant: string | undefined): void {
    if (variant !== undefined && TOOL_REGISTRY[toolId]?.variants) {
      this.#lastVariantByTool.set(toolId, variant);
      this.#syncToolButtonIcon(toolId);
    }
    this.#activateToolById(toolId);
  }
}
