// Build-trigger integration — Phase 6 follow-up 5z-1.
//
// After 5y-4's commit succeeds, the Worker pings the customer's
// configured build webhook (Cloudflare Pages deploy hook /
// Vercel deploy hook / GitHub Pages `repository_dispatch` URL).
// The hook URL lives on the `github_installations.build_hook_url`
// column (added in 5y-1's migration).
//
// Failure is non-fatal — the commit returns 200 to the editor
// even if the build-hook ping fails. The outcome is logged to
// `audit_events` (`action: 'embed_build_hook'`) so the
// installation owner can spot a persistently failing hook in the
// dashboard.
//
// Retry: simple linear back-off, capped at 3 attempts, with 30
// seconds between attempts. Cloudflare Workers cap CPU time at
// ~50ms per request but allow ~30s of wall-clock waiting on
// `fetch` (no actual CPU), so the retry budget fits inside one
// request. Adoption-time tradeoff: if a customer's webhook is
// rate-limited (Cloudflare Pages enforces 1/minute on deploy
// hooks), the first ping wins and subsequent retries get the
// rate-limit body — still treated as failure in `audit_events`.

import type { Context } from "hono";
import { requireAuth } from "../auth-middleware.js";
import type { Env } from "../index.js";
import { recordAuditEvent } from "../storage-repo.js";
import { findGitHubInstallationById, type GitHubInstallationRow } from "./github-app.js";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 30_000;

/** Fire the build-trigger webhook for the given installation.
 *  Returns the final HTTP status, or null when the
 *  installation has no `build_hook_url` configured. Failures
 *  are absorbed; the caller logs the outcome to `audit_events`. */
export async function pingBuildHook(opts: {
  installation: GitHubInstallationRow;
  /** Inject a sleep impl so tests don't wait 30s per retry. */
  sleepImpl?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
}): Promise<{ pinged: false } | { pinged: true; status: number; attempts: number }> {
  const url = opts.installation.build_hook_url;
  if (!url) return { pinged: false };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;

  let lastStatus = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "User-Agent": "annot-cloud-editor" },
      });
      lastStatus = res.status;
      if (res.ok) return { pinged: true, status: res.status, attempts: attempt };
      if (res.status < 500) {
        // 4xx is the customer's configuration problem (invalid
        // URL / revoked hook); retrying won't help.
        return { pinged: true, status: res.status, attempts: attempt };
      }
    } catch {
      lastStatus = 0;
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleepImpl(BACKOFF_MS);
    }
  }
  return { pinged: true, status: lastStatus, attempts: MAX_ATTEMPTS };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `PATCH /api/embed/installations/:id` — let an installation
 *  owner update the `build_hook_url` (and, in the future,
 *  `repo_policy` / `default_branch_override` / `target_paths_json`).
 *  Pre-dashboard the only consumer is `curl`; the dashboard
 *  UI lives downstream. */
export async function handleEmbedInstallationPatch(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;
  const idStr = c.req.param("id");
  const id = Number.parseInt(idStr ?? "", 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json(
      {
        ok: false,
        error: "invalid_request",
        message: "installation id must be a positive integer",
      },
      400,
    );
  }
  const installation = await findGitHubInstallationById(c.env.DB, id);
  if (!installation) {
    return c.json(
      { ok: false, error: "no_installation", message: `Installation ${id} not found.` },
      404,
    );
  }
  // The dashboard-UI step that pairs an installation with a
  // specific workspace lands later (5z-2's setup wizard). For
  // now the owner check is: the installation must be either
  // unclaimed (workspace_id IS NULL) OR claimed by the caller's
  // workspace. Anyone authenticated can claim an unclaimed
  // installation by being the first to PATCH against it; the
  // dashboard will add a proper claim flow later.
  if (installation.workspace_id !== null && installation.workspace_id !== auth.workspaceId) {
    return c.json(
      {
        ok: false,
        error: "not_authorised",
        message: "This installation is claimed by another workspace.",
      },
      403,
    );
  }
  let body: {
    buildHookUrl?: string | null;
    repoPolicy?: "pr-mode" | "direct-push";
    defaultBranchOverride?: string | null;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ ok: false, error: "invalid_request", message: "Body must be JSON" }, 400);
  }
  // Build the UPDATE statement dynamically over the present
  // fields. Null is meaningful — it clears the column.
  const sets: string[] = [];
  const binds: (string | null | undefined)[] = [];
  if ("buildHookUrl" in body) {
    sets.push("build_hook_url = ?");
    binds.push(body.buildHookUrl ?? null);
  }
  if ("repoPolicy" in body) {
    if (body.repoPolicy !== "pr-mode" && body.repoPolicy !== "direct-push") {
      return c.json(
        {
          ok: false,
          error: "invalid_request",
          message: "repoPolicy must be 'pr-mode' or 'direct-push'",
        },
        400,
      );
    }
    sets.push("repo_policy = ?");
    binds.push(body.repoPolicy);
  }
  if ("defaultBranchOverride" in body) {
    sets.push("default_branch_override = ?");
    binds.push(body.defaultBranchOverride ?? null);
  }
  // Claim the installation for this workspace if it's
  // unclaimed.
  if (installation.workspace_id === null) {
    sets.push("workspace_id = ?");
    binds.push(auth.workspaceId);
  }
  if (sets.length === 0) {
    return c.json({ ok: false, error: "invalid_request", message: "Nothing to update." }, 400);
  }
  binds.push(String(id));
  await c.env.DB.prepare(`UPDATE github_installations SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  await recordAuditEvent(c.env.DB, {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    action: "embed_installation_patch",
    resourceType: "github_installation",
    resourceId: String(id),
    metadata: body,
  });
  const updated = await findGitHubInstallationById(c.env.DB, id);
  return c.json({
    ok: true,
    installation: {
      id: updated?.id,
      account_login: updated?.account_login,
      repo_policy: updated?.repo_policy,
      default_branch_override: updated?.default_branch_override,
      build_hook_url: updated?.build_hook_url,
      workspace_id: updated?.workspace_id,
    },
  });
}
