---
"@ingcreators/annot-core": patch
---

Remove the `@ingcreators/annot-imagequant` workspace dependency
graph entirely. The package's GPL-3.0 WASM was replaced by the
pure-TS Median Cut quantizer in Phases 1–3 of
`docs/plans/_done/replace-libimagequant-with-median-cut.md`;
Phase 4 deletes the workspace package itself + the `verify-wasm`
CI job + the Cargo dependabot watch + the issue-template option +
the published 0.1.0 on npm (via the `npm deprecate` operator
action documented in the Phase 4 PR description).
