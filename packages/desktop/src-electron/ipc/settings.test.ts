/**
 * Unit tests for the Phase 2 settings IPC handlers.
 */

import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSettingsHandlers, type SettingsHandlers } from "./settings.js";

let userDataDir: string;
let defaultPresetsDir: string;
let defaultPresetsPath: string;
let handlers: SettingsHandlers;

const DEFAULT_YAML = `tools:
  arrow:
    stroke_color: "#ff0000"
    stroke_width: 3
last_variants:
  shape: rect
`;

beforeEach(async () => {
  userDataDir = await fs.mkdtemp(join(tmpdir(), "annot-settings-userdata-"));
  defaultPresetsDir = await fs.mkdtemp(join(tmpdir(), "annot-settings-defaults-"));
  defaultPresetsPath = join(defaultPresetsDir, "tool-presets.yml");
  await fs.writeFile(defaultPresetsPath, DEFAULT_YAML, "utf-8");
  handlers = createSettingsHandlers({ userDataDir, defaultPresetsPath });
});

afterEach(async () => {
  await fs.rm(userDataDir, { recursive: true, force: true });
  await fs.rm(defaultPresetsDir, { recursive: true, force: true });
});

describe("load_tool_presets", () => {
  it("returns the bundled defaults when no user file exists", async () => {
    const presets = await handlers.loadToolPresets();
    expect(presets.tools?.arrow).toEqual({ stroke_color: "#ff0000", stroke_width: 3 });
    expect(presets.last_variants).toEqual({ shape: "rect" });
  });

  it("user file takes priority over the bundled default", async () => {
    await handlers.saveToolPresets({
      presets: {
        tools: { arrow: { stroke_color: "#0000ff" } },
      },
    });
    const presets = await handlers.loadToolPresets();
    expect(presets.tools?.arrow).toEqual({ stroke_color: "#0000ff" });
  });

  it("returns an empty object when neither file exists", async () => {
    handlers = createSettingsHandlers({
      userDataDir,
      defaultPresetsPath: join(defaultPresetsDir, "missing.yml"),
    });
    const presets = await handlers.loadToolPresets();
    expect(presets).toEqual({});
  });

  it("preserves arbitrary fields on the inner preset values (schema-transparent)", async () => {
    // The on-disk YAML's inner shape is whatever the JS toolbar
    // emits — variant discriminators, per-end arrow shape, etc.
    // The Rust port had a regression where typed inner structs
    // dropped these silently; the TS port is naturally
    // schema-transparent. Pin the contract here.
    await handlers.saveToolPresets({
      presets: {
        tools: {
          "arrow.end": {
            stroke_color: "#ff0000",
            arrow_head_end: "stealth",
            arrow_width_end: "lg",
            arrow_length_end: "md",
            stroke_opacity: 0.8,
            stroke_linecap: "round",
            stroke_linejoin: "miter",
          },
        },
      },
    });
    const presets = await handlers.loadToolPresets();
    expect(presets.tools?.["arrow.end"]).toEqual({
      arrow_head_end: "stealth",
      arrow_length_end: "md",
      arrow_width_end: "lg",
      stroke_color: "#ff0000",
      stroke_linecap: "round",
      stroke_linejoin: "miter",
      stroke_opacity: 0.8,
    });
  });
});

describe("save_tool_presets", () => {
  it("creates intermediate directories when the user-data dir is fresh", async () => {
    const freshDir = join(userDataDir, "subdir-that-doesnt-exist-yet");
    handlers = createSettingsHandlers({ userDataDir: freshDir, defaultPresetsPath });
    await handlers.saveToolPresets({ presets: { tools: { rect: { fill: "#000" } } } });
    const text = await fs.readFile(join(freshDir, "user-presets.yml"), "utf-8");
    expect(text).toContain("rect:");
    expect(text).toContain("fill: '#000'");
  });
});

describe("get_portable_dir", () => {
  it("returns <userData>/data and creates it on first call", async () => {
    const dir = await handlers.getPortableDir();
    expect(dir).toBe(join(userDataDir, "data"));
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });
});
