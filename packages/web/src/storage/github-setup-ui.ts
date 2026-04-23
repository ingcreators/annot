/**
 * GitHub connect flow UI — device-flow dialog, PAT fallback dialog,
 * repo picker, branch picker, base-path prompt.
 *
 * Phase 1 of `docs/plans/github-integration.md`: these flows prove
 * out the auth shape end-to-end. `GitHubStore` (Phase 2) and the
 * sidebar item + routing (Phase 3) call into `connectGitHub()` to
 * acquire a `GitHubRepoRef`.
 *
 * Shares the `.app-dialog*` CSS tokens defined in
 * `packages/web/src/styles/file-manager.css` so the look matches
 * the rest of the app.
 */

import {
  signIn,
  signInWithPat,
  signOut,
  isSignedIn,
  hasClientId,
  fetchUserInfo,
  listWritableRepos,
  searchRepos,
  getRepo,
  listBranches,
  saveRepoRef,
  loadRepoRef,
  normalizeBasePath,
  type GitHubRepoRef,
  type GitHubRepoSummary,
  type DeviceFlowState,
  type DeviceFlowHandle,
} from "./github-auth.js";

/**
 * Run the full connect flow: sign in (device flow or PAT) → pick
 * repo → pick branch → enter base path → persist. Returns the
 * saved ref, or `null` if the user cancelled at any step.
 *
 * If the user is already signed in, the sign-in step is skipped
 * and the picker opens directly.
 */
export async function connectGitHub(): Promise<GitHubRepoRef | null> {
  if (!hasClientId() && !isSignedIn()) {
    await showPlainAlert(
      "GitHub integration is not configured",
      "VITE_GITHUB_CLIENT_ID is empty. You can still connect with a "
        + "personal access token — click \"Use a personal access token\" "
        + "in the next dialog.",
    );
  }

  if (!isSignedIn()) {
    const ok = await runSignInFlow();
    if (!ok) return null;
  }

  let user;
  try {
    user = await fetchUserInfo();
  } catch (e) {
    await showPlainAlert("GitHub sign-in failed", (e as Error).message);
    return null;
  }

  const repo = await showRepoPicker(user.login);
  if (!repo) return null;

  const branch = await showBranchPicker(repo);
  if (branch == null) return null;

  const basePath = await showBasePathPrompt(repo, branch);
  if (basePath == null) return null;

  const ref: GitHubRepoRef = {
    owner: repo.owner,
    repo: repo.name,
    branch,
    basePath,
  };
  saveRepoRef(ref);
  return ref;
}

export function disconnectGitHub(): void {
  signOut();
  // Keep the saved repo ref — re-connecting usually means the user
  // wants the same repo. Use `clearRepoRef()` from github-auth when
  // a full reset is needed.
}

// ---- Sign-in: device flow + PAT fallback ----

async function runSignInFlow(): Promise<boolean> {
  const choice = await showSignInChoiceDialog();
  if (choice === "device") {
    return await runDeviceFlow();
  }
  if (choice === "pat") {
    return await runPatFlow();
  }
  return false;
}

type SignInChoice = "device" | "pat" | null;

function showSignInChoiceDialog(): Promise<SignInChoice> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Connect to GitHub",
      "Choose how to authorize Annot to read and commit to your repositories.",
    );

    const makeBtn = (label: string, sub: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-dialog-btn app-dialog-primary";
      btn.style.width = "100%";
      btn.style.padding = "10px 14px";
      btn.style.height = "auto";
      btn.style.justifyContent = "flex-start";
      btn.style.display = "flex";
      btn.style.flexDirection = "column";
      btn.style.alignItems = "flex-start";
      btn.style.gap = "4px";
      btn.innerHTML = `
        <span style="font-weight:600;font-size:14px;">${escapeHtml(label)}</span>
        <span style="font-weight:400;font-size:12px;opacity:.85;">${escapeHtml(sub)}</span>
      `;
      btn.addEventListener("click", onClick);
      return btn;
    };

    const deviceBtn = makeBtn(
      "Sign in with GitHub (device flow)",
      "Opens github.com/login/device. Requires VITE_GITHUB_CLIENT_ID.",
      () => { close(); resolve("device"); },
    );
    const patBtn = makeBtn(
      "Use a personal access token",
      "Paste a fine-grained PAT with Contents read/write. No OAuth App needed.",
      () => { close(); resolve("pat"); },
    );
    if (!hasClientId()) {
      (deviceBtn as HTMLButtonElement).disabled = true;
      deviceBtn.style.opacity = "0.55";
      deviceBtn.style.cursor = "not-allowed";
    }

    body.appendChild(deviceBtn);
    body.appendChild(document.createElement("div")).style.height = "8px";
    body.appendChild(patBtn);

    addCancelOnly(root, () => { close(); resolve(null); });
    attachCloseBehaviors(root, () => { close(); resolve(null); });
  });
}

