/**
 * Stories for `<annot-doc-empty-state>` — Phase 4 of
 * `docs/plans/annot-html-document-ux-polish.md`. The element
 * has no reactive properties; the variants demonstrate how it
 * sits inside an `<article>` mirroring the production mount.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-empty-state.js";

const meta: Meta = {
  title: "Editor / DocEmptyState",
  render: () => {
    const wrapper = document.createElement("div");
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";
    wrapper.style.color = "var(--annot-doc-fg, #1f2937)";
    wrapper.style.padding = "1rem";
    wrapper.style.fontFamily = "Annot Sans, system-ui, sans-serif";

    const article = document.createElement("article");
    const empty = document.createElement("annot-doc-empty-state");
    empty.addEventListener("empty-state-action", (e) => {
      console.log("[story] empty-state-action", (e as CustomEvent).detail);
    });
    article.appendChild(empty);
    wrapper.appendChild(article);
    return wrapper;
  },
};
export default meta;

type Story = StoryObj;

export const Default: Story = {};
