// `POST /api/embed/commit` endpoint — Phase 6 follow-up 5y-4.
//
// Receives the edited annotation yaml (and optionally a fresh
// PNG) from the embed shell, mints an installation token for the
// target repo, and commits via the GitHub Contents API. The
// per-installation `repo_policy` decides between:
//
//   - `direct-push` — commits straight to the
//     `default_branch_override ?? <repo default>` branch.
//   - `pr-mode`     — creates a branch `annot-edit/<editId>`,
//     commits there, opens a PR via the Pulls API.
//
// The endpoint accepts:
//
//   - `installationId` (number, required) — from the load
//     response's `repoState`; helps avoid the
//     `findGitHubInstallationByAccount` lookup again on commit.
//   - `repo` / `pngPath` / `annotationsPath` — same shape as the
//     `/api/embed/load` URL params.
//   - `branch` — branch the load came off (passed through from
//     the editor; matches `repoState.branch`).
//   - `annotationsYaml` — full text of the edited yaml.
//   - `annotationsSha` — blob sha at load time (for optimistic
//     write).
//   - `pngBase64?` — included when the editor mutates the
//     underlying bitmap (today: only via the redact-burn-into-
//     image path). Omitted on annotation-only edits.
//   - `pngSha?` — only present when `pngBase64` is present.
//   - `editId` — random opaque id surfaced back to the docs site
//     via 5y-5's hash redirect.
//
// On GitHub-side 409 (sha mismatch), the endpoint returns
// `{ ok: false, error: "conflict" }` so the editor surfaces a
// reload + retry prompt. Other GitHub-side failures collapse to
// 502 with the upstream body in the response message.

import type { Context } from "hono";
import { requireAuth } from "../auth-middleware.js";
import type { Env } from "../index.js";
import { recordAuditEvent } from "../storage-repo.js";
import { findGitHubInstallationById, type GitHubInstallationRow } from "./github-app.js";
import { getInstallationToken } from "./github-app-token.js";

const COMMIT_MESSAGE_PREFIX = "Annot edit via annot.work/embed";
const BRANCH_PREFIX = "annot-edit/";

interface CommitRequestBody {
  installationId: number;
  repo: string;
  pngPath: string;
  annotationsPath: string;
  branch: string;
  annotationsYaml: string;
  annotationsSha: string;
  pngBase64?: string;
  pngSha?: string;
  editId: string;
}

/** Response shape: success carries the resulting commit SHA +
 *  optional PR URL; conflict / error variants surface the reason
 *  via the discriminated `ok` field. */
type CommitResponseBody =
  | {
      ok: true;
      editId: string;
      commitSha: string;
      branch: string;
      prUrl?: string;
      policy: "pr-mode" | "direct-push";
    }
  | { ok: false; error: "conflict"; message: string }
  | { ok: false; error: string; message: string };