function runDeviceFlow(): Promise<boolean> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Waiting for GitHub authorization",
      "Open the URL below and enter the code to authorize Annot.",
    );

    let handle: DeviceFlowHandle | null = null;
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { handle?.cancel(); } catch { /* ignore */ }
      close();
      resolve(ok);
    };

    const status = document.createElement("div");
    status.style.fontSize = "13px";
    status.style.color = "var(--text-secondary)";
    status.textContent = "Starting…";
    body.appendChild(status);

    const codeEl = document.createElement("div");
    codeEl.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    codeEl.style.fontSize = "28px";
    codeEl.style.fontWeight = "700";
    codeEl.style.letterSpacing = "4px";
    codeEl.style.textAlign = "center";
    codeEl.style.padding = "16px 12px";
    codeEl.style.background = "var(--input-bg)";
    codeEl.style.border = "1px solid var(--input-border)";
    codeEl.style.borderRadius = "8px";
    codeEl.style.color = "var(--text-primary)";
    codeEl.style.display = "none";
    body.appendChild(codeEl);

    const linkRow = document.createElement("div");
    linkRow.style.display = "flex";
    linkRow.style.gap = "8px";
    linkRow.style.alignItems = "center";
    linkRow.style.justifyContent = "space-between";
    linkRow.style.fontSize = "13px";
    linkRow.style.marginTop = "4px";
    linkRow.style.display = "none";
    body.appendChild(linkRow);

    const linkAnchor = document.createElement("a");
    linkAnchor.target = "_blank";
    linkAnchor.rel = "noopener noreferrer";
    linkAnchor.style.color = "var(--accent)";
    linkAnchor.style.textDecoration = "underline";
    linkAnchor.style.wordBreak = "break-all";
    linkRow.appendChild(linkAnchor);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "app-dialog-btn";
    copyBtn.textContent = "Copy code";
    copyBtn.style.minWidth = "0";
    copyBtn.style.height = "30px";
    copyBtn.style.padding = "0 12px";
    copyBtn.style.fontSize = "12px";
    linkRow.appendChild(copyBtn);

    let currentCode = "";
    copyBtn.addEventListener("click", async () => {
      if (!currentCode) return;
      try {
        await navigator.clipboard.writeText(currentCode);
        copyBtn.textContent = "Copied";
        setTimeout(() => { copyBtn.textContent = "Copy code"; }, 1200);
      } catch { /* ignore */ }
    });

    const err = document.createElement("div");
    err.className = "app-dialog-error";
    err.style.display = "none";
    body.appendChild(err);

    const fallbackRow = document.createElement("div");
    fallbackRow.style.fontSize = "12px";
    fallbackRow.style.marginTop = "6px";
    fallbackRow.innerHTML =
      `<a href="#" style="color:var(--accent);">Use a personal access token instead</a>`;
    body.appendChild(fallbackRow);
    fallbackRow.querySelector("a")?.addEventListener("click", async (e) => {
      e.preventDefault();
      try { handle?.cancel(); } catch { /* ignore */ }
      close();
      settled = true;
      const ok = await runPatFlow();
      resolve(ok);
    });

    addCancelOnly(root, () => settle(false), "Cancel");
    attachCloseBehaviors(root, () => settle(false));

    handle = signIn((state: DeviceFlowState) => {
      if (settled) return;
      switch (state.phase) {
        case "starting":
          status.textContent = "Requesting device code…";
          break;
        case "awaiting-authorization": {
          currentCode = state.userCode ?? "";
          codeEl.textContent = currentCode;
          codeEl.style.display = "";
          linkRow.style.display = "flex";
          const targetUri = state.verificationUriComplete ?? state.verificationUri ?? "";
          linkAnchor.href = targetUri;
          linkAnchor.textContent = state.verificationUri ?? targetUri;
          status.textContent = "Waiting for authorization…";
          err.style.display = "none";
          break;
        }
        case "authorized":
          status.textContent = "Authorized.";
          settle(true);
          break;
        case "error":
          err.textContent = state.error ?? "Unknown error.";
          err.style.display = "";
          status.textContent = "Authorization failed.";
          break;
        case "cancelled":
          settle(false);
          break;
      }
    });

    handle.result.then(
      (token) => { if (token) settle(true); else settle(false); },
      () => { /* error already surfaced via listener */ },
    );
  });
}

