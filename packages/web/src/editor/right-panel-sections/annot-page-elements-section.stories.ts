/**
 * Stories for `<annot-right-panel-page-elements-section>` — the
 * DOM-element list sourced from the browser-extension's
 * `pageMetadata` capture. Renders a search input + scrollable
 * row list; hover / click would manipulate the live canvas in
 * production, but the canvas is null in the story so those are
 * exercised as no-ops (logged via console).
 *
 * Phase 3 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-page-elements-section.js";
import type { PageMetadataLike } from "./types.js";

interface Args {
  metadata: PageMetadataLike | null;
}

function makeMetadata(): PageMetadataLike {
  return {
    capturedAt: "2026-04-25T10:00:00Z",
    url: "https://example.com/article",
    title: "Example article",
    devicePixelRatio: 2,
    viewport: { width: 1024, height: 768 },
    scrollOffset: { x: 0, y: 0 },
    captureRect: { x: 0, y: 0, width: 1024, height: 1600 },
    elements: [
      {
        bbox: [40, 40, 160, 40] as [number, number, number, number],
        tag: "button",
        role: "button",
        text: "Subscribe",
      },
      {
        bbox: [40, 100, 200, 24] as [number, number, number, number],
        tag: "a",
        role: "link",
        text: "Read more",
        href: "https://example.com/more",
      },
      {
        bbox: [40, 160, 320, 36] as [number, number, number, number],
        tag: "input",
        inputType: "search",
        placeholder: "Search the docs",
      },
      {
        bbox: [40, 220, 280, 36] as [number, number, number, number],
        tag: "input",
        inputType: "email",
        placeholder: "you@example.com",
      },
      {
        bbox: [40, 280, 240, 28] as [number, number, number, number],
        tag: "h2",
        text: "Getting started",
      },
      {
        bbox: [40, 340, 200, 24] as [number, number, number, number],
        tag: "label",
        text: "Accept terms",
      },
      {
        bbox: [40, 380, 200, 24] as [number, number, number, number],
        tag: "input",
        inputType: "checkbox",
      },
    ],
  } as unknown as PageMetadataLike;
}

const meta: Meta<Args> = {
  title: "Editor / RightPanelSections / right-panel.page-elements",
  render: (args) => {
    const wrapper = document.createElement("aside");
    wrapper.id = "editor-right-panel";
    wrapper.style.width = "300px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "var(--bg-panel, #1e1e2e)";
    const heading = document.createElement("h3");
    heading.className = "editor-right-panel-section-title";
    heading.textContent = "Elements";
    wrapper.appendChild(heading);
    const section = document.createElement(
      "annot-right-panel-page-elements-section",
    );
    section.pageMetadata = args.metadata;
    section.canvas = null;
    section.history = null;
    section.selection = null;
    wrapper.appendChild(section);
    return wrapper;
  },
  argTypes: {
    metadata: { control: false },
  },
  args: {
    metadata: makeMetadata(),
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Populated: Story = {
  args: { metadata: makeMetadata() },
};

export const EmptyMetadata: Story = {
  args: {
    metadata: { ...makeMetadata(), elements: [] } as PageMetadataLike,
  },
};

export const NoMetadata: Story = {
  args: { metadata: null },
};
