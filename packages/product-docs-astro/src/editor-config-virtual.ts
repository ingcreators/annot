// Module that ships the project-wide defaults `<AnnotEditButton>`
// reads at click time. Phase 5f of
// `docs/plans/living-spec-authoring-roadmap.md`.
//
// Without the `productDocsIntegration({ editor: ... })` config,
// this file's exports are the defaults consumers see — `newTab`
// mode + `https://annot.work` cloud URL. With the integration,
// Vite's `resolve.alias` redirects every import of this file to
// a virtual module the integration generates, with the merged
// (built-in + per-project + loaded `annot-docs.config.ts`)
// defaults baked in.
//
// `<AnnotEditButton>` imports the named export at click time;
// per-call props on the component still win over the default.

import type { EmbedMode } from "@ingcreators/annot-embed-protocol";

export interface ResolvedEditorConfig {
  readonly embedMode: EmbedMode;
  readonly cloudUrl: string;
}

/**
 * Phase 5 OSS-side built-in defaults. Mirror the per-component
 * defaults declared inside `<AnnotEditButton>` (`mode="newTab"`,
 * `cloudUrl="https://annot.work"`) so consumers without the
 * integration installed still see consistent behaviour.
 */
export const ANNOT_EDITOR_CONFIG: ResolvedEditorConfig = {
  embedMode: "newTab",
  cloudUrl: "https://annot.work",
};
