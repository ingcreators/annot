# Living product docs — Playwright + Astro + annot

> **Status:** Draft — strategic plan establishing `annot` as a
>   "living product docs platform" with two verticals (global
>   operation manuals + Japanese 画面設計書). Phase 0 PoC is in
>   progress: Stage 1 (`annot_aria_snapshot` MCP tool) landed in
>   [#869](https://github.com/ingcreators/annot/pull/869); Stages 2–6
>   ready to start. Phase 1+ gated on PoC findings and a
>   positioning update in
>   [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md).
> **Compatibility:** Additive across the existing OSS surface. New
>   packages (`@ingcreators/annot-product-docs`,
>   `@ingcreators/annot-product-docs-astro`,
>   `@ingcreators/annot-product-docs-xlsx`) compose existing
>   primitives (annot-annotator + annot-playwright + annot-mcp).
>   Existing public APIs untouched; `*.screen.mdx` is a new file
>   format, no schema migration of existing artefacts. Note: the
>   plan adopts MDX (Astro / Docusaurus / Nextra / Mintlify
>   standard) as the source-of-truth format, NOT a custom YAML.
> **Risk:** Medium-high. The technical work is small (~6 weeks
>   solo to ship Phase 1+2+3); the positioning shift is the
>   risk-bearing part. Asserting "annot is a docs platform, not
>   just an annotation toolkit" affects every README, the
>   `PRODUCT_DIRECTION.md` north star, and the Pro tier pricing
>   model in [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md).
>   Additional risk: the existing `packages/docs-site` (VitePress)
>   is impacted — see "VitePress / Astro migration" in Open
>   questions.

## TL;DR

`annot-annotator` + `annot-playwright` already ship the
primitives needed to generate annotated screenshots from
live Playwright captures. Wrap them in a thin authoring layer
(`*.screen.mdx` — an MDX file with `<Screen>` / `<Overlay>` /
`<Transition>` components on top of Playwright `aria-snapshot`)
and a set of output adapters (Astro, Excel, PDF) and the
combined product becomes **"living user manuals from your
existing Playwright test suite"** — a category currently held
by closed-source SaaS (Scribehow / Guidde / Tango) on the
global side and by Excel templates on the Japanese SI side.
Neither addresses the "docs drift when the UI changes" problem;
both lose to a code-driven, CI-integrated alternative.

The plan unfolds in eight phases:

| Phase | Output | Estimated work |
|---|---|---|
| 0. PoC | One screen → annotated PNG + Excel + Astro page, by hand | ~3 days |
| 1. Core package | `@ingcreators/annot-product-docs` (MDX parser + fixture + resolver) | 1 week |
| 2. Astro integration | `@ingcreators/annot-product-docs-astro` | 1 week |
| 3. Excel adapter | `@ingcreators/annot-product-docs-xlsx` | 1 week |
| 4. Drift detection CLI | `annot docs lint` + CI integration | 3 days |
| 5. AI-assisted authoring | Three new tools on `@ingcreators/annot-mcp` | 1 week |
| 6. Cloud Web editor (Pro tier) | Browser-based MDX block editor with GitHub PR output | 2 weeks |
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

Plus one architectural alignment that emerged during plan
drafting: **MDX has become the de-facto docs-as-code format**
(Astro, Next.js / Nextra, Docusaurus, Mintlify all use it).
By adopting MDX as the source of truth, annot's per-screen
files **become** the docs pages — no separate "spec format
on disk plus rendered docs site" duplication.

Each of these tail-winds is recent (last ~6 months) and
converging now. A year ago this plan would have been
premature on the primitive layer; a year from now Mintlify
or GitHub might build their own version and the niche
shrinks.

### The two verticals

The single underlying engine serves two distinct deliverable
needs:

**Vertical A — Global operation manuals**

- Audience: end users of software products
- Format: Web docs (MDX rendered by Astro), embedded
  annotated screenshots, multi-language
- Customers: SaaS companies, OSS projects, technical writers
- Current state: GitBook / Mintlify / Document360 + manual
  screenshots
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
  consumed by 画面設計書 authoring; goes out of sync with
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
(Playwright test, aria-snapshot, `*.screen.mdx`, annot DSL)
and differ only in the **output adapter**:

```
                Playwright + aria-snapshot
                       ↓
                 *.screen.mdx (MDX, source of truth)
                       ↓
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
     Astro (Web)    Excel (SI)   PDF / future verticals
     Vertical A     Vertical B
   (MDX renders     (MDX AST →   (MDX → HTML → PDF)
     directly)     ExcelJS)
```

### Why annot wins against existing solutions

For **Vertical A** (Scribehow et al. as competitors):

| Axis | Scribehow / Guidde / Tango | annot |
|---|---|---|
| Input | Browser extension records human clicks | Playwright tests (already exist for testing) |
| Update model | Re-record manually when UI changes | Re-run tour in CI; drift detected automatically |
| Hosting | Closed SaaS | OSS + self-host or Annot Cloud |
| Customisation | Templates only | Full MDX freedom + custom Astro components |
| Multi-language | Re-record per locale | Re-run tour with different `locale`; locale-specific MDX |
| Version control | Proprietary versioning | Git-native (MDX files in repo) |
| CI/CD | None | First-class |
| AI integration | Limited / none | `annot-mcp` agent-callable, MDX-aware |

The defensible angle: **code-driven, CI-native, OSS core,
drift-detected, MDX-as-source-of-truth**. Scribehow's
$24/user pricing buys a recorder + a viewer; annot's pitch
buys "your docs stay honest about your product."

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

## Naming taxonomy

The vocabulary across packages, files, fixtures, and CLI
follows a deliberate two-level pattern: **umbrella name
is broad (`docs` / `product-docs`); unit name is specific
(`screen`)**.

| Layer | Term | Reasoning |
|---|---|---|
| Umbrella package | `@ingcreators/annot-product-docs` | Broad enough to cover both verticals; "product docs" is industry-standard (vs marketing docs / API docs / internal docs) |
| Astro adapter | `@ingcreators/annot-product-docs-astro` | Same prefix |
| Excel adapter | `@ingcreators/annot-product-docs-xlsx` | Same prefix |
| (Future) VitePress adapter | `@ingcreators/annot-product-docs-vitepress` | Same prefix |
| CLI top-level | `annot docs` | Short for daily use |
| CLI subcommands | `annot docs init / lint / render` | Verbs |
| Playwright fixture | `screen` (in tests) | Neutral, maps to 画面 cleanly |
| File extension | `*.screen.mdx` | Unit-name + format |
| Directory convention | `tests/screens/` (tour) / `docs/screens/` (MDX) | Plural of unit |
| Tour file extension | `*.tour.ts` | Captures intent (vs `*.spec.ts` test convention) |
| Platform messaging | "Living product docs" | Marketing label; "画面設計書" stays as the Vertical B Japanese name |

Why "screen" (not "page", "view", or "document"):

- "screen" is neutral in English (web / mobile / dashboard)
- maps 1-1 to Japanese 画面 for Vertical B
- "page" conflicts with Playwright's `page` fixture
- "view" carries MVC baggage
- "document" is too generic

Why "product-docs" (not just "docs"):

- "annot-docs" would collide visually with `annot.work/docs`
  (the docs *content* URL vs the docs *generator* package)
- "product-docs" is explicit about the niche
- slightly longer but unambiguous

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

A single Playwright API call (`page.locator('body').ariaSnapshot({
mode: "ai" })`) produces the entire tree. The
`annot_aria_snapshot` MCP tool added in Phase 0 Stage 1
([#869](https://github.com/ingcreators/annot/pull/869)) wraps
this for agent-callable use.

**Critical: refs are session-local.** `ref=e3` in snapshot
#1 may be `ref=e4` in snapshot #2 if a new element was
added above. annot **must not persist refs**. The fix is to
use `role + name` (with tree-path disambiguation for
duplicates) as the persistent match key, expressed as JSX
props on `<Overlay>` / `<Transition>` components:

```mdx
<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
  会社のメールアドレスを入力
</Overlay>
```

At resolve time:

1. Take fresh aria-snapshot of the current page
2. For each `<Overlay match>` in the MDX, find the matching
   element in the snapshot — fail loudly if zero matches or
   multiple (disambiguate with `under: { role, name }`)
3. Resolve the matched element's `ref` to a Playwright
   `Locator` (e.g. `page.getByRole('textbox', { name:
   'Email' })`)
4. Use the locator's bounding box for callout placement

This makes `*.screen.mdx` stable across page edits and across
refactors that don't change accessibility semantics.
Detecting drift becomes mechanical: if `match` can't be
resolved, the spec disagrees with reality.

### Authoring model: five input sources

Naive "developer writes the spec" fails because the
information is distributed across multiple people. Real
authoring routes information through five layers:

| Layer | Authored by | Format | Effort |
|---|---|---|---|
| 1. Playwright `aria-snapshot` | Auto (Playwright runtime) | Persisted as a `<!-- annot:snapshot --> ... <!-- /annot:snapshot -->` MDX comment block | 0 |
| 2. HTML attribute extraction | Auto (DOM walker) | Persisted alongside the snapshot block | 0 |
| 3. Schema introspection (Zod / OpenAPI) | Optional, project-specific | Frontmatter or MDX prop overrides | small one-time |
| 4. Business overlays | Designer / PdM | MDX prose inside `<Overlay>` / `<Transition>` | per-screen |
| 5. AI draft (`annot-mcp`) | LLM (Claude / Cursor / Aider) | MDX proposal → human review | 0 for draft, small for review |

The user writing experience differs by role:

- **Developer** — writes the Playwright **tour** test
  (`page.goto(...)` + `await screen.capture(...)`).
  Optionally adds initial `<Overlay match>` blocks. Doesn't
  write item-level business copy.
- **Technical writer / docs author** — writes the body of
  each `*.screen.mdx`: the Markdown prose between component
  tags. This is exactly what they already write in
  Mintlify / Docusaurus / Astro — no new format to learn.
- **Designer / PdM** — adds business `<Overlay>` blocks
  with `note` Markdown bodies. Optionally uses the Annot
  Cloud Web editor (Phase 6) if Git is friction.
- **Customer (reviewer)** — reads the rendered Astro page
  or the exported Excel. Files Issues for clarifications.

This division is the key to the plan's viability — no single
person is asked to do "everything." Each layer is owned by
the role that has the relevant knowledge.

### Test suite vs tour suite

A point of clarification that was almost a wrong turn during
plan drafting: docs-generation **does not** piggy-back on
existing functional tests. Functional tests and tour tests
are different artefacts owned by different roles, sharing
only the `@ingcreators/annot-playwright` scaffolding.

| Concern | Functional tests | Tour tests |
|---|---|---|
| File | `tests/e2e/*.spec.ts` | `tests/screens/*.tour.ts` |
| Playwright project | `e2e` | `screens` |
| Owner | Dev team | Tech writer / designer / dev |
| Purpose | Behaviour verification (`expect`) | Walk every screen, call `screen.capture(...)` |
| Edge cases | Validation failures, error states, race conditions | Happy-path snapshots only |
| CI cadence | Every PR | Release branch (slower, fewer reruns) |
| Viewport / locale | Multiple combinations | Fixed (1440×900, `ja-JP`, light scheme) |
| Failure semantics | "Functionality broke" | "Docs need refresh" |

Tour tests use the same Playwright primitives but their
shape is different — they're closer to "scripts that walk
the app" than to "assertions." A tour file typically looks
like:

```ts
// tests/screens/auth.tour.ts
import { test } from "@ingcreators/annot-playwright";

test.describe.configure({ mode: "serial" });

test("認証フロー全画面", async ({ page, screen }) => {
  await page.goto("/login");
  await screen.capture({
    id: "SC-001",
    mdxPath: "docs/screens/login.screen.mdx",
  });

  await page.getByLabel("メールアドレス").fill("demo@example.com");
  await page.getByLabel("パスワード").fill("demo-password");
  await page.getByRole("button", { name: "ログイン" }).click();

  await screen.capture({ id: "SC-002", mdxPath: "docs/screens/dashboard.screen.mdx" });
});
```

The `screen` fixture extends the existing `annot-playwright`
package (the `screenSpec` working name was renamed to `screen`
per the Naming taxonomy section). Phase 1's package layout
includes a sibling `screen` fixture alongside the existing
`annotator` fixture.

### `*.screen.mdx` format (canonical)

```mdx
---
# docs/screens/login.screen.mdx
id: SC-001
title: ログイン画面
titleEn: Login screen
url: /login
purpose: 未認証ユーザーが認証情報を入力する
purposeEn: Authenticate an anonymous user.
---

import {
  Screen,
  Overlay,
  Transition,
  TransitionTable,
} from "@ingcreators/annot-product-docs-astro";

# ログイン画面 {#SC-001}

未認証ユーザーが認証情報を入力する画面です。社員 ID 移行
までの暫定実装。SSO 切替後に廃止予定。

<Screen src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**メールアドレス** — 会社のメールアドレスを入力してください。
個人 Gmail は許可していません。
</Overlay>

<Overlay match={{ role: "textbox", name: "Password" }} intent="required" number={2}>
**パスワード** — 8 文字以上、英数記号混合。

> 3 回連続失敗するとアカウントが 30 分ロックされます。
</Overlay>

<Overlay match={{ role: "button", name: "ログイン" }} intent="action" number={3}>
クリックで `POST /api/auth/sign-in`
</Overlay>

</Screen>

## 画面遷移

<TransitionTable>
  <Transition trigger={{ role: "button", name: "ログイン" }} on="認証成功" to="SC-002" />
  <Transition trigger={{ role: "button", name: "ログイン" }} on="認証失敗" to="self">
    エラー帯表示
  </Transition>
</TransitionTable>

{/* === auto-generated below — rewritten by `annot docs sync` === */}
{/* annot:snapshot */}
{/*
- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- checkbox "Remember me" [ref=e7]
- button "ログイン" [ref=e9]
*/}
{/* /annot:snapshot */}
{/* annot:attributes */}
{/*
textbox "Email":
  type: email
  required: true
  maxLength: 255
textbox "Password":
  type: password
  required: true
  minLength: 8
*/}
{/* /annot:attributes */}
```

Disambiguation when `role + name` is non-unique:

```mdx
<Overlay
  match={{
    role: "button",
    name: "OK",
    under: { role: "dialog", name: "確認" }
  }}
  intent="action"
  number={4}
>
  削除確認ダイアログの承認ボタン
</Overlay>
```

Why MDX instead of YAML:

- **One file = one screen + its documentation.** No
  separation between "spec" and "rendered docs page" —
  the MDX file IS the rendered page.
- **Rich prose.** Markdown formatting (headings, lists,
  bold, code blocks, links to other screens) is natural
  inside `<Overlay>` bodies. YAML can do multi-line strings
  but loses semantic structure.
- **Industry standard.** Astro / Next / Docusaurus /
  Mintlify all consume MDX natively. annot's output is
  portable across docs engines (each ships a per-engine
  components package).
- **JSX = typed structure.** `<Overlay match={...}>` gets
  TypeScript-level type checking on `match`, `intent`,
  `number`. YAML schema validation works but is weaker.
- **AI-friendly.** LLMs read and write MDX fluently;
  patching `match` props via `remark` AST is straightforward.

### Output flow

For Vertical A (Web docs via Astro):

```
*.screen.mdx (source of truth)
     ↓
Astro build (with @ingcreators/annot-product-docs-astro)
     ↓
HTML page with annotated PNG inline + numbered callouts +
transition table
```

For Vertical B (Excel via xlsx adapter):

```
*.screen.mdx (source of truth)
     ↓
MDX AST extraction (remark / @mdx-js/mdx)
     ↓
Structured data (frontmatter + <Overlay match> + bodies)
     ↓
ExcelJS workbook with annotated PNG embedded + item-spec
table + transition sheet
```

For both: the Playwright tour produces the annotated PNG
and writes the `annot:snapshot` / `annot:attributes` MDX
comment blocks. The MDX human-authored content is never
touched by automation; only the comment blocks rotate.

### Drift detection

`annot docs lint` walks every `*.screen.mdx`, takes a
fresh snapshot, and reports:

- **Added** — elements in the live snapshot with no
  `<Overlay>`. Severity: warning. Suggests boilerplate
  to insert into the MDX.
- **Removed** — `<Overlay match>` whose key resolves to
  zero elements. Severity: error. Either the element was
  deleted (delete the overlay) or it was renamed (update
  the `match.name`).
- **Renamed** — heuristic match: `role` matches, `name`
  diff. Severity: warning. Suggests the new name.
- **Role changed** — `name` matches, `role` diff.
  Severity: warning. Often indicates a meaningful UX shift
  (button → link, etc.) that the docs should reflect.
- **Duplicated** — `match` resolves to multiple elements.
  Severity: error. Requires disambiguation with `under`.
- **Attribute drift** — auto-generated `annot:attributes`
  comment block no longer matches. Severity: info.
  Auto-fixed by `annot docs sync`.

CI integration: `annot docs lint --ci` exits non-zero on
errors only. Add to existing test workflow.

## Package architecture

```
@ingcreators/annot-product-docs         # Phase 1 — core
  src/
    mdx.ts                   # parse + serialise *.screen.mdx (remark AST)
    fixture.ts               # Playwright `screen` fixture
    resolver.ts              # match → ref → Locator
    drift.ts                 # diff snapshot vs <Overlay> props
    cli.ts                   # annot docs { init | sync | lint | render }
  Tier: A (Node, no DOM beyond Playwright's runtime)

@ingcreators/annot-product-docs-astro   # Phase 2
  src/
    integration.ts           # Astro integration (image service + MDX components)
    image-service.ts         # *.screen.mdx → annotated PNG via annot-annotator
    components/
      Screen.astro
      Overlay.astro
      Transition.astro
      TransitionTable.astro
      ScreenList.astro       # Index of all screens (auto from MDX glob)
      TransitionGraph.astro  # Mermaid-rendered cross-screen graph
  Tier: B-render (Astro build-time, no live editor)

@ingcreators/annot-product-docs-xlsx    # Phase 3
  src/
    extract.ts               # MDX AST → structured data
    workbook.ts              # ExcelJS-based .xlsx emitter
    layout.ts                # cover / list / detail / transitions sheet layouts
    rich-text.ts             # Markdown → ExcelJS rich-text
    templates/
      default.xlsx           # the OSS default template
  Tier: A

# Future (not in initial scope):
# @ingcreators/annot-product-docs-vitepress   — Vue components for VitePress
# @ingcreators/annot-product-docs-nextra      — Next/Nextra components
# @ingcreators/annot-product-docs-docusaurus  — Docusaurus components
# @ingcreators/annot-product-docs-pdf         — pdf-lib + Astro HTML
```

Phase 5 (AI-assisted) adds tools to the existing
`@ingcreators/annot-mcp` package; no new package.

Phase 6 (Cloud editor) lives in the private `annot-cloud`
repo per [`oss-cloud-split.md`](./oss-cloud-split.md);
not a workspace package here.

## Phased plan

### Phase 0 — PoC (~3 days, 1–2 PRs)

Goal: confirm the technical hypothesis with the minimum
viable artefact. Disposable code under `examples/`.

Stages:

1. **MCP `annot_aria_snapshot` tool** (half day) —
   **landed in [#869](https://github.com/ingcreators/annot/pull/869)**.
   Add the tool to `packages/mcp/src/tools/`. Inputs:
   `{ url, viewport, waitFor, rootSelector, timeout, output }`.
   Output: the YAML snapshot. Reuses the existing
   `BrowserPool`. Reusable as a primitive beyond the
   product-docs workflow.
2. **Hand-write one `login.screen.mdx`** (1 hour). Pick a
   screen from the existing PWA (e.g. share dialog or
   editor toolbar) and author the MDX by hand —
   `<Screen>` + `<Overlay>` blocks + Markdown notes. No
   tooling yet — exercise the format and feel out
   ergonomics.
3. **MDX AST extraction + match resolver script** (half
   day). Standalone Node script in
   `examples/product-docs-poc/`. Reads the mdx, takes a
   Playwright snapshot, resolves matches, prints the
   resolution report.
4. **Annotated PNG output** (half day). Same script. For
   each resolved overlay, emit a numbered callout using
   the existing annot DSL. Render via `annot-annotator`.
5. **One-page Astro render + one Excel sheet** (1 day
   combined). Two outputs from the same `*.screen.mdx` to
   prove the adapter pattern. Astro renders the MDX
   directly; Excel walks the AST.
6. **Deliberately break the screen, see drift** (1 hour).
   Rename a button in the live page, re-run the script,
   observe the drift report. Document the experience.

Exit criteria:

- Decision: is MDX authoring ergonomic? Are the
  `<Overlay match>` keys concrete enough?
- Decision: does the AST extraction → Excel path produce
  something visibly distinct from manual Excel templates?
- Decision: does the rendered Astro page work as
  documentation (not just a debug view)?

If any answer is no, the plan goes back to Draft and the
design iterates. If all yes, proceed to Phase 1.

### Phase 1 — `@ingcreators/annot-product-docs` (1 week, 4 PRs)

The core OSS package. No output adapters yet — those are
Phases 2/3.

- **PR 1**: Scaffold the package. `package.json`,
  `tsconfig.json`, `vite.config.ts` matching the
  annot-annotator pattern. Empty `src/index.ts`. Workspace
  dependency on `annot-annotator` + `annot-playwright`.
  `private: true` until Phase 7 publishes.
- **PR 2**: `mdx.ts` + `resolver.ts`. The remark-based MDX
  parser, JSX prop extraction for `<Overlay>` /
  `<Transition>`, frontmatter parsing, the snapshot
  parser, the match resolver. Test coverage in mocked
  Playwright (no live browser).
- **PR 3**: `fixture.ts`. Playwright `screen` fixture that
  extends `@ingcreators/annot-playwright`'s `test`.
  Provides `screen.capture({ id, mdxPath })`. Updates the
  `annot:snapshot` / `annot:attributes` MDX comment blocks
  in-place. Tested against a small static HTML fixture.
- **PR 4**: `cli.ts` + `drift.ts`. `annot docs init` /
  `annot docs sync` / `annot docs lint` commands. All
  invoke Playwright; all can read a glob of
  `**/*.screen.mdx`.

### Phase 2 — `@ingcreators/annot-product-docs-astro` (1 week, 4 PRs)

The Astro integration. Produces Vertical A's primary
deliverable (Web docs).

- **PR 1**: Scaffold + Astro integration boilerplate.
  `integration.ts` exporting the
  `productDocsIntegration()` function for
  `astro.config.mjs`.
- **PR 2**: Image Service. Map `*.screen.mdx` → annotated
  PNG via `annot-annotator`. Caching keyed on mdx file
  SHA. The Astro Image Service hooks into the existing
  `astro:assets` pipeline.
- **PR 3**: `<Screen>` / `<Overlay>` / `<Transition>` /
  `<TransitionTable>` / `<ScreenList>` /
  `<TransitionGraph>` components. Test with a sample
  Astro app under `examples/`.
- **PR 4**: Dogfood on `packages/docs-site/`. If
  `docs-site` is still VitePress at this point, this PR
  is gated on a separate VitePress → Astro migration plan
  (see Open questions); if Astro migration has landed,
  this PR migrates one or more existing `recipes/` to
  use `<Screen>`. First real production user.

### Phase 3 — `@ingcreators/annot-product-docs-xlsx` (1 week, 3 PRs)

The Excel adapter. Vertical B's deliverable.

- **PR 1**: Scaffold + ExcelJS dependency. `extract.ts`
  walking the MDX AST to a normalised data shape (same
  shape the Astro components consume). Empty workbook
  emitter.
- **PR 2**: Cover sheet + screen-list sheet + per-screen
  detail sheet layout. Use the default template under
  `templates/default.xlsx`. Numbered callouts on the
  embedded annotated PNG match the item-spec table's row
  numbers. `rich-text.ts` converts Markdown inside
  `<Overlay>` bodies to ExcelJS rich text (bold / italic /
  hyperlinks).
- **PR 3**: Transition diagram sheet. Render the full
  cross-screen graph as a Mermaid diagram, rasterise via
  `@napi-rs/canvas` (transitive dep of `annot-annotator`),
  embed.

### Phase 4 — Drift detection CLI + CI integration (3 days, 2 PRs)

Already prototyped in Phase 1 (`drift.ts`). Phase 4
polishes it for production.

- **PR 1**: `annot docs lint --ci` exit codes. JSON output
  mode for editor integrations. `--fix` flag that
  auto-applies safe fixes (attribute drift, snapshot
  block rewrites).
- **PR 2**: GitHub Actions integration. Sample workflow
  in `examples/`. Annotation API output so failures show
  up as PR review comments at the right line in the mdx.

### Phase 5 — AI-assisted authoring via `annot-mcp` (1 week, 3 PRs)

Adds three tools to the existing MCP server. Lets agents
draft `*.screen.mdx` files and propose drift fixes.

- **PR 1**: `annot_draft_screen_spec` — given a URL, take
  the snapshot, propose an MDX skeleton (frontmatter +
  `<Screen>` block with empty-bodied `<Overlay>` blocks
  for each interactive element).
- **PR 2**: `annot_propose_drift_fixes` — given an MDX
  file + current snapshot, propose `match` prop updates
  for renamed elements + new `<Overlay>` blocks for added
  elements. Returns a unified diff so the agent can show
  it to the human.
- **PR 3**: `annot_translate_screen_spec` — given an MDX
  file in one language, propose a locale-specific
  sibling (`login.en.screen.mdx` etc.) with translated
  prose. The LLM doing the translation is the agent
  itself, via MCP — annot doesn't bundle an LLM.

### Phase 6 — Annot Cloud Web editor (2 weeks, separate `annot-cloud` repo)

The Pro tier feature for non-Git contributors. Web UI
for designers / writers to edit `<Overlay>` block bodies
(Markdown rich text) + add new `<Overlay>` blocks via a
Notion-style block editor.

Lands in `ingcreators/annot-cloud` (private), not this
OSS repo. Out of scope for this plan beyond the interface
contract: the cloud editor reads from + writes to GitHub
via the existing GitHubStore mechanism, so the OSS side
is unchanged. The cloud editor produces standard MDX
that round-trips with developer-authored files — no
proprietary serialisation.

### Phase 7 — Publication + positioning (3 days, 2–3 PRs)

The risk-bearing phase. annot's public identity shifts.

- **PR 1**: Update `PRODUCT_DIRECTION.md`. New section:
  "annot as a living product docs platform." The
  "Playwright + annot" duo gets co-equal billing with
  the PWA / extension hosts. Verticals A and B are
  documented as primary use cases.
- **PR 2**: Publish the three new packages
  (`annot-product-docs`, `annot-product-docs-astro`,
  `annot-product-docs-xlsx`) via the existing Trusted
  Publishing pipeline. First versions at `0.1.0`.
- **PR 3**: Launch blog + README updates across the
  monorepo. Cross-link from `annot.work/docs` to a new
  `annot.work/docs/product-docs/` section.

After Phase 7, the broader market knows annot exists as
a docs tool, not just a screenshot annotator.

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
  annot generates docs you go look at; tours run inside
  the product. Different category.
- **Mobile app screenshots**. Playwright is web-only.
  Appium / Maestro integration is a future plan.
- **Real-time collaborative editing** of MDX. Git + PRs
  is the collaboration model. Cloud editor (Phase 6) is
  single-user-per-session.
- **PDF output**. Likely a Phase 8 follow-up using
  pdf-lib over the Astro HTML output, but not in the
  initial scope. Excel covers the Japanese SI deliverable
  need; Astro covers the global Web need.
- **Custom Excel templates per SIer firm**. The OSS Excel
  adapter ships ONE default template. Customer-specific
  templates (Hitachi-style, NRI-style, NEC-style) are
  Annot Cloud Pro tier customisation.
- **Non-MDX source formats in the OSS path**. The plan
  rejected a YAML-side-car alternative in favour of MDX
  as single source of truth. A TS-inline `screen.capture({
  inline: { ... } })` escape hatch may be added as a
  Phase 1+ follow-up if dev-only teams ask, but is not
  the default authoring path.

## Verification

Pass criteria for the OSS minimum (Phases 1–4):

- A consumer can `pnpm add @ingcreators/annot-product-docs
  @ingcreators/annot-product-docs-astro` and follow the
  README from cold to a generated annotated docs page in
  under 30 minutes.
- `annot docs lint` correctly reports drift for the six
  change scenarios (Added / Removed / Renamed / Role
  changed / Duplicated / Attribute drift) in the test
  fixtures.
- The Excel output opens correctly in Excel 2016+, Excel
  for Mac, and LibreOffice; embedded image + item-table
  alignment survives all three; Markdown formatting in
  `<Overlay>` bodies translates to Excel rich text.
- The Astro Image Service caches across builds (verified
  by `astro build` runtime not regressing on a no-change
  second build).
- Existing annot tests + builds across all 15 packages
  still pass — no regression in the host apps, PWA,
  desktop, extension, VSCode.

Pass criteria for the positioning shift (Phase 7):

- A reader hitting `annot.work` learns within 30 seconds
  that annot generates docs from Playwright tests.
  (Today's landing copy doesn't say this.)
- A search for "Playwright user manual generator" /
  "Playwright docs from tests" hits annot in the first
  page of results within 3 months of publication.
- At least one external case study (a non-Annot company
  using annot for their public docs) within 6 months. The
  best place to seed this is the Playwright Discord +
  Tailwind / Storybook / Astro community channels.

## Migration notes

Existing `annot-annotator` / `annot-playwright` /
`annot-mcp` public APIs are not touched. New packages
compose them.

Existing `*.screen.mdx`-shaped files: none — this is a
new format. The `.screen.mdx` double-extension was chosen
deliberately so existing MDX tooling (Astro / Next /
Docusaurus) treats it as plain MDX (the inner `.mdx`
extension is what matters) while annot's CLI globs on
`**/*.screen.mdx` to find files to lint.

`PRODUCT_DIRECTION.md` updates in Phase 7 are additive —
no removal or contradiction of existing principles. The
"SVG-first screenshot annotation toolkit" line stays;
"living product docs platform" is added alongside.

## Open questions / risks

### 1. VitePress / Astro migration of `packages/docs-site`

The current annot OSS docs site (`packages/docs-site`) is
VitePress. Phase 2 of this plan ships an Astro integration
package. Two paths:

- **(a) Migrate `docs-site` to Astro Starlight** before or
  during Phase 2. Lets us dogfood the Astro components
  immediately. Bigger refactor (~25 pages to migrate) but
  aligns with the "annot uses annot" story.
- **(b) Keep `docs-site` on VitePress**. Ship a sibling
  `@ingcreators/annot-product-docs-vitepress` adapter
  (Vue components) before Phase 2 closes. Faster but
  doubles the component-library work.
- **(c) Defer dogfooding**. Phase 2 ships only the Astro
  adapter; dogfooding waits for a separate post-launch
  VitePress → Astro migration plan.

**Default for this plan: (c)**. Phase 2's "first
production user" criterion can be an external Astro
project (a fresh `examples/astro-docs-site/`) rather than
the live annot docs site. Migration of the live site is
a separate plan, ideally landing as a deliberate
positioning move ("annot.work/docs is built with annot").

### 2. MDX schema validation strictness

`<Overlay match={{ role, name, under? }}>` is JSX so
TypeScript can in principle type-check the prop shape.
Two implementation options:

- **(a) Loose runtime check**. `match` is `unknown` at
  the type level; runtime Zod validates the shape.
  Maximum flexibility, weaker IDE feedback.
- **(b) Tight TypeScript types**. `<Overlay>` is typed
  with a discriminated union on `match.role` (each role
  has known accessible-name patterns). Strong IDE
  feedback, but a small ergonomic cost (every role needs
  a type entry).

Default: **(a)** for Phase 1; revisit at Phase 2 if
authors complain.

### 3. How aggressive is automatic Excel template fitting?

If a customer hands annot their custom Excel template
(`画面設計書_template_v3.xlsx`), should the Pro tier:

- (a) require the template to follow a documented
  schema (predictable but constrains the customer);
- (b) accept arbitrary templates and use AI to map cells
  (flexible but error-prone);
- (c) ship a template library curated for the top 5–10
  Japanese SI firms (medium customisation, finite scope).

Default for Phase 3 (OSS): one default template only.
Customer-template work is Pro tier.
Default for Pro tier (TBD): probably **(c)** with **(b)**
as a later fallback for the long tail.

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
Playwright tests" feature in 1–2 quarters once they
decide to. annot's lead is in:

- OSS core (they're SaaS-only)
- aria-snapshot primitive choice (the right primitive —
  but they could copy it)
- MDX-as-source-of-truth (industry-aligned, hard to
  differentiate against, but the first-mover branding
  matters)
- Drift detection as a first-class feature (defensible
  with CI integration depth)
- AI agent integration via MCP (the MCP standard means
  this isn't proprietary, but having the tools shipped
  ~6 months earlier matters)
- Japanese SI vertical (they won't go after this)

The realistic forecast: annot has a 12–18 month window
to build community + reputation before a well-funded
competitor copies the global vertical. The Japanese
vertical is durable indefinitely on cultural grounds
(no global SaaS has the patience to learn Japanese
SIer Excel templates).

### 6. TS-inline escape hatch

Some teams (especially small all-developer teams) will
want everything in `.tour.ts` rather than separate MDX
files. The plan's default is MDX-first, but a
`screen.capture({ inline: { id, title, overlays: [...] }})`
mode could be added in Phase 1 as a one-PR follow-up
without disturbing the rest of the design.

Default: ship MDX-only in Phase 1. Add TS-inline if the
first three Phase 0 PoC + Phase 1 dogfood users ask for
it.

## References

### Internal

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — current
  strategic north star; updated by Phase 7.
- [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md) — Pro
  tier features; Phase 6 of this plan adds the "product
  docs cloud editor" to the Pro tier.
- [`oss-cloud-split.md`](./oss-cloud-split.md) — architectural
  guardrails for OSS vs Annot Cloud boundary.
- [`_done/agent-mcp-integration.md`](./_done/agent-mcp-integration.md)
  — `annot-mcp` foundation; Phase 5 extends it.
- [`_done/annot-annotator-package.md`](./_done/annot-annotator-package.md)
  — `createAnnotator` API used by the Image Service.
- [`_done/annot-playwright-fixture.md`](./_done/annot-playwright-fixture.md)
  — Playwright fixture surface; Phase 1's `screen` fixture
  extends it.
- [`_done/headless-annotator-publish.md`](./_done/headless-annotator-publish.md)
  — Trusted Publishing pipeline; Phase 7 publishes through it.
- [`launch-prep.md`](./launch-prep.md) — Phase 8c (Astro
  landing) and 8d (VitePress docs) of the cloud roadmap.
  This plan's Open Question #1 (VitePress / Astro migration)
  interacts with launch-prep's choice to ship `docs-site` on
  VitePress; default resolution is "defer the migration
  decision to post-launch."

### External

- Playwright `aria-snapshot` /
  [`_snapshotForAI`](https://playwright.dev/docs/aria-snapshots)
  — the primitive.
- [`playwright-cli` interaction docs](https://playwright.dev/agent-cli/commands/interaction)
  — the canonical example of refs-as-handles.
- [MDX](https://mdxjs.com) — the source-of-truth format.
- [remark](https://github.com/remarkjs/remark) /
  [@mdx-js/mdx](https://github.com/mdx-js/mdx) — the AST
  toolchain for extraction (Excel adapter, AI patching).
- [Scribehow](https://scribehow.com) — closest existing
  competitor in the global vertical. Browser-extension
  recorder.
- [Guidde](https://guidde.com) — video-first competitor.
- [Tango](https://www.tango.us) — same category.
- [Mintlify](https://mintlify.com) — docs platform that
  could grow into a competitor; also our format mate
  (both use MDX).
- [GitBook](https://gitbook.com) — same.
- [Storybook autodocs](https://storybook.js.org/docs/writing-docs/autodocs)
  — component-level analogue; conceptually closest existing
  thing in OSS land.
- ExcelJS — the chosen Excel emitter for Phase 3.
- Astro Image Service —
  <https://docs.astro.build/en/recipes/build-custom-img-component/>
  the architectural hook for Phase 2.
