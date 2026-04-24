/**
 * GitHub connect flow UI — PAT paste, repo picker, branch picker,
 * base-path prompt.
 *
 * Phase 1 of `docs/plans/github-integration.md`: these flows prove
 * out the auth shape end-to-end. `GitHubStore` (Phase 2) and the
 * sidebar item + routing (Phase 3) call into `connectGitHub()` to
 * acquire a `GitHubRepoRef`.
 *
 * PAT-only by design. See `github-auth.ts` for why Device Flow /
 * Web Flow can't complete in a browser without a backend proxy.
 *
 * Shares the `.app-dialog*` CSS tokens defined in
 * `packages/web/src/styles/file-manager.css` so the look matches
 * the rest of the app.
 */

import {
  fetchUserInfo,
  type GitHubRepoRef,
  type GitHubRepoSummary,
  getRepo,
  isSignedIn,
  listBranches,
  listWritableRepos,
  loadRepoRef,
  normalizeBasePath,
  saveRepoRef,
  searchRepos,
  signInWithPat,
  signOut,
  verifyWriteAccess,
} from "./github-auth.js";

/**
 * Run the full connect flow: PAT paste → pick repo → pick branch →
 * enter base path → persist. Returns the saved ref, or `null` if
 * the user cancelled at any step.
 *
 * If the user is already signed in, the sign-in step is skipped
 * and the picker opens directly.
 */
export async function connectGitHub(): Promise<GitHubRepoRef | null> {
  if (!isSignedIn()) {
    const ok = await runPatFlow();
    if (!ok) return null;
  }

  let user: Awaited<ReturnType<typeof fetchUserInfo>>;
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

/**
 * Present the reconfigure menu to the user (repo / branch / base
 * path) and run the sub-flow they pick. Returns the updated ref
 * on success, or `null` if cancelled or the existing ref is
 * unchanged. Intended to be called from the sidebar's reselect
 * icon when the user is already connected — first-time connect
 * should go through `connectGitHub()` for the full flow.
 */
export async function showReconfigureMenu(current: GitHubRepoRef): Promise<GitHubRepoRef | null> {
  const choice = await showChoiceDialog();
  if (!choice) return null;
  if (choice === "repo") {
    // Full flow including repo picker. The existing helper handles
    // PAT re-entry if the session expired.
    return await connectGitHub();
  }
  if (choice === "branch") {
    return await runBranchOnlySwitch(current);
  }
  if (choice === "basePath") {
    return await runBasePathOnlySwitch(current);
  }
  return null;
}

/**
 * Fetch branches for the currently-configured repo, show the branch
 * picker, and persist the new ref on success. Reused by the
 * reconfigure menu's "Change branch" path. `basePath` is carried
 * through unchanged.
 */
export async function runBranchOnlySwitch(current: GitHubRepoRef): Promise<GitHubRepoRef | null> {
  let repo: GitHubRepoSummary;
  try {
    repo = await getRepo(current.owner, current.repo);
  } catch (e) {
    await showPlainAlert("Couldn't load repository", (e as Error).message);
    return null;
  }
  const branch = await showBranchPicker(repo);
  if (branch == null) return null;
  if (branch === current.branch) return null; // no-op
  const ref: GitHubRepoRef = { ...current, branch };
  saveRepoRef(ref);
  return ref;
}

/**
 * Show the base-path prompt pre-filled with the current base path.
 * Reused by the reconfigure menu's "Change base path" path. Other
 * fields carry through unchanged. No-op (returns `null`) if the
 * value didn't change.
 */
export async function runBasePathOnlySwitch(current: GitHubRepoRef): Promise<GitHubRepoRef | null> {
  let repo: GitHubRepoSummary;
  try {
    repo = await getRepo(current.owner, current.repo);
  } catch (e) {
    await showPlainAlert("Couldn't load repository", (e as Error).message);
    return null;
  }
  const basePath = await showBasePathPrompt(repo, current.branch);
  if (basePath == null) return null;
  if (basePath === current.basePath) return null; // no-op
  const ref: GitHubRepoRef = { ...current, basePath };
  saveRepoRef(ref);
  return ref;
}

type ReconfigureChoice = "repo" | "branch" | "basePath";

function showChoiceDialog(): Promise<ReconfigureChoice | null> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Change GitHub connection",
      "Pick what you'd like to change. Everything else stays the same.",
    );

    const makeBtn = (label: string, sub: string, value: ReconfigureChoice) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "app-dialog-btn app-dialog-primary";
      btn.style.width = "100%";
      btn.style.padding = "10px 14px";
      btn.style.height = "auto";
      btn.style.display = "flex";
      btn.style.flexDirection = "column";
      btn.style.alignItems = "flex-start";
      btn.style.gap = "4px";
      btn.innerHTML = `
        <span style="font-weight:600;font-size:14px;">${escapeHtml(label)}</span>
        <span style="font-weight:400;font-size:12px;opacity:.85;">${escapeHtml(sub)}</span>
      `;
      btn.addEventListener("click", () => {
        close();
        resolve(value);
      });
      return btn;
    };

    body.appendChild(
      makeBtn("Repository", "Switch to a different repo. Runs the full picker flow.", "repo"),
    );
    const g1 = document.createElement("div");
    g1.style.height = "8px";
    body.appendChild(g1);
    body.appendChild(makeBtn("Branch", "Same repo, different branch.", "branch"));
    const g2 = document.createElement("div");
    g2.style.height = "8px";
    body.appendChild(g2);
    body.appendChild(
      makeBtn("Base path", "Same repo + branch, different folder inside.", "basePath"),
    );

    addCancelOnly(root, () => {
      close();
      resolve(null);
    });
    attachCloseBehaviors(root, () => {
      close();
      resolve(null);
    });
  });
}

