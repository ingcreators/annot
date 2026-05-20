---
"@ingcreators/annot-core": minor
---

Add `quantizeMedianCut` — a pure-TS Median Cut + Floyd–Steinberg
dither quantizer at `@ingcreators/annot-core/encode/quantize-median-cut`
— and an opt-in `quantizer?: "wasm" | "median-cut"` field on
`EncodeOptions`. Default stays `"wasm"` (libimagequant via the
existing GPL-3.0 WASM dependency) so production behaviour is
unchanged. Phase 1 of
`docs/plans/replace-libimagequant-with-median-cut.md`; Phase 2
will flip the default to `"median-cut"` and Phase 4 will retire
the `"wasm"` branch entirely.
