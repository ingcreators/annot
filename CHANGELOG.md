# Changelog

All notable changes to Annot are recorded here. The format follows
[Keep a Changelog]; semantic versioning will start once the first
tagged release ships. Until then, every PR landed on `main` is
listed under the rolling **Unreleased** heading, grouped by date
in descending order.

Each entry is a single squash-merge commit on `main`. Click the
`#NN` link to read the full PR conversation, including the test
plan, reviewer notes, and any post-merge follow-ups.

[Keep a Changelog]: https://keepachangelog.com/en/1.1.0/

## [Unreleased]

### 2026-04-25

- [#98](https://github.com/ingcreators/annot/pull/98) — fix(editor): display:contents on Lit wrappers so parent flex
- [#97](https://github.com/ingcreators/annot/pull/97) — fix(pwa): force reload after SKIP_WAITING so the Reload banner
- [#96](https://github.com/ingcreators/annot/pull/96) — fix(toolbar): flush `<annot-toolbar-button>` render synchronously in `getButton()`
- [#95](https://github.com/ingcreators/annot/pull/95) — fix(file-manager): id-based grid-host lookup survives GalleryPage's className overwrite
- [#94](https://github.com/ingcreators/annot/pull/94) — fix(file-manager): await gallery readiness before refresh
- [#93](https://github.com/ingcreators/annot/pull/93) — feat(ui): migrate dialogs + capture dialog/toast to Lit (Phase 6)
- [#92](https://github.com/ingcreators/annot/pull/92) — feat(toolbar): Lit variant flyouts + save menu (Phase 5c)
- [#91](https://github.com/ingcreators/annot/pull/91) — feat(toolbar): Lit shell + tool buttons (Phase 5b)
- [#90](https://github.com/ingcreators/annot/pull/90) — refactor(toolbar): relocate Toolbar from core to web (Phase 5a)
- [#89](https://github.com/ingcreators/annot/pull/89) — feat(web): migrate header + statusbar to Lit (Phase 4)
- [#88](https://github.com/ingcreators/annot/pull/88) — feat(web): migrate Sidebar + FileManager shell to Lit (Phase 3)
- [#87](https://github.com/ingcreators/annot/pull/87) — feat(web): migrate right-panel + sections to Lit (Phase 2)
- [#86](https://github.com/ingcreators/annot/pull/86) — feat(web): migrate drawer + drawer sections to Lit (Phase 1)
- [#85](https://github.com/ingcreators/annot/pull/85) — feat(web): migrate SaveStatusIndicator + ErrorBar to Lit (Phase 0)
- [#84](https://github.com/ingcreators/annot/pull/84) — chore(web): bootstrap Storybook + 5 landmark stories (Phase 1)
- [#83](https://github.com/ingcreators/annot/pull/83) — docs(plans): Storybook + Lit migration (Queued, sign-off incorporated)
- [#82](https://github.com/ingcreators/annot/pull/82) — refactor(editor): right-panel becomes a UISection host (Phase 3)
- [#81](https://github.com/ingcreators/annot/pull/81) — refactor(editor): drawer becomes a UISection host (Phase 2)
- [#80](https://github.com/ingcreators/annot/pull/80) — refactor(web): UI section registration API + opt-out (Phase 1)
- [#79](https://github.com/ingcreators/annot/pull/79) — docs(plans): plugin-ui-slots (Queued, sign-off incorporated)
- [#78](https://github.com/ingcreators/annot/pull/78) — refactor(web): sidebar tabs + Recent built-in (Phase 1)
- [#77](https://github.com/ingcreators/annot/pull/77) — docs(plans): plugin-sidebar-tabs (Queued, sign-off incorporated)
- [#76](https://github.com/ingcreators/annot/pull/76) — refactor(storage): plugin storage registration + opt-out (Phase C)
- [#75](https://github.com/ingcreators/annot/pull/75) — refactor(storage): StorageRegistry + setTokenRefresher contract (Phase B)
- [#74](https://github.com/ingcreators/annot/pull/74) — refactor(storage): widen `StorageMode` to string (Phase A)
- [#73](https://github.com/ingcreators/annot/pull/73) — docs(plans): plugin-storage-registration (Queued, sign-off incorporated)
- [#72](https://github.com/ingcreators/annot/pull/72) — refactor(web): Phase 5 cloud readiness gate — add `onBeforeSave` + audit
- [#71](https://github.com/ingcreators/annot/pull/71) — refactor(web): plugin API MVP — PluginHost + built-in GitHub links (Phase 4)
- [#70](https://github.com/ingcreators/annot/pull/70) — refactor(web): extract ExtensionTransferHost + SplitEditorHost (Phase 3.5)
- [#69](https://github.com/ingcreators/annot/pull/69) — refactor(web): extract RouterHost + StorageBridge (Phase 3)
- [#68](https://github.com/ingcreators/annot/pull/68) — refactor(web): extract EditorSession + HeaderHost + StatusHost (Phase 2)
- [#67](https://github.com/ingcreators/annot/pull/67) — refactor(web): extract SavePipeline + CaptureHost (Phase 1)
- [#66](https://github.com/ingcreators/annot/pull/66) — docs(claude): document unwritten landing conventions
- [#65](https://github.com/ingcreators/annot/pull/65) — refactor(web): extract pure helpers from app.ts (Phase 0)
- [#64](https://github.com/ingcreators/annot/pull/64) — docs(plans): queue app.ts decomposition + Plugin API MVP
- [#63](https://github.com/ingcreators/annot/pull/63) — chore(tsconfig): enable `noUncheckedIndexedAccess` across the monorepo

### 2026-04-24

- [#62](https://github.com/ingcreators/annot/pull/62) — chore(tsconfig): tighten shared base with 2 safe strict flags + document deltas
- [#61](https://github.com/ingcreators/annot/pull/61) — test(storage): StorageProvider contract coverage for Drive + Device
- [#60](https://github.com/ingcreators/annot/pull/60) — style(css): silence noDescendingSpecificity warnings with rationale
- [#59](https://github.com/ingcreators/annot/pull/59) — chore(deps): drop vitest / vite ignores now that both are on current major
- [#58](https://github.com/ingcreators/annot/pull/58) — chore(deps): re-allow biome major bumps via dependabot
- [#57](https://github.com/ingcreators/annot/pull/57) — chore(tooling): migrate to Biome 2.4.13
- [#43](https://github.com/ingcreators/annot/pull/43) — perf(github): atomic commits for rename / move / bulk delete
- [#55](https://github.com/ingcreators/annot/pull/55) — chore(deps): ignore major bumps for biome / vitest / vite in dependabot
- [#50](https://github.com/ingcreators/annot/pull/50) — chore(deps-dev): bump vitest from 2.1.9 to 4.1.5
- [#56](https://github.com/ingcreators/annot/pull/56) — fix(test-mock): drop node:crypto dependency in GitHub API simulator
- [#51](https://github.com/ingcreators/annot/pull/51) — chore(deps-dev): bump vite from 6.4.2 to 8.0.10
- [#53](https://github.com/ingcreators/annot/pull/53) — chore(deps-dev): bump typescript from 5.9.3 to 6.0.3
- [#49](https://github.com/ingcreators/annot/pull/49) — chore(ci): bump actions/checkout from 4 to 6
- [#48](https://github.com/ingcreators/annot/pull/48) — chore(ci): bump actions/setup-node from 4 to 6
- [#47](https://github.com/ingcreators/annot/pull/47) — chore(ci): bump pnpm/action-setup from 4 to 6
- [#54](https://github.com/ingcreators/annot/pull/54) — test(storage): shared StorageProvider contract suite (Browser + GitHub)
- [#45](https://github.com/ingcreators/annot/pull/45) — test: vitest + pure-logic tests for core's headless subset
- [#44](https://github.com/ingcreators/annot/pull/44) — chore(tooling): adopt Biome + dependabot + pnpm audit
- [#42](https://github.com/ingcreators/annot/pull/42) — docs(plans): spell out Cloud storage model vs OSS git-native
- [#41](https://github.com/ingcreators/annot/pull/41) — feat(github): reconfigure menu + rate-limit advisory banner
- [#40](https://github.com/ingcreators/annot/pull/40) — perf(github): amend previous commit for same-file update streaks
- [#39](https://github.com/ingcreators/annot/pull/39) — feat(github): last commit + View on GitHub in details drawer
- [#38](https://github.com/ingcreators/annot/pull/38) — feat(web): github integration phase 3 — sidebar + routing
- [#37](https://github.com/ingcreators/annot/pull/37) — feat(web): github integration phase 2 — GitHubStore
- [#36](https://github.com/ingcreators/annot/pull/36) — feat(web): github integration phase 1 — PAT auth + repo picker
- [#35](https://github.com/ingcreators/annot/pull/35) — docs(plans): capture individual-user GitHub integration design
- [#34](https://github.com/ingcreators/annot/pull/34) — docs(plans): capture OSS + commercial cloud split strategy

### 2026-04-23

- [#32](https://github.com/ingcreators/annot/pull/32) — fix(web): opacity of the error/update bar (info variant)
- [#33](https://github.com/ingcreators/annot/pull/33) — refactor(drive): drop boot-time root folder verify
- [#31](https://github.com/ingcreators/annot/pull/31) — refactor(storage): rename internal identifiers to match UI labels
- [#30](https://github.com/ingcreators/annot/pull/30) — refactor(storage): rename mode identifiers to match UI labels
- [#29](https://github.com/ingcreators/annot/pull/29) — fix(sidebar): show FOLDERS heading and tree together, not separately
- [#28](https://github.com/ingcreators/annot/pull/28) — refactor(drive): drop silent token renewal, always use the banner
- [#27](https://github.com/ingcreators/annot/pull/27) — fix(web): make error-bar actually paint above #file-manager
- [#26](https://github.com/ingcreators/annot/pull/26) — fix(drive): timeout silent renewal so blocked popups don't hang
- [#25](https://github.com/ingcreators/annot/pull/25) — fix(drive): use prompt=none for truly-silent token renewal
- [#24](https://github.com/ingcreators/annot/pull/24) — fix(drive): prompt to re-pick when the persisted root is gone
- [#23](https://github.com/ingcreators/annot/pull/23) — fix(drive): route 401 recovery through a user-gesture banner
- [#22](https://github.com/ingcreators/annot/pull/22) — fix(drive): auto-refresh expired access token across every API call
- [#21](https://github.com/ingcreators/annot/pull/21) — chore(brand): add Drive UI 64 and 256 icon sizes
- [#20](https://github.com/ingcreators/annot/pull/20) — chore: rename save convention to annot + preserve opened filename on export
- [#19](https://github.com/ingcreators/annot/pull/19) — chore(brand): fix stale package paths + generate OAuth/Drive-UI icons
- [#18](https://github.com/ingcreators/annot/pull/18) — feat(web): handoff route + Drive UI Integration plumbing
- [#17](https://github.com/ingcreators/annot/pull/17) — perf(web): run PNG-8 encoding in a Web Worker
- [#16](https://github.com/ingcreators/annot/pull/16) — feat(drive): show Drive root folder name under the FOLDERS tree
- [#15](https://github.com/ingcreators/annot/pull/15) — feat(web): in-app prompt when a new version is available
- [#14](https://github.com/ingcreators/annot/pull/14) — feat(web): flush pending save before leaving the editor
- [#13](https://github.com/ingcreators/annot/pull/13) — perf(drive): coalesce rapid edits and skip redundant re-fetch
- [#12](https://github.com/ingcreators/annot/pull/12) — feat(drive): allow re-picking the Drive root folder
- [#11](https://github.com/ingcreators/annot/pull/11) — feat(drive): show picked root folder name in the sidebar
- [#10](https://github.com/ingcreators/annot/pull/10) — fix(drive): avoid call-stack overflow when base64-encoding uploads
- [#9](https://github.com/ingcreators/annot/pull/9) — feat(drive): narrow scope to drive.file + persist root folder
- [#8](https://github.com/ingcreators/annot/pull/8) — docs(plans): Drive integration v1 — drive.file + Marketplace
- [#7](https://github.com/ingcreators/annot/pull/7) — ci: pin Node 24 via .nvmrc as single source of truth
- [#6](https://github.com/ingcreators/annot/pull/6) — ci: opt actions runner into Node 24 ahead of the forced switch
- [#5](https://github.com/ingcreators/annot/pull/5) — feat(extension): point at annot.work in production builds
- [#4](https://github.com/ingcreators/annot/pull/4) — fix(web): remove `public/_redirects`, rely on wrangler SPA fallback
- [#3](https://github.com/ingcreators/annot/pull/3) — chore: add wrangler.jsonc for Cloudflare Workers Static Assets
- [#2](https://github.com/ingcreators/annot/pull/2) — docs: align URL docs with annot.work + root base
- [#1](https://github.com/ingcreators/annot/pull/1) — chore(web): prep for Cloudflare Pages deploy

Pre-PR direct commits (initial bootstrap, 2026-04-23):

- `9d9ca31` — ci: add typecheck + build workflow
- `8abfcd0` — docs: add root README.md
- `7d43f3b` — chore: add repository field to all package.json
- `1362629` — Initial commit: annot monorepo
