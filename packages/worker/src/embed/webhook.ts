// GitHub App webhook receiver — Phase 6 follow-up 5y-6.
//
// GitHub delivers events to the URL declared on the App's
// `hook_attributes.url` (set to `${origin}/api/embed/webhook` by
// the manifest emitted from 5y-1's `routes.ts`). This handler
// closes the gap noted at the top of `routes.ts:25` — the manifest
// pointed at this URL since 5y-1, but no actual handler existed
// until 5y-6.
//
// Events handled:
//   - `installation` action=created    → upsert github_installations row
//   - `installation` action=deleted    → set suspended_at (treat delete
//                                        as suspension so the row stays
//                                        for audit + later re-install)
//   - `installation` action=suspend    → set suspended_at
//   - `installation` action=unsuspend  → clear suspended_at
//   - `installation_repositories`      → no-op (target_paths_json is the
//                                        source of truth; we still 200
//                                        so GitHub stops re-delivering)
//   - `ping`                            → 200 (GitHub fires once after
//                                        every App config change)
//   - anything else                     → 200 { ignored: true }
//
// Signature verification: the request body is HMAC-SHA256'd with
// `GITHUB_APP_WEBHOOK_SECRET`; the hex digest is compared against
// `X-Hub-Signature-256` in constant time. Any mismatch returns
// 401 and the event is dropped (GitHub will retry per its standard
// redelivery policy).

import type { Context } from "hono";
import type { Env } from "../index.js";
import { recordAuditEvent } from "../storage-repo.js";
import { upsertGitHubInstallation } from "./github-app.js";

interface InstallationAccount {
  login?: string;
  type?: string;
}

interface InstallationPayload {
  id?: number;
  account?: InstallationAccount;
  suspended_at?: string | null;
}

interface InstallationEvent {
  action?: string;
  installation?: InstallationPayload;
}

/**
 * `POST /api/embed/webhook` — GitHub App event receiver. Verifies
 * the signature then dispatches by `X-GitHub-Event` header. Always
 * returns a JSON body; status is 200 for handled / ignored events
 * and 401 for signature failures.
 */
export async function handleEmbedWebhook(c: Context<{ Bindings: Env }>): Promise<Response> {
  const secret = c.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) {
    return c.json(
      {
        ok: false,
        error: "webhook_secret_unset",
        message: "GITHUB_APP_WEBHOOK_SECRET is not bound; cannot verify deliveries.",
      },
      503,
    );
  }

  const signature = c.req.header("X-Hub-Signature-256") ?? "";
  const eventType = c.req.header("X-GitHub-Event") ?? "";
  const delivery = c.req.header("X-GitHub-Delivery") ?? "";

  const bodyText = await c.req.text();
  const verified = await verifyHubSignature(secret, bodyText, signature);
  if (!verified) {
    return c.json(
      {
        ok: false,
        error: "invalid_signature",
        message: "X-Hub-Signature-256 did not match the body HMAC.",
      },
      401,
    );
  }

  // `ping` is GitHub's "is your endpoint alive?" sentinel — fired
  // once after the App is registered + after every config change.
  if (eventType === "ping") {
    return c.json({ ok: true, event: "ping", delivery });
  }

  if (eventType === "installation") {
    return handleInstallationEvent(c, bodyText, delivery);
  }

  if (eventType === "installation_repositories") {
    // The repo-allowlist source of truth is `target_paths_json` on
    // the installation row; the per-repo grant set GitHub maintains
    // is informational. Acknowledge so GitHub doesn't redeliver.
    return c.json({ ok: true, event: eventType, delivery, ignored: true });
  }

  return c.json({ ok: true, event: eventType, delivery, ignored: true });
}

