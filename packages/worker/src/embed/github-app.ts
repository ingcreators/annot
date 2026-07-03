// GitHub App credential surface + `github_installations` repo —
// Phase 6 follow-up 5y-1.
//
// This module is the foundation the rest of the 5y / 5z sub-phases
// build on:
//   - 5y-2 mints installation tokens via `GITHUB_APP_PRIVATE_KEY`
//     + `GITHUB_APP_ID` and reads PNG / yaml from the user's repo.
//   - 5y-4 commits back through the same token.
//   - 5y-1 (this PR) just declares the secrets, the `github_installations`
//     row shape, and the health-probe / setup-page endpoints so the
//     binding-deploy review is its own diff.
//
// The actual JWT signing + Contents API logic lands in 5y-2 — this
// file is intentionally small and contains no GitHub API calls.

import type { Env } from "../index.js";

/** Mirrors the `github_installations` table from `0004_github_apps.sql`. */
export interface GitHubInstallationRow {
  /** GitHub-assigned installation id. */
  id: number;
  account_login: string;
  /** 'User' | 'Organization' — mirrors GitHub's
   *  `installation.account.type`. */
  account_type: string;
  /** Workspace the installation is claimed by; null until a signed-in
   *  user binds it via the dashboard. */
  workspace_id: string | null;
  installed_at: number;
  suspended_at: number | null;
  /** 'pr-mode' (default — safer) or 'direct-push'. */
  repo_policy: "pr-mode" | "direct-push";
  default_branch_override: string | null;
  build_hook_url: string | null;
  /** JSON-encoded `Array<{ repo: string; pathPrefix: string }>`
   *  the App is authorised to commit under. NULL = no allowlist
   *  beyond the installation's repo set. */
  target_paths_json: string | null;
}

export interface InsertGitHubInstallationInput {
  id: number;
  accountLogin: string;
  accountType: "User" | "Organization";
  workspaceId?: string | null;
  repoPolicy?: "pr-mode" | "direct-push";
}

/** Insert (or upsert by id, since GitHub-assigned ids never
 *  change) a github_installations row. Used by the webhook
 *  handler in 5y-2 + the manual setup flow's callback. */
