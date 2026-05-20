---
"@ingcreators/annot-core": minor
---

Switch the client-capture PNG-8 default quantizer to the pure-TS
Median Cut at `@ingcreators/annot-core/encode/quantize-median-cut`.
`DEFAULT_ENCODE_OPTIONS.quantizer` is now `"median-cut"`. The
`@ingcreators/annot-imagequant` WASM import and the `ensureWasm()`
initialisation path are removed from `@ingcreators/annot-core/encode`.
The `quantizer: "wasm"` value on `EncodeOptions` is retained for
back-compat (now resolves to the same Median Cut implementation)
so consumers that persisted `quantizer: "wasm"` to localStorage
keep working unchanged.

Phase 2 of `docs/plans/replace-libimagequant-with-median-cut.md`.
Phase 3 retires the annotator / MCP dynamic-import path; Phase 4
deletes the workspace package and deprecates the published
`@ingcreators/annot-imagequant@0.1.0` on npm.
