// Astro integration entry point for `@ingcreators/annot-product-docs-astro`.
//
// Phase 2 PR 1 of `docs/plans/living-product-docs.md` shipped
// the scaffold. Phase 5f of
// `docs/plans/living-spec-authoring-roadmap.md` extends it with
// the `editor` config that flows into `<AnnotEditButton>`'s
// build-time defaults via a Vite virtual module.
//
// The integration:
//
//   - Wires up the MDX renderer + Image Service (per the
//     original Phase 2 plan).
//
//   - Generates a virtual module that replaces
//     `editor-config-virtual.ts`'s built-in defaults with the
//     merged project-wide editor config (per-call > integration
//     option > config-file > built-in default).

import type { EmbedMode } from "@ingcreators/annot-embed-protocol";
import type { AstroIntegration } from "astro";
import type { ResolvedEditorConfig } from "./editor-config-virtual.js";

// Minimal Vite-plugin shape the integration produces. Typed
// against the subset of fields Astro / Vite actually invoke so
// the integration compiles against both Vite's `rollup`-based
// `Plugin` and Astro's `rolldown`-based one without a
// per-bundler conditional. Astro accepts any object with `name`
// + the hook subset.
export interface EditorConfigVitePlugin {
  readonly name: string;
  readonly enforce?: "pre" | "post";
  readonly resolveId: (id: string) => string | null;
  readonly load: (id: string) => string | null;
}

export interface ProductDocsEditorOptions {
  /**
   * Default embed mode for every `<AnnotEditButton>` in the
   * site. Per-call `mode` prop wins when set. Defaults to
   * `"newTab"`.
   */
  embedMode?: EmbedMode;
  /**
   * Cloud editor origin override for on-prem deployments
   * (e.g. `"https://annot.internal.example.com"`). Per-call
   * `cloudUrl` prop wins when set. Defaults to
   * `"https://annot.work"`.
   */
  cloudUrl?: string;
}

export interface ProductDocsIntegrationOptions {
  /**
   * Directory (relative to the Astro project root) that contains
   * the `annot:`-frontmatter MDX files the integration should
   * walk for the Image Service + component-config defaults.
   * Default: `"docs"`.
   */
  contentDir?: string;
  /**
   * Path to the `annot-docs.config.ts` config file. Default:
   * `"annot-docs.config.ts"`. Future PRs read this for the
   * `meta` defaults + per-book template lookups.
   */
  configPath?: string;
  /**
   * Project-wide `<AnnotEditButton>` defaults. Phase 5f of
   * `docs/plans/living-spec-authoring-roadmap.md`.
   */
  editor?: ProductDocsEditorOptions;
  /**
   * If `true`, the integration logs a debug line on every
   * config:setup. Useful for verifying the integration is
   * installed correctly in an Astro project. Default: `false`.
   */
  verbose?: boolean;
}

const INTEGRATION_NAME = "@ingcreators/annot-product-docs-astro";

const BUILT_IN_EDITOR_DEFAULTS: ResolvedEditorConfig = {
  embedMode: "newTab",
  cloudUrl: "https://annot.work",
};

const EDITOR_CONFIG_VIRTUAL_ID = "virtual:annot-docs/editor-config";
const RESOLVED_EDITOR_CONFIG_VIRTUAL_ID = `\0${EDITOR_CONFIG_VIRTUAL_ID}`;
const EDITOR_CONFIG_VIRTUAL_MODULE_BASENAME = "editor-config-virtual";

/**
 * Vite plugin that:
 *
 *   1. Generates a virtual module (`virtual:annot-docs/editor-config`)
 *      exporting the resolved editor config.
 *
 *   2. Aliases every import of the package's
 *      `editor-config-virtual.ts` to the virtual module so
 *      `<AnnotEditButton>` picks up the project-wide defaults.
 *
 * Exported here for vitest. Consumers don't need to import it
 * directly — `productDocsIntegration` wires it up automatically.
 */
export function editorConfigVirtualPlugin(resolved: ResolvedEditorConfig): EditorConfigVitePlugin {
  return {
    name: "annot-docs:editor-config-virtual",
    enforce: "pre",
    resolveId(id) {
      if (id === EDITOR_CONFIG_VIRTUAL_ID) {
        return RESOLVED_EDITOR_CONFIG_VIRTUAL_ID;
      }
      // Match the shipped `editor-config-virtual.ts` file by
      // basename. Resolved IDs end with the basename + the
      // extension; we accept either `.ts` (source) or `.js`
      // (built dist) so both workspace consumers and published
      // npm consumers hit the virtual module.
      if (
        id.endsWith(`${EDITOR_CONFIG_VIRTUAL_MODULE_BASENAME}.ts`) ||
        id.endsWith(`${EDITOR_CONFIG_VIRTUAL_MODULE_BASENAME}.js`)
      ) {
        return RESOLVED_EDITOR_CONFIG_VIRTUAL_ID;
      }
      return null;
    },
    load(id) {
      if (id === RESOLVED_EDITOR_CONFIG_VIRTUAL_ID) {
        return `export const ANNOT_EDITOR_CONFIG = ${JSON.stringify(resolved)};\n`;
      }
      return null;
    },
  };
}

/**
 * Merge the per-call editor options into the built-in defaults.
 * Future revision (Phase 5f follow-up if needed) also reads
 * `annot-docs.config.ts`'s `editor` config + merges in the
 * middle of this precedence ladder; today the integration
 * option is the only override layer.
 */
export function resolveEditorConfig(
  editor: ProductDocsEditorOptions | undefined,
): ResolvedEditorConfig {
  return {
    embedMode: editor?.embedMode ?? BUILT_IN_EDITOR_DEFAULTS.embedMode,
    cloudUrl: editor?.cloudUrl ?? BUILT_IN_EDITOR_DEFAULTS.cloudUrl,
  };
}

/**
 * Astro integration factory. Drop into `astro.config.mjs`:
 *
 * ```js
 * import { defineConfig } from "astro/config";
 * import { productDocsIntegration } from "@ingcreators/annot-product-docs-astro";
 *
 * export default defineConfig({
 *   integrations: [
 *     productDocsIntegration({
 *       editor: {
 *         embedMode: "newTab",
 *         cloudUrl: "https://annot.internal.example.com",
 *       },
 *     }),
 *   ],
 * });
 * ```
 */
export function productDocsIntegration(
  options: ProductDocsIntegrationOptions = {},
): AstroIntegration {
  const opts: Required<Omit<ProductDocsIntegrationOptions, "editor">> & {
    editor: ProductDocsEditorOptions | undefined;
  } = {
    contentDir: options.contentDir ?? "docs",
    configPath: options.configPath ?? "annot-docs.config.ts",
    editor: options.editor,
    verbose: options.verbose ?? false,
  };

  const resolvedEditor = resolveEditorConfig(opts.editor);

  return {
    name: INTEGRATION_NAME,
    hooks: {
      "astro:config:setup": ({ logger, updateConfig }) => {
        if (opts.verbose) {
          logger.info(
            `${INTEGRATION_NAME} installed — contentDir=${opts.contentDir} configPath=${opts.configPath} editor.embedMode=${resolvedEditor.embedMode} editor.cloudUrl=${resolvedEditor.cloudUrl}`,
          );
        }
        updateConfig({
          vite: {
            plugins: [editorConfigVirtualPlugin(resolvedEditor)],
          },
        });
      },
    },
  };
}

/**
 * Default-export shape some Astro integration authors prefer.
 */
export default productDocsIntegration;
