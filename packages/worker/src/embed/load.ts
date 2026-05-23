// `/api/embed/load` endpoint — Phase 6 follow-up 5y-2.
//
// Flow:
//   1. Parse the URL params via `parseEmbedRequestUrl` from
//      `@ingcreators/annot-embed-protocol` (canonical contract
//      from the OSS-side `encodeEmbedRequestUrl` produced by
//      `<AnnotEditButton>`).
//   2. Authorise the visitor via session cookie (cloud-roadmap
//      Phase 3 — in production at `annot.work/api/*`).
//   3. Look up the github_installations row by repo owner. The
//      account_login lookup is what lets a visitor whose own
//      installation has been registered hit the endpoint without
//      additional pairing.
//   4. Mint an installation token (cached in SESSIONS KV) and
//      read repo metadata to discover the default branch + private
//      flag.
//   5. Per the pricing-tier mapping in
//      `docs/plans/annot-cloud-roadmap.md`, free-tier visitors
//      can only load PUBLIC repos; private repos require
//      `users.plan IN ('pro', 'team', 'enterprise')`.
//   6. Fetch PNG (binary) + annotations yaml (text) via the
//      Contents API.
//   7. Respond with `{ pngBase64, annotationsYaml,
//      repoState: { branch, headSha, pngSha, annotationsSha } }`.
//      The `*Sha` fields feed 5y-4's optimistic-write commit
//      endpoint.

import { EmbedRequestUrlError, parseEmbedRequestUrl } from "@ingcreators/annot-embed-protocol";
import type { Context } from "hono";
import { requireAuth } from "../auth-middleware.js";
import type { Env } from "../index.js";
import { findGitHubInstallationByAccount, type GitHubInstallationRow } from "./github-app.js";
import { getInstallationToken, readRepoFile, readRepoInfo } from "./github-app-token.js";

/** Plans that may load PRIVATE repos via the embed endpoint.
 *  Free-tier hits a 403 on private-repo loads — the user's docs
 *  site can still link to the editor (and the editor surfaces the
 *  upgrade prompt), but the load itself fails closed. */
const PRIVATE_REPO_PLANS = new Set(["pro", "team", "enterprise", "early_supporter"]);

export interface EmbedLoadResponseBody {
  ok: true;
  installationId: number;
  pngBase64: string;
  annotationsYaml: string;
  repoState: {
    branch: string;
    pngSha: string;
    annotationsSha: string;
    private: boolean;
  };
}

export async function handleEmbedLoad(c: Context<{ Bindings: Env }>): Promise<Response> {
  // ── 1. Auth ───────────────────────────────────────────────
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  // ── 2. Parse the embed-request URL params ─────────────────
  let parsed: ReturnType<typeof parseEmbedRequestUrl>;
  try {
    parsed = parseEmbedRequestUrl(c.req.url);
  } catch (err) {
    if (err instanceof EmbedRequestUrlError) {
      return c.json({ ok: false, error: "invalid_request", message: err.message }, 400);
    }
    throw err;
  }

  // Slug guard — repo must be "owner/name" with no traversal.
  const repoMatch = parsed.repo.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!repoMatch) {
    return c.json({ ok: false, error: "invalid_request", message: "repo must be owner/name" }, 400);
  }
  // Capture group exists per the regex above; assert non-null for
  // the strict-null check.
  const repoOwner = repoMatch[1] as string;
  // Path guard — no leading `/`, no `..` segments, no NUL bytes.
  for (const path of [parsed.pngPath, parsed.annotationsPath]) {
    if (path.startsWith("/") || path.includes("..") || path.includes("\0")) {
      return c.json({ ok: false, error: "invalid_request", message: "path is unsafe" }, 400);
    }
  }

  // ── 3. Look up the github_installations row ───────────────
  const installation = await findGitHubInstallationByAccount(c.env.DB, repoOwner);
  if (!installation) {
    return c.json(
      {
        ok: false,
        error: "no_installation",
        message: `No annot-cloud-editor App installation found on "${repoOwner}". Install the App from https://github.com/apps/annot-cloud-editor.`,
      },
      404,
    );
  }

  // ── 4. Mint an installation token + read repo info ────────
  let installationToken: string;
  try {
    installationToken = await getInstallationToken(c.env, c.env.SESSIONS, installation.id);
  } catch (err) {
    console.error("[embed/load] installation token mint failed", err);
    return c.json(
      {
        ok: false,
        error: "upstream_error",
        message: "Failed to mint a GitHub installation token.",
      },
      502,
    );
  }

  let repoInfo: Awaited<ReturnType<typeof readRepoInfo>>;
  try {
    repoInfo = await readRepoInfo({ installationToken, repo: parsed.repo });
  } catch (err) {
    console.error("[embed/load] repo metadata fetch failed", err);
    return c.json(
      { ok: false, error: "upstream_error", message: "Failed to read repo metadata." },
      502,
    );
  }

  // ── 5. Plan-tier gate for private repos ───────────────────
  if (repoInfo.private) {
    const userPlanRow = await c.env.DB.prepare(
      "SELECT plan FROM users WHERE id = ? AND deleted_at IS NULL",
    )
      .bind(auth.userId)
      .first<{ plan: string }>();
    const plan = userPlanRow?.plan ?? "free";
    if (!PRIVATE_REPO_PLANS.has(plan)) {
      return c.json(
        {
          ok: false,
          error: "plan_required",
          message:
            "Editing private repos requires a Pro plan or above. Visit https://annot.work/settings/billing to upgrade.",
          requiredPlan: "pro",
        },
        403,
      );
    }
  }

  // ── 6. Fetch the PNG + annotations yaml ───────────────────
  const branch = installation.default_branch_override ?? repoInfo.default_branch;
  let pngFile: Awaited<ReturnType<typeof readRepoFile>>;
  let annotationsFile: Awaited<ReturnType<typeof readRepoFile>>;
  try {
    [pngFile, annotationsFile] = await Promise.all([
      readRepoFile({
        installationToken,
        repo: parsed.repo,
        path: parsed.pngPath,
        ref: branch,
      }),
      readRepoFile({
        installationToken,
        repo: parsed.repo,
        path: parsed.annotationsPath,
        ref: branch,
      }),
    ]);
  } catch (err) {
    console.error("[embed/load] file fetch failed", err);
    const message = err instanceof Error ? err.message : String(err);
    if (/404/.test(message)) {
      return c.json(
        {
          ok: false,
          error: "not_found",
          message: `One of the requested files does not exist on ${parsed.repo}@${branch}.`,
        },
        404,
      );
    }
    return c.json(
      { ok: false, error: "upstream_error", message: "Failed to fetch repo file contents." },
      502,
    );
  }

  // ── 7. Respond ────────────────────────────────────────────
  const body: EmbedLoadResponseBody = {
    ok: true,
    installationId: installation.id,
    pngBase64: pngFile.contentBase64,
    annotationsYaml: annotationsFile.text,
    repoState: {
      branch,
      pngSha: pngFile.sha,
      annotationsSha: annotationsFile.sha,
      private: repoInfo.private,
    },
  };
  return c.json(body);
}

/** Surface helper for tests: expose the row → response builder
 *  so unit tests can exercise the plan-gate logic without
 *  stubbing the full handler. */
export function isPrivateRepoPlan(plan: string | undefined | null): boolean {
  return PRIVATE_REPO_PLANS.has(plan ?? "free");
}

/** Re-export for tests that want to construct an installation
 *  row without touching the DB. */
export type { GitHubInstallationRow };
