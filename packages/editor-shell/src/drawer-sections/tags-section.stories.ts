/**
 * Stories for the built-in `drawer.tags` section — the thin Lit
 * wrapper that hosts `<annot-tag-editor>` inside the file-details
 * drawer. The tag-editor itself has its own story (`Editor /
 * TagEditor`); this story exists so the wrapper's section frame
 * + onTagsChange forwarding are reviewable in isolation.
 *
 * Phase 1 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./tags-section.js";
import { createDrawerSectionFrame } from "./helpers.js";

interface Args {
  tags: Record<string, string>;
}

const meta: Meta<Args> = {
  title: "Editor / DrawerSections / drawer.tags",
  render: (args) => {
    const frame = createDrawerSectionFrame("Tags");
    const section = document.createElement("annot-drawer-tags-section");
    section.tags = args.tags;
    // Storybook arg-flow trace — intentional `console.log`.
    section.onTagsChange = (next) => {
      console.log("[story] onTagsChange", next);
    };
    frame.body.appendChild(section);
    const wrapper = document.createElement("aside");
    wrapper.className = "file-details-drawer";
    wrapper.appendChild(frame.section);
    return wrapper;
  },
  argTypes: {
    tags: { control: "object" },
  },
  args: {
    tags: { author: "alice", status: "reviewing" },
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Empty: Story = {
  args: { tags: {} },
};

export const Populated: Story = {
  args: { tags: { author: "alice", status: "reviewing" } },
};

export const ManyTags: Story = {
  args: {
    tags: {
      author: "alice",
      status: "reviewing",
      priority: "high",
      sprint: "26-04",
      area: "drawer",
    },
  },
};
