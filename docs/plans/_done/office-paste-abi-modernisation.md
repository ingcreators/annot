# Office-paste ABI — modernise the TS↔Rust shape contract

> **Status:** Done. Landed across PRs
> [#202](https://github.com/ingcreators/annot/pull/202)–
> [#210](https://github.com/ingcreators/annot/pull/210). Each
> phase landed as its own squash-merge with the same
> "byte-equivalent unless the PR description calls out a
> change" contract, verified by an `insta` golden snapshot of
> the GVML drawing XML.
>
> **Risk:** Low-medium. The Office-paste path is exercised
> only on Tauri desktop (`Ctrl+C` → paste into PowerPoint /
> Word / Excel). It has no automated tests today; verification
> is a manual paste smoke-test against each shape kind. Same
> XML output before/after the rename is the migration
> contract — verified by serialising the built drawing XML
> string and comparing against a golden snapshot.

## How to resume in a fresh session

```
"Read docs/plans/office-paste-abi-modernisation.md and start <phase>."
```

## Context

`copyAsOffice` (Tauri command `copy_as_office`) takes a JSON
array of `AnnotationShape` and emits a Microsoft-Office-clipboard
GVML drawing XML so paste lands as native PowerPoint shapes
(rather than a flat PNG). The TS side builds the array in
[`web/toolbar.ts:transformOf`](../../packages/web/src/editor/toolbar.ts:683);
the Rust side parses it into
`packages/desktop/src-tauri/src/commands/clipboard.rs:AnnotationShape`
and dispatches to a per-`type` `gvml_*` emitter.

### Today's contract

| Concept | TS field name | Rust field name | Rust read site |
|---|---|---|---|
| Shape discriminator | `type` | `shape_type` | match arm in `build_gvml_zip` |
| Plain stroke / fill | `stroke`, `fill`, `stroke_width`, … | `stroke`, `fill`, `stroke_width`, … | every emitter |
| Geometry | `x`, `y`, `width`, `height`, `x1..y2`, `cx`, `cy`, `rx`, `ry` | matching | every emitter |
| Counter shape | `marker_shape` (TS-only — Rust struct doesn't model it) | `stroke` carries the shape name | `gvml_marker:611` (`s.stroke == Some("rect")`) |
| Sticky bg color | `text_variant` + `stroke` carrying the bg `fill` | `stroke` carries the bg color | `gvml_text:559` (`s.stroke` parsed as rgba) |
| Mosaic / blur PNG | `image_data_url` (preferred) + `text` (carrier) | `text` only | `build_gvml_zip:247` |
| Freehand `<path d="...">` | `text` carrying the d-string | `text` only | `gvml_freehand:631` |
| Per-end arrow (shape / width / length) | `arrow_shape_*` / `arrow_width_*` / `arrow_length_*` | matching | `gvml_line` via `end_xml` |
| Rounded rect | `type: "rounded-rect"` (a separate type string) | dispatched as `gvml_rect(_, _, true)` | `build_gvml_zip:238` |
| Redact-solid bar | `type: "rect"` + `redact_style: "solid"` (TS-only) | distinguishable only by Rust never reading `redact_style` | `gvml_rect` — no special path, treated as plain rect |
| Stroke opacity | `stroke_opacity_value` (numeric) AND `stroke_opacity` (separate field) | only `stroke_opacity_value` is read | duplication — see "Specifically broken" |

### Specifically broken

1. **`marker_shape` is TS-only.** TS sends both `marker_shape:
   "circle"` and `stroke: "circle"`; Rust reads `stroke ===
   "rect"` to decide between roundRect vs ellipse OOXML
   prst. Adding a third shape ("rounded") works only because
   Rust falls through to the ellipse default.
2. **`image_data_url` is dual-written.** TS sends both
   `image_data_url: href` and `text: href`; Rust ignores
   `image_data_url` entirely and reads `text`.
3. **Sticky/callout bg color travels in `stroke`.** Reasonable
   semantically (it IS a stroke-like outer color), but the name
   is misleading and `text_variant` is set on the TS side
   with no Rust reader. Rust just reads `stroke` to discover
   the bg color.
4. **`stroke_opacity` vs `stroke_opacity_value`.** Two TS
   fields ostensibly carry the same value, but only
   `stroke_opacity_value` is read on the Rust side.
   `stroke_opacity` is a vestige of an older shape that no
   reader claims today.
5. **`redact_style` is TS-only.** TS sets
   `redact_style: "solid"` on a rect to flag it as a redaction
   bar; Rust never reads it. The shape paths through
   `gvml_rect` identically — visually correct because solid
   redactions look identical to a filled rect, but the field
   adds zero information for the Rust emitter.
6. **`tail_x` / `tail_y` callout coordinates are TS-only.** The
   callout-specific tail tip carrier in the TS interface; Rust
   has no reader for them. Callout textboxes are emitted as
   plain roundRect without the tail.
7. **`has_arrow` boolean is the legacy-form discriminator** in
   the same family. After the
   `_done/toolbar-schema.md`-related cleanups stripped the
   `<line marker-end>` form, `has_arrow` is now derived but
   still emitted; Rust reads it inside `gvml_line` to default
   to triangle when no per-end shape is set. Could go away once
   per-end shapes are guaranteed populated for every emitted
   "arrow" shape.

### Why this is a real refactor (not a pre-release cleanup)

Renaming the TS field doesn't help by itself — the Rust struct
deserializes by exact field name, so a TS-only rename breaks
Rust. The fix is symmetric:

1. Add the new field to the Rust struct.
2. Switch the Rust reader to use it (with a fallback to the old
   carrier for one PR cycle).
3. Have the TS side stop dual-writing, then the Rust fallback
   can be removed.

This is a cross-language schema migration with paste-into-Office
testing as the verification gate. It's worth its own plan.

## Goal

A clean, lie-free Office-paste ABI where:

- Each `AnnotationShape` field has ONE name on both sides.
- Field names describe the data (`marker_shape: "rounded"`),
  not the carrier (`stroke: "rounded"`).
- Type strings encode the shape family, not visual variants
  (`type: "rect"` + `corner_radius` instead of `"rounded-rect"`).
- The Rust struct compiles a complete-enough model that adding
  a new shape variant doesn't require renaming carrier fields.

After this plan lands, `web/toolbar.ts:transformOf` should have
no comments saying "carrier field", "Rust side reads from", or
"until the ABI is widened". The Rust struct should declare every
field the TS side emits.

## Constraints

- **Same Office-paste output XML before/after each phase.**
  Verified by a golden test (Phase 0): serialise the GVML
  drawing string for a synthetic 6-shape canvas, snapshot it,
  rerun after each migration. Any diff is intentional and
  called out in the PR.
- **One field-name modernisation per phase.** Each phase is
  independently merge-able + revertable. Land Phase 1 → wait
  for green → Phase 2 → … . No big-bang rename.
- **No new TS↔Rust ABI dialects.** Both sides converge on the
  new field name; the carrier comes out cleanly when
  `copyAsOffice`'s on-disk wire is identical (it isn't —
  Tauri serializes ToolPreset to JSON, not a versioned binary
  format — but the principle "one schema, both sides" still
  holds).
- **No automated paste-into-Office testing.** The Office
  clipboard format requires Windows / OS clipboard simulation
  that isn't feasible in CI today. The verification is a
  manual smoke test on Tauri desktop; the contract for each
  phase is "GVML XML byte-equivalent to before".

## Phases

### Phase 0 — Land the GVML golden test (no migration)

**Goal:** Pin the current XML output as a regression net for
every subsequent phase. Without this, phases land "blind" — a
field-name swap that drops a value silently looks like a clean
diff.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` — make
  `build_gvml_zip` reachable from a Rust unit test by extracting
  the drawing-XML construction into a separate `fn build_drawing_xml(shapes, w, h, has_image) -> String`. The wrapper that
  builds the ZIP keeps the existing entry point.
- `packages/desktop/src-tauri/src/commands/clipboard_test.rs`
  (NEW, behind `#[cfg(test)]`) — synthetic 6-shape input
  exercising every emitter (rect / rounded-rect / ellipse /
  arrow / marker / textbox / mosaic / freehand). Snapshot via
  `insta` (already a workspace dep — verify) or a vendored
  golden-file helper.
- `packages/desktop/src-tauri/Cargo.toml` — add `insta = "1"`
  + `dev-dependencies` block if not already present.

**Acceptance:**

- `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`
  passes.
- The snapshot pins the current XML output literally; a
  follow-up PR that breaks output produces a snapshot diff for
  reviewers to inspect.

### Phase 1 — `marker_shape` becomes the canonical marker
discriminator

**Goal:** Move marker shape detection off `s.stroke == "rect"`
onto a proper `marker_shape: Option<MarkerShape>` field on the
Rust struct.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` —
  - Add `pub marker_shape: Option<String>` to `AnnotationShape`.
  - In `gvml_marker`, prefer `s.marker_shape.as_deref()`; fall
    back to `s.stroke.as_deref() == Some("rect")` for one
    cycle.
  - Extend the `prstGeom` to also handle `"rounded"` (currently
    falls through to ellipse; emit `roundRect` with a higher
    `adj` value for the more rounded look).
- `packages/web/src/editor/toolbar.ts:transformOf` — drop the
  `stroke: shapeName` carrier write. Update the explanatory
  comment.

**Acceptance:**

- Snapshot from Phase 0 matches for circle / rect (no XML diff).
- New snapshot fixture for `marker_shape: "rounded"` produces
  the new `roundRect` XML.
- Manual: paste a Counter (rounded) into PowerPoint Tauri-side,
  verify it shows as a rounded square.

### Phase 2 — `image_data_url` becomes the mosaic/blur carrier

**Goal:** Stop dual-writing the data URL into `text`.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` — add
  `pub image_data_url: Option<String>` field. In the
  `mosaic_image` arm of `build_gvml_zip`, prefer
  `s.image_data_url`, fall back to `s.text` for one cycle.
- `packages/web/src/editor/toolbar.ts:transformOf` — drop the
  `text: href` carrier write.

**Acceptance:**

- Phase 0 snapshot unchanged.
- Manual paste of a mosaic redaction into PowerPoint produces
  the same picture as before.

### Phase 3 — Sticky / callout bg color: `text_bg_color` field

**Goal:** Stop using `stroke` to carry the textbox bg color.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` — add
  `pub text_bg_color: Option<String>`. In `gvml_text`, prefer
  the new field, fall back to `s.stroke`.
- `packages/web/src/editor/toolbar.ts:transformOf` — replace
  the `stroke: …` carrier write for textbox shapes with
  `text_bg_color: …`.

**Acceptance:**

- Phase 0 snapshot unchanged.
- Manual: paste each textbox variant (plain / sticky / callout)
  and verify the bg color matches.

### Phase 4 — Callout tail position lands in Rust

**Goal:** Wire `tail_x` / `tail_y` (already in the TS interface)
into the Rust struct + `gvml_text` so callouts emit a tail.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` —
  - Add `pub tail_x: Option<f64>`, `pub tail_y: Option<f64>`,
    `pub text_variant: Option<String>` fields.
  - In `gvml_text`, when `text_variant === "callout"` and
    tail coordinates are present, switch from
    `prstGeom prst="roundRect"` to `wedgeRoundRectCallout`
    with the tail anchored at `(tail_x, tail_y)`.

**Acceptance:**

- Phase 0 snapshot unchanged for plain / sticky variants.
- New snapshot fixture for callout with tail emits
  `wedgeRoundRectCallout`.
- Manual: paste a callout textbox; verify the tail tip lands
  where the user drew it.

### Phase 5 — Redact-solid: `redact_style` becomes a real
discriminator

**Goal:** Stop emitting redact-solid as plain rect; let Rust
distinguish so future PRs can apply the same DrawingML treatment
as PowerPoint's "rectangle (no outline)" preset (e.g. force
`<a:ln><a:noFill/></a:ln>` regardless of the user's stroke
preset).

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` — add
  `pub redact_style: Option<String>`. In `gvml_rect` /
  matching arm, branch on it for solid redactions: emit no
  outline regardless of `s.stroke_*` fields.
- TS already populates the field. No TS change needed beyond
  updating any "TS-only" comments.

**Acceptance:**

- Phase 0 snapshot unchanged for plain rect / rounded-rect.
- New snapshot fixture for redact-solid produces no
  `<a:ln>` outline on the bar.

### Phase 6 — Drop `type: "rounded-rect"`, prefer `corner_radius`

**Goal:** Two type strings (`"rect"` / `"rounded-rect"`) for
one geometry is redundant. Both go through `gvml_rect` already;
the only difference is `rounded: bool`. The TS interface already
has `corner_radius` for the geometry detail; emit `type: "rect"`
for both, dispatch internally on `corner_radius > 0`.

**Files:**

- `packages/desktop/src-tauri/src/commands/clipboard.rs` —
  - Drop the `"rounded-rect"` arm from `build_gvml_zip`.
  - In `gvml_rect`, branch on `s.corner_radius.unwrap_or(0.0) > 0`
    for the `roundRect` variant.
- `packages/web/src/editor/toolbar.ts:transformOf` — emit
  `type: "rect"` always; drop the rounded-rect ternary.

**Acceptance:**

- Phase 0 snapshot diff: `type: "rect"` for what used to be
  emitted as `"rounded-rect"`. The OOXML output should be
  byte-identical (the rounded-rect XML still has the `roundRect`
  preset).

### Phase 7 — Drop `stroke_opacity` (keep `stroke_opacity_value`)

**Goal:** Two TS fields ostensibly hold the same value, only one
is read. Drop the unread one.

**Files:**

- `packages/core/src/utils/tauri-bridge.ts` — drop
  `stroke_opacity` from the `AnnotationShape` interface
  (keep `stroke_opacity_value`).
- `packages/web/src/editor/toolbar.ts:transformOf` — drop the
  `stroke_opacity` field from every shape literal.

**Acceptance:**

- Phase 0 snapshot unchanged (Rust never read the dropped
  field).
- TypeScript build proves no other reader was using
  `stroke_opacity`.

### Phase 8 — Cleanup + plan archival

**Files:**

- `packages/web/src/editor/toolbar.ts:transformOf` — final
  pass: every comment that calls a field a "carrier" /
  "legacy" / "Rust side reads from" gets refreshed since
  phases 1–7 made each field self-explanatory.
- `packages/core/src/utils/tauri-bridge.ts` — `AnnotationShape`
  interface header drops the "Rust handlers can adopt the
  richer metadata incrementally" disclaimer (the Rust struct
  is now in lockstep).
- `packages/desktop/src-tauri/src/commands/clipboard.rs` —
  remove the one-cycle fallback reads (`.or(s.stroke...)`,
  `.or(s.text...)`) added in phases 1 / 2 / 3.
- Move
  [`docs/plans/office-paste-abi-modernisation.md`](./office-paste-abi-modernisation.md)
  → `docs/plans/_done/office-paste-abi-modernisation.md` with
  status header noting the landing PR range.
- Update `docs/plans/README.md` index.

## Out of scope

- **Adding new visual features to the Office-paste output**
  (e.g. true gradient support inside textboxes, transparent
  rectangles via DrawingML alpha modifiers). Each is a
  follow-up plan; this one only modernises the existing
  feature set's ABI.
- **Replacing the Office-paste path with a native OOXML SDK**
  (e.g. `quick-xml`-based templating). The hand-rolled string
  builders work; refactoring them is its own concern.
- **Adding paste-into-Word support** for things that currently
  paste only into PowerPoint correctly. Tracked separately.
- **Cross-platform Office-paste support** (currently Tauri /
  Windows-only via `set_clipboard_all`). macOS / Linux support
  is a separate plan.

## Reference: existing code to read

Before starting, read these in this order:

1. [`packages/desktop/src-tauri/src/commands/clipboard.rs`](../../packages/desktop/src-tauri/src/commands/clipboard.rs) —
   the Rust entry point. `AnnotationShape` struct + per-shape
   `gvml_*` emitters. The Phase 0 golden test wraps
   `build_gvml_zip` (or its extracted XML half).
2. [`packages/web/src/editor/toolbar.ts:683-984`](../../packages/web/src/editor/toolbar.ts) —
   the TS payload builder (`#copyAll` → `transformOf` → the
   shape-literal emit per `el`). This is what the
   modernisation refactors against on the TS side.
3. [`packages/core/src/utils/tauri-bridge.ts:287-390`](../../packages/core/src/utils/tauri-bridge.ts) —
   the TS `AnnotationShape` interface. Each phase brings the
   Rust struct closer to this declaration.
4. PRs [#180](https://github.com/ingcreators/annot/pull/180)–[#186](https://github.com/ingcreators/annot/pull/186) —
   the schema-lock series this plan is the natural successor
   to. PR [#184](https://github.com/ingcreators/annot/pull/184)
   in particular flagged the "ABI carrier" issue and is the
   direct kickoff for this work.

## Status log

- 2026-04-26 — Plan drafted as the queued follow-up to the
  pre-release schema-lock series. Same "drop legacy" spirit,
  but each step is a real cross-language ABI migration with
  paste-into-Office verification, not a single-side delete.