// ---- PAT sign-in ----

function runPatFlow(): Promise<boolean> {
  return new Promise((resolve) => {
    const { close, root, body } = openDialog(
      "Sign in to GitHub",
      "Annot stores screenshots by committing them to a repository you " +
        "own or collaborate on. Create a personal access token and " +
        "paste it below.",
    );

    const help = document.createElement("div");
    help.style.fontSize = "12px";
    help.style.lineHeight = "1.6";
    help.style.color = "var(--text-secondary)";
    help.innerHTML = `
      <strong style="color:var(--text-primary);">Recommended: fine-grained token</strong> —
      tighter scope than a classic token, limited to the single repo you
      pick. On the token creation page, set:
      <ul style="margin:6px 0 8px 18px;padding:0;">
        <li>Repository access → <em>Only select repositories</em> → pick your target repo</li>
        <li>Repository permissions → <strong>Contents: Read and write</strong></li>
      </ul>
      <a href="https://github.com/settings/personal-access-tokens/new"
         target="_blank" rel="noopener noreferrer"
         style="color:var(--accent);text-decoration:underline;">
         Open GitHub — New fine-grained token ↗
      </a>
      <br/>
      <a href="https://github.com/settings/tokens/new?scopes=repo&description=Annot"
         target="_blank" rel="noopener noreferrer"
         style="color:var(--accent);text-decoration:underline;font-size:11px;">
         Or create a classic token with the <code>repo</code> scope ↗
      </a>
    `;
    body.appendChild(help);

    // Chrome warns when a password field isn't inside a form (it
    // can't offer to save the PAT to the password manager otherwise),
    // so wrap the input. `method="dialog"` + preventDefault on submit
    // keeps the page from navigating when the user hits Enter.
    const form = document.createElement("form");
    form.method = "dialog";
    form.autocomplete = "on";
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      submit();
    });
    body.appendChild(form);

    const input = document.createElement("input");
    input.type = "password";
    input.className = "app-dialog-input";
    input.placeholder = "github_pat_… or ghp_…";
    input.autocomplete = "current-password";
    input.spellcheck = false;
    input.name = "github-pat";
    form.appendChild(input);

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
    cancel.addEventListener("click", () => {
      close();
      resolve(false);
    });
    actions.appendChild(cancel);
    okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "app-dialog-btn app-dialog-ok app-dialog-primary";
    okBtn.textContent = "Continue";
    okBtn.addEventListener("click", submit);
    actions.appendChild(okBtn);
    root.appendChild(actions);

    // Enter-to-submit is handled by the form's submit event above.
    requestAnimationFrame(() => input.focus());
    attachCloseBehaviors(root, () => {
      close();
      resolve(false);
    });
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

    // "Use a different token" escape hatch. Without this the only
    // way to rotate a PAT is to wait for the current one to 401,
    // which is a bad fit for proactive rotation (token about to
    // expire, scope tightening, suspected leak). Clicking runs the
    // PAT flow first, then re-opens the picker with the new user
    // info. `signInWithPat` overwrites the existing token so we
    // don't sign out pre-emptively — if the user cancels the PAT
    // dialog their current session stays intact.
    const rotateRow = document.createElement("div");
    rotateRow.style.fontSize = "12px";
    rotateRow.style.marginTop = "4px";
    rotateRow.innerHTML = `<a href="#" style="color:var(--accent);">Use a different personal access token</a>`;
    body.appendChild(rotateRow);
    rotateRow.querySelector("a")?.addEventListener("click", async (e) => {
      e.preventDefault();
      close();
      const ok = await runPatFlow();
      if (!ok) {
        resolve(null);
        return;
      }
      try {
        const user = await fetchUserInfo();
        const repo = await showRepoPicker(user.login);
        resolve(repo);
      } catch (ex) {
        await showPlainAlert("GitHub sign-in failed", (ex as Error).message);
        resolve(null);
      }
    });

    const cancelBtn = addCancelOnly(root, () => {
      close();
      resolve(null);
    });

    let repos: GitHubRepoSummary[] = [];
    let filtered: GitHubRepoSummary[] = [];

    /**
     * Close the picker with `r` selected, but first verify the token
     * can actually write to it. `/user/repos` happily lists public
     * repos the user owns even when a fine-grained PAT has no write
     * grant on them (GitHub's "Also includes public repositories
     * (read-only)" behaviour, built-in and not togglable), so the
     * only way to tell is a probe PUT with an impossible SHA — see
     * `verifyWriteAccess`.
     */
    const verifyAndSelect = async (r: GitHubRepoSummary) => {
      err.style.display = "none";
      list.style.opacity = "0.5";
      list.style.pointerEvents = "none";
      try {
        const canWrite = await verifyWriteAccess(r.owner, r.name);
        if (!canWrite) {
          err.innerHTML = `Your personal access token doesn't have <strong>Contents: Read and Write</strong> on <strong>${escapeHtml(r.fullName)}</strong>. Pick another repository, or rotate your token via the link below.`;
          err.style.display = "";
          return;
        }
        close();
        resolve(r);
      } catch (e) {
        err.textContent = `Couldn't verify write access: ${(e as Error).message}`;
        err.style.display = "";
      } finally {
        list.style.opacity = "";
        list.style.pointerEvents = "";
      }
    };

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
        const badge = r.private
          ? `<span style="font-size:10px;background:var(--border-color);color:var(--text-secondary);padding:1px 6px;border-radius:999px;margin-left:6px;">private</span>`
          : "";
        row.innerHTML = `
          <div style="font-size:13px;font-weight:600;">${escapeHtml(r.fullName)}${badge}</div>
          <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
            ${escapeHtml(r.description ?? "")} ${r.description ? "·" : ""} default: ${escapeHtml(r.defaultBranch)}
          </div>
        `;
        row.addEventListener("click", async () => {
          await verifyAndSelect(r);
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
        await verifyAndSelect(r);
      } catch (ex) {
        err.textContent = (ex as Error).message;
        err.style.display = "";
      }
    });

    requestAnimationFrame(() => search.focus());
    attachCloseBehaviors(root, () => {
      close();
      resolve(null);
    });

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
    select.innerHTML = "<option>Loading…</option>";
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
          opt.textContent =
            b.name + (b.isDefault ? " (default)" : "") + (b.protected ? " — protected" : "");
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
      onCancel: () => {
        close();
        resolve(null);
      },
      onOk: () => {
        const v = select.value || repo.defaultBranch;
        close();
        resolve(v);
      },
    });
    attachCloseBehaviors(root, () => {
      close();
      resolve(null);
    });
  });
}

// ---- Base path prompt ----

function showBasePathPrompt(repo: GitHubRepoSummary, branch: string): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = loadRepoRef();
    const defaultVal =
      existing && existing.owner === repo.owner && existing.repo === repo.name
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
      preview.textContent = norm ? `→ ${repo.fullName}/${norm}/…` : `→ ${repo.fullName}/…`;
    };
    input.addEventListener("input", renderPreview);
    renderPreview();

    addActions(root, {
      okLabel: "Connect",
      onCancel: () => {
        close();
        resolve(null);
      },
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
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
    attachCloseBehaviors(root, () => {
      close();
      resolve(null);
    });
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
    close: () => {
      try {
        overlay.remove();
      } catch {
        /* ignore */
      }
    },
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
    ok.addEventListener("click", () => {
      close();
      resolve();
    });
    actions.appendChild(ok);
    root.appendChild(actions);
    attachCloseBehaviors(root, () => {
      close();
      resolve();
    });
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
