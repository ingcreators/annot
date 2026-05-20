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
>   Existing public APIs untouched; `.mdx` files with an `annot:`
>   frontmatter block become the source-of-truth format
>   (industry-standard MDX, NOT a custom YAML).
> **Risk:** Medium-high. The technical work is ~7 weeks solo to
>   ship Phase 1+2+3 (Phase 3 expanded from 1 to 2 weeks to
>   include customer-template support); the positioning shift
>   is the risk-bearing part. Asserting "annot is a docs
>   platform, not just an annotation toolkit" affects every
>   README, the `PRODUCT_DIRECTION.md` north star, and the Pro
>   tier pricing model in
>   [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md).
>   Additional risk: the existing `packages/docs-site`
>   (VitePress) is impacted — see "VitePress / Astro migration"
>   in Open questions.

## TL;DR

`annot-annotator` + `annot-playwright` already ship the
primitives needed to generate annotated screenshots from
live Playwright captures. Wrap them in a thin authoring layer
(plain `.mdx` files with `annot:` frontmatter, plus a small
set of JSX components — `<Screen>` / `<Overlay>` /
`<Transition>` / `<HistoryEntry>` / `<ScreenList>`) and a set
of output adapters (Astro, Excel, PDF) and the combined
product becomes **"living user manuals from your existing
Playwright test suite"** — a category currently held by
closed-source SaaS (Scribehow / Guidde / Tango) on the global
side and by Excel templates on the Japanese SI side. Neither
addresses the "docs drift when the UI changes" problem; both
lose to a code-driven, CI-integrated alternative.

The plan unfolds in eight phases:

| Phase | Output | Estimated work |
|---|---|---|
| 0. PoC | One screen → annotated PNG + Excel + Astro page, by hand | ~3 days |
| 1. Core package | `@ingcreators/annot-product-docs` (MDX parser + fixture + resolver + `defineConfig`) | 1 week |
| 2. Astro integration | `@ingcreators/annot-product-docs-astro` (5 components + Image Service) | 1 week |
| 3. Excel adapter | `@ingcreators/annot-product-docs-xlsx` (templates + placeholders + named ranges) | 2 weeks |
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
   readable primitive. `playwright-mcp`, `playwright-cli`,
   and Cursor / Claude Code all converged on it as the
   standard for describing what's on a page. The same
   primitive is exactly what a screen design document needs.
2. **`@ingcreators/annot-mcp` shipped** (Phase 8 of
   [`_done/agent-mcp-integration.md`](./_done/agent-mcp-integration.md),
   2026-05-20). Annot now speaks MCP; AI agents can call
   `annot_annotate_url` directly. Adding docs-related tools
   is one phase, not a rebuild.
3. **The OSS publish pipeline is done**
   ([`_done/headless-annotator-publish.md`](./_done/headless-annotator-publish.md),
   2026-05-20). Five `@ingcreators/*` packages on npm with
   Trusted Publishing. Adding new packages to the pipeline
   is mechanical.

Plus one architectural alignment that emerged during plan
drafting: **MDX has become the de-facto docs-as-code format**
(Astro, Next.js / Nextra, Docusaurus, Mintlify all use it).
By adopting MDX as the source of truth, annot's per-screen
files **become** the docs pages — no separate "spec format on
disk plus rendered docs site" duplication.

### The two verticals

The single underlying engine serves two distinct deliverable
needs:

**Vertical A — Global operation manuals**

- Audience: end users of software products
- Format: Web docs (MDX rendered by Astro), embedded
  annotated screenshots, multi-language
- Customers: SaaS companies, OSS projects, technical writers
- Current state: GitBook / Mintlify / Document360 + manual
  screenshots; Scribehow / Guidde / Tango for click-recording
- Pain: screenshots go stale on every UI change; multi-language
  variants must be re-recorded per locale
- Market size: massive — Scribehow ~$50M ARR, Mintlify ~$10M+
  ARR, GitBook $40M+ ARR
- Existing competitor closest in shape: **Scribehow** —
  browser-extension recorder, $24/user/month, ~1M users

**Vertical B — Japanese SI 画面設計書 (screen design specs)**

- Audience: developers + customer (sign-off) + maintenance
  contractors
- Format: Excel (occasionally Word/PDF), formal templates
  per SIer, numbered callouts + item-spec tables + screen
  transition diagrams
- Customers: Japanese / Korean SIers, 受託 / 公共系
- Current state: 100% manual; ~1 person-month per project
  consumed by 画面設計書 authoring; goes out of sync with
  implementation immediately
- Market size: smaller — Japan/Korea/Taiwan SI industry,
  ~$50B globally, very fragmented buyer base; but ARPU
  potentially high
- Existing competitor: none global

The two verticals share **all** the input infrastructure
(Playwright tour, aria-snapshot, MDX files, `<Screen>` /
`<Overlay>` JSX components) and differ only in the
**book composition + output adapter**:

```
                Playwright + aria-snapshot
                       ↓
              MDX files (source of truth)
                  with annot: frontmatter
                       ↓
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
     Astro (Web)    Excel (SI)   PDF / future verticals
     Vertical A     Vertical B
   (MDX → HTML    (MDX AST →    (MDX → HTML → PDF)
    via Astro)    template       
                 fill via
                 ExcelJS)
```

