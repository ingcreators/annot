/**
 * Stories for `<annot-file-details-drawer>` — the full drawer
 * host with its chrome (backdrop + header + close button) plus
 * every visible combination of built-in sections (File / Tags /
 * Last commit / External links).
 *
 * Bootstrapped in Phase 1 of `docs/plans/_done/storybook-introduction.md`
 * when the drawer was still imperative; converted to the Lit
 * element in Phase 1 of `docs/plans/_done/lit-migration.md`. Each
 * story opens the drawer automatically so reviewers see the
 * populated panel without having to click "toggle".
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-file-details-drawer.js";
import type { FileDetailsData } from "./annot-file-details-drawer.js";

interface Args {
  data: FileDetailsData;
  disabledSections: string[];
}

function mountDrawer(args: Args): HTMLElement {
  const container = document.createElement("div");
  // The drawer positions itself absolute to its container; a
  // tall flex wrapper lets Storybook render the slide-in
  // without clipping.
  container.style.position = "relative";
  container.style.width = "100%";
  container.style.height = "600px";
  container.style.background = "var(--bg-canvas, #1e1e1e)";

  const drawer = document.createElement("annot-file-details-drawer");
  drawer.data = args.data;
  drawer.isBuiltinSectionDisabled = (id) => args.disabledSections.includes(id);
  container.appendChild(drawer);
  // Open the drawer after it's connected so the slide-in state
  // is visible in the story frame.
  queueMicrotask(() => drawer.open());
  return container;
}

const TYPICAL_DATA: FileDetailsData = {
  filename: "screenshot-2026-04-25.png",
  folderPath: "Screenshots/Mobile",
  width: 1024,
  height: 768,
  fileSizeBytes: 1_240_000,
  createdAt: "2026-04-25T10:00:00Z",
  updatedAt: "2026-04-25T10:05:00Z",
  sourceUrl: "https://example.com/source/article",
  tags: { author: "alice", status: "reviewing" },
};

const meta: Meta<Args> = {
  title: "Editor / FileDetailsDrawer",
  render: (args) => mountDrawer(args),
  argTypes: {
    data: { control: false },
    disabledSections: {
      control: "check",
      options: [
        "drawer.file",
        "drawer.tags",
        "drawer.last-commit",
        "drawer.external-links",
      ],
    },
  },
  args: {
    data: TYPICAL_DATA,
    disabledSections: [],
  },
};
export default meta;

type Story = StoryObj<Args>;

export const EverySectionVisible: Story = {
  args: {
    data: {
      ...TYPICAL_DATA,
      lastCommit: {
        authorName: "alice",
        authorAvatarUrl: "https://github.com/github.png",
        messageHeadline: "Add Phase 2 drawer migration",
        date: "2026-04-25T09:00:00Z",
        shortSha: "a1b2c3d",
        url: "https://github.com/ingcreators/annot/commit/a1b2c3d",
      },
      externalLinks: [
        {
          label: "View on GitHub",
          url: "https://github.com/ingcreators/annot/blob/main/image.png",
          icon: "open_in_new",
        },
      ],
    },
  },
};

export const NoCommitNoLinks: Story = {
  args: {
    data: TYPICAL_DATA,
  },
};

export const CommitOnly: Story = {
  args: {
    data: {
      ...TYPICAL_DATA,
      lastCommit: {
        authorName: "bob",
        messageHeadline: "Update docs",
        date: "2026-04-24T14:30:00Z",
        shortSha: "9876abc",
      },
    },
  },
};

export const MultipleExternalLinks: Story = {
  args: {
    data: {
      ...TYPICAL_DATA,
      externalLinks: [
        { label: "View on GitHub", url: "https://github.com/foo", icon: "open_in_new" },
        { label: "JIRA ticket", url: "https://example.atlassian.net/browse/FOO-123", icon: "task" },
        { label: "Team thread", url: "https://example.slack.com/archives/ABC", icon: "chat" },
      ],
    },
  },
};

export const TagsDisabled: Story = {
  name: "Disabled — drawer.tags",
  args: {
    data: TYPICAL_DATA,
    disabledSections: ["drawer.tags"],
  },
};

export const FileDisabled: Story = {
  name: "Disabled — drawer.file",
  args: {
    data: TYPICAL_DATA,
    disabledSections: ["drawer.file"],
  },
};
