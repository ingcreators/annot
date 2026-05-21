// Stage 5a: Render the MDX to a minimal HTML page.
//
// The PoC's HTML is intentionally simple — just enough to prove
// that the same MDX file feeds both web and Excel outputs.
// Phase 2 (Astro adapter) will produce a fully styled page with
// proper component implementations.

import { writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { ParsedMdx } from "./parse-mdx.ts";

export async function renderHtml(opts: {
  parsed: ParsedMdx;
  annotatedPngPath: string;
  outPath: string;
}): Promise<void> {
  const { frontmatter, screens, transitions } = opts.parsed;

  // Relative path from output file to annotated PNG.
  const pngRel = relativePath(opts.outPath, opts.annotatedPngPath);

  const overlays = screens.flatMap((s) =>
    s.overlays.map((o, idx) => ({ index: o.number ?? idx + 1, ...o })),
  );

  const transitionsList = transitions
    .map((t) => {
      const trigger = `role="${t.trigger.role}", name="${t.trigger.name}"`;
      const onLabel = t.on ? `(${escapeHtml(t.on)})` : "";
      const target = t.to ? `→ <code>${escapeHtml(t.to)}</code>` : "";
      const body = t.body ? ` — ${escapeHtml(t.body)}` : "";
      return `<li><strong>${escapeHtml(trigger)}</strong> ${onLabel} ${target}${body}</li>`;
    })
    .join("\n");

  const overlayItems = overlays
    .sort((a, b) => a.index - b.index)
    .map((o) => {
      const matchLabel = `role="${o.match.role}", name="${o.match.name}"`;
      return `
        <li>
          <strong>${o.index}. ${escapeHtml(o.match.name)}</strong>
          <small style="color:#666"> (${escapeHtml(matchLabel)})</small>
          <div class="overlay-body">${markdownToHtml(o.body)}</div>
        </li>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(frontmatter.title ?? frontmatter.id)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 1200px; margin: 40px auto; padding: 0 20px; color: #111827; line-height: 1.6; }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin-top: 32px; }
    .meta { color: #6b7280; font-size: 13px; margin-bottom: 24px; }
    .screenshot { border: 1px solid #e5e7eb; border-radius: 8px; max-width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
    ol.overlays { padding-left: 20px; }
    ol.overlays li { margin-bottom: 16px; }
    .overlay-body { background: #f9fafb; padding: 12px; border-radius: 6px; margin-top: 6px; }
    ul.transitions li { margin-bottom: 6px; }
    code { background: #f3f4f6; padding: 2px 6px; border-radius: 3px; font-size: 90%; }
    blockquote { border-left: 3px solid #d1d5db; padding: 8px 16px; margin: 8px 0; background: #fef3c7; }
  </style>
</head>
<body>
  <h1>${escapeHtml(frontmatter.title ?? frontmatter.id)} <small style="color:#9ca3af">(${escapeHtml(frontmatter.id)})</small></h1>
  <div class="meta">
    ${frontmatter.purpose ? `<div><strong>Purpose:</strong> ${escapeHtml(frontmatter.purpose)}</div>` : ""}
    ${formatMeta(frontmatter.meta)}
  </div>

  <img class="screenshot" src="${pngRel}" alt="${escapeHtml(frontmatter.title ?? frontmatter.id)}" />

  <h2>Items</h2>
  <ol class="overlays">${overlayItems}</ol>

  ${transitions.length ? `<h2>Transitions</h2><ul class="transitions">${transitionsList}</ul>` : ""}
</body>
</html>
`;

  await writeFile(opts.outPath, html, "utf8");
}

function formatMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) return "";
  const entries = Object.entries(meta).map(
    ([k, v]) =>
      `<span style="margin-right: 16px"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</span>`,
  );
  return `<div>${entries.join("")}</div>`;
}

function relativePath(from: string, to: string): string {
  const fromDir = dirname(from);
  // Naive: if both are in the same directory, just use basename.
  if (fromDir === dirname(to)) return basename(to);
  // Otherwise, use the absolute "to" — PoC doesn't need fancy
  // relative-path computation.
  return to;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function markdownToHtml(md: string): string {
  // Very small Markdown subset: paragraphs, **bold**, > blockquote,
  // - list items. Sufficient for the PoC. Phase 1 will use a real
  // Markdown renderer (remark or micromark).
  let out = md.trim();
  if (!out) return "";

  // Blockquotes
  out = out.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");

  // List items
  out = out.replace(/^- (.+)$/gm, "<li>$1</li>");
  out = out.replace(/(<li>[\s\S]*?<\/li>(?:\s*<li>[\s\S]*?<\/li>)*)/g, "<ul>$1</ul>");

  // Paragraph wrapping (very rough)
  out = out
    .split(/\n\s*\n/)
    .map((p) => (p.startsWith("<") ? p : `<p>${p}</p>`))
    .join("\n");

  return out;
}