### Why annot wins against existing solutions

For **Vertical A** (Scribehow et al. as competitors):

| Axis | Scribehow / Guidde / Tango | annot |
|---|---|---|
| Input | Browser extension records human clicks | Playwright tours (`*.spec.ts` in dedicated `tests/docs/`) |
| Update model | Re-record manually when UI changes | Re-run tour in CI; drift detected automatically |
| Hosting | Closed SaaS | OSS + self-host or Annot Cloud |
| Customisation | Templates only | Full MDX freedom + custom Astro components |
| Multi-language | Re-record per locale | Re-run tour with different `locale`; locale-specific MDX |
| Version control | Proprietary versioning | Git-native (MDX files in repo) |
| CI/CD | None | First-class |
| AI integration | Limited / none | `annot-mcp` agent-callable, MDX-aware |

The defensible angle: **code-driven, CI-native, OSS core,
drift-detected, MDX-as-source-of-truth**.

For **Vertical B** (Excel templates as the status quo):
the status quo loses on every axis except "client expects
Excel." annot wins by **producing Excel from a code-driven
source of truth, filling customer-supplied corporate
templates** (placeholder substitution + named-range image /
table insertion). First-mover in a market global incumbents
won't pay attention to.

## Naming taxonomy

The vocabulary across packages, files, fixtures, and CLI
follows a deliberate two-level pattern: **umbrella name is
broad (`docs` / `product-docs`); unit name is specific
(`screen`)**.

| Layer | Term | Reasoning |
|---|---|---|
| Umbrella package | `@ingcreators/annot-product-docs` | Broad enough to cover both verticals |
| Astro adapter | `@ingcreators/annot-product-docs-astro` | Same prefix |
| Excel adapter | `@ingcreators/annot-product-docs-xlsx` | Same prefix |
| (Future) VitePress adapter | `@ingcreators/annot-product-docs-vitepress` | Same prefix |
| CLI top-level | `annot docs` | Short for daily use |
| CLI subcommands | `annot docs init / lint / render` | Verbs |
| Playwright fixture | `screen` (in tests) | Neutral, maps to 画面 cleanly |
| Unit | "screen" (the thing captured by `<Screen>` in MDX) | Atomic capture unit |
| MDX file extension | plain `.mdx` | Industry standard; detect annot files via `annot:` frontmatter |
| Tour directory | `tests/docs/` | Purpose-named (vs unit-named); matches CLI verb |
| Tour file extension | `*.spec.ts` | Standard Playwright; project separation does the disambiguation |
| MDX directory convention | `docs/books/<book-name>/` | Organised by output workbook |
| Frontmatter key | `annot:` | Detection signal — files without it are regular MDX |
| Platform messaging | "Living product docs" | Marketing label; "画面設計書" stays as the Vertical B Japanese name |

Why "screen" (not "page", "view", or "document"):

- "screen" is neutral in English (web / mobile / dashboard)
- maps 1-1 to Japanese 画面 for Vertical B
- "page" conflicts with Playwright's `page` fixture
- "view" carries MVC baggage

Why "product-docs" (not just "docs"):

- "annot-docs" would collide visually with `annot.work/docs`
  (the docs *content* URL vs the docs *generator* package)
- "product-docs" is explicit about the niche
- slightly longer but unambiguous

Why standard `*.spec.ts` for tours (not a custom `*.tour.ts`):

- Zero learning cost — Playwright defaults work
- IDE / debugger / HTML reporter all integrate without config tweaks
- Tour vs functional separation lives in Playwright projects
  (`tests/docs/` vs `tests/e2e/`), not file extensions

## Technical design

### Primitive: Playwright aria-snapshot + persistent match keys

The foundational decision: use Playwright's `aria-snapshot`
(also called `_snapshotForAI` internally) as the structural
source-of-truth for what's on the page:

```
- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- checkbox "Remember me" [ref=e7]
- button "Sign in" [ref=e9]
```

