/**
 * Stories for `<annot-apply-redactions-button>`.
 *
 * Phase 3 of `docs/plans/_done/redact-burn-into-image.md`. The button
 * gates on `count > 0`; the disabled-zero variant covers the
 * "host mounts the button regardless, lets the count drop to 0
 * after a successful burn" story.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-apply-redactions-button.js";

interface Args {
  count: number;
  /** Storybook control flag — when true, leaves `onApply` unset to
   *  exercise the "host hasn't supplied a callback" disabled state. */
  unsetOnApply: boolean;
}

const meta: Meta<Args> = {
  title: "Editor / RightPanelSections / right-panel.apply-redactions",
  render: (args) => {
    const wrapper = document.createElement("div");
    // Mirror the right-panel's column flex so the button takes the
    // full panel width. The PWA right-panel is 240 px wide; the
    // button labels itself, so we leave the wrapper a touch wider
    // for the story preview to show the full label without
    // wrapping.
    wrapper.style.width = "260px";
    wrapper.style.padding = "12px";
    wrapper.style.background = "var(--annot-bg-panel, #1e1e1e)";
    const el = document.createElement("annot-apply-redactions-button");
    el.count = args.count;
    el.onApply = args.unsetOnApply
      ? null
      : async () => {
          console.log("[story] apply-redactions onApply", { count: args.count });
          return { count: args.count };
        };
    el.addEventListener("applied", (e) => {
      console.log("[story] applied event", (e as CustomEvent).detail);
    });
    wrapper.appendChild(el);
    return wrapper;
  },
  argTypes: {
    count: { control: { type: "number", min: 0, max: 99 } },
    unsetOnApply: { control: "boolean" },
  },
};
export default meta;

type Story = StoryObj<Args>;

/** Default (active) state — three redactions pending. Clicking
 *  opens the confirm modal. */
export const Default: Story = {
  args: { count: 3, unsetOnApply: false },
};

/** Single-redaction copy ("1 redaction(s)"). The plan's body text
 *  intentionally uses the same string for 1 / N — keeping the
 *  pluralisation simple under happy-dom, where Intl.PluralRules
 *  isn't always plumbed in test environments. */
export const SingleRedaction: Story = {
  args: { count: 1, unsetOnApply: false },
};

/** Many redactions — confirm the dialog body still reads cleanly
 *  with a large count (no scrollbar / overflow). */
export const ManyRedactions: Story = {
  args: { count: 25, unsetOnApply: false },
};

/** Disabled because the document has no redactions. The host can
 *  always mount the button; the count gate handles visibility. */
export const ZeroCountDisabled: Story = {
  name: "Zero count (disabled)",
  args: { count: 0, unsetOnApply: false },
};

/** Disabled because the host hasn't supplied an `onApply` callback.
 *  Demonstrates the dual-gate (`count > 0` AND `onApply !== null`). */
export const NoApplyCallback: Story = {
  name: "No onApply callback (disabled)",
  args: { count: 3, unsetOnApply: true },
};
