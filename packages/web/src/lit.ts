/**
 * Re-export of the Lit runtime + decorators under the
 * `@ingcreators/annot-web/lit` subpath.
 *
 * Plugin authors continue to import from here so they don't take
 * their own `lit` dependency — Annot controls the version
 * centrally, and host + plugin code share the same `LitElement`
 * identity (`instanceof` checks work across the boundary).
 *
 * Originally introduced in Phase 0 of
 * `docs/plans/_done/lit-migration.md` and lived in this file as
 * the source of truth for the project. Phase 2b of
 * `docs/plans/_done/vscode-extension-host.md` moved the source of
 * truth to `@ingcreators/annot-host-ui/lit` so the
 * host-neutral shell can compose Lit components, and this file
 * collapsed to a re-export. Plugin authors keep importing
 * `@ingcreators/annot-web/lit` — the surface is unchanged.
 */

export * from "@ingcreators/annot-host-ui/lit";
