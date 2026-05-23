/**
 * OverlayTool — Phase 4d of
 * [`docs/plans/living-spec-authoring-roadmap.md`](../../../docs/plans/living-spec-authoring-roadmap.md).
 *
 * Lives differently from the other tools in this directory: it
 * doesn't paint SVG annotations onto the canvas. Instead it
 * orchestrates the snapshot-region pick flow:
 *
 *   1. On activation, the tool calls
 *      `context.mountSnapshotPicker(container, elementTree)` which
 *      returns a picker `HTMLElement` (typically
 *      `<annot-snapshot-overlay>` from host-ui) + an `unmount`
 *      function. The tool subscribes to the picker's
 *      `overlay-region-pick` event.
 *   2. The picker handles its own hover / click and fires
 *      `overlay-region-pick`.
 *   3. The tool builds an {@link OverlayProposal} (match key from
 *      `role` + `name`, auto-assigned number = `max(existing) + 1`)
 *      and asks `openIntentDialog` to resolve the user's intent
 *      choice.
 *   4. On confirm, the tool calls `onCommit` with the resolved
 *      `OverlayEntry`; the shell (Phase 4e) wires the writer call.
 *   5. On cancel (dialog returns `null`), the tool just resets —
 *      no commit, no SVG mutation, no history entry.
 *
 * Pointer events on the canvas are no-ops while the tool is
 * active — the picks come from the picker element, not the canvas.
 *
 * The tool deliberately uses a `mountSnapshotPicker` factory
 * injected via context instead of importing the
 * `<annot-snapshot-overlay>` Lit element directly. host-ui already
 * depends on editor; importing host-ui from editor would form a
 * cycle. The Phase 4e shell wiring supplies the factory.
 */

import type { OverlayRegionPickDetail } from "@ingcreators/annot-core/editor";
import type { ElementTree } from "@ingcreators/annot-core/element-tree";
import { ToolBase } from "./tool-base.js";

/**
 * One Phase 2a overlay entry. Re-declared here (instead of
 * imported from `@ingcreators/annot-product-docs`) to keep
 * `@ingcreators/annot-editor` free of the product-docs dep —
 * the shell composes the entry into the full `AnnotationsFile`
 * via Phase 4b's writer.
 */
export interface OverlayEntry {
  id: string;
  kind: "numberedBadge";
  match: MatchKey;
  intent?: OverlayIntent;
  number: number;
}

export interface MatchKey {
  role: string;
  name?: string;
}

export type OverlayIntent = "required" | "action" | "info";

/**
 * Snapshot pick the tool received, normalized into a
 * "proposed overlay" the intent dialog renders. The proposed
 * `match` is derived from the node's `role` + `name`; the
 * proposed `number` is `max(existing.number, 0) + 1`. Both are
 * deterministic so the dialog can preview them without any
 * additional async work.
 */
export interface OverlayProposal {
  /** Source node's tree-unique ref (debug surface only). */
  ref: string;
  /** Snapshot region's role — drives the dialog's title text. */
  role: string;
  /** Snapshot region's accessible name, when present. */
  name?: string;
  /** Proposed match key to land in the yaml. */
  proposedMatch: MatchKey;
  /** Auto-assigned badge number (1 when no existing overlays). */
  proposedNumber: number;
}

/**
 * Handle returned by `mountSnapshotPicker`. The picker `element`
 * is the actual DOM node the tool subscribes to (must dispatch
 * `overlay-region-pick` CustomEvents); `unmount` removes the
 * element + any host-side bookkeeping.
 */
export interface SnapshotPickerHandle {
  element: HTMLElement;
  unmount: () => void;
}

/**
 * Host-supplied context for the OverlayTool. Wires the tool to
 * the editor shell's current image + existing overlay set +
 * commit handler. Set after construction via `setContext` so the
 * tool doesn't depend on this data at instantiation time.
 */