function runPatFlow(): Promise<boolean> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Sign in with a personal access token",
      "Create a fine-grained PAT with Contents: Read and Write on the "
        + "repository you want to use, or a classic PAT with the `repo` "
        + "scope. Paste it below.",
    );

    const link = document.createElement("div");
    link.style.fontSize = "12px";
    link.innerHTML = `
      <a href="https://github.com/settings/personal-access-tokens/new"
         target="_blank" rel="noopener noreferrer"
         style="color:var(--accent);text-decoration:underline;">
         Open GitHub — Fine-grained tokens ↗
      </a>
    `;
    body.appendChild(link);

    const input = document.createElement("input");
    input.type = "password";
    input.className = "app-dialog-input";
    input.placeholder = "github_pat_… or ghp_…";
    input.autocomplete = "off";
    input.spellcheck = false;
    body.appendChild(input);

    const err = document.createElement("div");
    err.className = "app-dialog-error";
    err.style.display = "none";
    body.appendChild(err);

    let busy = false;
    const setBusy = (b: boolean) => {
      busy = b;
      input.disabled = b;
      okBtn.disabled = b;
      okBtn.textContent = b ? "Verifying…" : "Continue";
    };

    let okBtn!: HTMLButtonElement;
    const submit = async () => {
      if (busy) return;
      err.style.display = "none";
      setBusy(true);
      try {
        await signInWithPat(input.value);
        close();
        resolve(true);
      } catch (e) {
        err.textContent = (e as Error).message;
        err.style.display = "";
        setBusy(false);
        input.focus();
        input.select();
      }
    };

    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "app-dialog-btn app-dialog-cancel";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => { close(); resolve(false); });
    actions.appendChild(cancel);
    okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "app-dialog-btn app-dialog-ok app-dialog-primary";
    okBtn.textContent = "Continue";
    okBtn.addEventListener("click", submit);
    actions.appendChild(okBtn);
    root.appendChild(actions);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
    requestAnimationFrame(() => input.focus());
    attachCloseBehaviors(root, () => { close(); resolve(false); });
  });
}

// ---- Repo picker ----

