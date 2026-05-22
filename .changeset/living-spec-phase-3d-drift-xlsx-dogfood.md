---
"@ingcreators/annot-product-docs": minor
---

**Annotation palette drift + xlsx coverage (Phase 3d)** — closes
Phase 3 of `docs/plans/living-spec-authoring-roadmap.md`.

### Drift detector — `yamlAnnotations` opt-in

`detectDrift` / `detectDriftFromYaml` / `detectDriftFromElementTree`
gain an optional `yamlAnnotations: readonly AnnotationSpec[]`
field. When set, the detector walks the match keys reachable from
each Phase 3a `AnnotationSpec` (via the new
`collectMatchKeysFromAnnotation(spec) → MatchKey[]` helper) and
runs them through the same match-cycle as overlays — emitting
`removed` / `renamed` / `role-changed` / `duplicated` findings
with the annotation `id` referenced in the message.

Free-coord variants (`bbox`-only rect / `point`-only arrow
endpoint / `at`-only text / `bbox`-only callout target /
freehand / `bbox`-only redact / `bbox`-only focusMask cutout)
contribute zero keys and pass through silently.

`annotations[]` IDs are NEVER referenced from `<AnnotCallout for>`
(overlays[] owns that contract), so no
`description-missing` / `description-orphan` findings fire for
this source.

### Excel adapter — yaml-driven rows for migrated screens

`@ingcreators/annot-product-docs-xlsx`'s `extractFromParsed`
gains an optional `annotationsYamlByPath` context map. When a
`<Screen>` carries `annotations="…"` and the matching yaml is in
the map, the item-table rows are sourced from the yaml's
`overlays[]` (each row's body cross-referenced from
`screen.callouts` by id). `extractMdxFile` loads each
referenced yaml file from disk automatically — missing files are
a loud failure on the same "explicit reference, but file gone"
reasoning the Astro Image Service uses.

`annotations[]` entries in the yaml are deliberately NOT
surfaced as rows. The Astro Image Service composes them onto
the annotated PNG; the Excel adapter renders the resulting image
in the spreadsheet's picture column while the items table stays
scoped to overlays.

### workflow-app dogfood

`examples/workflow-app/docs/books/operation-manual/OM-001-login.mdx`
migrates from inline `<Overlay>` to the
`<Screen annotations="./OM-001-login.annotations.yaml">` +
`<AnnotCallout for>` form. The companion yaml ships three
overlays plus three `annotations[]` entries exercising
`rect` + `arrow` + `focusMask` — the full Phase 3 palette
end-to-end through the workflow-app's docs build.

### Compatibility

Additive. Existing drift callers see no behaviour change unless
they opt in to `yamlAnnotations`. Existing xlsx callers see no
behaviour change unless they migrate a screen to the yaml form;
inline-`<Overlay>` screens continue to drive rows as before.
