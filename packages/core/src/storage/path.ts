/**
 * Path utilities for filesystem-style storage identifiers.
 *
 * Paths are POSIX-style, separated by "/". Never leading or trailing "/".
 * Root path is "" (empty string). Reserved segments "." and ".." are invalid.
 */

/** Empty string represents the root folder. */
export const ROOT_PATH = "";

/** Characters not allowed in a single path segment (Windows-reserved + control). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejects ASCII control chars in filenames (POSIX + Windows block these).
const INVALID_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

/**
 * Validate a single path segment (folder or filename).
 * Throws if the name is empty, is "." / "..", or contains reserved characters.
 */
export function validateName(name: string): void {
  if (!name) throw new Error("Name must not be empty");
  if (name === "." || name === "..") throw new Error(`Name "${name}" is reserved`);
  if (INVALID_NAME_CHARS.test(name)) {
    throw new Error(`Name "${name}" contains invalid characters`);
  }
  if (name.length > 255) throw new Error("Name is too long (max 255 chars)");
}

/**
 * Join a parent path with a single name.
 * Throws if `name` contains "/".
 */
export function joinPath(parent: string, name: string): string {
  if (!name) throw new Error("joinPath: name is required");
  if (name.includes("/")) throw new Error(`joinPath: name must not contain "/": "${name}"`);
  return parent ? `${parent}/${name}` : name;
}

/** Return the parent folder's path. Root path's parent is "" (root). */
export function getParentPath(path: string): string {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Return the last segment (folder name or filename) from a path. */
export function getFilename(path: string): string {
  if (!path) return "";
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** Split a path into its segments. Returns [] for the root path. */
export function splitPath(path: string): string[] {
  return path ? path.split("/") : [];
}

/**
 * Return all ancestor paths from root down to (but not including) `path`.
 * Example: `ancestorPaths("A/B/C") = ["A", "A/B"]`.
 */
export function ancestorPaths(path: string): string[] {
  const parts = splitPath(path);
  const out: string[] = [];
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i];
    out.push(acc);
  }
  return out;
}

/**
 * Return `true` if `path` is equal to `ancestor` or is nested inside it.
 * Example: `isDescendantOrSame("A/B/C", "A") === true`.
 */
export function isDescendantOrSame(path: string, ancestor: string): boolean {
  if (!ancestor) return true;
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/**
 * Split a filename into base + extension. Extension includes the leading ".".
 * Example: `splitExt("image.tar.gz") = ["image.tar", ".gz"]`.
 * Files without extension return `[name, ""]`.
 */
export function splitExt(filename: string): [string, string] {
  const i = filename.lastIndexOf(".");
  if (i <= 0) return [filename, ""]; // dotfiles or no extension
  return [filename.slice(0, i), filename.slice(i)];
}

/**
 * Return a unique filename within its folder by appending " (2)", " (3)", ...
 * before the extension. If `desired` is already free, returns it unchanged.
 */
export function uniquifyFilename(desired: string, exists: (candidate: string) => boolean): string {
  if (!exists(desired)) return desired;
  const [base, ext] = splitExt(desired);
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`Could not find unique name for "${desired}"`);
}

/** Async variant of `uniquifyFilename` for stores that need async existence checks. */
export async function uniquifyFilenameAsync(
  desired: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!(await exists(desired))) return desired;
  const [base, ext] = splitExt(desired);
  for (let n = 2; n < 10000; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`Could not find unique name for "${desired}"`);
}

/** Rewrite a child path when its ancestor folder is renamed/moved. */
export function rewritePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  if (path === oldPrefix) return newPrefix;
  if (oldPrefix && path.startsWith(`${oldPrefix}/`)) {
    return newPrefix ? newPrefix + path.slice(oldPrefix.length) : path.slice(oldPrefix.length + 1);
  }
  if (!oldPrefix) {
    return newPrefix ? `${newPrefix}/${path}` : path;
  }
  return path;
}
