// Per-workspace plan-gated quotas — Phase 4e.
//
// Quotas live as constants here rather than DB rows so they're
// cache-friendly, version-controlled, and changing a quota for an
// existing plan is a code-change + redeploy (not a DB migration).
//
// Free-tier values during Phase 4 (pre-launch beta) are intentionally
// permissive — high enough that no real beta user hits them. They
// tighten in Phase 7 right before Stripe goes live (per
// `docs/plans/annot-cloud-roadmap.md` Phase 7d). Don't tighten them
// here without also updating the roadmap.

import { activeDocumentCount, activeShareCount, totalStorageUsedBytes } from "./storage-repo.js";

export type PlanId = "free" | "pro" | "team";

/** Per-plan resource limits. `Number.POSITIVE_INFINITY` means
 *  effectively unbounded — quota check skips the comparison rather
 *  than running into Infinity-aware SQL. */
export interface PlanLimits {
  /** Total bytes of `images.size_bytes` + `documents.size_bytes`
   *  the workspace may hold (across non-deleted rows). Annotations
   *  SVGs and thumbnails are NOT counted in Phase 4 — they're
   *  small relative to the original bytes and lumping them in
   *  inflates accounting without changing user-visible behaviour. */
  storageBytes: number;
  /** Number of non-deleted `documents` rows the workspace may
   *  hold. Phase 4 only — images aren't capped by count. */
  activeDocuments: number;
  /** Number of non-revoked `share_links` rows the workspace may
   *  hold. Revoking a share frees the slot; the underlying
   *  resource (image / document) is not affected. */
  activeShares: number;
}

/**
 * The Phase 7 "launch" values quoted in the roadmap are:
 *   free.storageBytes        = 500 MB
 *   free.activeDocuments     = 5
 *   free.activeShares        = 3
 * Phase 4e + 5 ship ~10× those numbers so the beta period has
 * headroom (per `annot-cloud-roadmap.md` Phase 7d: "free quotas
 * reduced to launch values at Phase 7d"). When Phase 7d ships,
 * edit these values + the corresponding roadmap line in lockstep.
 */
export const PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    storageBytes: 5_000_000_000, // 5 GB (beta) → 500 MB at Phase 7d
    activeDocuments: 50, // (beta) → 5 at Phase 7d
    activeShares: 30, // (beta) → 3 at Phase 7d
  },
  pro: {
    storageBytes: 50_000_000_000, // 50 GB
    activeDocuments: Number.POSITIVE_INFINITY,
    activeShares: Number.POSITIVE_INFINITY,
  },
  team: {
    // Team is a per-seat plan; the per-workspace storage cap is
    // intentionally generous to support a multi-member workspace
    // pooling its allowances. Phase 7 may revisit if Team users
    // need a per-seat-multiplied cap.
    storageBytes: 500_000_000_000, // 500 GB
    activeDocuments: Number.POSITIVE_INFINITY,
    activeShares: Number.POSITIVE_INFINITY,
  },
};

/** Result of a pre-write quota check. */
export interface QuotaCheckResult {
  /** True when the write may proceed; false when 413 is the
   *  correct response. */
  ok: boolean;
  /** Workspace's current plan id. Useful for surfacing in the
   *  error message ("Upgrade to Pro to lift this limit"). */
  plan: PlanId;
  usage: {
    storageBytes: number;
    documentCount: number;
    shareCount: number;
  };
  limits: PlanLimits;
  /** Which limit failed; undefined when `ok === true`. */
  exceeded?: "storage" | "documents" | "shares";
  /** Human-readable message for the API response body. Always
   *  populated; clients show it as-is when surfacing the gate. */
  message: string;
}

/** Read the workspace's plan id. Falls back to `"free"` when the
 *  row is missing (which shouldn't happen in practice — every
 *  authenticated request has just resolved the workspace via the
 *  session). */
async function getWorkspacePlan(db: D1Database, workspaceId: string): Promise<PlanId> {
  const row = await db
    .prepare("SELECT plan FROM workspaces WHERE id = ? LIMIT 1")
    .bind(workspaceId)
    .first<{ plan: string }>();
  const plan = row?.plan;
  if (plan === "pro" || plan === "team") return plan;
  return "free";
}

/**
 * Pre-flight quota check for an upload that's about to add
 * `additionalBytes` of `images.size_bytes` + `documents.size_bytes`
 * to the workspace. When `incrementsDocumentCount` is true the check
 * also enforces the `activeDocuments` limit.
 *
 * Call this BEFORE the D1 row insert / R2 byte upload — the gate's
 * whole job is to short-circuit those expensive operations when the
 * workspace is over quota.
 *
 * For PATCH-content (overwrite an existing document body), the
 * caller passes the size *delta* (new bytes - old bytes) as
 * `additionalBytes` so re-saving a 1 MB document inside a quota-
 * exhausted workspace doesn't get rejected when the byte count
 * didn't actually go up.
 */
export async function checkUploadQuota(
  db: D1Database,
  workspaceId: string,
  additionalBytes: number,
  options: { incrementsDocumentCount?: boolean; incrementsShareCount?: boolean } = {},
): Promise<QuotaCheckResult> {
  const [plan, currentBytes, currentDocs, currentShares] = await Promise.all([
    getWorkspacePlan(db, workspaceId),
    totalStorageUsedBytes(db, workspaceId),
    options.incrementsDocumentCount ? activeDocumentCount(db, workspaceId) : Promise.resolve(0),
    options.incrementsShareCount ? activeShareCount(db, workspaceId) : Promise.resolve(0),
  ]);
  const limits = PLAN_LIMITS[plan];
  const projectedBytes = currentBytes + Math.max(0, additionalBytes);
  const projectedDocs = options.incrementsDocumentCount ? currentDocs + 1 : currentDocs;
  const projectedShares = options.incrementsShareCount ? currentShares + 1 : currentShares;
  const usage = {
    storageBytes: currentBytes,
    documentCount: currentDocs,
    shareCount: currentShares,
  };

  if (Number.isFinite(limits.storageBytes) && projectedBytes > limits.storageBytes) {
    return {
      ok: false,
      plan,
      usage,
      limits,
      exceeded: "storage",
      message: `Workspace storage limit exceeded (${currentBytes} + ${additionalBytes} > ${limits.storageBytes} bytes on the ${plan} plan).`,
    };
  }

  if (
    options.incrementsDocumentCount &&
    Number.isFinite(limits.activeDocuments) &&
    projectedDocs > limits.activeDocuments
  ) {
    return {
      ok: false,
      plan,
      usage,
      limits,
      exceeded: "documents",
      message: `Workspace document limit exceeded (${currentDocs} + 1 > ${limits.activeDocuments} documents on the ${plan} plan).`,
    };
  }

  if (
    options.incrementsShareCount &&
    Number.isFinite(limits.activeShares) &&
    projectedShares > limits.activeShares
  ) {
    return {
      ok: false,
      plan,
      usage,
      limits,
      exceeded: "shares",
      message: `Workspace active share limit exceeded (${currentShares} + 1 > ${limits.activeShares} shares on the ${plan} plan).`,
    };
  }

  return {
    ok: true,
    plan,
    usage,
    limits,
    message: "ok",
  };
}
