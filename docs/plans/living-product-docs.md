# Living product docs — Playwright + Astro + annot

> **Status:** Draft — strategic plan capturing the conversation that
>   established `annot` as a "living product docs platform" with two
>   verticals (global operation manuals + Japanese 画面設計書). PoC
>   work (Phase 0) is ready to start; Phase 1+ gated on PoC
>   findings and a positioning update in
>   [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md).
> **Compatibility:** Additive across the existing OSS surface. New
>   packages (`@ingcreators/annot-screen-spec`,
>   `@ingcreators/annot-astro-screen-spec`,
>   `@ingcreators/annot-xlsx-screen-spec`) compose existing
>   primitives (annot-annotator + annot-playwright + annot-mcp).
>   Existing public APIs untouched; existing `screen.yaml` is a
>   new file format, no schema migration of existing artefacts.
> **Risk:** Medium-high. The technical work is small (~6 weeks
>   solo to ship Phase 1+2+3); the positioning shift is the
>   risk-bearing part. Asserting "annot is a docs platform, not
>   just an annotation toolkit" affects every README, the
>   `PRODUCT_DIRECTION.md` north star, and the Pro tier pricing
>   model in [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md).

## TL;DR

`annot-annotator` + `annot-playwright` already ship the
primitives needed to generate annotated screenshots from
live Playwright captures. Wrap them in a thin authoring layer
(`screen.yaml` — a Playwright `aria-snapshot` plus
human-written overlays) and a set of output adapters (Astro,
Excel, PDF) and the combined product becomes **"living user
manuals from your existing Playwright test suite"** — a
category currently held by closed-source SaaS
(Scribehow / Guidde / Tango) on the global side and by Excel
templates on the Japanese SI side. neither addresses the
"docs drift when the UI changes" problem; both lose to a
code-driven, CI-integrated alternative.

The plan unfolds in eight phases:

| Phase | Output | Estimated work |
|---|---|---|
| 0. PoC | One screen → annotated PNG + Excel + Astro page, by hand | ~3 days |
| 1. Core package | `@ingcreators/annot-screen-spec` (yaml + fixture + resolver) | 1 week |
| 2. Astro integration | `@ingcreators/annot-astro-screen-spec` | 1 week |
| 3. Excel adapter | `@ingcreators/annot-xlsx-screen-spec` | 1 week |
| 4. Drift detection CLI | `annot screen-spec lint` + CI integration | 3 days |
| 5. AI-assisted authoring | Three new tools on `@ingcreators/annot-mcp` | 1 week |
| 6. Cloud Web editor (Pro tier) | Browser-based `overlays` authoring with GitHub PR output | 2 weeks |
| 7. Publication + positioning | `PRODUCT_DIRECTION.md` update; launch blog | 3 days |

Phases 1–4 are the OSS minimum viable product. Phases 5–6
are Annot Cloud Pro tier features. Phase 7 is the
positioning shift.

## Strategic context

### Why now

Three tail-winds converged in late 2024 / early 2026:

1. **Playwright `aria-snapshot`** (Playwright ≥1.49, late
   2024) made the accessibility tree a first-class agent-
   readable primitive. `playwright-mcp` (Microsoft's
   official MCP server), `playwright-cli`, and Cursor /
   Claude Code all converged on it as the standard for
   describing what's on a page. The same primitive is
   exactly what a screen design document needs — `role`,
   `name`, hierarchy — with refs as ephemeral handles.
2. **`@ingcreators/annot-mcp` shipped** (Phase 8 of
   [`_done/agent-mcp-integration.md`](./_done/agent-mcp-integration.md),
   2026-05-20). Annot now speaks MCP; AI agents can call
   `annot_annotate_url` directly. Adding "AI-drafted screen
   spec" tools is one phase, not a rebuild.
