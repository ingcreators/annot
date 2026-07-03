// Tests for `embed/github-app.ts` + `embed/routes.ts` —
// Phase 6 follow-up 5y-1.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { makeMockD1Sqlite, makeMockEnv } from "../test-helpers.js";
import {
  checkInstallationWorkspaceAccess,
  findGitHubInstallationByAccount,
  findGitHubInstallationById,
  type GitHubInstallationRow,
  inspectGitHubAppSecrets,
  isTargetPathAllowed,
  parseTargetPaths,
  upsertGitHubInstallation,
} from "./github-app.js";

describe("inspectGitHubAppSecrets", () => {
  it("reports ok:true when every secret is bound", () => {
    const env = makeMockEnv();
    const status = inspectGitHubAppSecrets(env);
    expect(status.ok).toBe(true);
    expect(status.secrets).toEqual({
      GITHUB_APP_ID: true,
      GITHUB_APP_CLIENT_ID: true,
      GITHUB_APP_CLIENT_SECRET: true,
      GITHUB_APP_PRIVATE_KEY: true,
      GITHUB_APP_WEBHOOK_SECRET: true,
    });
  });

  it("reports ok:false when any secret is empty", () => {
    const env = makeMockEnv({ GITHUB_APP_PRIVATE_KEY: "" });
    const status = inspectGitHubAppSecrets(env);
    expect(status.ok).toBe(false);
    expect(status.secrets.GITHUB_APP_PRIVATE_KEY).toBe(false);
    expect(status.secrets.GITHUB_APP_ID).toBe(true);
  });

  it("masks the GITHUB_APP_ID when at least 8 chars", () => {
    const env = makeMockEnv({ GITHUB_APP_ID: "1234567890" });
    const status = inspectGitHubAppSecrets(env);
    expect(status.appIdMasked).toBe("1234…7890");
  });

  it("shows an ellipsis-only mask when the id is short", () => {
    const env = makeMockEnv({ GITHUB_APP_ID: "42" });
    const status = inspectGitHubAppSecrets(env);
    expect(status.appIdMasked).toBe("…");
  });

  it("returns null masked id when GITHUB_APP_ID is empty", () => {
    const env = makeMockEnv({ GITHUB_APP_ID: "" });
    const status = inspectGitHubAppSecrets(env);
    expect(status.appIdMasked).toBeNull();
  });
});

describe("github_installations CRUD", () => {
  it("upserts a row and finds it by id", async () => {
    const db = makeMockD1Sqlite();
    const row = await upsertGitHubInstallation(db, {
      id: 111,
      accountLogin: "octocat",
      accountType: "User",
    });
    expect(row.id).toBe(111);
    expect(row.account_login).toBe("octocat");
    expect(row.account_type).toBe("User");
    expect(row.repo_policy).toBe("pr-mode");
    expect(row.workspace_id).toBeNull();

    const found = await findGitHubInstallationById(db, 111);
    expect(found?.account_login).toBe("octocat");
  });

  it("re-upsert preserves the existing workspace_id + repo_policy", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubInstallation(db, {
      id: 222,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-aaa",
      repoPolicy: "direct-push",
    });
    // Webhook re-fires installation event — workspace_id +
    // repo_policy must NOT regress to nulls / defaults.
    const re = await upsertGitHubInstallation(db, {
      id: 222,
      accountLogin: "octocat-renamed",
      accountType: "User",
    });
    expect(re.workspace_id).toBe("ws-aaa");
    expect(re.repo_policy).toBe("direct-push");
    expect(re.account_login).toBe("octocat-renamed");
  });

  it("finds by account_login when present + not-suspended", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubInstallation(db, {
      id: 333,
      accountLogin: "acme-inc",
      accountType: "Organization",
    });
    const found = await findGitHubInstallationByAccount(db, "acme-inc");
    expect(found?.id).toBe(333);
    const notFound = await findGitHubInstallationByAccount(db, "nope");
    expect(notFound).toBeNull();
  });

  it("skips suspended rows in lookups", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubInstallation(db, {
      id: 444,
      accountLogin: "sleeping",
      accountType: "User",
    });
    await db
      .prepare("UPDATE github_installations SET suspended_at = ? WHERE id = ?")
      .bind(Date.now(), 444)
      .run();
    expect(await findGitHubInstallationById(db, 444)).toBeNull();
    expect(await findGitHubInstallationByAccount(db, "sleeping")).toBeNull();
  });
});

describe("checkInstallationWorkspaceAccess", () => {
  function row(workspaceId: string | null): GitHubInstallationRow {
    return {
      id: 1,
      account_login: "octocat",
      account_type: "User",
      workspace_id: workspaceId,
      installed_at: 0,
      suspended_at: null,
      repo_policy: "pr-mode",
      default_branch_override: null,
      build_hook_url: null,
      target_paths_json: null,
    };
  }

  it("grants access to the claiming workspace", () => {
    expect(checkInstallationWorkspaceAccess(row("ws-1"), "ws-1")).toBeNull();
  });

  it("denies unclaimed installations", () => {
    expect(checkInstallationWorkspaceAccess(row(null), "ws-1")).toBe("unclaimed");
  });

  it("denies other workspaces", () => {
    expect(checkInstallationWorkspaceAccess(row("ws-2"), "ws-1")).toBe("other_workspace");
  });
});

