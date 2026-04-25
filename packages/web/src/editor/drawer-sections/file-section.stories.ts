/**
 * Stories for the built-in `drawer.file` section — the File
 * metadata block in `<annot-file-details-drawer>`. Exercises the
 * `<annot-drawer-file-section>` Lit element in isolation, away
 * from the drawer host, so the variants land as focused visual
 * artifacts.
 *
 * Bootstrapped in Phase 1 of `docs/plans/storybook-introduction.md`
 * when the section was still an imperative factory; converted to
 * the Lit element in Phase 1 of `docs/plans/lit-migration.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./file-section.js";
import { createDrawerSectionFrame } from "./helpers.js";
import type { FileDetailsData } from "../file-details-drawer-types.js";

interface Args {
  filename: string;
  folderPath: string;
  width: number;
  height: number;
  fileSizeBytes: number;
  createdAt: string;
  updatedAt: string;
  sourceUrl: string;
}

const meta: Meta<Args> = {
  title: "Editor / DrawerSections / drawer.file",
  // Build the section frame (heading + body) and mount the
  // `<annot-drawer-file-section>` Lit element inside the body.
  // The drawer's visual chrome wraps the section body so the
  // rendered story mirrors what the user sees inside the drawer.
  render: (args) => {
    const data: FileDetailsData = {
      filename: args.filename,
      folderPath: args.folderPath,
      width: args.width,
      height: args.height,
      fileSizeBytes: args.fileSizeBytes,
      createdAt: args.createdAt || undefined,
      updatedAt: args.updatedAt || undefined,
      sourceUrl: args.sourceUrl || undefined,
      tags: {},
    };
    const frame = createDrawerSectionFrame("File");
    const section = document.createElement("annot-drawer-file-section");
    section.data = data;
    section.onRename = async (newName) => {
      console.log("[story] onRename", newName);
    };
    frame.body.appendChild(section);
    // Keep the drawer's panel class so the story picks up the
    // same layout tokens (fixed width, padding, typography).
    const wrapper = document.createElement("aside");
    wrapper.className = "file-details-drawer";
    wrapper.appendChild(frame.section);
    return wrapper;
  },
  argTypes: {
    filename: { control: "text" },
    folderPath: { control: "text" },
    width: { control: "number" },
    height: { control: "number" },
    fileSizeBytes: { control: "number" },
    createdAt: { control: "text" },
    updatedAt: { control: "text" },
    sourceUrl: { control: "text" },
  },
  args: {
    filename: "screenshot-2026-04-25.png",
    folderPath: "Screenshots/Mobile",
    width: 1024,
    height: 768,
    fileSizeBytes: 1_240_000,
    createdAt: "2026-04-25T10:00:00Z",
    updatedAt: "2026-04-25T10:05:00Z",
    sourceUrl: "",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Minimal: Story = {
  args: {
    filename: "image.png",
    folderPath: "",
    width: 640,
    height: 480,
    fileSizeBytes: 24_000,
    createdAt: "",
    updatedAt: "",
    sourceUrl: "",
  },
};

export const Typical: Story = {
  args: {
    filename: "screenshot-2026-04-25.png",
    folderPath: "Screenshots/Mobile",
    width: 1024,
    height: 768,
    fileSizeBytes: 1_240_000,
    createdAt: "2026-04-25T10:00:00Z",
    updatedAt: "2026-04-25T10:05:00Z",
    sourceUrl: "",
  },
};

export const WithSourceUrl: Story = {
  args: {
    filename: "captured-from-web.png",
    folderPath: "Web Captures",
    width: 1280,
    height: 720,
    fileSizeBytes: 2_800_000,
    createdAt: "2026-04-24T09:30:00Z",
    updatedAt: "2026-04-25T08:15:00Z",
    sourceUrl: "https://example.com/article/12345",
  },
};

export const ExtraLongFilename: Story = {
  args: {
    filename: "extremely-long-filename-that-overflows-the-narrow-drawer-column.png",
    folderPath: "Archive/2026/April/Mobile/iOS/Safari",
    width: 2048,
    height: 1536,
    fileSizeBytes: 8_400_000,
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-25T12:00:00Z",
    sourceUrl: "https://example.com/very/long/path/to/source/page",
  },
};
