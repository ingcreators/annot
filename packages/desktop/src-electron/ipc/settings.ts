/**
 * Tool-presets + portable-dir IPC handlers — Phase 2 of
 * `docs/plans/desktop-electron-migration.md`.
 *
 * Direct port of `packages/desktop/src-tauri/src/commands/settings.rs`.
 * Three channels:
 *
 *   - `load_tool_presets`  → reads the user-presets YAML from
 *     `<userData>/user-presets.yml`, falling back to the
 *     bundled-resource default at the host-supplied
 *     `defaultPresetsPath`. Returns an empty `ToolPresets`
 *     when neither exists (the renderer's hardcoded defaults
 *     take over).
 *   - `save_tool_presets`  → writes user presets to the same
 *     user file as YAML.
 *   - `get_portable_dir`   → returns `<userData>/data/`. Phase 5
 *     of the storage-provider migration narrowed this back to
 *     the legacy-data toast + extension-handoff sweep needs;
 *     the Electron port keeps that contract verbatim so the
 *     renderer call sites don't move when Phase 5 of THIS plan
 *     swaps `tauri-bridge.ts` → `desktop-bridge.ts`.
 *
 * Schema-transparent inner values: the `tools` map's per-entry
 * shape is whatever the JS toolbar emits (driven by per-tool
 * `presetFields` in `packages/core/src/editor/tool-registry.ts`).
 * The Rust port made this transparent via
 * `HashMap<String, serde_yaml::Value>` after a regression where
 * a typed inner struct silently dropped fields the renderer
 * relied on (variant discriminators, per-end arrow shape, stroke
 * cap/join, …). The TS port is naturally schema-transparent —
 * `js-yaml` round-trips arbitrary YAML mappings — so the same
 * values flow through unchanged.
 */

import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

/** On-disk shape of the tool-presets YAML file. The inner
 *  `tools` map is intentionally typed as `Record<string,
 *  unknown>` so anything the JS toolbar emits round-trips
 *  unchanged — see the file-level comment for context. */
export interface ToolPresets {
  tools?: Record<string, unknown>;
  last_variants?: Record<string, string>;
}

export interface SettingsHandlers {
  loadToolPresets(): Promise<ToolPresets>;
  saveToolPresets(input: { presets: ToolPresets }): Promise<void>;
  getPortableDir(): Promise<string>;
}

export interface SettingsHandlerOptions {
  /** `app.getPath('userData')` resolved by the main process. The
   *  user-presets YAML and the portable data directory live
   *  under here. */
  userDataDir: string;
  /** Absolute path to the read-only default-presets YAML
   *  shipped with the app. `electron-builder.extraResources`
   *  puts the file at a known location; the main process
   *  resolves it once and passes it down. */
  defaultPresetsPath: string;
}

export function createSettingsHandlers(opts: SettingsHandlerOptions): SettingsHandlers {
  const userPresetsPath = join(opts.userDataDir, "user-presets.yml");
  const portableDataDir = join(opts.userDataDir, "data");

  return {
    async loadToolPresets() {
      // User file takes priority.
      const userPresets = await tryReadYamlPresets(userPresetsPath);
      if (userPresets) return userPresets;

      const defaultPresets = await tryReadYamlPresets(opts.defaultPresetsPath);
      if (defaultPresets) return defaultPresets;

      // No file found — let the renderer fall back to its
      // hardcoded defaults. Mirrors `ToolPresets::default()` on
      // the Rust side.
      return {};
    },

    async saveToolPresets({ presets }) {
      await fs.mkdir(dirname(userPresetsPath), { recursive: true });
      const text = yaml.dump(presets, {
        // `js-yaml` defaults that produce output close to the
        // Rust `serde_yaml` shape: indentation 2, no
        // line-folding, sorted keys for deterministic diffs.
        indent: 2,
        lineWidth: -1,
        sortKeys: true,
      });
      await fs.writeFile(userPresetsPath, text, "utf-8");
    },

    async getPortableDir() {
      await fs.mkdir(portableDataDir, { recursive: true });
      return portableDataDir;
    },
  };
}

async function tryReadYamlPresets(path: string): Promise<ToolPresets | null> {
  let text: string;
  try {
    text = await fs.readFile(path, "utf-8");
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
  // `yaml.load` returns `unknown` — narrow defensively. Empty /
  // comment-only files load as `undefined` or `null`; treat
  // those as missing.
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed as ToolPresets;
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}

export const SETTINGS_CHANNELS = {
  loadToolPresets: "load_tool_presets",
  saveToolPresets: "save_tool_presets",
  getPortableDir: "get_portable_dir",
} as const;

export type SettingsChannel = (typeof SETTINGS_CHANNELS)[keyof typeof SETTINGS_CHANNELS];

export const SETTINGS_CHANNEL_TO_HANDLER: Record<SettingsChannel, keyof SettingsHandlers> = {
  [SETTINGS_CHANNELS.loadToolPresets]: "loadToolPresets",
  [SETTINGS_CHANNELS.saveToolPresets]: "saveToolPresets",
  [SETTINGS_CHANNELS.getPortableDir]: "getPortableDir",
};