3. **The OSS publish pipeline is done**
   ([`_done/headless-annotator-publish.md`](./_done/headless-annotator-publish.md),
   2026-05-20). Five `@ingcreators/*` packages on npm with
   Trusted Publishing + dual-mode auth. Adding new packages
   to the same pipeline is mechanical.

Each of these is recent (last ~6 months) and converging now.
A year ago this plan would have been premature on the
primitive layer; a year from now Mintlify or GitHub might
build their own version and the niche shrinks.

### The two verticals

The single underlying engine serves two distinct deliverable
needs:

**Vertical A — Global operation manuals**

- Audience: end users of software products
- Format: Web docs (Astro), embedded screenshots, multi-language
- Customers: SaaS companies, OSS projects, technical writers
- Current state: GitBook / Mintlify / Document360 + manual screenshots
- Pain: screenshots go stale on every UI change; technical
  writer chases the dev team to update them; multi-language
  variants must be re-recorded per locale
- Market size: massive — every SaaS, every B2B product, every
  enterprise tool. Comparable existing companies: Scribehow
  (~$50M ARR), Mintlify (~$10M+ ARR), GitBook ($40M+ ARR)
- Existing competitor closest in shape: **Scribehow** —
  browser-extension recorder, $24/user/month, ~1M users.
  Differs from annot in being a click-recorder, not
  code-driven. Records once; doesn't stay in sync.

**Vertical B — Japanese SI 画面設計書 (screen design specs)**

- Audience: developers + customer (sign-off) + maintenance
  contractors
- Format: Excel (occasionally Word/PDF), formal templates per
  SIer, numbered callouts + item-spec tables + screen
  transition diagrams
- Customers: Japanese / Korean SIers, 受託 / 公共系
- Current state: 100% manual; ~1 person-month per project
  consumed by screen-spec authoring; goes out of sync with
  implementation immediately
- Pain: documented in
  [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md)'s
  "Japanese SI culture" notes (informally); the deliverable
  is required for client sign-off but provides little
  ongoing value because of drift
- Market size: smaller — Japan/Korea/Taiwan SI industry,
  ~$50B globally, very fragmented buyer base; but ARPU
  potentially high (saving 1 person-month per project ≈
  ¥1M+ value)
- Existing competitor: none global; some regional Japanese
  SaaS exist but none does code-driven generation

The two verticals share **all** the input infrastructure
(Playwright test, aria-snapshot, `screen.yaml`, annot DSL)
and differ only in the **output adapter**:

```
                Playwright + aria-snapshot
                       ↓
                  screen.yaml (YAML on disk)
                       ↓
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
    Astro (Web)    Excel (SI)    PDF / future verticals
    Vertical A     Vertical B
```

### Why annot wins against existing solutions

For **Vertical A** (Scribehow et al. as competitors):

| Axis | Scribehow / Guidde / Tango | annot |
|---|---|---|
| Input | Browser extension records human clicks | Playwright tests (already exist for testing) |
| Update model | Re-record manually when UI changes | Re-run tests in CI; drift detected automatically |
| Hosting | Closed SaaS | OSS + self-host or Annot Cloud |
| Customisation | Templates only | Full Astro / DSL freedom |
| Multi-language | Re-record per locale | Re-run tests with different `locale` |
| Version control | Proprietary versioning | Git-native |
| CI/CD | None | First-class |
| AI integration | Limited / none | `annot-mcp` agent-callable |

The defensible angle: **code-driven, CI-native, OSS core,
drift-detected**. Scribehow's $24/user pricing buys a
recorder + a viewer; annot's pitch buys "your docs stay
honest about your product."

For **Vertical B** (Excel templates as the status quo):

The status quo loses on every axis except "client expects
Excel." annot wins by **producing Excel from a code-driven
source of truth** — which is genuinely novel. Existing
画面設計書 generation efforts in Japan are either:

