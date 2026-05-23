#!/usr/bin/env node
/**
 * `setup-customer.ts` — Phase 6 follow-up 5z-2.
 *
 * Repeatable on-prem provisioning for the annot-cloud embed
 * editor. Bundles the otherwise-manual `wrangler` calls
 * (KV / D1 / R2 create, D1 migrate, secret puts) into one
 * command so a customer's CI-driven preview / staging
 * environment can stand up the editor without a human in the
 * loop.
 *
 * Usage:
 *   pnpm tsx packages/worker/scripts/setup-customer.ts \
 *     --workerName annot-cloud-acme \
 *     --account-id <cloudflare-account-id>
 *
 * The script:
 *   1. Runs `wrangler kv namespace create SESSIONS` (idempotent
 *      via stderr-grep on "already exists").
 *   2. Runs `wrangler d1 create annot-db` (same).
 *   3. Runs `wrangler r2 bucket create annot-objects` (same).
 *   4. Prints the IDs for the operator to paste into
 *      `wrangler.jsonc`.
 *   5. Runs `wrangler d1 migrations apply annot-db --remote`.
 *   6. Walks the operator through `wrangler secret put` for
 *      every secret the embed flow needs (interactive — the
 *      operator types values; the script never logs them).
 *
 * The script does NOT:
 *   - Register the GitHub App on github.com (manual one-time
 *     step; documented in
 *     `docs/plugin-api/embed-editor-self-host.md`).
 *   - Edit `wrangler.jsonc` (resource IDs printed for the
 *     operator to commit explicitly).
 *
 * Tier A — Node only, no DOM, no Workers runtime.
 */

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

interface CliArgs {
  workerName: string;
  accountId: string;
}

function parseCli(): CliArgs {
  const { values } = parseArgs({
    options: {
      workerName: { type: "string" },
      "account-id": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    printUsage();
    process.exit(0);
  }
  const workerName = values.workerName ?? "";
  const accountId = values["account-id"] ?? "";
  if (!workerName || !accountId) {
    console.error("Missing --workerName or --account-id.\n");
    printUsage();
    process.exit(1);
  }
  return { workerName, accountId };
}

function printUsage(): void {
  console.log(`Usage: setup-customer.ts --workerName <name> --account-id <id>

Provisions the Cloudflare resources + applies D1 migrations + walks
the operator through wrangler secret put for every embed-editor
secret.

Required:
  --workerName <name>     Wrangler worker name (e.g. annot-cloud-acme)
  --account-id <id>       Cloudflare account id

Run wrangler login first if you haven't authenticated this shell.

For the full self-host walkthrough, see
docs/plugin-api/embed-editor-self-host.md.
`);
}

function runWrangler(
  args: string[],
  opts: { allowFailureGrep?: RegExp } = {},
): {
  stdout: string;
  ok: boolean;
} {
  console.log(`\n$ wrangler ${args.join(" ")}`);
  const res = spawnSync("wrangler", args, { encoding: "utf8", stdio: "pipe" });
  const stdout = res.stdout ?? "";
  const stderr = res.stderr ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  if (res.status === 0) {
    return { stdout, ok: true };
  }
  if (opts.allowFailureGrep?.test(stderr)) {
    console.log("  (treating as already-exists; continuing)");
    return { stdout, ok: true };
  }
  return { stdout, ok: false };
}

interface ProvisionedResource {
  kind: "kv" | "d1" | "r2";
  name: string;
  id?: string;
}

function extractId(stdout: string, kind: "kv" | "d1" | "r2"): string | undefined {
  if (kind === "kv") {
    // wrangler kv namespace create prints:
    //   id = "abc123def456..."
    const m = stdout.match(/id\s*=\s*"([^"]+)"/);
    return m?.[1];
  }
  if (kind === "d1") {
    // wrangler d1 create prints `database_id = "<uuid>"`
    const m = stdout.match(/database_id\s*=\s*"([^"]+)"/);
    return m?.[1];
  }
  // R2 bucket names are themselves the identifier; no separate id.
  return undefined;
}

function provisionResources(): ProvisionedResource[] {
  const resources: ProvisionedResource[] = [];

  console.log("\n=== Step 1/3: KV namespace (SESSIONS) ===");
  const kv = runWrangler(["kv", "namespace", "create", "SESSIONS"], {
    allowFailureGrep: /already exists/i,
  });
  resources.push({ kind: "kv", name: "SESSIONS", id: extractId(kv.stdout, "kv") });

  console.log("\n=== Step 2/3: D1 database (annot-db) ===");
  const d1 = runWrangler(["d1", "create", "annot-db"], {
    allowFailureGrep: /already exists/i,
  });
  resources.push({ kind: "d1", name: "annot-db", id: extractId(d1.stdout, "d1") });

  console.log("\n=== Step 3/3: R2 bucket (annot-objects) ===");
  runWrangler(["r2", "bucket", "create", "annot-objects"], {
    allowFailureGrep: /already exists/i,
  });
  resources.push({ kind: "r2", name: "annot-objects" });

  return resources;
}

function applyMigrations(): void {
  console.log("\n=== Applying D1 migrations ===");
  const res = runWrangler(["d1", "migrations", "apply", "annot-db", "--remote"]);
  if (!res.ok) {
    console.error(
      "Migration apply failed. Fix the underlying issue and re-run; the wrangler call is idempotent.",
    );
    process.exit(2);
  }
}

const SECRETS = [
  // Existing OAuth secrets (Phase 2c / 3) — included so a fresh
  // tenant gets the full sign-in flow alongside the embed surface.
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  // GitHub App secrets (5y-1).
  "GITHUB_APP_ID",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_WEBHOOK_SECRET",
  "GITHUB_APP_PRIVATE_KEY",
];

function walkSecrets(): void {
  console.log("\n=== Secrets ===");
  console.log("For each prompt, paste the value + hit Enter. The script");
  console.log("never logs the values; they go straight to wrangler.\n");
  for (const name of SECRETS) {
    console.log(`\nSetting ${name}…`);
    const res = spawnSync("wrangler", ["secret", "put", name], { stdio: "inherit" });
    if (res.status !== 0) {
      console.error(`Failed to set ${name}. Re-run the script to continue.`);
      process.exit(3);
    }
  }
}

function printIds(resources: ProvisionedResource[]): void {
  console.log("\n=== Resource IDs (paste into wrangler.jsonc) ===\n");
  for (const r of resources) {
    if (r.kind === "kv")
      console.log(
        `  KV namespace SESSIONS:  id = ${r.id ?? "<look up via `wrangler kv namespace list`>"}`,
      );
    if (r.kind === "d1")
      console.log(`  D1 database annot-db:   id = ${r.id ?? "<look up via `wrangler d1 list`>"}`);
    if (r.kind === "r2") console.log("  R2 bucket annot-objects: name = annot-objects");
  }
}

function main(): void {
  const args = parseCli();
  console.log(`Provisioning '${args.workerName}' on account '${args.accountId}'`);
  console.log("Make sure you ran `wrangler login` already.");
  const resources = provisionResources();
  applyMigrations();
  walkSecrets();
  printIds(resources);
  console.log("\nDone. Next steps:");
  console.log("  1. Paste the IDs above into packages/worker/wrangler.jsonc");
  console.log("  2. Run: pnpm --filter @ingcreators/annot-worker exec wrangler deploy");
  console.log("  3. Visit /api/embed/setup on the deployed Worker to register your GitHub App");
  console.log("  4. Install the App on the repo(s) you want the editor to write to");
}

main();