describe("parseTargetPaths / isTargetPathAllowed", () => {
  it("NULL column means no allowlist (everything allowed)", () => {
    const rules = parseTargetPaths(null);
    expect(rules).toBeNull();
    expect(isTargetPathAllowed(rules, "octocat/myrepo", "any/path.png")).toBe(true);
  });

  it("matches repo case-insensitively and paths by prefix", () => {
    const rules = parseTargetPaths(
      JSON.stringify([{ repo: "Octocat/MyRepo", pathPrefix: "docs/" }]),
    );
    expect(isTargetPathAllowed(rules, "octocat/myrepo", "docs/login.png")).toBe(true);
    expect(isTargetPathAllowed(rules, "octocat/myrepo", "src/login.png")).toBe(false);
    expect(isTargetPathAllowed(rules, "octocat/other", "docs/login.png")).toBe(false);
  });

  it("an empty pathPrefix allows the whole repo", () => {
    const rules = parseTargetPaths(JSON.stringify([{ repo: "octocat/myrepo", pathPrefix: "" }]));
    expect(isTargetPathAllowed(rules, "octocat/myrepo", "anywhere/at/all.yaml")).toBe(true);
    expect(isTargetPathAllowed(rules, "octocat/other", "anywhere/at/all.yaml")).toBe(false);
  });

  it("fails CLOSED on malformed JSON", () => {
    const rules = parseTargetPaths("{not json");
    expect(rules).toEqual([]);
    expect(isTargetPathAllowed(rules, "octocat/myrepo", "docs/login.png")).toBe(false);
  });

  it("fails CLOSED on a non-array value and drops malformed entries", () => {
    expect(parseTargetPaths(JSON.stringify({ repo: "octocat/myrepo" }))).toEqual([]);
    const rules = parseTargetPaths(
      JSON.stringify([{ repo: "octocat/myrepo", pathPrefix: "docs/" }, { repo: 42 }, "nope", null]),
    );
    expect(rules).toEqual([{ repo: "octocat/myrepo", pathPrefix: "docs/" }]);
  });
});

describe("/api/embed/health", () => {
  it("returns ok:true when every secret is bound", async () => {
    const env = makeMockEnv();
    const res = await app.request("/api/embed/health", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      feature: string;
      appIdMasked: string | null;
      secrets: Record<string, boolean>;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("annot-api");
    expect(body.feature).toBe("embed");
    expect(body.appIdMasked).not.toBeNull();
    expect(body.secrets.GITHUB_APP_PRIVATE_KEY).toBe(true);
  });

  it("returns ok:false when a secret is missing", async () => {
    const env = makeMockEnv({ GITHUB_APP_WEBHOOK_SECRET: "" });
    const res = await app.request("/api/embed/health", {}, env);
    // Endpoint stays 200 — `ok: false` in the body signals
    // missing config, mirroring `/api/health/bindings`'s shape.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; secrets: Record<string, boolean> };
    expect(body.ok).toBe(false);
    expect(body.secrets.GITHUB_APP_WEBHOOK_SECRET).toBe(false);
    expect(body.secrets.GITHUB_APP_PRIVATE_KEY).toBe(true);
  });
});

describe("/api/embed/setup", () => {
  it("renders the manifest-flow HTML page with a GitHub form action", async () => {
    const env = makeMockEnv();
    const res = await app.request("https://annot.work/api/embed/setup", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);
    const html = await res.text();
    expect(html).toContain('action="https://github.com/settings/apps/new"');
    expect(html).toContain('name="manifest"');
    expect(html).toContain("annot-cloud-editor");
    expect(html).toContain("wrangler secret put GITHUB_APP_ID");
  });

  it("rewrites the manifest origin to match the incoming request host", async () => {
    const env = makeMockEnv();
    const res = await app.request("https://annot.example.com/api/embed/setup", {}, env);
    const html = await res.text();
    // The redirect_url / setup_url / hook URL in the embedded
    // manifest JSON should reflect the self-host origin so the
    // resulting GitHub App points back at the customer's
    // deployment.
    expect(html).toContain("https://annot.example.com/api/embed/setup/callback");
    expect(html).toContain("https://annot.example.com/api/embed/webhook");
  });

  it("renders the 'secrets missing' notice when any secret is unset", async () => {
    const env = makeMockEnv({ GITHUB_APP_ID: "" });
    const res = await app.request("https://annot.work/api/embed/setup", {}, env);
    const html = await res.text();
    expect(html).toContain("Secrets missing");
    expect(html).not.toContain("Secrets bound");
  });

  it("renders the 'secrets bound' notice when every secret is set", async () => {
    const env = makeMockEnv();
    const res = await app.request("https://annot.work/api/embed/setup", {}, env);
    const html = await res.text();
    expect(html).toContain("Secrets bound");
  });

  it("sets a restrictive Content-Security-Policy", async () => {
    const env = makeMockEnv();
    const res = await app.request("https://annot.work/api/embed/setup", {}, env);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action https://github.com");
  });
});
