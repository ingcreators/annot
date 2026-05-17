/**
 * Stories for `<annot-doc-image-editor-modal>` — Phase 5a of
 * `docs/plans/_done/annot-html-document.md`.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-doc-image-editor-modal.js";
import {
  AnnotDocImageEditorModalElement,
  type ImageEditorModalInput,
  type ImageEditorModalResult,
} from "./annot-doc-image-editor-modal.js";

interface Args {
  input: ImageEditorModalInput;
}

const PNG_PIXEL =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" data-annot-version="1" viewBox="0 0 800 480" width="800" height="480"><image href="${PNG_PIXEL}" width="800" height="480"/><g id="annotations"></g></svg>`;

const meta: Meta<Args> = {
  title: "Doc / DocImageEditorModal",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "32px";
    wrapper.style.background = "#f3f4f6";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Open image editor";
    trigger.style.padding = "8px 12px";
    trigger.addEventListener("click", () => {
      AnnotDocImageEditorModalElement.openFor(args.input).then((result: ImageEditorModalResult) => {
        console.log("[story] image-editor-modal result:", result);
      });
    });
    wrapper.appendChild(trigger);

    const hint = document.createElement("div");
    hint.style.marginTop = "12px";
    hint.style.color = "#6b7280";
    hint.textContent =
      "Click the button above to open the modal. Save / Cancel resolves a promise.";
    wrapper.appendChild(hint);

    return wrapper;
  },
  argTypes: {
    input: { control: false },
  },
  args: {
    input: { id: "story-img", svg: SAMPLE_SVG },
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

/** Phase 5 of `card-document-image-gallery-link-sync.md` — when
 *  the block was inserted from a gallery selection, the modal
 *  header surfaces a "Linked to gallery" badge + an Unlink
 *  action. Clicking the action confirms via dialog and hides
 *  the badge; the next Save returns `unlinked: true`. */
export const Linked: Story = {
  args: {
    input: {
      id: "story-img",
      svg: SAMPLE_SVG,
      sourceImagePath: "Screenshots/Mobile/login-flow.png",
      positionInImages: 1,
      totalImages: 1,
    },
  },
};

/** A doc-only block (no `sourceImagePath`) renders without the
 *  link badge — same shape as a Phase-0 modal session. */
export const Unlinked: Story = {
  args: {
    input: {
      id: "story-img",
      svg: SAMPLE_SVG,
      positionInImages: 2,
      totalImages: 5,
    },
  },
};
