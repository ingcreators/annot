/**
 * Stories for `<annot-candidate-panel>` — right-side panel inside
 * the capture workspace.
 *
 * Phase 3 of `docs/plans/web-capture-redesign.md` adds the
 * `Populated` story exercising the `CandidateStore` integration.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-candidate-panel.js";
import { CandidateStore } from "./candidate-store.js";
import type { CaptureCandidate } from "./types.js";

const FAKE_THUMB =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNzIiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiM0NDQiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iI2VlZSIgZm9udC1zaXplPSIxNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSI+UHJldmlldzwvdGV4dD48L3N2Zz4=";

function makeCandidate(
  id: string,
  status: CaptureCandidate["status"] = "candidate",
): CaptureCandidate {
  return {
    id,
    status,
    createdAt: new Date(Date.now() - Number.parseInt(id, 10) * 5000).toISOString(),
    sourceWidth: 1280,
    sourceHeight: 720,
    imageBlob: new Blob([id], { type: "image/jpeg" }),
    thumbnailDataUrl: FAKE_THUMB,
  };
}

interface Args {
  count: number;
}

const meta: Meta<Args> = {
  title: "Capture / CandidatePanel",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:320px;height:480px;background:var(--bg-panel, #2a2a2a);border-left:1px solid #444;";
    const el = document.createElement("annot-candidate-panel");
    const store = new CandidateStore();
    for (let i = 1; i <= args.count; i++) store.add(makeCandidate(String(i)));
    el.store = store;
    el.addEventListener("candidate-accept", (e) =>
      console.log("[story] candidate-accept", (e as CustomEvent).detail),
    );
    el.addEventListener("candidate-edit", (e) =>
      console.log("[story] candidate-edit", (e as CustomEvent).detail),
    );
    el.addEventListener("candidate-delete", (e) => {
      console.log("[story] candidate-delete", (e as CustomEvent).detail);
      store.remove((e as CustomEvent).detail.id);
    });
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    count: { control: { type: "number", min: 0, max: 20 } },
  },
  args: {
    count: 0,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Empty: Story = {};

export const Populated: Story = {
  args: { count: 3 },
};

export const ManyCandidates: Story = {
  args: { count: 10 },
};
