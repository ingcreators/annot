/**
 * Stories for `<annot-icon>` — exercises each `IconSpec.kind`
 * variant and a sampling of registry ids so reviewers can
 * eyeball the visual contract.
 *
 * Phase 4a of `docs/plans/svg-icons-and-plugin-icon-spec.md`.
 */

import { builtinIcon, type IconSpec, svgIcon, urlIcon } from "@ingcreators/annot-core";
import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./annot-icon.js";

interface Args {
  spec: IconSpec | null;
  size: string;
  color: string;
}

function host(args: Args): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "8px";
  wrap.style.fontSize = args.size;
  wrap.style.color = args.color;

  const icon = document.createElement("annot-icon");
  icon.style.width = "1em";
  icon.style.height = "1em";
  if (args.spec) icon.spec = args.spec;
  wrap.appendChild(icon);

  const label = document.createElement("span");
  label.style.fontSize = "14px";
  label.style.color = "var(--annot-text-muted, #666)";
  label.textContent = args.spec
    ? `kind: "${args.spec.kind}"${args.spec.kind === "builtin" ? ` / id: "${args.spec.id}"` : ""}`
    : "(no spec)";
  wrap.appendChild(label);
  return wrap;
}

const meta: Meta<Args> = {
  title: "UI / AnnotIcon",
  render: host,
  argTypes: {
    size: { control: "text" },
    color: { control: "color" },
  },
  args: {
    spec: builtinIcon("edit"),
    size: "24px",
    color: "var(--annot-text, #222)",
  },
};
export default meta;

type Story = StoryObj<Args>;

export const BuiltinEdit: Story = {
  name: "Builtin — edit",
  args: { spec: builtinIcon("edit") },
};

export const BuiltinCloud: Story = {
  name: "Builtin — cloud",
  args: { spec: builtinIcon("cloud") },
};

export const BuiltinShapeRect: Story = {
  name: "Builtin — shape.rect (hand-rolled)",
  args: { spec: builtinIcon("shape.rect") },
};

export const BuiltinArrowBoth: Story = {
  name: "Builtin — arrow.both (hand-rolled)",
  args: { spec: builtinIcon("arrow.both") },
};

export const Large48px: Story = {
  name: "Builtin — 48px size",
  args: { spec: builtinIcon("delete"), size: "48px" },
};

export const ColouredAccent: Story = {
  name: "Builtin — currentColor accent",
  args: { spec: builtinIcon("highlight"), color: "#cc3366" },
};

export const PluginSvg: Story = {
  name: "kind: svg — plugin-supplied logomark (sanitised)",
  args: {
    spec: svgIcon(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="9"/>
        <path d="M8 12l3 3 5-6"/>
      </svg>`,
    ),
  },
};

export const PluginSvgWithScript: Story = {
  name: "kind: svg — sanitiser strips embedded <script>",
  args: {
    spec: svgIcon(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert('XSS')">
        <script>alert('XSS')</script>
        <circle cx="12" cy="12" r="9" fill="currentColor"/>
      </svg>`,
    ),
  },
};

export const UrlSameOrigin: Story = {
  name: "kind: url — same-origin path (rendered as <img>)",
  args: {
    spec: urlIcon(
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><circle cx='12' cy='12' r='9' fill='%2369c'/></svg>",
    ),
  },
};

export const UrlExternalRejected: Story = {
  name: "kind: url — external https rejected (renders nothing)",
  args: { spec: urlIcon("https://evil.test/icon.svg") },
};

export const UnknownBuiltinId: Story = {
  name: "kind: builtin — unknown id renders nothing",
  args: { spec: builtinIcon("definitely-not-a-real-id") },
};

export const NoSpec: Story = {
  name: "spec = null",
  args: { spec: null },
};