- Internal SI-firm tooling (proprietary, project-scoped,
  doesn't generalise)
- Manual Excel templates with macros
- Cacoo / draw.io extensions for the transition diagram
  only

None is connected to a running test suite. Annot's
defensible angle here is **first-mover** in a market
incumbents don't pay attention to.

## Technical design

### Primitive: Playwright aria-snapshot + persistent match keys

The foundational decision: use Playwright's
`aria-snapshot` (also called `_snapshotForAI` internally) as
the structural source-of-truth for what's on the page.
Quoting the format:

```
- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- checkbox "Remember me" [ref=e7]
- button "Sign in" [ref=e9]
```

This already encodes:

- **Project name** of every interactive element via `name`
- **Element type** via `role`
- **Hierarchy** via YAML indentation
- **Ephemeral handle** via `ref=eN`

A single Playwright API call (`page._snapshotForAI()` or the
public `page.locator('body').ariaSnapshot()`) produces the
entire tree.

**Critical: refs are session-local.** `ref=e3` in snapshot
#1 may be `ref=e4` in snapshot #2 if a new element was
added above. annot **must not persist refs**. The fix is to
use `role + name` (with tree-path disambiguation for
duplicates) as the persistent match key:

```yaml
overlays:
  - match: { role: textbox, name: Email }       # persistent
    note: 会社のメールアドレスを入力
    callout: { intent: required, number: 1 }
```

At resolve time:

1. Take fresh aria-snapshot of the current page
2. For each overlay's `match`, find the matching element in
   the snapshot — fail loudly if zero matches or multiple
   (disambiguate with `under: { role: ..., name: ... }`)
3. Resolve the matched element's `ref` to a Playwright
   `Locator` (e.g. `page.getByRole('textbox', { name:
   'Email' })`)
4. Use the locator's bounding box for callout placement

This makes screen.yaml stable across page edits and across
refactors that don't change accessibility semantics.
Detecting drift becomes mechanical: if `match` can't be
resolved, the spec disagrees with reality.

### Authoring model: five input sources

Naive "developer writes the spec" fails because the
information is distributed across multiple people. Real
authoring routes information through five layers:

| Layer | Authored by | Format | Effort |
|---|---|---|---|
| 1. Playwright `aria-snapshot` | Auto (Playwright runtime) | YAML | 0 |
| 2. HTML attribute extraction | Auto (DOM walker) | YAML, supplements layer 1 | 0 |
| 3. Schema introspection (Zod / OpenAPI) | Optional, project-specific | YAML overlay | small one-time |
| 4. Business overlays | Designer / PdM | YAML or Markdown | per-screen |
| 5. AI draft (`annot-mcp`) | LLM (Claude / Cursor / Aider) | YAML proposal → human review | 0 for draft, small for review |

The user writing experience differs by role:

- **Developer** — writes the Playwright test (`page.goto(...)`).
  Optionally adds `callouts` for which elements to annotate.
  Doesn't write item-level specs.
- **Designer / PdM** — writes `screen.yaml`'s business sections:
  `purpose`, `notes`, `transitions`. Optionally uses the
  Annot Cloud Web editor (Phase 6) if Git is friction.
- **Technical writer / customer** — reviews the generated
  Astro / Excel / PDF output. Files Issues for clarifications.

This division is the key to the plan's viability — no single
person is asked to do "everything." Each layer is owned by
the role that has the relevant knowledge.

### `screen.yaml` format (canonical)

```yaml
# tests/screens/login.screen.yaml

# === metadata (per-screen, human-authored) ===
screen:
  id: SC-001
  title: ログイン画面
  titleEn: Login screen
  purpose: 未認証ユーザーが認証情報を入力する
  purposeEn: Authenticate an anonymous user.

# === auto-generated (Playwright + DOM walk) ===
# Rewritten on every `annot screen-spec sync` run. Do not edit
# by hand — your edits will be lost.
generated:
  snapshot: |
    - textbox "Email" [ref=e3]
    - textbox "Password" [ref=e5]
    - checkbox "Remember me" [ref=e7]
    - button "Sign in" [ref=e9]
  attributes:
    'textbox "Email"':
      type: email
      required: true
      maxLength: 255
      pattern: '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    'textbox "Password"':
      type: password
      required: true
      minLength: 8
    'button "Sign in"':
      formAction: /api/auth/sign-in

# === business overlays (human-authored, persistent) ===
overlays:
  - match: { role: textbox, name: Email }
    note: 会社のメールアドレスを入力 (個人 Gmail は禁止)
    noteEn: Use your work email; personal Gmail is rejected.
    callout: { intent: required, number: 1 }

  - match: { role: textbox, name: Password }
    note: 8文字以上、英数記号混合。3回失敗で30分ロック。
    noteEn: 8+ characters, mixed case + digit + symbol. Locked
            for 30 minutes after 3 failed attempts.
    callout: { intent: required, number: 2 }

  - match: { role: button, name: Sign in }
    behavior: POST /api/auth/sign-in
    callout: { intent: action, number: 3 }

# === transitions (human-authored) ===
transitions:
  - trigger:
      match: { role: button, name: Sign in }
      condition: 認証成功
    to: SC-002
  - trigger:
      match: { role: button, name: Sign in }
      condition: 認証失敗
    to: self
    note: エラー帯表示
```

Disambiguation when `role + name` is non-unique:

```yaml
overlays:
  # Two "OK" buttons exist on the screen — one in the page,
  # one in a confirmation dialog. Disambiguate with `under:`.
  - match:
      role: button
      name: OK
      under: { role: dialog, name: 確認 }
    note: 削除確認ダイアログの承認ボタン
```

### Drift detection

`annot screen-spec lint` walks every `*.screen.yaml`, takes a
fresh snapshot, and reports:

- **Added** — elements in the live snapshot with no overlay.
  Severity: warning. Suggests boilerplate to copy into
  `overlays`.
- **Removed** — overlays whose `match` resolves to zero
  elements. Severity: error. Either the element was deleted
  (delete the overlay) or it was renamed (update the
  `match.name`).
- **Renamed** — heuristic match: `role` matches, `name`
  diff. Severity: warning. Suggests the new name.
- **Role changed** — `name` matches, `role` diff. Severity:
  warning. Often indicates a meaningful UX shift (button →
  link, etc.) that the docs should reflect.
- **Duplicated** — `match` resolves to multiple elements.
  Severity: error. Requires disambiguation with `under:`.
- **Attribute drift** — auto-generated `attributes` no
  longer match. Severity: info. Auto-fixed by `annot
  screen-spec sync`.

CI integration: `annot screen-spec lint --ci` exits non-zero
on errors only. Add to existing test workflow.

## Package architecture

```
@ingcreators/annot-screen-spec        # Phase 1
  src/
    yaml.ts                  # parse + validate screen.yaml
    fixture.ts               # Playwright fixture: page → snapshot + attributes
    resolver.ts              # match → ref → Locator
    drift.ts                 # diff snapshot vs overlays
    cli.ts                   # annot screen-spec { sync | lint | render }
  Tier: A (Node, no DOM beyond Playwright's runtime)

@ingcreators/annot-astro-screen-spec  # Phase 2
  src/
    integration.ts           # astro.config integration
    image-service.ts         # screen.yaml → annotated PNG via annot-annotator
    components/
      ScreenSpec.astro       # full screen detail page
      ScreenList.astro       # all-screens index
      TransitionGraph.astro  # Mermaid-rendered transition diagram
  Tier: B-render (Astro build-time, no live editor)

@ingcreators/annot-xlsx-screen-spec   # Phase 3
  src/
    workbook.ts              # ExcelJS-based .xlsx emitter
    layout.ts                # per-screen sheet layout (cover, list, detail, transitions)
    templates/
      default.xlsx           # the OSS default template
  Tier: A
```

Phase 5 (AI-assisted) adds tools to the existing
`@ingcreators/annot-mcp` package; no new package.

Phase 6 (Cloud editor) lives in the private `annot-cloud`
repo per [`oss-cloud-split.md`](./oss-cloud-split.md);
not a workspace package here.

## Phased plan

### Phase 0 — PoC (~3 days, 1 PR)

Goal: confirm the technical hypothesis with the minimum
viable artefact. Disposable code under `examples/`.

Stages:

1. **MCP aria-snapshot tool** (half day). Add
   `annot_aria_snapshot` to `packages/mcp/src/tools/`.
   Inputs: `{ url, viewport }`. Output: the YAML snapshot.
   Reuses the existing `BrowserPool`. This lands as a
   contained MCP tool addition, NOT a screen-spec
   dependency — it's reusable as a primitive.
2. **Hand-write one `login.screen.yaml`** (1 hour). Pick a
   screen from the existing PWA (e.g. `editor toolbar` or
   the share dialog) and author the YAML by hand. No
   tooling yet — exercise the format.
3. **Match resolver script** (half day). Standalone Node
   script in `examples/screen-spec-poc/`. Reads the yaml,
   takes a Playwright snapshot, resolves matches, prints
   the resolution report.
4. **Annotated PNG output** (half day). Same script. For
   each resolved overlay, emit a numbered callout using
   the existing annot DSL. Render via `annot-annotator`.
5. **One-page Astro + one Excel sheet** (1 day combined).
   Two outputs from the same `screen.yaml` to prove the
   adapter pattern.
6. **Deliberately break the screen, see drift** (1 hour).
   Rename a button in the live page, re-run the script,
   observe the drift report. Document the experience.

Exit criteria:

- Decision: is the authoring experience workable? Is the
  `match: { role, name }` key concrete enough?
- Decision: is the Excel output visibly distinct from
  what manual Excel templates produce?
- Decision: is the Astro output visibly distinct from a
  hand-written GitBook page?

If any answer is no, the plan goes back to Draft and the
design iterates. If all yes, proceed to Phase 1.

### Phase 1 — `@ingcreators/annot-screen-spec` (1 week, 3–4 PRs)

The core OSS package. No output adapters yet — those are
Phases 2/3.

- **PR 1**: Scaffold the package. `package.json`,
  `tsconfig.json`, `vite.config.ts` matching the
  annot-annotator pattern. Empty `src/index.ts`. Workspace
  dependency on `annot-annotator` + `annot-playwright`.
  `private: true` until Phase 7 publishes.
- **PR 2**: `yaml.ts` + `resolver.ts`. The Zod schema for
  `screen.yaml`, the snapshot parser, the match resolver.
  Test coverage in mocked Playwright (no live browser).
- **PR 3**: `fixture.ts`. Playwright fixture that takes a
  `page` and emits a `screen.yaml.generated` block. Tested
  against a small static HTML fixture.
- **PR 4**: `cli.ts` + `drift.ts`. `annot screen-spec sync`
  + `annot screen-spec lint` commands. Both invoke
  Playwright; both can read a glob of `*.screen.yaml`.

### Phase 2 — `@ingcreators/annot-astro-screen-spec` (1 week, 3–4 PRs)

The Astro integration. Produces Vertical A's primary
deliverable (Web docs).

- **PR 1**: Scaffold + Astro integration boilerplate.
- **PR 2**: Image Service. Map `screen.yaml` → annotated PNG
  via `annot-annotator`. Caching keyed on yaml SHA.
- **PR 3**: `<ScreenSpec />`, `<ScreenList />`,
  `<TransitionGraph />` components. Test with the existing
  annot docs-site as the consumer.
- **PR 4**: Migrate `packages/docs-site/recipes/` over to use
  `<ScreenSpec />` for any recipe that walks through a UI
  screen. This is dogfooding — first real production user.

### Phase 3 — `@ingcreators/annot-xlsx-screen-spec` (1 week, 3 PRs)

The Excel adapter. Vertical B's deliverable.

- **PR 1**: Scaffold + ExcelJS dependency. Empty workbook
  emitter.
- **PR 2**: Cover sheet + screen-list sheet + per-screen
  detail sheet layout. Use the default template under
  `templates/default.xlsx`. Numbered callouts on the
  embedded annotated PNG match the item-spec table's row
  numbers.
- **PR 3**: Transition diagram sheet. Render the full
  cross-screen `transitions` graph as a Mermaid diagram,
  rasterise via `@napi-rs/canvas` (already a transitive
  dep of `annot-annotator`), embed.

### Phase 4 — Drift detection CLI + CI integration (3 days, 2 PRs)

Already prototyped in Phase 1 (`drift.ts`). Phase 4
polishes it for production.

- **PR 1**: `annot screen-spec lint --ci` exit codes. JSON
  output mode for editor integrations. `--fix` flag that
  auto-applies safe fixes (attribute drift).
- **PR 2**: GitHub Actions integration. Sample workflow
  in `examples/`. Annotation API output so failures show
  up as PR review comments at the right line in the yaml.

### Phase 5 — AI-assisted authoring via `annot-mcp` (1 week, 3 PRs)

Adds three tools to the existing MCP server. Lets agents
draft `screen.yaml` files and propose drift fixes.

- **PR 1**: `annot_draft_screen_spec` — given a URL, take
  the snapshot, propose a `screen.yaml` skeleton (with
  empty `overlays.note` fields for human fill-in).
- **PR 2**: `annot_propose_drift_fixes` — given a yaml +
  current snapshot, propose `match` updates for renamed
  elements + new overlays for added elements.
- **PR 3**: `annot_translate_screen_spec` — given a yaml
  in one language, propose `noteEn` / `titleEn` translations
  via the LLM client (the agent itself, via MCP — annot
  doesn't bundle an LLM).

### Phase 6 — Annot Cloud Web editor (2 weeks, separate `annot-cloud` repo)

The Pro tier feature for non-Git contributors. Web UI for
designers to author `overlays.note` / `transitions` without
opening VSCode.

Lands in `ingcreators/annot-cloud` (private),
not this OSS repo. Out of scope for this plan beyond the
interface contract: the cloud editor reads from + writes to
GitHub via the existing GitHubStore mechanism, so the OSS
side is unchanged.

### Phase 7 — Publication + positioning (3 days, 2–3 PRs)

The risk-bearing phase. annot's public identity shifts.

- **PR 1**: Update `PRODUCT_DIRECTION.md`. New section:
  "annot as a living product docs platform." The
  "Playwright + annot" duo gets co-equal billing with the
  PWA / extension hosts. Verticals A and B are documented
  as primary use cases.
- **PR 2**: Publish the three new packages
  (`annot-screen-spec`, `annot-astro-screen-spec`,
  `annot-xlsx-screen-spec`) via the existing Trusted
  Publishing pipeline. First versions at `0.1.0`.
- **PR 3**: Launch blog + README updates across the
  monorepo. Cross-link from `annot.work/docs` to a new
  `annot.work/docs/screen-spec/` section.

After Phase 7, the broader market knows annot exists as a
docs tool, not just a screenshot annotator.

## Out of scope (explicitly)

- **Component-level docs** (Storybook's territory). annot
  is screen / flow level. A team using annot for screen
  docs and Storybook for component docs is the expected
  composition.
- **Video / animated walkthroughs**. annot is still-image.
  Loom / Tella / Guidde-video occupy that niche. Future
  Phase 8+ could add Playwright `trace` → annotated GIF /
  MP4, but not now.
- **In-app product tours** (Userpilot / Appcues territory).
  annot generates docs you go look at; tours run inside the
  product. Different category.
- **Mobile app screenshots**. Playwright is web-only.
  Appium / Maestro integration is a future plan.
- **Real-time collaborative editing** of `screen.yaml`. Git
  + PRs is the collaboration model. Cloud editor (Phase 6)
  is single-user.
- **PDF output**. Likely a Phase 8 follow-up using a
  pdf-lib + the Astro HTML output, but not in the initial
  scope. Excel covers the Japanese SI deliverable need;
  Astro covers the global Web need.
- **Custom Excel templates per SIer firm**. The OSS Excel
  adapter ships ONE default template. Customer-specific
  templates (Hitachi-style, NRI-style, NEC-style) are
  Annot Cloud Pro tier customisation.

## Verification

Pass criteria for the OSS minimum (Phases 1–4):

- A consumer can `pnpm add @ingcreators/annot-screen-spec
  @ingcreators/annot-astro-screen-spec` and follow the
  README from cold to a generated annotated docs page in
  under 30 minutes.
- `annot screen-spec lint` correctly reports drift for the
  six change scenarios (Added / Removed / Renamed / Role
  changed / Duplicated / Attribute drift) in the test
  fixtures.
- The Excel output opens correctly in Excel 2016+, Excel
  for Mac, and LibreOffice; embedded image + item-table
  alignment survives all three.
- The Astro Image Service caches across builds (verified
  by `astro build` runtime not regressing on a no-change
  second build).
- Existing annot tests + builds across all 15 packages
  still pass — no regression in the host apps, PWA,
  desktop, extension, VSCode.

Pass criteria for the positioning shift (Phase 7):

- A reader hitting `annot.work` learns within 30 seconds
  that annot generates docs from Playwright tests. (Today's
  landing copy doesn't say this.)
- A search for "Playwright user manual generator" /
  "Playwright docs from tests" hits annot in the first
  page of results within 3 months of publication.
- At least one external case study (a non-Annot company
  using annot for their public docs) within 6 months. The
  best place to seed this is the Playwright Discord +
  Tailwind / Storybook / Astro community channels.

## Migration notes

Existing `annot-annotator` / `annot-playwright` / `annot-mcp`
public APIs are not touched. New packages compose them.

Existing `screen.yaml`-shaped files: none — this is a new
format. If a future plan finds that the format collides with
an existing community spec (`storybook.yaml` /
`playwright.config.ts` / etc.), the file name can change
without breaking any current artefact.

`PRODUCT_DIRECTION.md` updates in Phase 7 are additive — no
removal or contradiction of existing principles. The
"SVG-first screenshot annotation toolkit" line stays;
"living product docs platform" is added alongside.

## Open questions / risks

### 1. File naming: `screen.yaml` vs `*.screen.yaml` vs other

Convention candidates:

- `tests/screens/login.spec.ts` + `tests/screens/login.screen.yaml`
- `tests/screens/login/test.ts` + `tests/screens/login/screen.yaml`
- Single combined file via custom test extension (`*.screen-test.ts`
  with yaml as a comment block) — too clever

Default: `*.screen.yaml` co-located with `*.spec.ts`.
Reviewable in PRs side-by-side, easy to glob.

### 2. Where the Playwright fixture invocation lives

Two options:

- **A.** Each `*.spec.ts` includes a `screenSpec.sync()` call
  in `afterEach`. The yaml's `generated:` block is rewritten
  on every test run.
- **B.** `annot screen-spec sync` is a standalone command run
  before `playwright test`. Tests don't know about it.

Default: **B**. Decouples docs generation from test runs.
Tests run hot in dev; docs sync runs in CI + on-demand
locally. Avoids slowing down dev feedback.

### 3. How aggressive is automatic Excel template fitting?

If a customer hands annot their custom Excel template
(`画面設計書_template_v3.xlsx`), should the Pro tier:

- (a) require the template to follow a documented schema
  (predictable but constrains the customer);
- (b) accept arbitrary templates and use AI to map cells
  (flexible but error-prone);
- (c) ship a template library curated for the top 5–10
  Japanese SI firms (medium customisation, finite scope).

Default for Phase 3 (OSS): one default template only.
Customer-template work is Pro tier.
Default for Pro tier (TBD): probably **c** with **b** as a
later fallback for the long tail.

### 4. Naming the platform messaging

"Living docs" is established terminology in BDD circles
(Cucumber). Risk of confusion. Candidates:

- "Living product docs"
- "Living user manuals"
- "Tests-driven documentation"
- "Code-driven product docs"
- "Living screen specs" (画面設計書 vertical only)

Default: **"Living product docs"** as the umbrella name;
"画面設計書" stays as the vertical's Japanese label.

### 5. Competitive moat durability

Scribehow, Mintlify, GitBook all have the engineering
resources to build a "screenshot regeneration from
Playwright tests" feature in 1–2 quarters once they decide
to. annot's lead is in:

- OSS core (they're SaaS-only)
- aria-snapshot primitive choice (the right primitive — but
  they could copy it)
- Drift detection as a first-class feature (defensible
  with CI integration depth)
- AI agent integration via MCP (the MCP standard means
  this isn't proprietary, but having the tools shipped
  ~6 months earlier matters)
- Japanese SI vertical (they won't go after this)

The realistic forecast: annot has a 12–18 month window to
build community + reputation before a well-funded
competitor copies the global vertical. The Japanese vertical
is durable indefinitely on cultural grounds (no global SaaS
has the patience to learn Japanese SIer Excel templates).

## References

### Internal

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — current
  strategic north star; updated by Phase 7.
- [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md) — Pro
  tier features; Phase 6 of this plan adds the "screen spec
  cloud editor" to the Pro tier.
- [`oss-cloud-split.md`](./oss-cloud-split.md) — architectural
  guardrails for OSS vs Annot Cloud boundary.
- [`_done/agent-mcp-integration.md`](./_done/agent-mcp-integration.md)
  — `annot-mcp` foundation; Phase 5 extends it.
- [`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md)
  — `createAnnotator` API used by the Image Service.
- [`_done/annot-playwright-fixture.md`](./_done/annot-playwright-fixture.md)
  — Playwright fixture surface; Phase 1's `screen-spec`
  fixture extends it.
- [`_done/headless-annotator-publish.md`](./_done/headless-annotator-publish.md)
  — Trusted Publishing pipeline; Phase 7 publishes through it.
- [`launch-prep.md`](./launch-prep.md) — Phase 8c (Astro
  landing) and 8d (VitePress docs) of the cloud roadmap.
  Open question: does this plan motivate replacing VitePress
  with Astro Starlight for `annot.work/docs`? See "Open
  questions" #1 below; default answer is "post-launch
  follow-up, separate plan."

### External

- Playwright `aria-snapshot` /
  [`_snapshotForAI`](https://playwright.dev/docs/aria-snapshots)
  — the primitive.
- [`playwright-cli` interaction docs](https://playwright.dev/agent-cli/commands/interaction)
  — the canonical example of refs-as-handles.
- [Scribehow](https://scribehow.com) — closest existing
  competitor in the global vertical. Browser-extension
  recorder.
- [Guidde](https://guidde.com) — video-first competitor.
- [Tango](https://www.tango.us) — same category.
- [Mintlify](https://mintlify.com) — docs platform that
  could grow into a competitor.
- [GitBook](https://gitbook.com) — same.
- [Storybook autodocs](https://storybook.js.org/docs/writing-docs/autodocs)
  — component-level analogue; conceptually closest existing
  thing in OSS land.
- ExcelJS — the chosen Excel emitter for Phase 3.
- Astro Image Service —
  <https://docs.astro.build/en/recipes/build-custom-img-component/>
  the architectural hook for Phase 2.