export interface OverlayToolContext {
  /**
   * The container into which the picker is mounted. Production
   * wires this to a sibling of `#svg-root` with `position: relative`
   * styling; tests pass any HTMLElement.
   */
  overlayContainer: HTMLElement;
  /** The ElementTree associated with the active image. */
  elementTree: ElementTree | undefined;
  /** Existing overlay entries from the loaded yaml; drives the
   *  auto-assigned number for new picks. */
  existingOverlays: readonly OverlayEntry[];
  /**
   * Factory that creates + mounts the snapshot region picker
   * element. Injected so the editor package doesn't depend on
   * host-ui directly (avoids the host-ui → editor / editor →
   * host-ui cycle). Phase 4e supplies a factory that mounts
   * `<annot-snapshot-overlay>` from `@ingcreators/annot-host-ui`.
   */
  mountSnapshotPicker: (
    container: HTMLElement,
    elementTree: ElementTree | undefined,
  ) => SnapshotPickerHandle;
  /**
   * Open an intent picker dialog for the proposed overlay. Resolves
   * to the user's confirmed `OverlayEntry` (with id set by the
   * caller — typically `"o<N>"`) or `null` on cancel. Injected so
   * the host can render a Lit-flavoured dialog without coupling
   * the editor package to host-ui directly, AND so tests can stub
   * the picker cleanly.
   */
  openIntentDialog: (proposal: OverlayProposal) => Promise<OverlayEntry | null>;
  /** Called with the user-confirmed entry. Awaited so the shell
   *  can persist via the Phase 4b writer before the next pick. */
  onCommit: (entry: OverlayEntry) => void | Promise<void>;
}

export class OverlayTool extends ToolBase {
  readonly name = "overlay";

  #context: OverlayToolContext | null = null;
  #picker: SnapshotPickerHandle | null = null;
  #onPick: ((e: Event) => void) | null = null;

  /** Wire the tool to its host context. Must be called before the
   *  tool is activated; calling while active replaces the active
   *  context AND re-mounts the picker so the new tree takes
   *  effect immediately. */
  setContext(context: OverlayToolContext): void {
    this.#context = context;
    if (this.#picker) {
      // Re-mount with the fresh context's tree / container.
      this.#tearDownPicker();
      this.#mountPicker();
    }
  }

  override onActivate(): void {
    if (!this.#context) return;
    this.#mountPicker();
  }

  override onDeactivate(): void {
    this.#tearDownPicker();
  }

  onPointerDown(): void {
    /* no-op — picks come from the snapshot picker element. */
  }
  onPointerMove(): void {
    /* no-op */
  }
  onPointerUp(): void {
    /* no-op */
  }

  /**
   * Public entry point exposed for test harnesses + future
   * keyboard-driven pick flows (e.g. arrow-key navigation through
   * snapshot regions). Production code reaches this same handler
   * via the `overlay-region-pick` DOM event.
   */
  async handlePick(detail: OverlayRegionPickDetail): Promise<void> {
    if (!this.#context) return;
    const proposal = this.buildProposal(detail);
    const entry = await this.#context.openIntentDialog(proposal);
    if (!entry) return;
    await this.#context.onCommit(entry);
  }

  /** Compute the proposal for a snapshot pick — pure function,
   *  exposed for tests + future tools that want to reuse the
   *  auto-assignment logic without touching the dialog flow. */
  buildProposal(detail: OverlayRegionPickDetail): OverlayProposal {
    if (!this.#context) {
      throw new Error("OverlayTool.buildProposal called before setContext()");
    }
    const proposedMatch: MatchKey = { role: detail.role };
    if (detail.name) proposedMatch.name = detail.name;
    const maxExisting = this.#context.existingOverlays.reduce(
      (acc, entry) => (entry.number > acc ? entry.number : acc),
      0,
    );
    const proposal: OverlayProposal = {
      ref: detail.ref,
      role: detail.role,
      proposedMatch,
      proposedNumber: maxExisting + 1,
    };
    if (detail.name) proposal.name = detail.name;
    return proposal;
  }

  #mountPicker(): void {
    if (!this.#context) return;
    const handle = this.#context.mountSnapshotPicker(
      this.#context.overlayContainer,
      this.#context.elementTree,
    );
    this.#onPick = (e: Event): void => {
      const detail = (e as CustomEvent<OverlayRegionPickDetail>).detail;
      // Fire-and-forget: dialog + commit are async, but the DOM
      // event handler shouldn't return a Promise (downstream
      // listeners assume void). Errors surface as unhandled
      // rejections — the host can install a global handler.
      void this.handlePick(detail);
    };
    handle.element.addEventListener("overlay-region-pick", this.#onPick);
    this.#picker = handle;
  }

  #tearDownPicker(): void {
    if (this.#picker) {
      if (this.#onPick) {
        this.#picker.element.removeEventListener("overlay-region-pick", this.#onPick);
        this.#onPick = null;
      }
      this.#picker.unmount();
      this.#picker = null;
    }
  }
}
