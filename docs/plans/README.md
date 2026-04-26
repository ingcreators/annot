# Plans

> Design documents for queued and in-progress work. Each plan is a
> living doc — update the status header when state changes, and move
> to `_done/` when landed so the active list stays scannable.

Plans sit between `PRODUCT_DIRECTION.md` (the "why") and the code
(the "how it ended up"). They capture the "how we intend to do it"
before implementation, which is invaluable for:

- Landing big refactors cohesively (no half-merged states).
- Sharing intent when multiple sessions / contributors iterate.
- Letting Claude Code read the plan and resume work across context
  resets.

## Active plans

Plans being discussed (`Draft`), waiting for an implementation
window (`Queued`), or actively shipping (`In progress`).

| Plan | Status | Summary |
|------|--------|---------|
| [`pre-release-cleanup.md`](./pre-release-cleanup.md) | Queued | Senior-engineer audit follow-through: four stages (hygiene → `StorageProvider` capability split → god-module decomposition → `core`↔`web` boundary fix). Each stage independently revertable; no data migration; touches every package. |
| [`desktop-browser-mode.md`](./desktop-browser-mode.md) | Queued | Bring the Tauri desktop to full extension-capture parity by extracting `@ingcreators/annot-capture` (orchestration + content scripts + encoding) and adding a Tauri host adapter with per-OS native capture commands. Windows-first; Browse window is Chrome-style tabbed with `window.open` / OAuth popups handled in-window. Extension and desktop both consume the shared package. |
| [`path-based-storage.md`](./path-based-storage.md) | Queued | Drop numeric IDs across all storage implementations; use filesystem-style paths as primary key. Prerequisite for `GitHubStore`. |
| [`google-drive-integration.md`](./google-drive-integration.md) | Draft | Rework the Drive backend onto the non-sensitive `drive.file` scope + Workspace Marketplace + Drive UI Integration so Annot can ship publicly without a restricted-scope CASA audit. |
| [`oss-cloud-split.md`](./oss-cloud-split.md) | Draft | Forward-looking strategy for keeping Annot OSS while developing paid features in a separate private `annot-cloud` repo. Guardrails apply from today; concrete phases trigger on "first paid feature" and "company incorporation". |
| [`github-integration.md`](./github-integration.md) | Draft | Individual-user `GitHubStore` — device-flow auth, pick repo + branch + base path, commits as save. Drive-integration-equivalent scope. PR automation / Check Runs / org admin live in `annot-cloud`, not here. Phases 1–3 landed (#36–#38); Phase 4 polish in progress. |

## Recently landed plans

Most recent entries in [`_done/`](./_done/), newest first. The
historic full list is the directory itself; this table is the
"first-page" view a reader scanning the repo will see.

| Plan | Landed | Summary |
|------|--------|---------|
| [`_done/office-paste-abi-modernisation.md`](./_done/office-paste-abi-modernisation.md) | 2026-04-26 | Cross-language ABI cleanup. Nine phases (0–8) lifting the Office-paste TS↔Rust shape contract off legacy carrier fields: phase 0 pins a GVML XML golden snapshot via `insta`; phases 1–7 migrate `marker_shape`, `image_data_url`, `text_bg_color`, callout tail, `redact_style`, `corner_radius`, and drop unused `stroke_opacity` — each gated by byte-equivalent goldens; phase 8 deletes the one-cycle fallbacks. PRs [#202](https://github.com/ingcreators/annot/pull/202)–[#210](https://github.com/ingcreators/annot/pull/210). After landing, every TS field has a matching Rust field; no comments saying "Rust side reads from" / "carrier field". Also unlocks `marker_shape: "rounded"` (visibly rounded counter) and pasted callouts now keep their tail (`wedgeRoundRectCallout`). |
| [`_done/toolbar-highlight-flyout-kind.md`](./_done/toolbar-highlight-flyout-kind.md) | 2026-04-26 | Cleanup follow-up to `_done/toolbar-schema.md` + `_done/toolbar-apply-style-to-element.md`. Five phases lifting the last residual `if (toolId === "highlight")` branch sites in [`toolbar.ts`](../../packages/web/src/editor/toolbar.ts) + [`toolbar-canvas-menu.ts`](../../packages/web/src/editor/toolbar-canvas-menu.ts) onto new `ToolRegistryEntry` fields: `flyoutKind: "variant" \| "color"` discriminator + `chipColorForVariant` / `tooltipLabelForVariant` / `ensurePresetForVariantChange` accessors. PRs [#197](https://github.com/ingcreators/annot/pull/197)–TBD. New structural test in `packages/web/src/editor/toolbar.test.ts` greps both source files for the forbidden `toolId === "<id>"` literal — adding a future swatch-style tool (Stamp, Pen color, …) is one TOOL_REGISTRY entry, no copy-paste. |
| [`_done/toolbar-apply-style-to-element.md`](./_done/toolbar-apply-style-to-element.md) | 2026-04-26 | Closes the read/write asymmetry the toolbar's schema migration left open. Four phases adding `applyStyleToElement?: (el, preset) => void` to `ToolRegistryEntry` as the inverse of the existing `extractStyleFromElement`, then collapsing `applyPresetStyleAttrs` / `applyMarkerPresetStyle` / `applyTextboxPresetStyle` (~120 LOC of element-tag cascade) into a generic registry dispatch. PRs [#193](https://github.com/ingcreators/annot/pull/193)–[#196](https://github.com/ingcreators/annot/pull/196). Structural test in `tool-registry.test.ts` enforces every extractor has a paired writer; `toolbar-preset-helpers.ts` shrank from 322 → 122 LOC. |
| [`_done/tool-property-renderer-schema.md`](./_done/tool-property-renderer-schema.md) | 2026-04-26 | Closing piece of the schema-driven trilogy. Five phases declarativising the Tool-side per-tool property panel: Tier B `panelControls` per `TOOL_REGISTRY` entry, Tier B `TOOL_PANEL_ADAPTERS` writing onto `ToolOptions`, `selectionDefMetadata` bridging label / options / ranges / `allowNone` from the SELECTION registry. PRs [#188](https://github.com/ingcreators/annot/pull/188)–[#192](https://github.com/ingcreators/annot/pull/192). The 649-LOC imperative cascade in `tool-property-renderer.ts` is gone; adding a new tool control is one entry in the registry + one matching adapter. |
| [`_done/toolbar-schema.md`](./_done/toolbar-schema.md) | 2026-04-26 | Sibling to `_done/property-panel-schema.md`. Six phases applying the same registry-driven pattern to `packages/web/src/editor/toolbar.ts`. Tier B `TOOL_REGISTRY` consolidates id / label / icon / variants / preset fields / element classifier / style extractor; generic `presetToWire` / `presetFromWire` replace the manual ~25-field marshallers; Tier C `tool-factories.ts` holds `CanvasManager`-bound factories. `toolbar-variants.ts` deleted. PRs [#166](https://github.com/ingcreators/annot/pull/166)–[#171](https://github.com/ingcreators/annot/pull/171). `toolbar.ts` shrank from 2,181 → ~1,996 LOC. |
| [`_done/property-panel-schema-extensions.md`](./_done/property-panel-schema-extensions.md) | 2026-04-26 | Follow-up to `_done/property-panel-schema.md`. Three phases extending the registry to cover the residual imperative rows: marker bg-primitive controls (#162), shape transparency / cap type + arrow-aware augmentations (#163), per-end arrow type+size pulldowns with dynamic `getOptions` (#164). `property-panel.ts` shrank from 1,377 → 991 LOC across the series; total reduction across the schema-driven migration + extensions is 826 LOC vs the original 1,817 baseline. |
| [`_done/property-panel-schema.md`](./_done/property-panel-schema.md) | 2026-04-26 | Schema-driven render for `PropertyPanel` — declarative `PROPERTY_CONTROLS` registry in Tier B + free-function renderer in Tier C. Closing piece of the testability series (proposal 8). Phases 1–4 landed in [#153](https://github.com/ingcreators/annot/pull/153)–[#161](https://github.com/ingcreators/annot/pull/161). Every category in `CATEGORY_CONTROL_SHAPE` now routes through `#renderViaRegistry` → `renderControl`; `property-panel.ts` shrank from 1,817 → ~1,580 LOC, with the residual being imperative rows the registry doesn't yet model (transparency, cap type, per-end arrow grids, marker bg-primitive). |
| [`_done/three-package-split.md`](./_done/three-package-split.md) | 2026-04-26 | Split `core/editor/` into TWO new workspace packages: `@ingcreators/annot-editor` (live-browser editor primitives) and `@ingcreators/annot-render` (data-driven `ImageRecord` rendering — gallery bulk-export's future home). Phase 0 scaffold + Phase 1–8 moves + Phase 9 docs landed in [#128](https://github.com/ingcreators/annot/pull/128)–[#137](https://github.com/ingcreators/annot/pull/137). CI-enforced cycle invariant in `packages/core/src/headless.test.ts` keeps `annot-core` decoupled from the editor / render packages. |
| [`_done/source-audit-cleanup.md`](./_done/source-audit-cleanup.md) | 2026-04-25 | Repo-hygiene + presentation pass for corporate adoption auditing. All seven phases shipped in [#100](https://github.com/ingcreators/annot/pull/100)–[#106](https://github.com/ingcreators/annot/pull/106): Apache-2.0 LICENSE + audit-facing root docs, plan-status hygiene, centralised logger shim, `any` triage in toolbar.ts and outside, `assertNonNull` helper + fragile DOM-lookup guards, README "for evaluators" section. |
| [`_done/lit-migration.md`](./_done/lit-migration.md) | 2026-04-25 | Multi-phase migration of `packages/web` UI from imperative DOM to Lit Web Components. All seven phases (0–6) shipped in [#85](https://github.com/ingcreators/annot/pull/85)–[#93](https://github.com/ingcreators/annot/pull/93); follow-up corner-case fixes in [#94](https://github.com/ingcreators/annot/pull/94)–[#98](https://github.com/ingcreators/annot/pull/98). |
| [`_done/storybook-introduction.md`](./_done/storybook-introduction.md) | 2026-04-25 | Storybook bootstrap in `packages/web` as the component showroom + visual-regression net for the Lit migration. Phase 1 landed in [#84](https://github.com/ingcreators/annot/pull/84); Phase 2 (CI-blocking) and beyond are explicitly optional follow-ups. |
| [`_done/plugin-ui-slots.md`](./_done/plugin-ui-slots.md) | 2026-04-25 | Drawer + right-panel become generic `UISection` hosts. Built-ins migrated; plugins register via split `addDrawerSection` / `addRightPanelSection`. Phases 1–3 landed in [#80](https://github.com/ingcreators/annot/pull/80)–[#82](https://github.com/ingcreators/annot/pull/82); optional Phase 4 polish deferred. |
| [`_done/plugin-sidebar-tabs.md`](./_done/plugin-sidebar-tabs.md) | 2026-04-25 | Sidebar "Views" section + section-priority ordering + setter-based tab API + built-in "Recent" tab. Phase 1 landed in [#78](https://github.com/ingcreators/annot/pull/78); optional Phase 2 visual polish deferred. |
| [`_done/plugin-storage-registration.md`](./_done/plugin-storage-registration.md) | 2026-04-25 | Open `storage/bridge.ts` to plugin-registered backends so `annot-cloud`'s pointer-commit store can land without a fork. Phases A, B, C landed in [#74](https://github.com/ingcreators/annot/pull/74)–[#76](https://github.com/ingcreators/annot/pull/76). |
| [`_done/app-decomposition.md`](./_done/app-decomposition.md) | 2026-04-25 | Break `packages/web/src/app.ts` (2.6k lines) into collaborator modules and ship a `PluginHost` MVP. Phases 0–5 + a 3.5 follow-up landed in [#65](https://github.com/ingcreators/annot/pull/65)–[#72](https://github.com/ingcreators/annot/pull/72); the three Phase-5 readiness-gate items each got their own follow-up plan (also landed). |

## Plan lifecycle

- **Draft** — being discussed, not yet decided.
- **Queued** — approved, waiting for implementation window.
- **In progress** — actively being implemented; link to tracking
  branch / PR if any.
- **Done** — landed; move the file to `_done/` and leave a one-line
  pointer in the table above if it's historically important.
- **Abandoned** — move to `_done/` with an `ABANDONED:` prefix in
  the file header explaining why.

## Adding a plan

Start the plan file with this header:

```markdown
# <title>

> **Status:** Draft | Queued | In progress | Done | Abandoned
> **Compatibility:** Which packages / systems are affected.
> **Risk:** Single landing vs phased, data migration needs,
>           breaking changes.

## Context
...

## Design
...

## Phased plan
...

## Verification
...

## Migration notes
...
```

Keep plans self-contained — future readers (including Claude Code
after context reset) should be able to execute from the plan alone
without chasing through chat history. Include:

- Rationale for non-obvious design choices.
- File paths that will be touched.
- Forward-looking notes (e.g. "how this enables X later").
