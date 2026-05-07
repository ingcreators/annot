/**
 * Stories for `<annot-tag-editor>` — the chip-based key:value
 * editor used in the file-details drawer's Tags section.
 *
 * Phase 1 of `docs/plans/lit-migration-completion.md` introduced
 * the Lit element; the story is the visual contract preserved
 * across the migration. The wrapper mirrors the drawer's section
 * frame so the chip / button styling lands in the same context
 * users actually see.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-tag-editor.js";

interface Args {
  tags: Record<string, string>;
}

const meta: Meta<Args> = {
  title: "Editor / TagEditor",
  render: (args) => {
    // Wrap in the drawer's section panel so Storybook reflects
    // the in-app context (panel background, padding, layout
    // tokens). The wrapper is purely cosmetic — the element
    // itself doesn't depend on any drawer-specific state.
    const wrapper = document.createElement("aside");
    wrapper.className = "file-details-drawer";
    wrapper.style.width = "320px";
    const section = document.createElement("section");
    section.className = "file-details-section";
    const heading = document.createElement("h3");
    heading.className = "file-details-section-title";
    heading.textContent = "Tags";
    section.appendChild(heading);
    const body = document.createElement("div");
    body.className = "file-details-section-body file-details-tags-editor";
    body.style.position = "relative";
    section.appendChild(body);
    const editor = document.createElement("annot-tag-editor");
    editor.tags = args.tags;
    // Storybook arg-flow trace — intentional `console.log`.
    editor.addEventListener("annot-tag-change", (e) => {
      const detail = (e as CustomEvent<{ tags: Record<string, string> }>).detail;
      console.log("[story] annot-tag-change", detail.tags);
    });
    body.appendChild(editor);
    wrapper.appendChild(section);
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