function showRepoPicker(userLogin: string): Promise<GitHubRepoSummary | null> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Pick a repository",
      `Signed in as ${userLogin}. Showing repositories you can push to.`,
    );

    const search = document.createElement("input");
    search.type = "search";
    search.className = "app-dialog-input";
    search.placeholder = "Filter… (fallback to full-text search after 2 chars)";
    body.appendChild(search);

    const list = document.createElement("div");
    list.style.maxHeight = "340px";
    list.style.overflowY = "auto";
    list.style.border = "1px solid var(--border-color)";
    list.style.borderRadius = "8px";
    list.style.background = "var(--input-bg)";
    list.setAttribute("role", "listbox");
    body.appendChild(list);

    const manual = document.createElement("div");
    manual.style.fontSize = "12px";
    manual.style.color = "var(--text-secondary)";
    manual.style.marginTop = "4px";
    manual.innerHTML = `
      Or enter manually:
      <input type="text" class="app-dialog-input" style="margin-top:6px;height:34px;" placeholder="owner/repo" />
    `;
    body.appendChild(manual);
    const manualInput = manual.querySelector<HTMLInputElement>("input")!;

    const err = document.createElement("div");
    err.className = "app-dialog-error";
    err.style.display = "none";
    body.appendChild(err);

    const cancelBtn = addCancelOnly(root, () => { close(); resolve(null); });

    let repos: GitHubRepoSummary[] = [];
    let filtered: GitHubRepoSummary[] = [];

    const renderRows = (items: GitHubRepoSummary[], emptyMsg: string) => {
      list.innerHTML = "";
      if (items.length === 0) {
        const empty = document.createElement("div");
        empty.style.padding = "20px";
        empty.style.textAlign = "center";
        empty.style.color = "var(--text-secondary)";
        empty.style.fontSize = "13px";
        empty.textContent = emptyMsg;
        list.appendChild(empty);
        return;
      }
      for (const r of items) {
        const row = document.createElement("button");
        row.type = "button";
        row.style.display = "block";
        row.style.width = "100%";
        row.style.textAlign = "left";
        row.style.padding = "10px 12px";
        row.style.background = "transparent";
        row.style.border = "none";
        row.style.borderBottom = "1px solid var(--border-color)";
        row.style.color = "var(--text-primary)";
        row.style.cursor = "pointer";
        row.addEventListener("mouseenter", () => {
          row.style.background = "var(--hover-bg)";
        });
        row.addEventListener("mouseleave", () => {
          row.style.background = "transparent";
        });
        const badge = r.private ? `<span style="font-size:10px;background:var(--border-color);color:var(--text-secondary);padding:1px 6px;border-radius:999px;margin-left:6px;">private</span>` : "";
        row.innerHTML = `
          <div style="font-size:13px;font-weight:600;">${escapeHtml(r.fullName)}${badge}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
            ${escapeHtml(r.description ?? "")} ${r.description ? "·" : ""} default: ${escapeHtml(r.defaultBranch)}
          </div>
        `;
        row.addEventListener("click", () => {
          close();
          resolve(r);
        });
        list.appendChild(row);
      }
    };

    const renderStatus = (msg: string) => {
      list.innerHTML = "";
      const div = document.createElement("div");
      div.style.padding = "20px";
      div.style.textAlign = "center";
      div.style.color = "var(--text-secondary)";
      div.style.fontSize = "13px";
      div.textContent = msg;
      list.appendChild(div);
    };

    renderStatus("Loading repositories…");

    listWritableRepos().then(
      (fetched) => {
        repos = fetched;
        filtered = fetched;
        renderRows(filtered, "No repositories with push access found.");
      },
      (e: Error) => {
        err.textContent = e.message;
        err.style.display = "";
        renderStatus("Couldn't load repositories.");
      },
    );

    let searchTimer: number | undefined;
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      window.clearTimeout(searchTimer);
      if (!q) {
        filtered = repos;
        renderRows(filtered, "No repositories with push access found.");
        return;
      }
      const local = repos.filter((r) => r.fullName.toLowerCase().includes(q));
      filtered = local;
      renderRows(local, "No local matches. Searching GitHub…");
      // Fall back to search endpoint if local list returned nothing.
      if (local.length === 0 && q.length >= 2) {
        searchTimer = window.setTimeout(async () => {
          try {
            const hits = await searchRepos(q);
            if (search.value.trim().toLowerCase() !== q) return;
            filtered = hits;
            renderRows(hits, "No matching repositories found.");
          } catch (e) {
            err.textContent = (e as Error).message;
            err.style.display = "";
          }
        }, 300);
      }
    });

    manualInput.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const v = manualInput.value.trim();
      const m = /^([^/\s]+)\/([^/\s]+)$/.exec(v);
      if (!m) {
        err.textContent = "Enter in the form owner/repo.";
        err.style.display = "";
        return;
      }
      err.style.display = "none";
      try {
        const r = await getRepo(m[1], m[2]);
        close();
        resolve(r);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.style.display = "";
      }
    });

    requestAnimationFrame(() => search.focus());
    attachCloseBehaviors(root, () => { close(); resolve(null); });

    // silence unused var lint — we hold the reference to move focus if needed
    void cancelBtn;
  });
}

// ---- Branch picker ----

function showBranchPicker(repo: GitHubRepoSummary): Promise<string | null> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Pick a branch",
      `${repo.fullName} — all commits land on the branch you pick here.`,
    );

    const select = document.createElement("select");
    select.className = "app-dialog-input";
    select.style.appearance = "auto";
    select.innerHTML = `<option>Loading…</option>`;
    select.disabled = true;
    body.appendChild(select);

    const err = document.createElement("div");
    err.className = "app-dialog-error";
    err.style.display = "none";
    body.appendChild(err);

    listBranches(repo.owner, repo.name, repo.defaultBranch).then(
      (branches) => {
        select.innerHTML = "";
        if (branches.length === 0) {
          select.innerHTML = `<option>${escapeHtml(repo.defaultBranch)} (new repo)</option>`;
          select.disabled = false;
          return;
        }
        for (const b of branches) {
          const opt = document.createElement("option");
          opt.value = b.name;
          opt.textContent = b.name + (b.isDefault ? " (default)" : "") + (b.protected ? " — protected" : "");
          if (b.isDefault) opt.selected = true;
          select.appendChild(opt);
        }
        select.disabled = false;
      },
      (e: Error) => {
        err.textContent = e.message;
        err.style.display = "";
        select.innerHTML = `<option value="${escapeHtml(repo.defaultBranch)}">${escapeHtml(repo.defaultBranch)}</option>`;
        select.disabled = false;
      },
    );

    addActions(root, {
      okLabel: "Continue",
      onCancel: () => { close(); resolve(null); },
      onOk: () => {
        const v = select.value || repo.defaultBranch;
        close();
        resolve(v);
      },
    });
    attachCloseBehaviors(root, () => { close(); resolve(null); });
  });
}