async function handleInstallationEvent(
  c: Context<{ Bindings: Env }>,
  bodyText: string,
  delivery: string,
): Promise<Response> {
  let payload: InstallationEvent;
  try {
    payload = JSON.parse(bodyText) as InstallationEvent;
  } catch {
    return c.json({ ok: false, error: "invalid_payload", message: "Body is not JSON." }, 400);
  }
  const action = payload.action;
  const inst = payload.installation;
  if (!inst || typeof inst.id !== "number") {
    return c.json(
      {
        ok: false,
        error: "invalid_payload",
        message: "installation.id missing or not numeric",
      },
      400,
    );
  }

  const accountType = inst.account?.type === "Organization" ? "Organization" : "User";
  const accountLogin = inst.account?.login ?? "";

  if (action === "created") {
    const row = await upsertGitHubInstallation(c.env.DB, {
      id: inst.id,
      accountLogin,
      accountType,
    });
    await auditInstallationEvent(c.env.DB, {
      workspaceId: row.workspace_id,
      action: "embed_webhook_installation_created",
      installationId: inst.id,
      delivery,
      payloadAction: action,
    });
    return c.json({ ok: true, event: "installation", action, delivery });
  }

  if (action === "deleted" || action === "suspend") {
    await c.env.DB.prepare("UPDATE github_installations SET suspended_at = ? WHERE id = ?")
      .bind(Date.now(), inst.id)
      .run();
    await auditInstallationEvent(c.env.DB, {
      workspaceId: await lookupWorkspaceId(c.env.DB, inst.id),
      action:
        action === "deleted"
          ? "embed_webhook_installation_deleted"
          : "embed_webhook_installation_suspend",
      installationId: inst.id,
      delivery,
      payloadAction: action,
    });
    return c.json({ ok: true, event: "installation", action, delivery });
  }

  if (action === "unsuspend") {
    await c.env.DB.prepare("UPDATE github_installations SET suspended_at = NULL WHERE id = ?")
      .bind(inst.id)
      .run();
    await auditInstallationEvent(c.env.DB, {
      workspaceId: await lookupWorkspaceId(c.env.DB, inst.id),
      action: "embed_webhook_installation_unsuspend",
      installationId: inst.id,
      delivery,
      payloadAction: action,
    });
    return c.json({ ok: true, event: "installation", action, delivery });
  }

  // Other installation actions (e.g. `new_permissions_accepted`)
  // are acknowledged but not acted on yet.
  return c.json({ ok: true, event: "installation", action, delivery, ignored: true });
}

/** Look up the workspace_id of an installation, including suspended
 *  rows (the embed-flow helpers filter out suspended; the webhook
 *  audit log needs to find the workspace even mid-suspend). */
async function lookupWorkspaceId(db: D1Database, installationId: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT workspace_id FROM github_installations WHERE id = ?")
    .bind(installationId)
    .first<{ workspace_id: string | null }>();
  return row?.workspace_id ?? null;
}

/** Best-effort audit log. Writes to `audit_events` only when the
 *  installation is already claimed by a workspace (the table's
 *  `workspace_id` is NOT NULL); otherwise console.warns so the
 *  unclaimed-install case stays visible in Workers logs without
 *  breaking the schema. */
async function auditInstallationEvent(
  db: D1Database,
  opts: {
    workspaceId: string | null;
    action: string;
    installationId: number;
    delivery: string;
    payloadAction: string | undefined;
  },
): Promise<void> {
  if (!opts.workspaceId) {
    console.warn(
      `[embed-webhook] ${opts.action} installation=${opts.installationId} delivery=${opts.delivery} — unclaimed installation, audit_events skipped`,
    );
    return;
  }
  await recordAuditEvent(db, {
    workspaceId: opts.workspaceId,
    userId: null,
    action: opts.action,
    resourceType: "github_installation",
    resourceId: String(opts.installationId),
    metadata: {
      delivery: opts.delivery,
      payload_action: opts.payloadAction,
    },
  });
}

/**
 * Constant-time verification of GitHub's `X-Hub-Signature-256`
 * header. The header value is `sha256=<hex>`; we recompute the
 * HMAC over the raw request body and compare in fixed time.
 */
export async function verifyHubSignature(
  secret: string,
  bodyText: string,
  signatureHeader: string,
): Promise<boolean> {
  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  const provided = signatureHeader.slice(expectedPrefix.length);
  const expected = await hmacSha256Hex(secret, bodyText);
  return timingSafeEqualHex(provided, expected);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return bytesToHex(new Uint8Array(sig));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Constant-time hex comparison. Returns false fast only when the
 *  lengths differ — the per-byte loop touches every byte even when
 *  it has already found a mismatch, so a timing oracle can't read
 *  the position of the first differing byte. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
