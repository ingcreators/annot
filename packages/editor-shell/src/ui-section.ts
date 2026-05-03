/**
 * Host-neutral `UISection` contract — descriptors for sections
 * mounted into the file-details drawer or the editor right-panel.
 *
 * Phase 2b of `docs/plans/_done/vscode-extension-host.md` extracted
 * these types out of `packages/web/src/app/plugin-host.ts` so the
 * shell-side built-in section infrastructure (drawer + right-panel
 * + tool-properties + selection-properties + page-elements + …) can
 * import the contract without depending on the PWA shell. The
 * `plugin-host.ts` re-export keeps the existing
 * `import { UISection } from "../app/plugin-host.js"` import sites
 * compiling untouched.
 *
 * Built-ins describe themselves via the same shape; plugins fill it
 * via `PluginContext.addDrawerSection` / `addRightPanelSection`.
 * The two targets have independent id namespaces — the same id is
 * allowed across targets so a single plugin can use `"comments"`
 * for both surfaces.
 */

/**
 * Per-image context handed to a UI section's `mount` (and to every
 * subsequent `update(ctx)` call on reactive sections). Captures the
 * minimum a typical section needs to render — path, mode, tags —
 * plus a `setTitle` escape hatch for sections whose heading depends
 * on dynamic state (the right-panel's tool-properties / selection-
 * properties sections set their title from the active tool / kind
 * of selection).
 */
export interface UISectionContext {
  /** Path of the open image. Always set when the section is
   *  mounted — sections only render when there's an active editor
   *  session. */
  readonly path: string;
  /** Storage mode at mount / update time. Stable for the section's
   *  lifetime — image swap unmounts + remounts. */
  readonly mode: string;
  /** Snapshot of `tags`. Re-read on each `update(ctx)` call. */
  readonly tags: Readonly<Record<string, string>>;
  /** Override the section heading. Idempotent; calling with the
   *  same string is a no-op. The host re-renders only the heading
   *  element, not the section body. */
  setTitle(title: string): void;
}

/**
 * Lifecycle returned from `UISection.mount`. Plugins pick the shape
 * that fits their needs:
 *
 * - **Function** — simple sections that own their DOM and don't
 *   need notifications when the image state changes. Equivalent
 *   to `{ unmount: fn }`.
 * - **Object** — reactive sections that want to be notified on
 *   rename / save / tag-edit. The host calls `update(ctx)` with a
 *   fresh context, then `unmount()` on session end.
 *
 * The host inspects the return shape: if it's a function, no
 * `update` notifications fire; if it's an object, `update?` runs
 * on every host-level state change.
 */
export type UISectionLifecycle =
  | (() => void)
  | {
      /** Optional. Called when per-image state changes (rename,
       *  save, tag edit). Plugin re-reads from `ctx` and updates
       *  its DOM in place — no remount. */
      update?(ctx: UISectionContext): void;
      /** Called once when the section is unmounted (editor
       *  session ends, opt-out toggled, plugin teardown). */
      unmount(): void;
    };

/**
 * Descriptor for a section in the file-details drawer or the editor
 * right-panel. Built-in sections describe themselves via this same
 * shape (Phase 2 / 3 of `docs/plans/_done/plugin-ui-slots.md` migrate
 * them); plugins fill it from `PluginContext.addDrawerSection` /
 * `addRightPanelSection`. The two targets have independent id
 * namespaces — the same id is allowed across targets so a single
 * plugin can use `"comments"` for both surfaces.
 */
export interface UISection {
  /** Stable id, unique within the section's target namespace.
   *  Plugin-owned namespace — e.g. `"cloud.comments"`. Built-ins
   *  reserve dotted ids: `"drawer.file"` / `"drawer.tags"` /
   *  `"right-panel.tool-properties"` etc. */
  readonly id: string;
  /** Section heading. The host wraps the plugin's mount container
   *  in a section frame matching the existing built-in sections
   *  (heading + content body). Use `ctx.setTitle` to override
   *  later. */
  readonly title: string;
  /** Render order within the target. Lower numbers render first.
   *  Falsy = `+Infinity` (appended last). Stable sort, so ties
   *  fall back to registration order. Built-ins reserve
   *  priorities documented per surface in
   *  `docs/plans/_done/plugin-ui-slots.md`. */
  readonly priority: number;
  /** Mount the section into the supplied container. Returns either
   *  a teardown function (simple) or a lifecycle object with
   *  `update?` + `unmount` (reactive). */
  mount(container: HTMLElement, ctx: UISectionContext): UISectionLifecycle;
  /** Optional: filter at mount time. False skips the section
   *  entirely (no `mount` call, no DOM). Plugins use this for
   *  "hide when no comments exist yet" type cases. Default:
   *  always visible. */
  visible?(ctx: UISectionContext): boolean;
}