export async function handleEmbedCommit(c: Context<{ Bindings: Env }>): Promise<Response> {
  // ── 1. Auth ───────────────────────────────────────────────
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  // ── 2. Parse + validate request body ──────────────────────
  let body: CommitRequestBody;
  try {
    body = (await c.req.json()) as CommitRequestBody;
  } catch {
    return c.json({ ok: false, error: "invalid_request", message: "Body must be JSON" }, 400);
  }
  const required: (keyof CommitRequestBody)[] = [
    "installationId",
    "repo",
    "pngPath",
    "annotationsPath",
    "branch",
    "annotationsYaml",
    "annotationsSha",
    "editId",
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return c.json(
        { ok: false, error: "invalid_request", message: `Missing required field "${field}"` },
        400,
      );
    }
  }
  if (body.pngBase64 && !body.pngSha) {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        message: "pngSha is required when pngBase64 is provided",
      },
      400,
    );
  }
  // Slug + path guards mirror 5y-2's load endpoint.
  if (!/^[\w.-]+\/[\w.-]+$/.test(body.repo)) {
    return c.json({ ok: false, error: "invalid_request", message: "repo must be owner/name" }, 400);
  }
  for (const path of [body.pngPath, body.annotationsPath]) {
    if (path.startsWith("/") || path.includes("..") || path.includes("\0")) {
      return c.json({ ok: false, error: "invalid_request", message: "path is unsafe" }, 400);
    }
  }

  // ── 3. Look up the installation by id ─────────────────────
  const installation = await findGitHubInstallationById(c.env.DB, body.installationId);
  if (!installation) {
    return c.json(
      {
        ok: false,
        error: "no_installation",
        message: `Installation ${body.installationId} not found or suspended.`,
      },
      404,
    );
  }

  // ── 4. Mint installation token ────────────────────────────
  let installationToken: string;
  try {
    installationToken = await getInstallationToken(c.env, c.env.SESSIONS, installation.id);
  } catch (err) {
    console.error("[embed/commit] token mint failed", err);
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: "Failed to mint a GitHub installation token.",
      },
      502,
    );
  }

  const policy = installation.repo_policy ?? "pr-mode";

  try {
    const result =
      policy === "direct-push"
        ? await commitDirectPush({ body, installation, installationToken })
        : await commitPullRequestMode({ body, installation, installationToken });
    // ── Audit ────────────────────────────────────────────────
    await recordAuditEvent(c.env.DB, {
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      action: "embed_commit",
      resourceType: "github_repo",
      resourceId: body.repo,
      metadata: {
        installationId: installation.id,
        policy,
        branch: result.branch,
        editId: body.editId,
        commitSha: result.commitSha,
        prUrl: result.prUrl,
        pngMutated: Boolean(body.pngBase64),
      },
    });
    return c.json<CommitResponseBody>({ ok: true, ...result, policy });
  } catch (err) {
    if (err instanceof CommitConflictError) {
      return c.json<CommitResponseBody>(
        { ok: false, error: "conflict", message: err.message },
        409,
      );
    }
    console.error("[embed/commit] upstream failure", err);
    return c.json<CommitResponseBody>(
      {
        ok: false,
        error: "upstream_error",
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
}

/** Thrown when the GitHub Contents API returns 409 (sha mismatch
 *  — someone else pushed to the same path). The handler maps it
 *  to a structured `error: "conflict"` response. */
export class CommitConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommitConflictError";
  }
}

interface CommitArgs {
  body: CommitRequestBody;
  installation: GitHubInstallationRow;
  installationToken: string;
}

interface CommitResult {
  editId: string;
  commitSha: string;
  branch: string;
  prUrl?: string;
}

/** Direct-push: `PUT /repos/:repo/contents/:path` for the yaml
 *  (and optionally the png) with the provided `sha` for optimistic
 *  concurrency. */
async function commitDirectPush(args: CommitArgs): Promise<CommitResult> {
  const targetBranch = args.installation.default_branch_override ?? args.body.branch;
  const annotationsCommit = await putFile({
    installationToken: args.installationToken,
    repo: args.body.repo,
    path: args.body.annotationsPath,
    branch: targetBranch,
    sha: args.body.annotationsSha,
    contentBase64: base64Of(args.body.annotationsYaml),
    message: `${COMMIT_MESSAGE_PREFIX} (annotations) — ${args.body.editId}`,
  });
  let pngCommitSha: string | undefined;
  if (args.body.pngBase64 && args.body.pngSha) {
    const pngCommit = await putFile({
      installationToken: args.installationToken,
      repo: args.body.repo,
      path: args.body.pngPath,
      branch: targetBranch,
      sha: args.body.pngSha,
      contentBase64: args.body.pngBase64,
      message: `${COMMIT_MESSAGE_PREFIX} (png) — ${args.body.editId}`,
    });
    pngCommitSha = pngCommit.sha;
  }
  return {
    editId: args.body.editId,
    commitSha: pngCommitSha ?? annotationsCommit.sha,
    branch: targetBranch,
  };
}

/** PR-mode: create a branch off the target branch's HEAD, commit
 *  onto it via the same `putFile` call (no `sha` needed on the
 *  new branch since the blob doesn't exist there), open a PR. */
