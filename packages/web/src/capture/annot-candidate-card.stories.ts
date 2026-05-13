/**
 * Stories for `<annot-candidate-card>` — the single-row card the
 * candidate panel renders for each pending capture.
 *
 * Phase 3 of `docs/plans/web-capture-redesign.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-candidate-card.js";
import type { CaptureCandidate, CaptureCandidateStatus } from "./types.js";

interface Args {
  status: CaptureCandidateStatus;
  withThumbnail: boolean;
}

const FAKE_THUMB =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iNzIiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiM0NDQiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZmlsbD0iI2VlZSIgZm9udC1zaXplPSIxNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSI+UHJldmlldzwvdGV4dD48L3N2Zz4=";

function makeCandidate(args: Args): CaptureCandidate {
  return {
    id: "c-1",
    status: args.status,
    createdAt: new Date().toISOString(),
    sourceWidth: 1280,
    sourceHeight: 720,
    imageBlob: new Blob(["fake"], { type: "image/jpeg" }),
    thumbnailDataUrl: args.withThumbnail ? FAKE_THUMB : "",
  };
}

const meta: Meta<Args> = {
  title: "Capture / CandidateCard",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "width:300px;background:var(--bg-panel, #2a2a2a);padding:12px;border:1px solid #444;";
    const el = document.createElement("annot-candidate-card");
    el.candidate = makeCandidate(args);
    el.addEventListener("candidate-accept", (e) =>
      console.log("[story] candidate-accept", (e as CustomEvent).detail),
    );
    el.addEventListener("candidate-delete", (e) =>
      console.log("[story] candidate-delete", (e as CustomEvent).detail),
    );
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    status: { control: "radio", options: ["candidate", "accepted", "deleted"] },
    withThumbnail: { control: "boolean" },
  },
  args: {
    status: "candidate",
    withThumbnail: true,
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const NoThumbnail: Story = {
  args: { status: "candidate", withThumbnail: false },
};

export const Accepted: Story = {
  args: { status: "accepted", withThumbnail: true },
};
