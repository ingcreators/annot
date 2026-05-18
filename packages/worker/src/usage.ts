// `/api/usage` endpoint — Phase 4e (+ Phase 5 shareCount).
//
// Returns the workspace's current usage + plan limits. The PWA
// uses this to render storage / document / share count bars in
// the settings drawer + to surface the "approaching limit" banner
// before the user actually hits the gate.

import type { Context } from "hono";
import { requireAuth } from "./auth-middleware.js";
import type { Env } from "./index.js";
import { PLAN_LIMITS, type PlanId } from "./plan-gates.js";
import { activeDocumentCount, activeShareCount, totalStorageUsedBytes } from "./storage-repo.js";

export async function handleUsageGet(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await requireAuth(c);
  if (auth instanceof Response) return auth;

  // Plan + usage are read in parallel: every request to this
  // endpoint pays a 4-query D1 cost regardless.
  const [planRow, storageBytes, documentCount, shareCount] = await Promise.all([
    c.env.DB.prepare("SELECT plan FROM workspaces WHERE id = ? LIMIT 1")
      .bind(auth.workspaceId)
      .first<{ plan: string }>(),
    totalStorageUsedBytes(c.env.DB, auth.workspaceId),
    activeDocumentCount(c.env.DB, auth.workspaceId),
    activeShareCount(c.env.DB, auth.workspaceId),
  ]);
  const plan: PlanId = planRow?.plan === "pro" || planRow?.plan === "team" ? planRow.plan : "free";
  const limits = PLAN_LIMITS[plan];

  // `Number.POSITIVE_INFINITY` doesn't survive JSON.stringify
  // (it becomes `null`). Emit `null` explicitly for unlimited
  // values so clients can `value === null ? "unlimited" :
  // formatBytes(value)` without ambiguity.
  const jsonLimits = {
    storageBytes: Number.isFinite(limits.storageBytes) ? limits.storageBytes : null,
    activeDocuments: Number.isFinite(limits.activeDocuments) ? limits.activeDocuments : null,
    activeShares: Number.isFinite(limits.activeShares) ? limits.activeShares : null,
  };

  return c.json({
    ok: true,
    workspaceId: auth.workspaceId,
    plan,
    usage: {
      storageBytes,
      documentCount,
      shareCount,
    },
    limits: jsonLimits,
  });
}