async function commitPullRequestMode(args: CommitArgs): Promise<CommitResult> {
  const baseBranch = args.installation.default_branch_override ?? args.body.branch;
  const newBranch = `${BRANCH_PREFIX}${args.body.editId}`;
  const baseSha = await readBranchHead({
    installationToken: args.installationToken,
    repo: args.body.repo,
    branch: baseBranch,
  });
  await createBranch({
    installationToken: args.installationToken,
    repo: args.body.repo,
    newBranch,
    fromSha: baseSha,
  });
  const annotationsCommit = await putFile({
    installationToken: args.installationToken,
    repo: args.body.repo,
    path: args.body.annotationsPath,
    branch: newBranch,
    sha: args.body.annotationsSha,
    contentBase64: base64Of(args.body.annotationsYaml),
    message: `${COMMIT_MESSAGE_PREFIX} (annotations) — ${args.body.editId}`,
  });
  let lastCommitSha = annotationsCommit.sha;
  if (args.body.pngBase64 && args.body.pngSha) {
    const pngCommit = await putFile({
      installationToken: args.installationToken,
      repo: args.body.repo,
      path: args.body.pngPath,
      branch: newBranch,
      sha: args.body.pngSha,
      contentBase64: args.body.pngBase64,
      message: `${COMMIT_MESSAGE_PREFIX} (png) — ${args.body.editId}`,
    });
    lastCommitSha = pngCommit.sha;
  }
  const prUrl = await openPullRequest({
    installationToken: args.installationToken,
    repo: args.body.repo,
    head: newBranch,
    base: baseBranch,
    title: `Annot edit — ${args.body.annotationsPath}`,
    body: `Edit produced by annot.work/embed (edit id \`${args.body.editId}\`).`,
  });
  return {
    editId: args.body.editId,
    commitSha: lastCommitSha,
    branch: newBranch,
    prUrl,
  };
}

interface PutFileArgs {
  installationToken: string;
  repo: string;
  path: string;
  branch: string;
  sha: string;
  contentBase64: string;
  message: string;
  fetchImpl?: typeof fetch;
}

async function putFile(args: PutFileArgs): Promise<{ sha: string }> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.github.com/repos/${args.repo}/contents/${args.path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${args.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annot-cloud-editor",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: args.message,
      content: args.contentBase64,
      sha: args.sha,
      branch: args.branch,
    }),
  });
  if (res.status === 409) {
    throw new CommitConflictError(
      `GitHub Contents API conflict for ${args.repo}/${args.path} on branch ${args.branch}.`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Contents PUT ${res.status} for ${args.repo}/${args.path}: ${body}`);
  }
  const data = (await res.json()) as { content: { sha: string }; commit: { sha: string } };
  // Returns the COMMIT sha (not the blob sha) so the caller can
  // link to the commit on github.com / surface it in the audit.
  return { sha: data.commit.sha };
}

interface ReadBranchHeadArgs {
  installationToken: string;
  repo: string;
  branch: string;
  fetchImpl?: typeof fetch;
}

async function readBranchHead(args: ReadBranchHeadArgs): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(
    `https://api.github.com/repos/${args.repo}/git/ref/heads/${args.branch}`,
    {
      headers: {
        Authorization: `token ${args.installationToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "annot-cloud-editor",
      },
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub git-ref ${res.status} for ${args.repo}@${args.branch}: ${body}`);
  }
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

interface CreateBranchArgs {
  installationToken: string;
  repo: string;
  newBranch: string;
  fromSha: string;
  fetchImpl?: typeof fetch;
}

async function createBranch(args: CreateBranchArgs): Promise<void> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.github.com/repos/${args.repo}/git/refs`, {
    method: "POST",
    headers: {
      Authorization: `token ${args.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annot-cloud-editor",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: `refs/heads/${args.newBranch}`,
      sha: args.fromSha,
    }),
  });
  if (!res.ok && res.status !== 422) {
    // 422 = ref already exists. We treat this as "branch reused"
    // and proceed; the editId-based naming makes collisions
    // unlikely but a user re-saving with the same editId would
    // hit this.
    const body = await res.text();
    throw new Error(`GitHub create-ref ${res.status} for ${args.repo} ${args.newBranch}: ${body}`);
  }
}

interface OpenPullRequestArgs {
  installationToken: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  fetchImpl?: typeof fetch;
}

async function openPullRequest(args: OpenPullRequestArgs): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const res = await fetchImpl(`https://api.github.com/repos/${args.repo}/pulls`, {
    method: "POST",
    headers: {
      Authorization: `token ${args.installationToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "annot-cloud-editor",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title: args.title,
      body: args.body,
      head: args.head,
      base: args.base,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub create-PR ${res.status} for ${args.repo}: ${body}`);
  }
  const data = (await res.json()) as { html_url: string };
  return data.html_url;
}

/** Base64-encode a UTF-8 string for the Contents API body. */
function base64Of(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}
