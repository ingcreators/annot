# Security Policy

Annot processes user screenshots and annotation data and integrates
with multiple third-party storage backends. We take security
reports seriously and appreciate the effort it takes to find,
validate, and report issues responsibly.

## Reporting a vulnerability

**Please use [GitHub's Private Vulnerability Reporting (PVR)]**
on this repository — open the **Security** tab and click
**"Report a vulnerability"**. PVR keeps the report private until
a fix lands, threads the conversation off the public issue
tracker, and gives the reporter credit on the published advisory
unless they opt out.

[GitHub's Private Vulnerability Reporting (PVR)]: https://github.com/ingcreators/annot/security/advisories/new

If for any reason you can't use PVR (account restrictions,
internal policy, etc.), DM the maintainer on GitHub at
[@ingmrn](https://github.com/ingmrn) and we'll move the
conversation to a private channel.

**Please do not open a public issue or pull request to disclose
a security problem.** A coordinated disclosure window protects
users running Annot against opportunistic exploitation while a
fix is in flight.

## What to include in a report

The more of the following you can share, the faster we can triage:

- **Component**: which package — `@ingcreators/annot-core`,
  `@ingcreators/annot-web`, `@ingcreators/annot-extension`, or
  `@ingcreators/annot-desktop` — and which file / module if
  known.
- **Reproduction steps**: minimal sequence to trigger the issue,
  ideally against a fresh clone of `main`. A short reproduction
  repo or recorded session works too.
- **Impact assessment**: what an attacker can do with the bug —
  read user data, take over an OAuth session, run code on the
  victim's machine, escalate to another origin, etc.
- **Affected versions / commits**: which `main` commit you tested
  against, plus any tagged releases if the issue spans them.
- **Suggested fix or mitigation** (optional): if you have one,
  it accelerates the triage. We don't require you to write the
  patch.

## Scope

In scope:

- All four packages in this repository
  (`packages/{core,web,extension,desktop}`).
- The official build artifacts produced from `main` (the PWA
  hosted on `annot.work`, the published Chrome extension when
  it's released, and the Tauri desktop builds).
- The shared SVG annotation format (`docs/svg-format.md`) and
  any code that parses or emits it.

Out of scope (handle through the linked channels):

- **Hosted `annot.work` infrastructure** beyond what the OSS
  build produces — backend services, S3 / R2 buckets, billing,
  team workspace ACLs. These run from the private
  `ingcreators/annot-cloud` repo (see
  `docs/plans/oss-cloud-split.md`); reports against
  `annot.work` directly should still come through PVR on this
  repo and we'll route them internally.
- **Forks and third-party builds**. We can only commit to fix
  what ships from this repository.
- **Known design trade-offs documented in `PRODUCT_DIRECTION.md`
  or active `docs/plans/`** — for example, the SVG format
  currently includes user-supplied strings without HTML
  escaping at the SVG layer (export pipeline handles
  sanitisation); changes to that contract belong in a design
  discussion rather than a security report.

## Response targets

We aim for the following response timeline. These are targets,
not guarantees — Annot is currently a small project and may need
to lean on you for verification or additional context.

| Phase | Target |
|-------|--------|
| Initial acknowledgement | Within 3 business days |
| Triage decision (in scope / not / duplicate) | Within 7 business days |
| Fix landed on `main` for confirmed in-scope reports | Within 30 days for high-severity issues; longer for low-severity by mutual agreement |
| Public advisory + credit | After the fix lands and impacted users have had a reasonable update window |

For high-severity issues with active exploitation, the timeline
compresses — we'll prioritise a fix and may release an
advisory simultaneously with the patch.

## Coordinated disclosure

We follow standard coordinated-disclosure practice. Once a fix
is released:

1. The advisory is published via GitHub Security Advisories
   on this repository.
2. The reporter is credited unless they request anonymity.
3. CVE assignment is requested via GitHub's CNA for issues
   that warrant one.
4. The fix commit / PR references the advisory by GHSA ID so
   the audit trail is complete.

## Hardening that already ships

Capabilities the current codebase relies on; documented here so
auditors can trace each to its enforcement point:

- **Storage providers** are isolated through the
  `StorageProvider` interface
  (`packages/core/src/storage/types.ts`); no feature code reaches
  past it. Adding a backend is a closed set of file changes
  reviewed against the contract test suite
  (`packages/web/src/storage/contract.test-helpers.ts`).
- **OAuth scopes** are kept minimal — Google Drive uses
  `drive.file` (per-file authorisation, not full Drive read);
  GitHub uses device-flow auth with the user choosing repos
  individually. See
  `docs/plans/google-drive-integration.md` and
  `docs/plans/github-integration.md` for the long-form
  rationale.
- **Browser extension** uses MV3 with content-script DOM
  metadata capture gated behind explicit user action; there is
  no background page that runs unconditionally.
- **CI runs `pnpm audit --audit-level=high`** on every PR via
  the `security audit` workflow. Findings surface as a non-blocking
  check (`continue-on-error: true`) so a new transitive CVE doesn't
  stall unrelated merges; the authoritative alert path is
  GitHub's native security advisories + Dependabot upgrade PRs.
- **CI runs `gitleaks`** on every PR via the `secret scan`
  workflow with the default ruleset extended by `.gitleaks.toml`
  at the repo root. The job is **blocking** — a credential
  matching any built-in rule (AWS, GCP, GitHub PAT, Stripe,
  private keys, JWT, generic high-entropy `*_KEY` / `*_SECRET`
  assignments, …) outside the small documented allowlist fails
  the PR. The gitleaks binary is pinned by version and
  SHA-256 in the workflow.
- **Defensive `.gitignore`**: `.env*`, `*.pem`, `*.key`,
  `id_rsa*`, `serviceAccountKey*.json`, `.dev.vars`, and similar
  patterns are pre-blocked from accidental `git add`. The
  `gitleaks` gate above is the second layer that catches
  anything that slips past.
- **Build supply chain**: Vite 8 + Biome 2 + Vitest 4, all
  pinned via `pnpm-lock.yaml`. Dependabot is enabled (see
  `.github/dependabot.yml`) for ecosystem updates. In-tree
  compiled artefacts (`@ingcreators/annot-imagequant` WASM,
  `annot-win-clipboard` napi-rs `.node` prebuild) are
  byte-diffed against a fresh CI rebuild on every PR — see
  the `verify-wasm` / `verify-win-clipboard` jobs in
  `.github/workflows/ci.yml`.
