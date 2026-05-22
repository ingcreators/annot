/**
 * Stories for `<annot-right-panel-page-elements-section>` — the
 * DOM-element list sourced from the `ElementTree` captured
 * alongside the screenshot. Renders a search input + scrollable
 * row list; hover / click would manipulate the live canvas in
 * production, but the canvas is null in the story so those are
 * exercised as no-ops (logged via console).
 *
 * Phase 3 of `docs/plans/litelement-stories-coverage.md`.
 */

import type { ElementTree } from "@ingcreators/annot-core";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-page-elements-section.js";

interface Args {
  elementTree: ElementTree | null;
}

function makeElementTree(): ElementTree {
  return {
    version: 1,
    source: { kind: "extension", capturedAt: "2026-05-23T00:00:00Z" },
    viewport: { width: 1024, height: 768, scale: 2 },
    root: {
      ref: "e0",
      role: "document",
      bbox: { x: 0, y: 0, width: 1024, height: 1600 },
      children: [
        {
          ref: "e1",
          role: "main",
          bbox: { x: 0, y: 0, width: 1024, height: 800 },
          children: [
            {
              ref: "e2",
              role: "heading",
              name: "Welcome",
              bbox: { x: 40, y: 40, width: 200, height: 30 },
              states: ["level=1"],
            },
            {
              ref: "e3",
              role: "form",
              bbox: { x: 40, y: 100, width: 400, height: 200 },
              children: [
                {
                  ref: "e4",
                  role: "textbox",
                  name: "Email",
                  bbox: { x: 40, y: 120, width: 300, height: 36 },
                  attributes: { type: "email", placeholder: "you@example.com" },
                },
                {
                  ref: "e5",
                  role: "textbox",
                  name: "Password",
                  bbox: { x: 40, y: 170, width: 300, height: 36 },
                  attributes: { type: "password" },
                },
                {
                  ref: "e6",
                  role: "button",
                  name: "Sign in",
                  bbox: { x: 40, y: 220, width: 100, height: 36 },
                },
              ],
            },
          ],
        },
        {
          ref: "e7",
          role: "navigation",
          bbox: { x: 0, y: 0, width: 1024, height: 60 },
          children: [
            {
              ref: "e8",
              role: "link",
              name: "Home",
              bbox: { x: 40, y: 20, width: 60, height: 20 },
            },
            {
              ref: "e9",
              role: "link",
              name: "Docs",
              bbox: { x: 120, y: 20, width: 60, height: 20 },
            },
            {
              ref: "e10",
              role: "link",
              name: "Sign up",
              bbox: { x: 200, y: 20, width: 80, height: 20 },
              attributes: { href: "/signup" },
            },
          ],
        },
      ],
    },
  };
}

const meta: Meta<Args> = {
  title: "Editor / RightPanelSections / right-panel.page-elements",
  render: (args) => {
    const wrapper = document.createElement("aside");
    wrapper.id = "editor-right-panel";
    wrapper.style.width = "300px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    const heading = document.createElement("h3");
    heading.className = "editor-right-panel-section-title";
    heading.textContent = "Elements";
    wrapper.appendChild(heading);
    const section = document.createElement("annot-right-panel-page-elements-section");
    section.elementTree = args.elementTree;
    section.canvas = null;
    section.history = null;
    section.selection = null;
    wrapper.appendChild(section);
    return wrapper;
  },
  argTypes: {
    elementTree: { control: false },
  },
  args: {
    elementTree: makeElementTree(),
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Tree view — hierarchical render of the `ElementTree`. The
 *  synthetic root is hidden; visible rows start at the first real
 *  child. */
export const TreeView: Story = {
  args: { elementTree: makeElementTree() },
};

/** Empty tree — the synthetic root has no named children. The
 *  section's `visible(ctx)` predicate hides the heading entirely
 *  in this case; the story still mounts the body so the empty
 *  state itself is inspectable. */
export const EmptyTree: Story = {
  args: {
    elementTree: {
      ...makeElementTree(),
      root: {
        ...makeElementTree().root,
        children: [],
      },
    },
  },
};

/** No tree — paste / desktop / legacy capture. The section hides
 *  itself in the host; the story leaves the body inert. */
export const NoTree: Story = {
  args: { elementTree: null },
};
