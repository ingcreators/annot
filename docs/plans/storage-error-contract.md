# StorageProvider error contract

> **Status:** Draft. Authored 2026-04-27 in response to the
> 2026-04-27 friction audit (item 8 — "Storage backends のエラー
> ハンドリング不一致") that produced
> [#227](https://github.com/ingcreators/annot/pull/227)–[#234](https://github.com/ingcreators/annot/pull/234).
> The audit's framing was inaccurate (see "Investigation" below);
> the real problem is narrower and easier to fix.
>
> **Compatibility:** `@ingcreators/annot-core/storage` ABI grows
> (new exported error classes + JSDoc on existing `StorageProvider`
> methods). All four backends migrate to the new error types;
> existing call sites that catch by message-substring need to be
> rewritten to use `instanceof`. No SVG schema change. No data
> migration. Plugin-registered storage backends (per
> [`_done/plugin-storage-registration.md`](./_done/plugin-storage-registration.md))
> are expected to throw the new types from day one — Annot is
> still pre-release, so there is no shipped plugin to keep
> compatible.
>
> **Risk:** Phased, four phases, each independently revertable.
> Phase 1 is JSDoc-only (zero runtime change). Phases 2–4 each
> touch one slice (error-class definitions / 4 backends / 1
> caller). The largest single PR is Phase 3 (4 backends, ~30
> throw-site rewrites total). Annot is still pre-release with no
> published plugins, so the migration drops the new types in
> directly without a back-compat shim.

## Context

The storage layer has four first-party `StorageProvider`
implementations
([`packages/web/src/storage/`](../../packages/web/src/storage/)):

- `browser-store.ts` (IndexedDB / `idb-keyval`)
- `device-store.ts` (File System Access API)
- `google-drive-store.ts` (Drive API)
- `github-store.ts` (GitHub REST + git tree)

Plus an extension-bridged variant in
[`packages/web/src/storage/bridge.ts`](../../packages/web/src/storage/bridge.ts)
that proxies to the extension's IDB.

### Investigation

The audit asserted "Storage backends のエラーハンドリング
不一致 — `device-store` と `github-store` で `undefined` を返す
箇所と `throw` する箇所が混在". A grep of the four
implementations actually shows the **per-method** error contract
is consistent across all four backends:

| Method | Missing path | Conflict | Other failure |
|--------|--------------|----------|---------------|
| `getImage(path)` | return `undefined` | n/a | `throw` (parse / IO error) |
| `getFolder(path)` | return `undefined` | n/a | `throw` |
| `listImages` / `listFolders` / `getBreadcrumb` | return `[]` | n/a | `throw` |
| `saveImage` | n/a (path uniquified) | uniquify with `(2)` | `throw` |
| `createFolder` | n/a | `throw new Error("Folder already exists: ...")` | `throw` |
| `renameImage` / `renameFolder` / `moveImage` / `moveFolder` | `throw` (source missing) | `throw` (collision at dest) | `throw` |
| `updateImage` / `deleteImage` / `deleteFolder` | silent no-op (idempotent) | n/a | `throw` |

So the `undefined` ↔ `throw` split is consistently driven by
**which method you call**, not by **which backend you call it
on**. The audit was wrong about the failure mode.

### What is actually wrong

Three real problems remain after the framing is corrected:

1. **The per-method contract is mostly undocumented.** The
   `StorageProvider` interface in
   [`packages/core/src/storage/types.ts:142`](../../packages/core/src/storage/types.ts)
   has JSDoc on `saveImage` and `createFolder` (one line each)
   but the rest of the methods have either a one-line summary
   or nothing. There's no central statement of "missing source
   path is `undefined` here vs `throw` there", so a new
   contributor or a new backend implementer has to grep the
   existing implementations to derive the contract.

2. **Conflict / not-found errors are plain `Error` instances
   with locale-leaking messages.** Every conflict throw across
   the four backends looks like
   `throw new Error("Image already exists: " + newPath)` or
   `throw new Error("Folder not found: " + folderPath)`. Caller
   code that wants to react ("the user typed a name that
   collides — show a renaming prompt instead of bailing") has
   to either catch everything or substring-match the message.

3. **Substring-matching is happening in production code today.**
   [`packages/web/src/app/split-editor-host.ts:246`](../../packages/web/src/app/split-editor-host.ts:246)
   has the literal pattern:
   ```ts
   if (msg.includes("already exists") || err?.name === "ConstraintError") {
     // Bump the suffix and retry
   }
   ```
   This is exactly the failure mode a structured-error
   discriminator should prevent. Changing any backend's error
   message wording silently breaks this code path.

The fix is **not** to migrate the public methods to a `Result<T,
E>` type — that's a sweeping change to every caller for marginal
benefit, and the existing throw / undefined split is already
sound. The fix is to (a) document the contract once, (b)
provide structured error types so callers can discriminate
without substring matching, and (c) refactor the one known
substring-matching site to use the new types.

## Goals

- A new contributor can read the `StorageProvider` interface
  (or its `tsdoc`-rendered output) and understand exactly which
  methods throw on missing sources, which return `undefined`,
  and which collide with what.
- A caller that wants to handle "name already exists" can write
  `catch (e) { if (e instanceof StorageConflictError) ... }`
  without grepping any backend's source.
- The substring match in `split-editor-host.ts` is gone,
  replaced by a structured `instanceof` check.
- The new error types are exported from
  `@ingcreators/annot-core/storage` so plugin-registered
  backends can throw them too.
- The headless boundary stays intact (the new error classes are
  Tier A — pure types + plain JS classes, no DOM).

## Non-goals

- **Not** migrating `StorageProvider` methods to a `Result<T,
  E>` style. The throw/undefined split is sound; rewriting
  every caller would dwarf the benefit.
- **Not** introducing per-backend error subclasses
  (`GitHubRateLimitError`, `DriveAuthError`, etc.). Those are
  legitimately backend-specific and stay as plain `Error`
  subclasses inside each backend file. The shared hierarchy
  only covers conditions every backend can produce
  (conflict / not-found / permission / quota).
- **Not** internationalising error messages. Messages stay in
  English; localisation is a UI concern handled at the
  display layer (`save-pipeline.ts` etc.) and lives outside
  this plan.
- **Not** retroactively wrapping every `throw new Error(...)`
  in storage backends. Only the **conflict** and **not-found**
  cases get the new types in Phase 3 — generic IO / network /
  parse failures keep using plain `Error`.
- **Not** touching the existing `StorageWith{Resync,
  ForceRefresh, Rename, Auth}` capability interfaces. Their
  methods (`resync` / `forceRefresh` / `setTokenRefresher`)
  don't have the same conflict / not-found semantics.

## Design

### New error hierarchy in `@ingcreators/annot-core/storage`

A new file `packages/core/src/storage/errors.ts` exports:

```ts
/** Base for all StorageProvider-thrown errors that callers may want to
 *  discriminate. Generic IO / network / parse errors continue to throw
 *  plain `Error` and are NOT captured by `instanceof StorageError`. */
export class StorageError extends Error {
  /** Stable discriminator for cross-backend error handling. Set by each
   *  subclass — never set directly. */
  readonly code: StorageErrorCode;
  /** Path the operation was attempted on (image or folder). */
  readonly path: string;
  constructor(code: StorageErrorCode, path: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.path = path;
  }
}

export type StorageErrorCode =
  | "conflict"     // Path already exists at the destination.
  | "not-found"    // Source path doesn't exist (for ops that require it).
  | "permission"   // Backend rejected the op for auth / ACL reasons.
  | "quota";       // Backend rejected for quota / size reasons.

export class StorageConflictError extends StorageError {
  constructor(path: string, message?: string) {
    super("conflict", path, message ?? `Path already exists: ${path}`);
    this.name = "StorageConflictError";
  }
}

export class StorageNotFoundError extends StorageError {
  constructor(path: string, message?: string) {
    super("not-found", path, message ?? `Path not found: ${path}`);
    this.name = "StorageNotFoundError";
  }
}

export class StoragePermissionError extends StorageError {
  constructor(path: string, message?: string) {
    super("permission", path, message ?? `Permission denied: ${path}`);
    this.name = "StoragePermissionError";
  }
}

export class StorageQuotaError extends StorageError {
  constructor(path: string, message?: string) {
    super("quota", path, message ?? `Quota exceeded: ${path}`);
    this.name = "StorageQuotaError";
  }
}
```

The classes are pure ES2022 — no `Error.captureStackTrace`
polyfill, no Browser-specific APIs — so they sit in Tier A and
get re-exported from `headless.ts`.

### `StorageProvider` JSDoc rewrite

Each method on the interface gains a `@throws` clause naming the
specific `StorageError` subclass(es) it can produce. Example:

```ts
/**
 * Save a new image. ...
 *
 * Returns the actual path assigned (post-uniquification).
 *
 * @throws {StoragePermissionError} if the backend rejects the
 *   write (e.g. expired GitHub token, revoked Drive scope).
 * @throws {StorageQuotaError} if the backend reports out-of-space
 *   or out-of-quota.
 * @throws {Error} for unstructured backend / IO failures.
 */
saveImage(...): Promise<string>;
```

For methods that **don't** throw on missing sources (`getImage`,
`getFolder`, `listImages`, `listFolders`, `getBreadcrumb`,
`updateImage`, `deleteImage`, `deleteFolder`), the JSDoc
explicitly says "Returns `undefined` / no-op for missing path"
so the contract is in one place.

### Plugin-storage compatibility

[`_done/plugin-storage-registration.md`](./_done/plugin-storage-registration.md)
opens `storage/bridge.ts` to plugin-registered backends. Annot
is still pre-release and no plugin ships yet — the only
forthcoming consumer (`annot-cloud`'s pointer-commit store) is
in-house, so it adopts the new error types from day one. No
shim, no fallback wrapper. Plugins land already-conformant or
they throw plain `Error` and lose structured-error UX, same as
any unconforming user code.

## Phased plan

| Phase | Scope | PRs | Depends on |
|-------|-------|-----|------------|
| 1 | JSDoc rewrite of every `StorageProvider` method (zero runtime change) | 1 | — |
| 2 | Add `StorageError` hierarchy in `packages/core/src/storage/errors.ts`, export from `headless.ts` | 1 | 1 done |
| 3 | Migrate the four first-party backends to throw the new types at conflict / not-found sites | 1 (or 4 if they get review-heavy) | 2 done |
| 4 | Replace the `msg.includes("already exists")` block in [`split-editor-host.ts:246`](../../packages/web/src/app/split-editor-host.ts:246) with `instanceof StorageConflictError`. | 1 | 3 done |

Each phase is independently revertable and lands on `main`
before the next starts. Phases 1 and 2 can land in parallel if
desired; Phase 3 must wait for Phase 2's exports.

## Verification

- **Phase 1:** docs-only, no test. Reviewer reads the JSDoc and
  cross-references each statement against the matching backend
  implementation.
- **Phase 2:** new file ships with co-located tests
  (`packages/core/src/storage/errors.test.ts`) covering: each
  subclass sets `name` / `code` / `path` correctly; `instanceof
  StorageError` and `instanceof StorageConflictError` both
  return true for a thrown subclass instance; `e.code` narrows
  to the literal type at compile time. Verified by Vitest.
- **Phase 3:** the existing
  [`packages/web/src/storage/contract.test-helpers.ts`](../../packages/web/src/storage/contract.test-helpers.ts)
  contract suite (run by each backend's
  `*-store.contract.test.ts`) gains four assertions per
  backend: `createFolder` of an existing folder throws
  `StorageConflictError`; `renameFolder` to an existing name
  throws `StorageConflictError`; `getImage` of a missing path
  returns `undefined` (regression guard); `renameImage` of a
  missing path throws `StorageNotFoundError`. The structural
  test catches if any backend forgot to migrate.
- **Phase 4:** existing split-editor unit / integration tests
  cover the rename-collision retry loop. After the migration
  the tests still pass; manual smoke confirms the user-facing
  behaviour (split → orphan-collision → uniquified rename) is
  unchanged.

## Migration notes

- **No data migration.** SVG schema unchanged.
  `data-annot-version` unchanged. `StorageProvider` method
  signatures unchanged.
- **Public surface change:** Phase 2 adds 5 new exported
  classes (`StorageError` + 4 subclasses) and 1 new exported
  type (`StorageErrorCode`) to
  `@ingcreators/annot-core/storage`. Mirror in
  `packages/core/src/headless.ts`.
- **Pre-release stance:** Annot has not been published. There
  is no shipped plugin, no external caller depending on the
  current error wording, no npm consumer with a pinned version.
  The migration drops the new types in directly — no
  back-compat shim, no soft-landing wrapper, no deprecation
  cycle.
- **In-repo callers:** the only call site that introspects
  errors today is the substring match in
  [`split-editor-host.ts:246`](../../packages/web/src/app/split-editor-host.ts:246),
  which Phase 4 rewrites. Generic `catch (e) {
  console.error(e.message) }` sites stay unchanged — the new
  error classes still expose `.message`.

## Open questions

- Should `StorageError.path` be required, or optional (some
  errors might not have a meaningful path)? Plan currently
  makes it required because every existing throw site has a
  path on hand; if we hit a counterexample during Phase 3 we
  loosen it.
- Should we add `StorageNetworkError` / `StorageRateLimitError`
  to the shared hierarchy too, or keep those backend-specific?
  Plan defers that decision — the four codes above cover every
  current cross-backend case, and adding more later is purely
  additive.
- Should `StorageNotFoundError` exist at all given that the
  contract for `get*` methods is "return `undefined`"? Plan
  keeps it for the **rename / move source missing** case, where
  throwing is the right behaviour and the caller wants to
  discriminate "source vanished mid-flight" from "destination
  collided".