export async function upsertGitHubInstallation(
  db: D1Database,
  input: InsertGitHubInstallationInput,
): Promise<GitHubInstallationRow> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO github_installations (
        id, account_login, account_type, workspace_id,
        installed_at, suspended_at, repo_policy,
        default_branch_override, build_hook_url, target_paths_json
      ) VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET
        account_login = excluded.account_login,
        account_type  = excluded.account_type,
        workspace_id  = COALESCE(github_installations.workspace_id, excluded.workspace_id),
        repo_policy   = COALESCE(github_installations.repo_policy,  excluded.repo_policy)`,
    )
    .bind(
      input.id,
      input.accountLogin,
      input.accountType,
      input.workspaceId ?? null,
      now,
      input.repoPolicy ?? "pr-mode",
    )
    .run();

  const row = await db
    .prepare("SELECT * FROM github_installations WHERE id = ?")
    .bind(input.id)
    .first<GitHubInstallationRow>();
  if (!row) {
    throw new Error(`github_installations row vanished immediately after upsert (id=${input.id}).`);
  }
  return row;
}

/** Why the caller may not act through an installation. `null`
 *  means access is granted. */
export type InstallationAccessDenial = "unclaimed" | "other_workspace";

/** Workspace-ownership gate shared by `/api/embed/load`,
 *  `/api/embed/commit`, and (with its claim-if-unclaimed
 *  exception) `PATCH /api/embed/installations/:id`.
 *
 *  An installation is usable only by the workspace that claimed
 *  it — otherwise any authenticated annot.work user could read
 *  and commit through ANY repo the App is installed on. Claiming
 *  happens via the PATCH endpoint (interim flow until the
 *  dashboard ships a proper claim UI). */
export function checkInstallationWorkspaceAccess(
  installation: GitHubInstallationRow,
  workspaceId: string,
): InstallationAccessDenial | null {
  if (installation.workspace_id === null) return "unclaimed";
  if (installation.workspace_id !== workspaceId) return "other_workspace";
  return null;
}

/** One entry of the `target_paths_json` allowlist — see the
 *  column doc on `GitHubInstallationRow`. */
export interface TargetPathRule {
  /** Full `owner/name` repo slug (matched case-insensitively —
   *  GitHub slugs are case-insensitive). */
  repo: string;
  /** Path prefix inside the repo. Empty string allows the whole
   *  repo. */
  pathPrefix: string;
}

/** Parse `github_installations.target_paths_json`.
 *
 *  - `null` column → `null` (no allowlist; every path in the
 *    installation's repo set is allowed).
 *  - Malformed JSON / non-array → `[]` (fail CLOSED: an
 *    allowlist we can't read must not become "allow all").
 *  - Entries without string `repo` + `pathPrefix` are dropped. */
export function parseTargetPaths(json: string | null): TargetPathRule[] | null {
  if (json === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    console.error("[embed] target_paths_json is not valid JSON; failing closed");
    return [];
  }
  if (!Array.isArray(value)) {
    console.error("[embed] target_paths_json is not an array; failing closed");
    return [];
  }
  return value.filter(
    (entry): entry is TargetPathRule =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as TargetPathRule).repo === "string" &&
      typeof (entry as TargetPathRule).pathPrefix === "string",
  );
}

/** True when `path` inside `repo` is covered by the allowlist.
 *  `rules === null` means the installation has no allowlist and
 *  every path is allowed. */
export function isTargetPathAllowed(
  rules: TargetPathRule[] | null,
  repo: string,
  path: string,
): boolean {
  if (rules === null) return true;
  const repoLower = repo.toLowerCase();
  return rules.some(
    (rule) => rule.repo.toLowerCase() === repoLower && path.startsWith(rule.pathPrefix),
  );
}

/** Find an installation by GitHub-assigned id. Returns null on
 *  cache-miss; callers must handle the absence (404 for the embed
 *  endpoint, 401 for the dashboard). */
export async function findGitHubInstallationById(
  db: D1Database,
  installationId: number,
): Promise<GitHubInstallationRow | null> {
  return await db
    .prepare(
      `SELECT * FROM github_installations
       WHERE id = ? AND suspended_at IS NULL
       LIMIT 1`,
    )
    .bind(installationId)
    .first<GitHubInstallationRow>();
}

/** Find an installation by account_login. Used by 5y-2 to map a
 *  `repo=<owner>/<name>` URL param to the right installation
 *  row when the customer hasn't yet bound the installation to a
 *  specific workspace. */
export async function findGitHubInstallationByAccount(
  db: D1Database,
  accountLogin: string,
): Promise<GitHubInstallationRow | null> {
  return await db
    .prepare(
      `SELECT * FROM github_installations
       WHERE account_login = ? AND suspended_at IS NULL
       LIMIT 1`,
    )
    .bind(accountLogin)
    .first<GitHubInstallationRow>();
}

/** Subset of Env fields the GitHub App flow depends on. Pulled
 *  out so handler code can pass `c.env` to helpers that don't
 *  need the full Env. */
export type GitHubAppEnv = Pick<
  Env,
  | "GITHUB_APP_ID"
  | "GITHUB_APP_CLIENT_ID"
  | "GITHUB_APP_CLIENT_SECRET"
  | "GITHUB_APP_PRIVATE_KEY"
  | "GITHUB_APP_WEBHOOK_SECRET"
>;

export interface GitHubAppSecretsStatus {
  /** True iff every secret needed for the 5y-2+ flow is bound. */
  ok: boolean;
  /** Per-secret presence (true) / absence (false). The values
   *  themselves are NEVER returned — only whether the binding is
   *  present. */
  secrets: {
    GITHUB_APP_ID: boolean;
    GITHUB_APP_CLIENT_ID: boolean;
    GITHUB_APP_CLIENT_SECRET: boolean;
    GITHUB_APP_PRIVATE_KEY: boolean;
    GITHUB_APP_WEBHOOK_SECRET: boolean;
  };
  /** First 4 + last 4 characters of `GITHUB_APP_ID`, or null when
   *  the secret is absent. Helps the operator confirm the right
   *  App is bound without leaking the (already-public) id in full
   *  via a casual `curl` paste. */
  appIdMasked: string | null;
}

/** Reports the binding status of every GitHub-App-related secret.
 *  Returns ok=true only when ALL five are present. Used by the
 *  `/api/embed/health` endpoint to drive the operator's smoke
 *  check after `wrangler secret put`. */
export function inspectGitHubAppSecrets(env: GitHubAppEnv): GitHubAppSecretsStatus {
  const present = (s: string | undefined): boolean => typeof s === "string" && s.length > 0;
  const secrets = {
    GITHUB_APP_ID: present(env.GITHUB_APP_ID),
    GITHUB_APP_CLIENT_ID: present(env.GITHUB_APP_CLIENT_ID),
    GITHUB_APP_CLIENT_SECRET: present(env.GITHUB_APP_CLIENT_SECRET),
    GITHUB_APP_PRIVATE_KEY: present(env.GITHUB_APP_PRIVATE_KEY),
    GITHUB_APP_WEBHOOK_SECRET: present(env.GITHUB_APP_WEBHOOK_SECRET),
  };
  const ok = Object.values(secrets).every(Boolean);
  const appId = env.GITHUB_APP_ID ?? "";
  const appIdMasked =
    appId.length >= 8 ? `${appId.slice(0, 4)}…${appId.slice(-4)}` : appId.length > 0 ? "…" : null;
  return { ok, secrets, appIdMasked };
}
