/**
 * Stories for the built-in `drawer.last-commit` section — author /
 * date / message headline + short SHA for the file's most recent
 * commit. Phase 1 of `docs/plans/litelement-stories-coverage.md`
 * adds this story so the GitHub-only commit row has visible
 * coverage independent of the parent drawer host story.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./last-commit-section.js";
import { createDrawerSectionFrame } from "./helpers.js";
import type { LastCommitInfo } from "../file-details-drawer-types.js";

interface Args {
  authorName: string;
  authorAvatarUrl?: string;
  date: string;
  messageHeadline: string;
  shortSha: string;
  url?: string;
}

const meta: Meta<Args> = {
  title: "Editor / DrawerSections / drawer.last-commit",
  render: (args) => {
    const commit: LastCommitInfo = {
      authorName: args.authorName,
      authorAvatarUrl: args.authorAvatarUrl || undefined,
      date: args.date,
      messageHeadline: args.messageHeadline,
      shortSha: args.shortSha,
      url: args.url || undefined,
    };
    const frame = createDrawerSectionFrame("Last commit");
    const section = document.createElement("annot-drawer-last-commit-section");
    section.commit = commit;
    frame.body.appendChild(section);
    const wrapper = document.createElement("aside");
    wrapper.className = "file-details-drawer";
    wrapper.appendChild(frame.section);
    return wrapper;
  },
  argTypes: {
    authorName: { control: "text" },
    authorAvatarUrl: { control: "text" },
    date: { control: "text" },
    messageHeadline: { control: "text" },
    shortSha: { control: "text" },
    url: { control: "text" },
  },
  args: {
    authorName: "alice",
    authorAvatarUrl: "https://github.com/github.png",
    date: "2026-04-25T09:00:00Z",
    messageHeadline: "Add Phase 2 drawer migration",
    shortSha: "a1b2c3d",
    url: "https://github.com/ingcreators/annot/commit/a1b2c3d",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {};

export const WithoutAvatar: Story = {
  args: {
    authorName: "bob",
    authorAvatarUrl: "",
    date: "2026-04-24T14:30:00Z",
    messageHeadline: "Update docs",
    shortSha: "9876abc",
    url: "",
  },
};

export const WithoutLink: Story = {
  args: {
    authorName: "carol",
    authorAvatarUrl: "https://github.com/github.png",
    date: "2026-04-23T08:15:00Z",
    messageHeadline: "Initial import — no public commit URL yet",
    shortSha: "0001234",
    url: "",
  },
};

export const LongMessage: Story = {
  args: {
    authorName: "dave",
    authorAvatarUrl: "https://github.com/github.png",
    date: "2026-04-22T11:45:00Z",
    messageHeadline:
      "An exceptionally long commit message headline that overflows the drawer panel column and truncates",
    shortSha: "deadbee",
    url: "https://github.com/ingcreators/annot/commit/deadbee",
  },
};
