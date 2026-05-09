/**
 * In-memory implementation of {@link DesktopFs} for unit tests.
 *
 * Mirrors the structure of `packages/web/src/storage/device-fs.test-mock.ts`
 * (which fakes the FSA `FileSystemDirectoryHandle` API for the
 * Device store). Where the FSA mock has to mirror the browser
 * `getFileHandle` / `createWritable` choreography, this one is
 * simpler: `DesktopFs`'s API is already a small set of POSIX-ish
 * primitives, so the in-memory tree backs them directly.
 *
 * Path normalisation: leading `/` and the configured `libraryRoot`
 * prefix are stripped. Everything inside the mock is stored against
 * a forward-slash, library-relative key so the contract suite's
 * "create folder Alpha → save into Alpha" calls round-trip
 * regardless of how the production code resolves the absolute
 * path on disk.
 *
 * Out of scope: permission errors, quota errors, mtime resolution
 * jitter, symlinks. DesktopStore doesn't depend on any of those for
 * the contract tests; if a future capability test does, extend the
 * mock here rather than reaching for the real plugin-fs.
 */

import type { DesktopFs, DesktopFsEntry, DesktopFsStat } from "./desktop-fs.js";

const ROOT = "/mock-library";

interface MockFile {
  kind: "file";
  bytes: Uint8Array;
  mtime: number;
}

interface MockDir {
  kind: "directory";
  children: Map<string, MockFile | MockDir>;
  mtime: number;
}

function makeDir(): MockDir {
  return { kind: "directory", children: new Map(), mtime: Date.now() };
}

/** Strip the absolute prefix the production code prepends so the
 *  internal tree only ever sees library-relative paths. */
