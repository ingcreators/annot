/**
 * Stories for `<annot-template-picker>` — modal picker for
 * built-in + user templates with a recently-used row.
 *
 * Phase 8c of `docs/plans/annot-html-document.md`. The stories
 * exercise:
 *
 *   - **Default** — a mix of built-in starter cards + user
 *     templates, including the recently-used row.
 *   - **EmptyState** — neither built-ins nor user templates;
 *     the "coming soon" + "no user templates yet" copy.
 *   - **OnlyUser** — built-in section empty (Phase 9 will
 *     populate); user templates fill the grid.
 *   - **Loading** — `loadingUser=true`; user section shows
 *     the spinner copy.
 *   - **WithRecent** — recently-used row populated by
 *     pre-seeded localStorage.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-template-picker.js";
import {
  type AnnotTemplatePickerElement,
  type BuiltinTemplateEntry,
  recordRecentTemplateId,
  type TemplateSelectedDetail,
  type UserTemplateEntry,
} from "./annot-template-picker.js";

interface Args {
  userTemplates: readonly UserTemplateEntry[];
  builtinTemplates: readonly BuiltinTemplateEntry[];
  loadingUser: boolean;
  recentKey: string;
}

const SAMPLE_USER: readonly UserTemplateEntry[] = [
  {
    path: "Templates/onboarding-walkthrough.annot.html",
    title: "Onboarding walkthrough",
    description:
      "First-run tour for new teammates. Covers signup, project creation, and the first capture.",
    tags: ["onboarding", "manual"],
  },
  {
    path: "Templates/bug-report.annot.html",
    title: "Bug report",
    description: "Steps-to-reproduce + expected vs actual + screenshots.",
    tags: ["bug", "qa"],
  },
  {
    path: "Templates/feature-spec.annot.html",
    title: "Feature spec",
  },
];

const SAMPLE_BUILTIN: readonly BuiltinTemplateEntry[] = [
  {
    id: "manual",
    title: "Manual",
    description: "Step-by-step starter for end-user manuals.",
  },
  {
    id: "feature-guide",
    title: "Feature guide",
    description: "Marketing-shaped walkthrough for a single feature.",
  },
  {
    id: "procedure",
    title: "Procedure",
    description: "Numbered runbook for an operational task.",
  },
];

const meta: Meta<Args> = {
  title: "Doc / TemplatePicker",
  render: (args) => {
    const wrapper = document.createElement("div");
    wrapper.style.padding = "1.5rem";
    wrapper.style.background = "var(--annot-doc-bg, #ffffff)";
    wrapper.style.maxWidth = "920px";
    const picker = document.createElement("annot-template-picker") as AnnotTemplatePickerElement;
    picker.userTemplates = args.userTemplates;
    picker.builtinTemplates = args.builtinTemplates;
    picker.loadingUser = args.loadingUser;
    picker.recentKey = args.recentKey;
    picker.addEventListener("template-selected", (e) => {
      console.log("[story] template-selected:", (e as CustomEvent<TemplateSelectedDetail>).detail);
    });
    wrapper.appendChild(picker);
    return wrapper;
  },
  argTypes: {
    userTemplates: { control: false },
    builtinTemplates: { control: false },
    loadingUser: { control: "boolean" },
    recentKey: { control: false },
  },
  args: {
    userTemplates: SAMPLE_USER,
    builtinTemplates: [],
    loadingUser: false,
    recentKey: "annot-template-picker-stories",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const Default: Story = {
  args: {
    userTemplates: SAMPLE_USER,
    builtinTemplates: SAMPLE_BUILTIN,
    loadingUser: false,
    recentKey: "annot-template-picker-stories",
  },
};

export const EmptyState: Story = {
  args: {
    userTemplates: [],
    builtinTemplates: [],
    loadingUser: false,
    recentKey: "annot-template-picker-stories-empty",
  },
};

export const OnlyUser: Story = {
  args: {
    userTemplates: SAMPLE_USER,
    builtinTemplates: [],
    loadingUser: false,
    recentKey: "annot-template-picker-stories-onlyuser",
  },
};

export const Loading: Story = {
  args: {
    userTemplates: [],
    builtinTemplates: [],
    loadingUser: true,
    recentKey: "annot-template-picker-stories-loading",
  },
};

export const WithRecent: Story = {
  args: {
    userTemplates: SAMPLE_USER,
    builtinTemplates: SAMPLE_BUILTIN,
    loadingUser: false,
    recentKey: "annot-template-picker-stories-recent",
  },
  loaders: [
    async () => {
      // Pre-seed two recents so the chip row appears on load.
      recordRecentTemplateId(
        "Templates/onboarding-walkthrough.annot.html",
        "annot-template-picker-stories-recent",
      );
      recordRecentTemplateId("manual", "annot-template-picker-stories-recent");
      return {};
    },
  ],
};
