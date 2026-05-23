/**
 * `<annot-embed-shell>` — Phase 6 follow-up 5y-3.
 *
 * The visitor-facing Lit element that mounts the Annot
 * `EditorShell` against a GitHub-App-backed StorageProvider
 * (`GitHubAppStorageProvider`). Lives inside the
 * `annot.work/embed` static page emitted by the Worker (5y-3's
 * `page.ts`), but also bundles independently for self-host
 * deployments per 5z-2.
 *
 * Lifecycle:
 *
 *   1. `connectedCallback` reads the `data-embed-params` attribute
 *      the page emitter wrote into the element + parses via
 *      `parseEmbedRequestUrl` from `@ingcreators/annot-embed-protocol`.
 *      Malformed params → renders a fatal-error slot.
 *   2. Constructs a `GitHubAppStorageProvider` from the parsed
 *      params, mounts an `EditorShell` against an internal
 *      container, and calls `shell.open(pngPath)` to load the
 *      file off the cloud-side `/api/embed/load` endpoint.
 *   3. Posts `EditorReady` via `createEmbedClientMessenger` when
 *      `mode === "inline"`. `mode === "newTab"` is the same
 *      flow without the postMessage step (the editor stands
 *      alone in its own tab).
 *   4. 5y-4 lights up the save flow (`updateImage` on the store
 *      proxies to `/api/embed/commit`).
 *   5. 5y-5 lights up the post-save redirect (`window.location`
 *      to `returnUrl#edit-complete=…` for newTab; `EditCommitted`
 *      postMessage for inline).
 *
 * Light DOM rendering — global host-ui CSS applies, matching the
 * convention in the Lit migration plan.
 *
 * The 5y-3 PR ships SOURCES only — the deployable JS bundle that
 * the `/embed` page loads at `/embed/shell.js` is a future
 * Cloudflare Pages deploy step (tracked as a follow-up infra
 * task). Tests in `embed-shell.test.ts` exercise the lifecycle
 * via happy-dom + stubbed `EditorShell`.
 */

import {
  createEmbedClientMessenger,
  EMBED_PROTOCOL_VERSION,
  type EmbedMessenger,
  EmbedRequestUrlError,
  encodeEmbedReturnHash,
  parseEmbedRequestUrl,
} from "@ingcreators/annot-embed-protocol";
import { EditorShell, type EditorShellHost } from "../editor-shell.js";
import { html, LitElement } from "../lit.js";
import { EmbedCommitConflictError, GitHubAppStorageProvider } from "./github-app-store.js";

/** Detail payload for the `mounted` CustomEvent fired after the
 *  EditorShell has successfully loaded the requested file. Tests
 *  and hosts can listen for this to know when the editor is
 *  interactive. */
export interface EmbedShellMountedDetail {
  pngPath: string;
  annotationsPath: string;
  repo: string;
  branch: string;
}

/** Detail payload for the `error` CustomEvent fired when the
 *  shell fails to parse params, fetch the file, or mount the
 *  editor. The reason text is user-presentable English. */
export interface EmbedShellErrorDetail {
  reason: string;
  cause?: unknown;
}

/** Construction-time options. The shell typically reads params
 *  off its DOM attribute, but tests / hosts can pass these
 *  directly via `mount(opts)` to avoid the attribute step. */
export interface EmbedShellMountOpts {
  cloudUrl: string;
  repo: string;
  pngPath: string;
  annotationsPath: string;
  returnUrl: string;
  mode: "newTab" | "inline";
  /** Optional explicit editId. Defaults to `crypto.randomUUID()`.
   *  Tests override this for deterministic assertions. */
  editId?: string;
  /** Override the global `fetch` (mostly for tests). */
  fetchImpl?: typeof fetch;
  /** Override the EditorShell constructor (for tests). */
  editorShellFactory?: (host: EditorShellHost) => EditorShell;
  /** Override the redirect call (for tests). Defaults to
   *  `window.location.replace`. */
  redirectImpl?: (url: string) => void;
}

const PARAMS_ATTRIBUTE = "data-embed-params";

export class AnnotEmbedShellElement extends LitElement {
  static override properties = {
    cloudUrl: { type: String, attribute: "data-cloud-url" },
  };

  declare cloudUrl: string;

