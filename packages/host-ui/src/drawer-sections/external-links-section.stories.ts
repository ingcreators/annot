/**
 * Stories for the built-in `drawer.external-links` section — the
 * stack of plugin-contributed external links inside
 * `<annot-file-details-drawer>` (today's `github-external-links`
 * built-in plugin contributes "View on GitHub"; future plugins
 * stack their own).
 *
 * Phase 1 of `docs/plans/litelement-stories-coverage.md`. The
 * wrapper mirrors the drawer's section frame so the link rows
 * land in the same chrome users see in the app.
 */

import { builtinIcon } from "@ingcreators/annot-core";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./external-links-section.js";
import type { ExternalLinkEntry } from "./external-links-section.js";
import { createDrawerSectionFrame } from "./helpers.js";

interface Args {
  links: ExternalLinkEntry[];
}

const meta: Meta<Args> = {
  title: "Editor / DrawerSections / drawer.external-links",
  render: (args) => {
    const frame = createDrawerSectionFrame("Links");
    const section = document.createElement("annot-drawer-external-links-section");
    section.links = args.links;
    frame.body.appendChild(section);
    const wrapper = document.createElement("aside");
    wrapper.className = "file-details-drawer";
    wrapper.appendChild(frame.section);
    return wrapper;
  },
  argTypes: {
    links: { control: false },
  },
  args: {
    links: [
      {
        label: "View on GitHub",
        url: "https://github.com/ingcreators/annot/blob/main/image.png",
        icon: builtinIcon("open_in_new"),
      },
    ],
  },
};
export default meta;

type Story = StoryObj<Args>;

export const SingleLink: Story = {
  args: {
    links: [
      {
        label: "View on GitHub",
        url: "https://github.com/ingcreators/annot/blob/main/image.png",
        icon: builtinIcon("open_in_new"),
      },
    ],
  },
};

export const MultiplePluginLinks: Story = {
  args: {
    links: [
      { label: "View on GitHub", url: "https://github.com/foo", icon: builtinIcon("open_in_new") },
      {
        label: "JIRA ticket",
        url: "https://example.atlassian.net/browse/FOO-123",
        icon: builtinIcon("task"),
      },
      {
        label: "Team thread",
        url: "https://example.slack.com/archives/ABC",
        icon: builtinIcon("chat"),
      },
    ],
  },
};

export const NoIcons: Story = {
  args: {
    links: [
      { label: "Spec", url: "https://example.com/spec/v1" },
      { label: "Design doc", url: "https://example.com/design/v2" },
    ],
  },
};