// ---- Base path prompt ----

function showBasePathPrompt(repo: GitHubRepoSummary, branch: string): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = loadRepoRef();
    const defaultVal = existing && existing.owner === repo.owner && existing.repo === repo.name
      ? existing.basePath
      : "";

    const { close, root, body } = openDialog(
      "Pick a base path",
      `Everything Annot writes to ${repo.fullName} on branch "${branch}" will live under this path. Leave empty to use the repo root.`,
    );

    const input = document.createElement("input");
    input.type = "text";
    input.className = "app-dialog-input";
    input.value = defaultVal;
    input.placeholder = "screenshots  (empty = repo root)";
    body.appendChild(input);

    const preview = document.createElement("div");
    preview.style.fontSize = "12px";
    preview.style.color = "var(--text-secondary)";
    preview.style.marginTop = "4px";
    body.appendChild(preview);

    const renderPreview = () => {
      const norm = normalizeBasePath(input.value);
      preview.textContent = norm
        ? `→ ${repo.fullName}/${norm}/…`
        : `→ ${repo.fullName}/…`;
    };
    input.addEventListener("input", renderPreview);
    renderPreview();

    addActions(root, {
      okLabel: "Connect",
      onCancel: () => { close(); resolve(null); },
      onOk: () => {
        close();
        resolve(normalizeBasePath(input.value));
      },
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        root.querySelector<HTMLButtonElement>(".app-dialog-ok")?.click();
      }
    });
    requestAnimationFrame(() => { input.focus(); input.select(); });
    attachCloseBehaviors(root, () => { close(); resolve(null); });
  });
}

// ---- Dialog helpers (local copies — dialog.ts doesn't export them) ----

interface OpenedDialog {
  root: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

function openDialog(title: string, message?: string): OpenedDialog {
  const overlay = document.createElement("div");
  overlay.className = "app-dialog-overlay";
  const dialog = document.createElement("div");
  dialog.className = "app-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  const t = document.createElement("div");
  t.className = "app-dialog-title";
  t.textContent = title;
  dialog.appendChild(t);
  if (message) {
    const m = document.createElement("div");
    m.className = "app-dialog-message";
    m.textContent = message;
    dialog.appendChild(m);
  }
  const body = document.createElement("div");
  body.className = "app-dialog-body";
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  return {
    root: dialog,
    body,
    close: () => { try { overlay.remove(); } catch { /* ignore */ } },
  };
}

interface ActionOpts {
  okLabel: string;
  cancelLabel?: string;
  onOk: () => void;
  onCancel: () => void;
}
function addActions(root: HTMLElement, opts: ActionOpts): void {
  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "app-dialog-btn app-dialog-cancel";
  cancel.textContent = opts.cancelLabel ?? "Cancel";
  cancel.addEventListener("click", () => opts.onCancel());
  actions.appendChild(cancel);
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "app-dialog-btn app-dialog-ok app-dialog-primary";
  ok.textContent = opts.okLabel;
  ok.addEventListener("click", () => opts.onOk());
  actions.appendChild(ok);
  root.appendChild(actions);
}

function addCancelOnly(
  root: HTMLElement,
  onCancel: () => void,
  label = "Cancel",
): HTMLButtonElement {
  const actions = document.createElement("div");
  actions.className = "app-dialog-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "app-dialog-btn app-dialog-cancel";
  cancel.textContent = label;
  cancel.addEventListener("click", onCancel);
  actions.appendChild(cancel);
  root.appendChild(actions);
  return cancel;
}

function attachCloseBehaviors(root: HTMLElement, onCancel: () => void): void {
  const overlay = root.parentElement as HTMLElement;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      document.removeEventListener("keydown", onKey);
      onCancel();
    }
  };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      document.removeEventListener("keydown", onKey);
      onCancel();
    }
  });
}

function showPlainAlert(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    const { close, root } = openDialog(title, message);
    const actions = document.createElement("div");
    actions.className = "app-dialog-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = "app-dialog-btn app-dialog-ok app-dialog-primary";
    ok.textContent = "OK";
    ok.addEventListener("click", () => { close(); resolve(); });
    actions.appendChild(ok);
    root.appendChild(actions);
    attachCloseBehaviors(root, () => { close(); resolve(); });
    requestAnimationFrame(() => ok.focus());
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
