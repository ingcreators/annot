/**
 * Stories for `<annot-scratchpad-section>` — the right-panel
 * popover that lists saved scratchpad items as a clickable
 * thumbnail grid.
 *
 * Phase 2 of `docs/plans/lit-migration-completion.md` introduced
 * the Lit element. The wrapper mirrors the popover's styling so
 * Storybook reflects the in-app context (rounded panel, dim
 * background).
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-scratchpad-section.js";
import type { ScratchpadItem, ScratchpadStoreLike } from "./scratchpad-types.js";

interface Args {
  items: ScratchpadItem[];
  saveEnabled: boolean;
  activeItemId: string | null;
}

const PLACEHOLDER_THUMB =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 60">' +
      '<rect width="80" height="60" fill="#16213e"/>' +
      '<rect x="6" y="6" width="68" height="48" fill="none" stroke="#7aa2ff" stroke-width="3"/>' +
      "</svg>",
  );

function makeMockStore(items: ScratchpadItem[]): ScratchpadStoreLike {
  let state = [...items];
  return {
    async list() {
      return [...state];
    },
    async save() {
      throw new Error("not used in story");
    },
    async delete(id: string) {
      state = state.filter((i) => i.id !== id);
    },
  } as unknown as ScratchpadStoreLike;
}

function makeItem(id: string, name: string): ScratchpadItem {
  return {
    id,
    name,
    svgMarkup: "<g></g>",
    thumbnail: PLACEHOLDER_THUMB,
    width: 80,
    height: 60,
    createdAt: "2026-04-25T10:00:00Z",
  };
}

const meta: Meta<Args> = {
  title: "Editor / ScratchpadSection",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.className = "tool-flyout-scratchpad anchored-popover";
    wrapper.style.width = "240px";
    wrapper.style.padding = "10px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e2e)";
    wrapper.style.border = "1px solid var(--annot-border-color, #333)";
    wrapper.style.borderRadius = "6px";
    const section = document.createElement("annot-scratchpad-section");
    section.store = makeMockStore(args.items);
    section.saveEnabled = args.saveEnabled;
    section.activeItemId = args.activeItemId;
    // Storybook arg-flow trace — intentional `console.log`.
    section.addEventListener("annot-scratchpad-save-request", () => {
      console.log("[story] annot-scratchpad-save-request");
    });
    section.addEventListener("annot-scratchpad-insert", (e) => {
      console.log("[story] annot-scratchpad-insert", (e as CustomEvent).detail);
    });
    wrapper.appendChild(section);
    return wrapper;
  },
  argTypes: {
    items: { control: false },
    saveEnabled: { control: "boolean" },
    activeItemId: { control: "text" },
  },
  args: {
    items: [],
    saveEnabled: false,
    activeItemId: null,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Empty: Story = {
  args: {
    items: [],
    saveEnabled: false,
  },
};

export const EmptyWithSaveEnabled: Story = {
  args: {
    items: [],
    saveEnabled: true,
  },
};

export const Populated: Story = {
  args: {
    items: [
      makeItem("a", "Red arrow"),
      makeItem("b", "Click here callout"),
      makeItem("c", "Yellow highlight"),
      makeItem("d", "Crop frame"),
    ],
    saveEnabled: false,
  },
};

export const ActiveItem: Story = {
  args: {
    items: [makeItem("a", "Red arrow"), makeItem("b", "Click here callout")],
    saveEnabled: true,
    activeItemId: "b",
  },
};