function normalisePath(path: string, libraryRoot: string): string {
  let p = path;
  if (p.startsWith(libraryRoot)) {
    p = p.slice(libraryRoot.length);
  }
  while (p.startsWith("/")) p = p.slice(1);
  while (p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function splitPath(path: string): string[] {
  return path ? path.split("/") : [];
}

/** Walk to the directory at `path`. Returns `undefined` when any
 *  segment is missing or resolves to a file. */
function findDir(root: MockDir, path: string): MockDir | undefined {
  let dir: MockDir = root;
  for (const segment of splitPath(path)) {
    const child = dir.children.get(segment);
    if (!child || child.kind !== "directory") return undefined;
    dir = child;
  }
  return dir;
}

function findEntry(root: MockDir, path: string): MockFile | MockDir | undefined {
  if (!path) return root;
  const segments = splitPath(path);
  const last = segments[segments.length - 1]!;
  const parentSegments = segments.slice(0, -1);
  const parent = findDir(root, parentSegments.join("/"));
  return parent?.children.get(last);
}

function entryStat(entry: MockFile | MockDir): DesktopFsStat {
  if (entry.kind === "file") {
    return { kind: "file", size: entry.bytes.byteLength, mtime: entry.mtime };
  }
  return { kind: "directory", size: 0, mtime: entry.mtime };
}

/**
 * Create a fresh in-memory `DesktopFs` for tests.
 *
 * Production code resolves library-relative paths against an
 * absolute `libraryRoot` (the OS-userData library directory). The
 * mock accepts BOTH absolute paths (with the configured
 * `libraryRoot` prefix) AND library-relative paths so a test that
 * hands the store the absolute root and a test that pokes the
 * mock directly both work.
 */
export function createMockDesktopFs(libraryRoot: string = ROOT): DesktopFs {
  const root = makeDir();

  const fs: DesktopFs = {
    async readDir(path) {
      const dir = findDir(root, normalisePath(path, libraryRoot));
      if (!dir) return [];
      const entries: DesktopFsEntry[] = [];
      for (const [name, child] of dir.children) {
        entries.push({ name, kind: child.kind });
      }
      return entries;
    },

    async readFile(path) {
      const entry = findEntry(root, normalisePath(path, libraryRoot));
      if (!entry || entry.kind !== "file") {
        throw new Error(`ENOENT: ${path}`);
      }
      // Defensive copy — callers shouldn't be able to mutate the
      // backing store by holding the returned Uint8Array.
      return new Uint8Array(entry.bytes);
    },

    async writeFile(path, bytes) {
      const normalised = normalisePath(path, libraryRoot);
      if (!normalised) throw new Error("EISDIR: cannot write to root");
      const segments = splitPath(normalised);
      const last = segments[segments.length - 1]!;
      const parent = findDir(root, segments.slice(0, -1).join("/"));
      if (!parent) {
        throw new Error(`ENOENT: parent missing for ${path}`);
      }
      const existing = parent.children.get(last);
      if (existing && existing.kind === "directory") {
        throw new Error(`EISDIR: ${path}`);
      }
      parent.children.set(last, {
        kind: "file",
        bytes: new Uint8Array(bytes),
        mtime: Date.now(),
      });
      parent.mtime = Date.now();
    },

    async mkdir(path, opts) {
      const normalised = normalisePath(path, libraryRoot);
      if (!normalised) return; // root always exists
      const segments = splitPath(normalised);
      let dir: MockDir = root;
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i]!;
        const isLast = i === segments.length - 1;
        const existing = dir.children.get(segment);
        if (existing) {
          if (existing.kind !== "directory") {
            throw new Error(`ENOTDIR: ${segment}`);
          }
          if (isLast && !opts?.recursive) {
            throw new Error(`EEXIST: ${path}`);
          }
          dir = existing;
          continue;
        }
        if (!isLast && !opts?.recursive) {
          throw new Error(`ENOENT: ${path}`);
        }
        const fresh = makeDir();
        dir.children.set(segment, fresh);
        dir.mtime = Date.now();
        dir = fresh;
      }
    },

    async rename(from, to) {
      const fromNorm = normalisePath(from, libraryRoot);
      const toNorm = normalisePath(to, libraryRoot);
      if (!fromNorm || !toNorm) throw new Error("EINVAL: empty path");

      const fromSegments = splitPath(fromNorm);
      const fromLeaf = fromSegments[fromSegments.length - 1]!;
      const fromParent = findDir(root, fromSegments.slice(0, -1).join("/"));
      const fromEntry = fromParent?.children.get(fromLeaf);
      if (!fromParent || !fromEntry) {
        throw new Error(`ENOENT: ${from}`);
      }

      const toSegments = splitPath(toNorm);
      const toLeaf = toSegments[toSegments.length - 1]!;
      const toParent = findDir(root, toSegments.slice(0, -1).join("/"));
      if (!toParent) {
        throw new Error(`ENOENT: parent missing for ${to}`);
      }
      // Mirror Node fs.rename: replacing an existing FILE is allowed
      // (overwrites silently); replacing a non-empty directory rejects.
      const existing = toParent.children.get(toLeaf);
      if (existing && existing.kind === "directory" && existing.children.size > 0) {
        throw new Error(`ENOTEMPTY: ${to}`);
      }

      fromParent.children.delete(fromLeaf);
      toParent.children.set(toLeaf, fromEntry);
      fromParent.mtime = Date.now();
      toParent.mtime = Date.now();
    },

    async remove(path, opts) {
      const normalised = normalisePath(path, libraryRoot);
      if (!normalised) throw new Error("EBUSY: cannot remove root");
      const segments = splitPath(normalised);
      const leaf = segments[segments.length - 1]!;
      const parent = findDir(root, segments.slice(0, -1).join("/"));
      const entry = parent?.children.get(leaf);
      if (!parent || !entry) {
        throw new Error(`ENOENT: ${path}`);
      }
      if (entry.kind === "directory" && entry.children.size > 0 && !opts?.recursive) {
        throw new Error(`ENOTEMPTY: ${path}`);
      }
      parent.children.delete(leaf);
      parent.mtime = Date.now();
    },

    async stat(path) {
      const entry = findEntry(root, normalisePath(path, libraryRoot));
      if (!entry) return undefined;
      return entryStat(entry);
    },
  };

  return fs;
}