  /** The mounted EditorShell instance, or null before mount /
   *  after destroy. Tests + hosts read this to verify wiring. */
  #editorShell: EditorShell | null = null;
  /** The GitHub-App-backed StorageProvider, or null before mount. */
  #store: GitHubAppStorageProvider | null = null;
  /** Embed-mode messenger, or null when in newTab mode. */
  #messenger: EmbedMessenger | null = null;
  /** Set once `mount()` has run, so a stray `connectedCallback`
   *  on Lit re-render doesn't double-mount. */
  #mounted = false;
  /** Internal container that EditorShell mounts its `<svg>` into.
   *  Created in `firstUpdated` so the Light-DOM children are in
   *  the DOM by the time EditorShell looks for them. */
  #shellContainer: HTMLDivElement | null = null;
  /** Embed mode + returnUrl + editId snapshot taken at mount.
   *  `save()` / `abandon()` read this to decide between the
   *  newTab hash-redirect path and the inline postMessage path. */
  #mountSnapshot: {
    mode: "newTab" | "inline";
    returnUrl: string;
    editId: string;
  } | null = null;
  /** Optional override for the post-save redirect / postMessage.
   *  Lets tests assert the redirect target without actually
   *  navigating. */
  #onSaveRedirect: ((url: string) => void) | null = null;

  constructor() {
    super();
    this.cloudUrl = "";
  }

  /** Light DOM — the host page emitter's CSS targets
   *  `#embed-mount` directly. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override render() {
    // The Light-DOM template carries a default loading slot the
    // host page's `<annot-embed-shell>` opening tag already
    // contains. We render a deterministic structure so
    // `firstUpdated` can find the container reliably.
    return html`
      <div class="annot-embed-shell-host" data-annot-embed-host>
        <slot></slot>
      </div>
    `;
  }

  override async firstUpdated(): Promise<void> {
    if (this.#mounted) return;
    const raw = this.getAttribute(PARAMS_ATTRIBUTE);
    if (!raw) {
      this.#emitError("Missing embed parameters.");
      return;
    }
    let params: Record<string, string>;
    try {
      params = JSON.parse(raw) as Record<string, string>;
    } catch (cause) {
      this.#emitError("Failed to parse embed parameters.", cause);
      return;
    }
    const search = new URLSearchParams(params);
    try {
      const parsed = parseEmbedRequestUrl(search);
      await this.mount({
        cloudUrl: this.cloudUrl || inferCloudUrl(),
        repo: parsed.repo,
        pngPath: parsed.pngPath,
        annotationsPath: parsed.annotationsPath,
        returnUrl: parsed.returnUrl,
        mode: parsed.mode === "inline" ? "inline" : "newTab",
      });
    } catch (err) {
      const message =
        err instanceof EmbedRequestUrlError
          ? `Invalid embed parameters: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      this.#emitError(message, err);
    }
  }

  /** Public mount entry point. Reads the embed params + boots
   *  the editor. Exposed (vs. doing this entirely inside
   *  `firstUpdated`) so tests can drive the lifecycle without
   *  attribute round-tripping. */
  async mount(opts: EmbedShellMountOpts): Promise<void> {
    if (this.#mounted) {
      throw new Error("annot-embed-shell already mounted");
    }
    this.#mounted = true;

    this.#ensureContainer();

    const store = new GitHubAppStorageProvider({
      cloudUrl: opts.cloudUrl,
      repo: opts.repo,
      pngPath: opts.pngPath,
      annotationsPath: opts.annotationsPath,
      fetchImpl: opts.fetchImpl,
    });
    this.#store = store;

    const host: EditorShellHost = {
      container: this.#shellContainer as HTMLDivElement,
      storage: store,
    };
    const editorShell = opts.editorShellFactory
      ? opts.editorShellFactory(host)
      : new EditorShell(host);
    this.#editorShell = editorShell;

    try {
      const record = await store.getImage(opts.pngPath);
      if (!record) {
        throw new Error(`No image returned from /api/embed/load for ${opts.pngPath}`);
      }
      editorShell.mountFromRecord(opts.pngPath, record, {
        annotationsYamlPath: opts.pngPath,
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.#emitError(`Failed to load file from GitHub: ${message}`, cause);
      return;
    }

    // Hide the default loading slot once the editor is mounted.
    const loadingChildren = this.querySelectorAll<HTMLElement>(".embed-loading");
    for (const child of loadingChildren) {
      child.style.display = "none";
    }

    const editId = opts.editId ?? crypto.randomUUID();
    this.#mountSnapshot = { mode: opts.mode, returnUrl: opts.returnUrl, editId };
    this.#onSaveRedirect = opts.redirectImpl ?? null;

    if (opts.mode === "inline") {
      this.#messenger = createEmbedClientMessenger({
        parentOrigin: inferParentOrigin(opts.returnUrl),
        onEvent: () => {
          // Future: parent → editor requests (discard / blur).
        },
      });
      this.#messenger.sendEvent({
        type: "EditorReady",
        protocolVersion: EMBED_PROTOCOL_VERSION,
        editorId: editId,
      });
    }

    const repoState = store.repoState;
    this.dispatchEvent(
      new CustomEvent<EmbedShellMountedDetail>("mounted", {
        detail: {
          pngPath: opts.pngPath,
          annotationsPath: opts.annotationsPath,
          repo: opts.repo,
          branch: repoState?.branch ?? "",
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Persist the current edit. Posts to `/api/embed/commit` via
   *  the storage provider, then triggers the post-save redirect
   *  (newTab) or `EditCommitted` postMessage (inline). Throws
   *  `EmbedCommitConflictError` on 409 so callers can prompt
   *  reload + retry. */
  async save(
    opts: { annotationsYaml: string; pngBase64?: string; pngSha?: string } = {
      annotationsYaml: "",
    },
  ): Promise<void> {
    if (!this.#store) {
      throw new Error("save() called before mount");
    }
    if (!this.#mountSnapshot) {
      throw new Error("save() called before mount snapshot was captured");
    }
    const snapshot = this.#mountSnapshot;
    const yaml = opts.annotationsYaml || this.#store.repoState?.annotationsYaml || "";
    try {
      const response = await this.#store.commit({
        editId: snapshot.editId,
        annotationsYaml: yaml,
        pngBase64: opts.pngBase64,
        pngSha: opts.pngSha,
      });
      if (!response.ok) {
        throw new Error(`commit failed: ${response.error}`);
      }
      if (snapshot.mode === "inline" && this.#messenger) {
        this.#messenger.sendEvent({
          type: "EditCommitted",
          editId: snapshot.editId,
          commitSha: response.commitSha,
          branch: response.branch,
          prUrl: response.prUrl,
        });
      } else {
        const hash = encodeEmbedReturnHash({ kind: "complete", editId: snapshot.editId });
        const target = appendHash(snapshot.returnUrl, hash);
        this.#redirect(target);
      }
    } catch (err) {
      if (err instanceof EmbedCommitConflictError) {
        // Surface as `error` event so the host can show a reload
        // prompt; do NOT redirect (the visitor would lose their
        // unsaved edits).
        this.#emitError("Someone else pushed to this file. Reload and try again.", err);
        throw err;
      }
      throw err;
    }
  }

  /** Discard the current edit. Posts an `EditAbandoned` event
   *  (inline) or redirects with `#edit-abandoned=1` (newTab). */
  abandon(reason: "userCancelled" | "saveError" | "authRejected" = "userCancelled"): void {
    if (!this.#mountSnapshot) {
      throw new Error("abandon() called before mount snapshot was captured");
    }
    const snapshot = this.#mountSnapshot;
    if (snapshot.mode === "inline" && this.#messenger) {
      this.#messenger.sendEvent({
        type: "EditAbandoned",
        editId: snapshot.editId,
        reason,
      });
      return;
    }
    const hash = encodeEmbedReturnHash({ kind: "abandoned", reason });
    const target = appendHash(snapshot.returnUrl, hash);
    this.#redirect(target);
  }

  /** Test-only accessor — returns the mounted EditorShell, or
   *  null. */
  get editorShell(): EditorShell | null {
    return this.#editorShell;
  }

  /** Test-only accessor — returns the GitHubAppStorageProvider,
   *  or null. */
  get store(): GitHubAppStorageProvider | null {
    return this.#store;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.#messenger) {
      this.#messenger.cleanup();
      this.#messenger = null;
    }
    if (this.#editorShell) {
      this.#editorShell.destroy();
      this.#editorShell = null;
    }
  }

  #ensureContainer(): void {
    if (this.#shellContainer) return;
    const existing = this.querySelector<HTMLDivElement>(".annot-embed-shell-host");
    if (existing) {
      this.#shellContainer = existing;
      return;
    }
    const container = document.createElement("div");
    container.className = "annot-embed-shell-host";
    container.dataset.annotEmbedHost = "";
    this.appendChild(container);
    this.#shellContainer = container;
  }

  #redirect(url: string): void {
    if (this.#onSaveRedirect) {
      this.#onSaveRedirect(url);
      return;
    }
    if (typeof window !== "undefined" && window.location) {
      window.location.replace(url);
    }
  }

  #emitError(reason: string, cause?: unknown): void {
    console.error("[annot-embed-shell]", reason, cause);
    this.dispatchEvent(
      new CustomEvent<EmbedShellErrorDetail>("error", {
        detail: { reason, cause },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

/** When the host page didn't set `data-cloud-url`, fall back to
 *  the document origin (the worker route serves /embed off the
 *  cloud origin already). */
function inferCloudUrl(): string {
  if (typeof window === "undefined") return "https://annot.work";
  return window.location.origin;
}

/** Resolve the parent's origin from the `returnUrl` so the
 *  postMessage channel can reject cross-origin frames. */
function inferParentOrigin(returnUrl: string): string {
  try {
    return new URL(returnUrl).origin;
  } catch {
    return "*";
  }
}

/** Append the embed-protocol hash fragment to a return URL,
 *  preserving any existing query string. Replaces any existing
 *  hash. */
function appendHash(returnUrl: string, hash: string): string {
  try {
    const url = new URL(returnUrl);
    url.hash = hash;
    return url.toString();
  } catch {
    // Caller validated returnUrl as absolute already; the catch
    // here is just for type-narrowing — if we get here something
    // went very wrong, return the URL as-is so we don't break
    // the abandon flow.
    return returnUrl + hash;
  }
}

customElements.define("annot-embed-shell", AnnotEmbedShellElement);
