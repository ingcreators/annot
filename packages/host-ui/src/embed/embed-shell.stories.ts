/**
 * Stories for `<annot-embed-shell>` — the visitor-facing element
 * that boots the Annot editor inside `annot.work/embed` against a
 * GitHub-App-backed store (Phase 6 follow-up 5y-3).
 *
 * What these stories can and can't show: a *successful* mount
 * needs a live `/api/embed/load` backend + a real browser
 * `EditorShell` canvas, neither of which exists in Storybook. So
 * the stories reproduce the two states a visitor actually sees
 * before the editor is interactive — the **loading slot** (what
 * the worker's `page.ts` emits inside the element) and the
 * **error contract** (missing / invalid embed params, surfaced as
 * the host page's warning banner). Each mirrors the real embed
 * page's markup + CSS so the composition matches production.
 *
 * No story triggers a real mount: without valid `data-embed-params`
 * the element's `firstUpdated` fails closed before any network
 * call, so nothing hits the wire.
 */

import type { Meta, StoryObj } from "@storybook/web-components-vite";
import "./embed-shell.js";
import type { AnnotEmbedShellElement, EmbedShellErrorDetail } from "./embed-shell.js";

interface Args {
  /**
   * Value for the element's `data-embed-params` attribute (the
   * JSON object the worker's `page.ts` writes). `undefined` omits
   * the attribute entirely — the "missing params" path. A partial
   * object exercises the validation-error path.
   */
  params: Record<string, string> | undefined;
  /**
   * When true, the wrapper mirrors the host page by swapping the
   * loading slot for an `.embed-warning` banner on the element's
   * `error` event. When false, errors are only logged so the
   * loading slot stays visible.
   */
  surfaceErrors: boolean;
}

// Mirrors the `<style>` block the worker's `page.ts` inlines around
// `<annot-embed-shell>` so the story composes exactly like /embed.
const EMBED_PAGE_CSS = `
  .embed-page {
    width: 900px;
    height: 560px;
    background: #fafafa;
    color: #222;
    font-family: system-ui, sans-serif;
    border: 1px solid var(--annot-border, #ddd);
    border-radius: 8px;
    overflow: hidden;
    position: relative;
  }
  .embed-page annot-embed-shell { display: block; width: 100%; height: 100%; }
  .embed-page .embed-loading {
    display: flex; align-items: center; justify-content: center;
    height: 100%; color: #555; font-size: 0.95rem;
  }
  .embed-page .embed-warning {
    display: block; padding: 0.75rem 1rem;
    background: #fef3c7; color: #92400e; font-size: 0.9rem;
  }
`;

const meta: Meta<Args> = {
  title: "Editor / EmbedShell",
  render: (args) => {
    const wrapper = document.createElement("div");
    const style = document.createElement("style");
    style.textContent = EMBED_PAGE_CSS;
    wrapper.appendChild(style);

    const page = document.createElement("div");
    page.className = "embed-page";
    wrapper.appendChild(page);

    const shell = document.createElement("annot-embed-shell") as AnnotEmbedShellElement;
    // The embed page always serves off the cloud origin; a
    // placeholder keeps `inferCloudUrl()` from reading the
    // Storybook origin.
    shell.setAttribute("data-cloud-url", "https://annot.work");
    if (args.params !== undefined) {
      shell.setAttribute("data-embed-params", JSON.stringify(args.params));
    }

    // The loading slot the worker's page.ts puts inside the element.
    const loading = document.createElement("div");
    loading.className = "embed-loading";
    loading.textContent = "Loading editor…";
    shell.appendChild(loading);

    shell.addEventListener("mounted", (e) => {
      console.log("[story] embed-shell mounted", (e as CustomEvent).detail);
    });
    // Annotate as `Event`: "error" is a built-in event name typed
    // `ErrorEvent` in the DOM event map, so we downcast from the base
    // `Event` to the CustomEvent the shell actually dispatches.
    shell.addEventListener("error", (e: Event) => {
      const detail = (e as CustomEvent<EmbedShellErrorDetail>).detail;
      console.log("[story] embed-shell error", detail);
      if (args.surfaceErrors) {
        const banner = document.createElement("div");
        banner.className = "embed-warning";
        banner.textContent = `Could not open the editor: ${detail.reason}`;
        // Mirror the host page: replace the shell content with the
        // warning so the visitor sees why nothing loaded.
        page.replaceChildren(banner);
      }
    });

    page.appendChild(shell);
    return wrapper;
  },
  argTypes: {
    params: { control: false },
    surfaceErrors: { control: "boolean" },
  },
  args: {
    params: undefined,
    surfaceErrors: false,
  },
};

export default meta;

type Story = StoryObj<Args>;

export const Loading: Story = {
  name: "Loading slot (pre-mount)",
  args: {
    params: undefined,
    surfaceErrors: false,
  },
};

export const InvalidParameters: Story = {
  name: "Invalid embed params → warning banner",
  args: {
    // Missing `pngPath` / `annotationsPath` / `return` — the
    // element's `parseEmbedRequestUrl` rejects it before any fetch.
    params: { repo: "octocat/demo-docs", mode: "newTab", v: "1" },
    surfaceErrors: true,
  },
};
