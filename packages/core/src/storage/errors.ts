// StorageProvider error hierarchy.
//
// Phase 2 of `docs/plans/storage-error-contract.md`. The classes
// here back the `@throws` clauses documented on `StorageProvider`
// in Phase 1 (`./types.ts`). Phase 3 migrates the four first-party
// backends to throw these subclasses; Phase 4 rewrites
// `split-editor-host.ts`'s substring match to use them.
//
// Tier A by construction — pure ES2022 classes with no DOM globals,
// no `Error.captureStackTrace` polyfill, no Browser-specific APIs.
// Imported safely from `headless.ts`.

/**
 * Stable discriminator for cross-backend storage error handling.
 * Mirrors the `StorageError` subclass hierarchy below; callers
 * that prefer a `switch` over `instanceof` can use `e.code`.
 */
export type StorageErrorCode = "conflict" | "not-found" | "permission" | "quota";

/**
 * Base for all `StorageProvider`-thrown errors that callers may
 * want to discriminate. Generic IO / network / parse errors keep
 * throwing plain `Error` and are NOT captured by `instanceof
 * StorageError`.
 *
 * Subclasses set `name` / `code` / `path` themselves. Construct via
 * the subclasses (`StorageConflictError`, `StorageNotFoundError`,
 * `StoragePermissionError`, `StorageQuotaError`) — callers and
 * backends never instantiate `StorageError` directly.
 */
export class StorageError extends Error {
  /** Discriminator. Set by each subclass to its matching code. */
  readonly code: StorageErrorCode;
  /** Path the failed operation was attempted on (image or folder). */
  readonly path: string;
  constructor(code: StorageErrorCode, path: string, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.path = path;
  }
}

/**
 * Destination path collides with an existing image or folder, and
 * the operation does NOT auto-uniquify. Thrown by `createFolder`
 * (duplicate name), `renameImage` / `renameFolder` / `moveFolder`
 * (caller-picked name collides). `saveImage` and `moveImage`
 * auto-uniquify and never throw this.
 */
export class StorageConflictError extends StorageError {
  constructor(path: string, message?: string) {
    super("conflict", path, message ?? `Path already exists: ${path}`);
    this.name = "StorageConflictError";
  }
}

/**
 * Source path for a `rename*` / `move*` no longer exists. Read
 * methods (`getImage`, `getFolder`, `listImages`, `listFolders`,
 * `getBreadcrumb`) and idempotent mutations (`updateImage`,
 * `deleteImage`, `deleteFolder`) return `undefined` / `[]` /
 * silently instead of throwing this.
 */
export class StorageNotFoundError extends StorageError {
  constructor(path: string, message?: string) {
    super("not-found", path, message ?? `Path not found: ${path}`);
    this.name = "StorageNotFoundError";
  }
}

/**
 * Backend rejected the operation for auth / ACL reasons — expired
 * GitHub token, revoked Drive scope, FSA permission lapse, etc.
 * Any mutating `StorageProvider` method may throw this.
 */
export class StoragePermissionError extends StorageError {
  constructor(path: string, message?: string) {
    super("permission", path, message ?? `Permission denied: ${path}`);
    this.name = "StoragePermissionError";
  }
}

/**
 * Backend reports out-of-space or out-of-quota. Any mutating
 * `StorageProvider` method may throw this.
 */
export class StorageQuotaError extends StorageError {
  constructor(path: string, message?: string) {
    super("quota", path, message ?? `Quota exceeded: ${path}`);
    this.name = "StorageQuotaError";
  }
}
