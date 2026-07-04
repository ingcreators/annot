// Tests for `embed/webhook.ts` — Phase 6 follow-up 5y-6.

import { describe, expect, it } from "vitest";
import app from "../index.js";
import { makeMockD1Sqlite, makeMockEnv } from "../test-helpers.js";
import { findGitHubInstallationById, upsertGitHubInstallation } from "./github-app.js";
import { verifyHubSignature } from "./webhook.js";

const SECRET = "test-webhook-secret";

async function signBody(body: string, secret: string = SECRET): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(body)));
  let hex = "";
  for (const b of sig) hex += b.toString(16).padStart(2, "0");
  return `sha256=${hex}`;
}

describe("verifyHubSignature", () => {
  it("returns true on a matching signature", async () => {
    const body = JSON.stringify({ hello: "world" });
    const header = await signBody(body);
    expect(await verifyHubSignature(SECRET, body, header)).toBe(true);
  });

  it("returns false on a mismatching signature", async () => {
    const body = JSON.stringify({ hello: "world" });
    const header = await signBody(body, "wrong-secret");
    expect(await verifyHubSignature(SECRET, body, header)).toBe(false);
  });

  it("returns false on a missing sha256= prefix", async () => {
    const body = "x";
    expect(await verifyHubSignature(SECRET, body, "abc")).toBe(false);
  });

  it("returns false when the body has been tampered with", async () => {
    const body = JSON.stringify({ hello: "world" });
    const header = await signBody(body);
    const tampered = JSON.stringify({ hello: "world!" });
    expect(await verifyHubSignature(SECRET, tampered, header)).toBe(false);
  });
});

describe("/api/embed/webhook", () => {
  it("rejects requests without a valid signature", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const body = JSON.stringify({ action: "created", installation: { id: 1 } });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": "sha256=deadbeef",
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe("invalid_signature");
  });

  it("503 when the webhook secret is unbound", async () => {
    const env = makeMockEnv({ GITHUB_APP_WEBHOOK_SECRET: "", DB: makeMockD1Sqlite() });
    const body = "{}";
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      { method: "POST", body, headers: { "X-GitHub-Event": "ping" } },
      env,
    );
    expect(res.status).toBe(503);
  });

  it("answers ping events with 200", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "ping",
          "X-GitHub-Delivery": "abc-123",
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { event: string; delivery: string };
    expect(json.event).toBe("ping");
    expect(json.delivery).toBe("abc-123");
  });

  it("upserts a github_installations row on installation=created", async () => {
    const db = makeMockD1Sqlite();
    const env = makeMockEnv({ DB: db });
    const body = JSON.stringify({
      action: "created",
      installation: {
        id: 7777,
        account: { login: "octocat", type: "User" },
      },
      sender: { login: "octocat", id: 12345 },
    });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "installation",
          "X-GitHub-Delivery": "del-1",
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const row = await findGitHubInstallationById(db, 7777);
    expect(row?.account_login).toBe("octocat");
    expect(row?.account_type).toBe("User");
    expect(row?.repo_policy).toBe("pr-mode");
    // Installer identity captured from the webhook sender so the
    // claim gate can verify it later.
    expect(row?.installed_by_id).toBe(12345);
    expect(row?.installed_by_login).toBe("octocat");
  });

  it("sets suspended_at on installation=deleted", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubInstallation(db, {
      id: 8888,
      accountLogin: "octocat",
      accountType: "User",
    });
    const env = makeMockEnv({ DB: db });
    const body = JSON.stringify({
      action: "deleted",
      installation: { id: 8888, account: { login: "octocat", type: "User" } },
    });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    // The not-suspended filter in findGitHubInstallationById should
    // now hide the row.
    expect(await findGitHubInstallationById(db, 8888)).toBeNull();
    // The raw row should still exist (we never DELETE — just mark
    // suspended).
    const raw = await db
      .prepare("SELECT suspended_at FROM github_installations WHERE id = ?")
      .bind(8888)
      .first<{ suspended_at: number | null }>();
    expect(raw?.suspended_at).not.toBeNull();
  });

  it("toggles suspended_at on suspend / unsuspend", async () => {
    const db = makeMockD1Sqlite();
    await upsertGitHubInstallation(db, {
      id: 9999,
      accountLogin: "octocat",
      accountType: "User",
    });
    const env = makeMockEnv({ DB: db });

    const suspendBody = JSON.stringify({
      action: "suspend",
      installation: { id: 9999, account: { login: "octocat", type: "User" } },
    });
    await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body: suspendBody,
        headers: {
          "X-Hub-Signature-256": await signBody(suspendBody),
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    expect(await findGitHubInstallationById(db, 9999)).toBeNull();

    const unsuspendBody = JSON.stringify({
      action: "unsuspend",
      installation: { id: 9999, account: { login: "octocat", type: "User" } },
    });
    await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body: unsuspendBody,
        headers: {
          "X-Hub-Signature-256": await signBody(unsuspendBody),
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    const restored = await findGitHubInstallationById(db, 9999);
    expect(restored?.suspended_at).toBeNull();
  });

  it("acknowledges installation_repositories events without acting", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const body = JSON.stringify({
      action: "added",
      installation: { id: 1 },
      repositories_added: [{ full_name: "octocat/hello" }],
    });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "installation_repositories",
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ignored: boolean };
    expect(json.ignored).toBe(true);
  });

  it("rejects installation events with missing installation.id", async () => {
    const env = makeMockEnv({ DB: makeMockD1Sqlite() });
    const body = JSON.stringify({ action: "created", installation: {} });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("writes an audit_event row for claimed installations", async () => {
    const db = makeMockD1Sqlite();
    // Seed: a user + workspace + a claimed installation row.
    await db
      .prepare(
        "INSERT INTO users (id, plan, created_at, updated_at, last_seen_at) VALUES (?, 'free', 0, 0, 0)",
      )
      .bind("user-x")
      .run();
    await db
      .prepare(
        "INSERT INTO workspaces (id, name, owner_user_id, created_at) VALUES (?, 'WS', ?, 0)",
      )
      .bind("ws-x", "user-x")
      .run();
    await upsertGitHubInstallation(db, {
      id: 12121,
      accountLogin: "octocat",
      accountType: "User",
      workspaceId: "ws-x",
    });

    const env = makeMockEnv({ DB: db });
    const body = JSON.stringify({
      action: "suspend",
      installation: { id: 12121, account: { login: "octocat", type: "User" } },
    });
    const res = await app.request(
      "https://annot.work/api/embed/webhook",
      {
        method: "POST",
        body,
        headers: {
          "X-Hub-Signature-256": await signBody(body),
          "X-GitHub-Event": "installation",
        },
      },
      env,
    );
    expect(res.status).toBe(200);
    const event = await db
      .prepare(
        "SELECT action, resource_id, workspace_id FROM audit_events WHERE resource_id = ? LIMIT 1",
      )
      .bind("12121")
      .first<{ action: string; resource_id: string; workspace_id: string }>();
    expect(event?.action).toBe("embed_webhook_installation_suspend");
    expect(event?.workspace_id).toBe("ws-x");
  });
});