A single Playwright API call (`page.locator('body').ariaSnapshot({
mode: "ai" })`) produces the entire tree. The
`annot_aria_snapshot` MCP tool added in Phase 0 Stage 1
([#869](https://github.com/ingcreators/annot/pull/869)) wraps
this for agent-callable use.

**Critical: refs are session-local.** `ref=e3` in snapshot
#1 may be `ref=e4` in snapshot #2. annot **must not persist
refs**. Persistent match keys use `role + name` (with
tree-path disambiguation via `under`) expressed as JSX props
on `<Overlay>` / `<Transition>` components:

```mdx
<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
  会社のメールアドレスを入力
</Overlay>
```

At resolve time:

1. Take fresh aria-snapshot
2. For each `<Overlay match>` in MDX, find the matching
   snapshot element — fail loudly if zero or multiple
3. Resolve to a Playwright `Locator`
4. Use the locator's bounding box for callout placement

Detecting drift becomes mechanical: if `match` can't be
resolved, the spec disagrees with reality.

### Authoring model: five input sources

Naive "developer writes the spec" fails because the
information is distributed across multiple people. Real
authoring routes information through five layers:

| Layer | Authored by | Format | Effort |
|---|---|---|---|
| 1. Playwright `aria-snapshot` | Auto (Playwright runtime) | MDX comment block (`{/* annot:snapshot ... */}`) | 0 |
| 2. HTML attribute extraction | Auto (DOM walker) | MDX comment block (`{/* annot:attributes ... */}`) | 0 |
| 3. Schema introspection (Zod / OpenAPI) | Optional, project-specific | Frontmatter or MDX prop overrides | small one-time |
| 4. Business overlays | Designer / PdM | MDX prose inside `<Overlay>` / `<Transition>` | per-screen |
| 5. AI draft (`annot-mcp`) | LLM (Claude / Cursor / Aider) | MDX proposal → human review | 0 for draft, small for review |

The user writing experience differs by role:

- **Developer** — writes the Playwright **tour**
  (`page.goto(...)` + `await screen.capture(...)`). Doesn't
  write item-level business copy.
- **Technical writer / docs author** — writes the body of
  each `*.mdx` file: Markdown prose between component tags.
  Exactly what they already write in Mintlify / Docusaurus.
- **Designer / PdM** — adds business `<Overlay>` blocks
  with Markdown notes. Optionally uses the Annot Cloud Web
  editor (Phase 6) if Git is friction.
- **Customer (reviewer)** — reads the rendered Astro page
  or the exported Excel.

This division is the key to the plan's viability — no single
person is asked to do "everything."

### Test suite vs tour suite

Docs generation does **not** piggy-back on existing functional
tests. Functional tests and tour tests are different
artefacts owned by different roles, sharing only the
`@ingcreators/annot-playwright` scaffolding:

| Concern | Functional tests | Tour tests |
|---|---|---|
| File | `tests/e2e/*.spec.ts` | `tests/docs/*.spec.ts` |
| Playwright project | `e2e` | `docs` |
| Owner | Dev team | Tech writer / designer / dev |
| Purpose | Behaviour verification (`expect`) | Walk every screen, call `screen.capture(...)` |
| Edge cases | Validation failures, error states, race conditions | Happy-path snapshots only |
| CI cadence | Every PR | Release branch (slower, fewer reruns) |
| Viewport / locale | Multiple combinations | Fixed (1440×900, `ja-JP`, light scheme) |
| Failure semantics | "Functionality broke" | "Docs need refresh" |

A tour file:

```ts
// tests/docs/auth.spec.ts
import { test } from "@ingcreators/annot-playwright";

test.describe.configure({ mode: "serial" });

test("認証フロー全画面", async ({ page, screen }) => {
  await page.goto("/login");
  await screen.capture({
    mdxPath: "docs/books/screen-spec/screens/SC-001-login.mdx",
    id: "login",
  });

  await page.getByLabel("メールアドレス").fill("demo@example.com");
  await page.getByLabel("パスワード").fill("demo-password");
  await page.getByRole("button", { name: "ログイン" }).click();

  await screen.capture({
    mdxPath: "docs/books/screen-spec/screens/SC-002-dashboard.mdx",
    id: "dashboard",
  });
});
```

### MDX format (canonical)

A docs MDX file is a regular MDX with an `annot:` frontmatter
block that declares the file's role in the output. Files
**without** `annot:` frontmatter are treated as regular MDX
and ignored by the annot pipeline.

#### Frontmatter schema

```yaml
annot:
  # required
  id: SC-001                          # unique within file

  # optional
  title: ログイン画面
  purpose: 未認証ユーザーが認証情報を入力する

  # per-MDX metadata (Excel template placeholders, Astro page meta)
  meta:
    author: 鈴木一郎                   # this MDX's primary author
    createdDate: 2026-05-20
    revisedDate: 2026-05-21
    revision: "1.2"
    reviewedBy: 田中花子
    # free-form additional fields allowed
    bugTicket: ABC-1234

  # Excel-specific (used by xlsx adapter; ignored by Astro)
  xlsx:
    book: 画面設計書                    # which workbook this file contributes to
    sheet: SC-001 ログイン               # single sheet name (all <Screen> blocks here)
    # OR for multiple <Screen> blocks each becoming its own sheet:
    # sheets:
    #   default: SC-001 ログイン (初期)
    #   error: SC-001 ログイン (エラー)

    role: screen                       # "cover" | "history" | "list" | "screen" (default) | "reference"
    order: 100                         # sort order within the book (default: 100)
```

#### MDX body and components

Single-screen example:

```mdx
import { Screen, Overlay, Transition } from "@ingcreators/annot-product-docs-astro";

# ログイン画面 {#SC-001}

未認証ユーザーが認証情報を入力する画面です。

<Screen id="login" src="./shots/login.png">

<Overlay match={{ role: "textbox", name: "Email" }} intent="required" number={1}>
**メールアドレス** — 会社のメールアドレスを入力してください。
個人 Gmail は許可していません。
</Overlay>

<Overlay match={{ role: "button", name: "ログイン" }} intent="action" number={3}>
クリックで `POST /api/auth/sign-in`
</Overlay>

</Screen>

{/* annot:snapshot */}
{/*
- textbox "Email" [ref=e3]
- textbox "Password" [ref=e5]
- button "ログイン" [ref=e9]
*/}
{/* /annot:snapshot */}

{/* annot:attributes */}
{/*
textbox "Email":
  type: email
  required: true
  maxLength: 255
*/}
{/* /annot:attributes */}
```

Multi-screen example (operation manual chapter):

```mdx
---
annot:
  id: GUIDE-001
  title: サインアップ
  meta:
    author: 田中花子
  xlsx:
    book: 操作マニュアル
    sheet: サインアップ
---

import { Screen, Overlay } from "@ingcreators/annot-product-docs-astro";

# サインアップ

会社のメールアドレスがあれば2分で完了します。

## Step 1: サインアップページを開く

<Screen id="signup-1" src="./shots/signup-1.png">
  <Overlay match={{ role: "link", name: "Sign up" }} number={1}>
    画面右上の **Sign up** リンクをクリック。
  </Overlay>
</Screen>

## Step 2: 情報を入力

<Screen id="signup-2" src="./shots/signup-2.png">
  <Overlay match={{ role: "textbox", name: "Email" }} number={1}>
    会社のメールアドレスを入力。
  </Overlay>
  <Overlay match={{ role: "textbox", name: "Company" }} number={2}>
    会社名を入力。
  </Overlay>
</Screen>

## Step 3: 認証メールから確認

<Screen id="signup-3" src="./shots/signup-3.png">
  ...
</Screen>
```

#### Roles: cover / history / list / screen / reference

All sheets in a book are MDX files. None are auto-generated
by config. This makes the output Git-reviewable end-to-end.

**Cover MDX:**

```mdx
---
annot:
  id: COVER
  xlsx:
    book: 画面設計書
    sheet: 表紙
    role: cover
    order: 1
  meta:
    projectAuthor: 山田太郎
    projectStartDate: 2026-01-15
---

# {meta.projectName} 画面設計書

本書は {meta.customerName} 様向け
{meta.projectName} の画面設計書です。
要件定義書 v2.3 に基づきます。
```

**History MDX:**

```mdx
---
annot:
  id: HISTORY
  xlsx:
    book: 画面設計書
    sheet: 改訂履歴
    role: history
    order: 2
---

import { HistoryEntry } from "@ingcreators/annot-product-docs-astro";

<HistoryEntry version="1.0" date="2026-03-15" author="山田太郎">
初版作成。要件定義 v2.0 に基づく全画面ドラフト。
</HistoryEntry>

<HistoryEntry version="1.1" date="2026-04-02" author="鈴木一郎">
レビュー指摘反映: SC-005 / SC-007 の項目追加。
</HistoryEntry>

<HistoryEntry version="1.2" date="2026-05-20" author="山田太郎">
ログイン画面 (SC-001) を SSO 経由に変更。
</HistoryEntry>
```

The benefit: revision history changes are MDX diffs in Git
PRs, reviewable. AI agents can add history entries naturally.

**List MDX:**

```mdx
---
annot:
  id: LIST
  xlsx:
    book: 画面設計書
    sheet: 画面一覧
    role: list
    order: 3
---

import { ScreenList } from "@ingcreators/annot-product-docs-astro";

# 画面一覧

<ScreenList book="画面設計書" sort="byId" />
```

`<ScreenList>` auto-enumerates all `role: screen` MDXs in the
same book. The MDX file itself is the sheet definition; the
component handles the enumeration.

#### Disambiguation when role + name is non-unique

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

#### Why MDX (recap)

- One file = one screen / one task + its documentation.
  No separation between "spec" and "rendered docs page".
- Rich prose (Markdown). Industry-standard tooling.
- JSX gives type-checking on `match` / `intent` / `number`.
- LLMs read and write MDX fluently (remark AST patches).

### Project config (`annot-docs.config.ts`)

The project config maps `book` names (declared in MDX
frontmatter) to **per-book Excel template configuration**.
Per-MDX `meta` fields take precedence; project config provides
project-wide defaults.

```ts
// annot-docs.config.ts
import { defineConfig } from "@ingcreators/annot-product-docs";

export default defineConfig({
  meta: {
    // Project-wide invariants — referenced as {meta.projectName} etc.
    projectName: "顧客管理システム",
    customerName: "株式会社XYZ",

    // Defaults for per-MDX meta fields (overridable per file)
    defaultAuthor: "山田太郎",
  },

  xlsx: {
    // Default book when MDX doesn't specify xlsx.book
    defaultBook: "画面設計書",

    // Per-book templates
    books: {
      "画面設計書": {
        template: "./templates/corporate-screen-spec-v3.xlsx",
        templateSheets: {
          // role → template sheet name to clone for each MDX
          cover:   "表紙テンプレ",
          history: "改訂履歴テンプレ",
          list:    "画面一覧テンプレ",
          screen:  "個別画面テンプレ",
        },
      },
      "操作マニュアル": {
        template: "./templates/end-user-manual.xlsx",
        templateSheets: {
          cover:  "表紙テンプレ",
          screen: "手順テンプレ",
          // No history / list — manual doesn't need them
        },
      },
      "クイックスタート": {
        // No template — uses annot's default template
        templateSheets: { screen: "default" },
      },
    },
  },
});
```

### Template Excel files

Customer-supplied Excel files are the layout source for the
xlsx adapter. They contain:

1. **Placeholder text** in cells: `{var}` substitution.
2. **Named ranges** marking where images / tables / lists go.

#### Placeholder syntax

```
{id}                      → annot.id
{title}                   → annot.title
{purpose}                 → annot.purpose
{meta.author}             → MDX meta.author (or project default)
{meta.createdDate}        → MDX meta.createdDate
{meta.projectName}        → project meta.projectName

{annot:date}              → render-time date (default yyyy-MM-dd)
{annot:datetime}          → render-time datetime
{annot:sheetIndex}        → 1-based sheet index in workbook
{annot:totalSheets}       → total sheet count in workbook

{meta.createdDate:yyyy年MM月dd日}  → "2026年05月20日"  (Phase 3 detail)
```

User variables: bare `{name}` style.
Annot built-ins: `{annot:name}` prefix to avoid collision.
Format suffix: `{var:format}` (Phase 3 detail).

#### Named ranges

The template author defines Excel Named Ranges with the
`annot` prefix. annot writes content into those ranges:

| Named range | Content | Where used |
|---|---|---|
| `annotImage` | annotated PNG | screen role (single-screen) |
| `annotImage:<screenId>` | per-`<Screen>` PNG | screen role (multi-screen) |
| `annotItemTable` | item-spec table from `<Overlay>` | screen role |
| `annotTransitions` | transitions table | screen role |
| `annotHistory` | history entries from `<HistoryEntry>` | history role |
| `annotList` | screen list from `<ScreenList>` | list role |
| `annotSnapshot` | aria-snapshot YAML (debug) | optional |
| `annotAttributes` | HTML attribute extraction | optional |

The template author selects a cell range in Excel → defines a
Named Range with `annot...` name. No programming required.

### Resolution + output flow

For each MDX file with `annot:` frontmatter:

1. Read project config + frontmatter (frontmatter takes precedence)
2. Determine `book`, `sheet`/`sheets`, `role`, `order`
3. For Excel output:
   - Open the book's template (or annot's default)
   - Locate the template sheet matching `role` (via `templateSheets[role]`)
   - For single-screen sheet or multi-screen `sheet:` (string):
     a. Clone the template sheet once
     b. Rename to `xlsx.sheet`
     c. Substitute `{var}` placeholders
     d. Insert content into named ranges
   - For multi-screen `sheets:` (object):
     a. Clone the template sheet N times (once per entry)
     b. Each clone renamed to the entry's value
     c. Substitute / insert per-screen content
4. After all MDXs processed:
   - Order sheets by `(role-default-order, order, file-path)`
   - Save as `<book>.xlsx`

For Astro output:
1. MDX renders directly via `@mdx-js/mdx`
2. `<Screen>` / `<Overlay>` / `<Transition>` /
   `<HistoryEntry>` / `<ScreenList>` components are
   provided by `@ingcreators/annot-product-docs-astro`
3. Image Service generates annotated PNGs from `<Screen>`
   blocks
4. Each MDX file → one page in the Astro routing

### Drift detection

`annot docs lint` walks every MDX with `annot:` frontmatter
where any `<Screen>` block exists, takes a fresh snapshot,
and reports:

- **Added** — elements in the live snapshot with no
  `<Overlay>`. Severity: warning.
- **Removed** — `<Overlay match>` whose key resolves to
  zero elements. Severity: error.
- **Renamed** — `role` matches, `name` differs. Severity:
  warning.
- **Role changed** — `name` matches, `role` differs.
  Severity: warning.
- **Duplicated** — `match` resolves to multiple elements.
  Severity: error.
- **Attribute drift** — `annot:attributes` MDX comment
  block no longer matches. Severity: info. Auto-fixed by
  `annot docs sync`.

Cover / history / list / reference MDXs have no `<Screen>`
blocks and are skipped by drift detection.

## OSS vs Pro tier split

The minimum viable platform ships in OSS so anyone can use
annot for product docs. Pro tier provides curated content,
collaboration UX, and AI assistance.

| Feature | OSS (free) | Pro tier (Annot Cloud) |
|---|---|---|
| `@ingcreators/annot-product-docs` core (CLI, fixture, resolver, drift) | ✅ | |
| Astro adapter with all components | ✅ | |
| Excel adapter with default template | ✅ | |
| Custom `xlsx.template` file support | ✅ | |
| `{var}` placeholder substitution | ✅ | |
| Named-range image / table insertion | ✅ | |
| Formatted variables (`{date:yyyy/MM/dd}` etc.) | ✅ | |
| Multi-book projects | ✅ | |
| Role-based MDXs (cover / history / list / screen) | ✅ | |
| AI tools (draft / propose-fixes / translate) via MCP | ✅ | |
| Curated template library (Hitachi / NRI / NEC / Fujitsu styles) | | ✅ |
| AI template-to-spec mapping (auto-detect placeholders in existing Excel) | | ✅ |
| Cloud Web editor for non-Git authors | | ✅ |
| Team template library (org-wide sharing) | | ✅ |
| Hosted drift dashboard | | ✅ |
| Multi-tenant template versioning | | ✅ |

The boundary follows the rest of `annot-cloud-roadmap.md`:
**OSS is the engine, Pro is the polish + content + UX.**

## Package architecture

```
@ingcreators/annot-product-docs         # Phase 1 — core
  src/
    mdx.ts                   # parse + serialise *.mdx with annot: frontmatter (remark AST)
    fixture.ts               # Playwright `screen` fixture
    resolver.ts              # match → ref → Locator
    drift.ts                 # diff snapshot vs <Overlay> props
    config.ts                # defineConfig + project config schema
    cli.ts                   # annot docs { init | sync | lint | render }
  Tier: A (Node, no DOM beyond Playwright's runtime)

@ingcreators/annot-product-docs-astro   # Phase 2
  src/
    integration.ts           # Astro integration (image service + MDX components)
    image-service.ts         # *.mdx <Screen> → annotated PNG via annot-annotator
    components/
      Screen.astro
      Overlay.astro
      Transition.astro
      TransitionTable.astro
      HistoryEntry.astro
      ScreenList.astro       # auto-enumerates role:screen MDXs by book
      TransitionGraph.astro  # Mermaid-rendered cross-screen graph
  Tier: B-render (Astro build-time, no live editor)

@ingcreators/annot-product-docs-xlsx    # Phase 3
  src/
    extract.ts               # MDX AST → structured data per MDX
    placeholder.ts           # {var} resolution + format suffix
    named-range.ts           # Excel Named Range I/O
    template.ts              # template loading + sheet cloning
    workbook.ts              # per-book workbook assembly
    rich-text.ts             # Markdown → ExcelJS rich-text
    components/
      history-render.ts      # <HistoryEntry> → table rows in annotHistory
      list-render.ts         # <ScreenList> → table rows in annotList
    templates/
      default.xlsx           # OSS default template
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
repo per [`oss-cloud-split.md`](./oss-cloud-split.md).

## Phased plan

### Phase 0 — PoC (~3 days, 1–2 PRs)

Goal: confirm the technical hypothesis with the minimum
viable artefact. Disposable code under `examples/`.

Stages:

1. **MCP `annot_aria_snapshot` tool** (half day) —
   **landed in [#869](https://github.com/ingcreators/annot/pull/869)**.
2. **Hand-write one MDX** (1 hour). Pick a screen from the
   existing PWA (e.g. share dialog or editor toolbar) and
   author the MDX by hand — `<Screen>` + `<Overlay>` blocks
   + Markdown notes. No tooling yet.
3. **MDX AST extraction + match resolver script** (half
   day). Standalone Node script in
   `examples/product-docs-poc/`.
4. **Annotated PNG output** (half day). Same script.
   Numbered callout via annot DSL → `annot-annotator`.
5. **One-page Astro render + one Excel sheet** (1 day
   combined). Two outputs from the same MDX.
6. **Deliberately break the screen, see drift** (1 hour).
   Rename a button, re-run, observe the drift report.

Exit criteria:

- Is MDX authoring ergonomic? Are `<Overlay match>` keys
  concrete enough?
- Does the AST extraction → Excel path produce something
  visibly distinct from manual templates?
- Does the rendered Astro page work as documentation?

### Phase 1 — `@ingcreators/annot-product-docs` (1 week, 4 PRs)

The core OSS package.

- **PR 1**: Scaffold (`package.json`, `vite.config.ts`,
  empty `src/index.ts`). Workspace deps on `annot-annotator`
  + `annot-playwright`. `private: true` until Phase 7
  publishes.
- **PR 2**: `mdx.ts` + `resolver.ts` + `config.ts`. Remark-
  based MDX parser, JSX prop extraction, frontmatter
  parsing, snapshot/attributes block extraction, match
  resolver, `defineConfig` helper, Zod schema for project
  config + frontmatter.
- **PR 3**: `fixture.ts`. Playwright `screen` fixture that
  extends `@ingcreators/annot-playwright`'s `test`.
  Provides `screen.capture({ id, mdxPath })`. Updates
  `annot:snapshot` / `annot:attributes` MDX comment blocks
  in-place. Tested against a small static HTML fixture.
- **PR 4**: `cli.ts` + `drift.ts`. `annot docs init` /
  `annot docs sync` / `annot docs lint` commands. All
  invoke Playwright; all glob `**/*.mdx` and filter by
  `annot:` frontmatter presence.

### Phase 2 — `@ingcreators/annot-product-docs-astro` (1 week, 4 PRs)

The Astro integration.

- **PR 1**: Scaffold + Astro integration boilerplate.
  `integration.ts` exporting `productDocsIntegration()`.
- **PR 2**: Image Service. `<Screen src=...>` → annotated
  PNG via `annot-annotator`. Caching keyed on MDX file SHA.
- **PR 3**: All 7 components (`<Screen>`, `<Overlay>`,
  `<Transition>`, `<TransitionTable>`, `<HistoryEntry>`,
  `<ScreenList>`, `<TransitionGraph>`). Test with a sample
  Astro app under `examples/`.
- **PR 4**: Dogfood on `packages/docs-site/` if Astro
  migration has landed, OR a fresh `examples/astro-docs-site/`
  if not (see Open question #1).

### Phase 3 — `@ingcreators/annot-product-docs-xlsx` (2 weeks, 6 PRs)

The Excel adapter. Expanded from 1 week to 2 weeks because
template support is in scope for the OSS minimum (Vertical B
fails without it).

- **PR 1**: Scaffold + ExcelJS dep + `extract.ts` walking
  the MDX AST to a normalised data shape (same shape the
  Astro components consume). Empty workbook emitter.
- **PR 2**: Minimum-viable layout WITHOUT templates. Cover
  / list / per-screen sheets generated from MDX content
  with a hard-coded default layout. Useful for users
  without a template; default OSS path.
- **PR 3**: Custom template support — `xlsx.template.file`
  field. Template sheet cloning. `{var}` placeholder
  substitution across cells. Validation: `sheet` vs
  `sheets`, sheet name length, file name safety.
- **PR 4**: Named-range processing — `annotImage` /
  `annotItemTable` / `annotTransitions` / `annotHistory`
  / `annotList`. Image fitting to range. Table generation
  from MDX components.
- **PR 5**: Special variables (`{annot:date}` etc.) +
  formatted variables (`{date:yyyy/MM/dd}`). Multi-screen
  `xlsx.sheets:` object support.
- **PR 6**: Multi-book CLI integration (`--book=<name>`).
  Transition diagram sheet via Mermaid → `@napi-rs/canvas`
  → embed.

### Phase 4 — Drift detection CLI + CI integration (3 days, 2 PRs)

Already prototyped in Phase 1 (`drift.ts`). Phase 4 polishes
for production.

- **PR 1**: `annot docs lint --ci` exit codes. JSON output
  for editor integrations. `--fix` flag for safe fixes
  (attribute drift, snapshot block rewrites).
- **PR 2**: GitHub Actions integration. Sample workflow.
  Annotation API output so failures appear as PR review
  comments at the right MDX line.

### Phase 5 — AI-assisted authoring via `annot-mcp` (1 week, 3 PRs)

- **PR 1**: `annot_draft_screen_spec` — given a URL,
  propose an MDX skeleton.
- **PR 2**: `annot_propose_drift_fixes` — given MDX +
  current snapshot, propose `match` updates and new
  `<Overlay>` blocks. Returns a unified diff.
- **PR 3**: `annot_translate_screen_spec` — given an MDX
  in one language, propose a locale-specific sibling.

### Phase 6 — Annot Cloud Web editor (2 weeks, separate `annot-cloud` repo)

Pro tier. Web UI for designers / writers to edit `<Overlay>`
block bodies (Markdown rich text) + add new `<Overlay>` /
`<HistoryEntry>` blocks via a Notion-style block editor.
Reads from + writes to GitHub via GitHubStore.

Out of scope for this plan beyond the interface contract.

### Phase 7 — Publication + positioning (3 days, 2–3 PRs)

- **PR 1**: Update `PRODUCT_DIRECTION.md`. New section:
  "annot as a living product docs platform."
- **PR 2**: Publish the three new packages via the
  existing Trusted Publishing pipeline. First versions at
  `0.1.0`.
- **PR 3**: Launch blog + README updates across the
  monorepo.

## Out of scope (explicitly)

- **Component-level docs** (Storybook's territory). annot
  is screen / flow level.
- **Video / animated walkthroughs**. annot is still-image.
  Loom / Tella / Guidde-video occupy that niche.
- **In-app product tours** (Userpilot / Appcues territory).
- **Mobile app screenshots**. Playwright is web-only.
- **Real-time collaborative editing** of MDX. Git + PRs is
  the collaboration model.
- **PDF output**. Phase 8 follow-up using pdf-lib over the
  Astro HTML output.
- **Custom Excel templates per SIer firm via the OSS path**.
  The OSS Excel adapter accepts arbitrary user-supplied
  templates (`xlsx.template.file`); a curated library of
  major SI firms' templates is Pro tier.
- **Non-MDX source formats in the OSS path**. The plan
  rejected YAML sidecars in favour of MDX as single source
  of truth. A TS-inline escape hatch may be added if
  developer-only teams ask, but is not the default.
- **Auto-generated cover / history / list sheets without an
  MDX**. Sheets ARE MDX files; no exceptions. This is what
  makes the whole pipeline Git-reviewable.

## Verification

Pass criteria for the OSS minimum (Phases 1–4):

- A consumer can `pnpm add @ingcreators/annot-product-docs
  @ingcreators/annot-product-docs-astro` and follow the
  README from cold to a generated annotated docs page in
  under 30 minutes.
- A consumer can `pnpm add @ingcreators/annot-product-docs-xlsx`,
  supply their own corporate Excel template, and produce a
  customer-deliverable 画面設計書 in under an hour.
- `annot docs lint` correctly reports drift for the six
  change scenarios in the test fixtures.
- The Excel output opens correctly in Excel 2016+, Excel
  for Mac, and LibreOffice; embedded image + item-table
  alignment survives all three; Markdown formatting in
  `<Overlay>` bodies translates to Excel rich text.
- The Astro Image Service caches across builds (no
  regression on a no-change second build).
- Existing annot tests + builds across all 15 packages
  still pass.

Pass criteria for the positioning shift (Phase 7):

- A reader hitting `annot.work` learns within 30 seconds
  that annot generates docs from Playwright tests.
- A search for "Playwright user manual generator" hits
  annot in the first page of results within 3 months.
- At least one external case study within 6 months.

## Migration notes

Existing `annot-annotator` / `annot-playwright` / `annot-mcp`
public APIs are not touched. New packages compose them.

Plain `.mdx` files with `annot:` frontmatter is a new
detection convention. Existing MDX files in customer docs
sites are unaffected (no `annot:` frontmatter = annot CLI
ignores them).

`PRODUCT_DIRECTION.md` updates in Phase 7 are additive — the
"SVG-first screenshot annotation toolkit" line stays;
"living product docs platform" is added alongside.

## Open questions / risks

### 1. VitePress / Astro migration of `packages/docs-site`

The current annot OSS docs site is VitePress. Phase 2 of
this plan ships an Astro integration package.

- **(a)** Migrate `docs-site` to Astro Starlight before /
  during Phase 2. Lets us dogfood. Bigger refactor.
- **(b)** Keep VitePress; ship a sibling Vue-components
  adapter. Faster but doubles component work.
- **(c)** Defer dogfooding. Phase 2's "first production
  user" is a fresh `examples/astro-docs-site/`.

**Default: (c).** Migration of the live site is a separate
plan, ideally landing as a deliberate positioning move
("annot.work/docs is built with annot").

### 2. MDX schema validation strictness

- **(a)** Loose runtime: `match` is `unknown` at type
  level; runtime Zod validates. Max flexibility.
- **(b)** Tight TypeScript: `<Overlay>` typed with
  discriminated union on `match.role`. Strong IDE
  feedback, ergonomic cost.

**Default: (a)** for Phase 1; revisit at Phase 2.

### 3. Excel template fitting policy (Pro tier)

For customer-specific templates (Hitachi / NRI / NEC styles):

- **(a)** Documented schema (predictable but constrains).
- **(b)** AI-mapped arbitrary templates (flexible but
  error-prone).
- **(c)** Curated template library for top 5–10 SI firms.

**Default for OSS (Phase 3): user supplies any template
with named ranges and placeholders.** No SI-firm-specific
support.
**Default for Pro tier (TBD): (c) with (b) as fallback for
the long tail.**

### 4. Platform messaging name

"Living docs" overlaps with BDD's Cucumber LivingDoc. Risk
of confusion. Candidates:

- "Living product docs"
- "Living user manuals"
- "Tests-driven documentation"
- "Code-driven product docs"

**Default: "Living product docs"** as the umbrella name;
"画面設計書" stays as the Vertical B Japanese name.

### 5. Competitive moat durability

Scribehow / Mintlify / GitBook have the engineering
resources to build a "screenshot regen from Playwright"
feature in 1–2 quarters. annot's lead:

- OSS core (they're SaaS-only)
- aria-snapshot primitive choice
- MDX-as-source-of-truth (industry-aligned)
- Drift detection (CI integration depth)
- AI agent integration via MCP
- Japanese SI vertical (they won't pursue)

The realistic forecast: 12–18 month window to build
community before a well-funded competitor copies the global
vertical. Japanese vertical is durable indefinitely on
cultural grounds.

### 6. TS-inline escape hatch

Some teams want everything in `*.spec.ts`. Default is
MDX-first; a `screen.capture({ inline: { ... } })` mode
could be added in Phase 1 as a one-PR follow-up.

**Default**: ship MDX-only in Phase 1.

### 7. Sheet ordering when both `order` and `role` are
   specified

If a project has multiple MDXs with `role: screen`, sheet
order needs deterministic rules:

1. Role-default order (cover → history → list → screen → reference)
2. Within same role: `order` field (default 100)
3. Tie-break: alphabetical by MDX file path

**Default: the three-tier sort above.** Documented in
`annot docs lint` warning when ordering is ambiguous.

## References

### Internal

- [`PRODUCT_DIRECTION.md`](../../PRODUCT_DIRECTION.md) — current
  strategic north star; updated by Phase 7.
- [`annot-cloud-roadmap.md`](./annot-cloud-roadmap.md) — Pro
  tier features; Phase 6 of this plan adds the "product docs
  cloud editor" + template library to the Pro tier.
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
  Open Question #1 interacts with launch-prep's choice to
  ship `docs-site` on VitePress.

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
- [ExcelJS](https://github.com/exceljs/exceljs) — the
  chosen Excel emitter for Phase 3. Supports Named Ranges,
  rich text, image embedding.
- [Scribehow](https://scribehow.com) — closest existing
  competitor in the global vertical.
- [Guidde](https://guidde.com) — video-first competitor.
- [Tango](https://www.tango.us) — same category.
- [Mintlify](https://mintlify.com) — docs platform that
  could grow into a competitor; also our format mate
  (both use MDX).
- [GitBook](https://gitbook.com) — same.
- [Storybook autodocs](https://storybook.js.org/docs/writing-docs/autodocs)
  — component-level analogue.
- [Astro Image Service](https://docs.astro.build/en/recipes/build-custom-img-component/)
  — architectural hook for Phase 2.
