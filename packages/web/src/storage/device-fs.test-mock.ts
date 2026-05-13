/**
 * In-memory implementation of the File System Access (FSA) API, just
 * rich enough to let {@link DeviceStore} round-trip every operation
 * the contract exercises.
 *
 * No standard polyfill exists for the FSA API — it's a browser-only,
 * user-gesture-gated surface (`window.showDirectoryPicker()` returns
 * a `FileSystemDirectoryHandle`). For unit testing we need to hand
 * the store something handle-shaped that behaves like a real
 * directory, backed by a plain in-memory tree.
 *
 * What's implemented:
 *
 *   FileSystemDirectoryHandle
 *     - `name`, `kind: "directory"`
 *     - `getFileHandle(name, { create? })`
 *     - `getDirectoryHandle(name, { create? })`
 *     - `removeEntry(name, { recursive? })`
 *     - `entries()` / `values()` / `keys()` / async-iterator protocol
 *
 *   FileSystemFileHandle
 *     - `name`, `kind: "file"`
 *     - `getFile()` returning a real `File`
 *     - `createWritable()` — truncates to 0 bytes immediately (this
 *       matches browsers and is load-bearing for DeviceStore's
 *       `#purgeEmptyFiles` crash-recovery heuristic).
 *
 *   FileSystemWritableFileStream
 *     - `write(data)` buffers the chunk (accepts string, BufferSource,
 *       Blob).
 *     - `close()` flushes the buffered chunks into the backing file.
 *     - `abort()` discards buffered chunks without flushing.
 *
 * Explicitly out of scope: seek / truncate on the writer, quota
 * errors, permission prompts (`queryPermission` / `requestPermission`),
 * and any of the `same-origin` boilerplate — DeviceStore doesn't call
 * into those from the paths the contract covers.
 *
 * The handles are shaped as native-looking classes (not plain
 * objects) so `instanceof` checks in production code work if the
 * test ever wanders into one.
 */

class MockWritable implements FileSystemWritableFileStream {
  #file: MockFileHandle;
  #chunks: Uint8Array[] = [];
  #closed = false;

  constructor(file: MockFileHandle) {
    this.#file = file;
    // Per FSA spec: the stream being open means the file is already
    // truncated to 0. DeviceStore's `#purgeEmptyFiles` relies on
    // this — a crashed write leaves a 0-byte file on disk.
    this.#file._setBytes(new Uint8Array(0));
  }

  async write(data: FileSystemWriteChunkType): Promise<void> {
    if (this.#closed) throw new TypeError("stream closed");
    let chunk: Uint8Array;
    if (typeof data === "string") {
      chunk = new TextEncoder().encode(data);
    } else if (data instanceof Blob) {
      chunk = new Uint8Array(await data.arrayBuffer());
    } else if (ArrayBuffer.isView(data)) {
      // Copy the underlying bytes — the caller is free to reuse the
      // ArrayBuffer afterwards.
      chunk = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
    } else if (data instanceof ArrayBuffer) {
      chunk = new Uint8Array(data.slice(0));
    } else if (data && typeof data === "object" && "type" in data) {
      // { type: "write", data, ... } FileSystemWriteParams shape.
      const params = data as { type: string; data?: FileSystemWriteChunkType };
      if (params.type === "write" && params.data !== undefined) {
        return this.write(params.data);
      }
      throw new TypeError(`unsupported write-params type: ${params.type}`);
    } else {
      throw new TypeError("unsupported write chunk type");
    }
    this.#chunks.push(chunk);
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const total = this.#chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of this.#chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    this.#file._setBytes(out);
  }

  async abort(): Promise<void> {
    this.#closed = true;
    this.#chunks = [];
    // Note: the file stays at the 0-byte state set in the constructor,
    // matching real browser behaviour.
  }

  async seek(_position: number): Promise<void> {
    throw new Error("seek() not supported in test mock");
  }

  async truncate(_size: number): Promise<void> {
    throw new Error("truncate() not supported in test mock");
  }

  // WritableStream-inherited surface we don't actually need; give
  // them stubs so the type check is happy.
  get locked(): boolean {
    return false;
  }

  getWriter(): WritableStreamDefaultWriter<FileSystemWriteChunkType> {
    throw new Error("getWriter() not supported in test mock");
  }
}

export class MockFileHandle implements FileSystemFileHandle {
  readonly kind = "file" as const;
  readonly name: string;
  #bytes: Uint8Array = new Uint8Array(0);
  /**
   * Stable per-file modification timestamp. Real `File.lastModified`
   * is the value at the time the file was last written; without
   * pinning it here every `getFile()` would invoke `new File()`
   * with no `lastModified` and the constructor would default to
   * `Date.now()` — so two consecutive reads would see different
   * timestamps. DeviceStore's metadata cache uses mtime as the
   * version string; tests would always cache-miss without a
   * stable value.
   *
   * Bumped via `_setBytes` from `MockWritable.close()` so a write
   * advances the timestamp by 1 ms (FSA real-world semantics).
   */
  #lastModified = Date.now();
  /** Monotonic per-file tiebreaker so two writes inside one ms
   *  still produce strictly-increasing timestamps. */
  static #counter = 0;

  constructor(name: string) {
    this.name = name;
  }

  async getFile(): Promise<File> {
    return new File([this.#bytes as BlobPart], this.name, {
      lastModified: this.#lastModified,
    });
  }

  async createWritable(
    _options?: FileSystemCreateWritableOptions,
  ): Promise<FileSystemWritableFileStream> {
    return new MockWritable(this);
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle);
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }

  async createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle> {
    // Worker-only API; DeviceStore never calls it. Present just to
    // satisfy the `FileSystemFileHandle` structural check.
    throw new Error("createSyncAccessHandle() not supported in test mock");
  }

  // Internal access for MockWritable + tests.
  _setBytes(bytes: Uint8Array): void {
    this.#bytes = bytes;
    // Bump the modification timestamp so version-based cache
    // invalidation in callers (DeviceStore × MetadataCache) sees a
    // fresh version per write. Counter keeps strictly-monotone
    // ordering across writes that happen inside the same
    // millisecond.
    MockFileHandle.#counter += 1;
    this.#lastModified = Date.now() + MockFileHandle.#counter;
  }
  _getBytes(): Uint8Array {
    return this.#bytes;
  }
}

type Entry = MockFileHandle | MockDirectoryHandle;

export class MockDirectoryHandle implements FileSystemDirectoryHandle {
  readonly kind = "directory" as const;
  readonly name: string;
  #entries = new Map<string, Entry>();

  constructor(name: string) {
    this.name = name;
  }

  async getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle> {
    const existing = this.#entries.get(name);
    if (existing) {
      if (existing.kind === "file") return existing;
      throw new DOMException(`${name} is a directory`, "TypeMismatchError");
    }
    if (!options?.create) {
      throw new DOMException(`File not found: ${name}`, "NotFoundError");
    }
    const file = new MockFileHandle(name);
    this.#entries.set(name, file);
    return file;
  }

  async getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle> {
    const existing = this.#entries.get(name);
    if (existing) {
      if (existing.kind === "directory") return existing;
      throw new DOMException(`${name} is a file`, "TypeMismatchError");
    }
    if (!options?.create) {
      throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
    }
    const dir = new MockDirectoryHandle(name);
    this.#entries.set(name, dir);
    return dir;
  }

  async removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void> {
    const existing = this.#entries.get(name);
    if (!existing) {
      throw new DOMException(`Entry not found: ${name}`, "NotFoundError");
    }
    if (existing.kind === "directory" && !options?.recursive) {
      // Mirror spec: non-recursive removeEntry throws if the dir
      // isn't empty. DeviceStore always passes `recursive: true` for
      // folder deletes, so this branch only catches accidents.
      const keys = await (async () => {
        const first = (await existing.keys().next()).value;
        return first;
      })();
      if (keys !== undefined) {
        throw new DOMException(`Directory not empty: ${name}`, "InvalidModificationError");
      }
    }
    this.#entries.delete(name);
  }

  async resolve(_possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    // Not used by DeviceStore; keep a minimal stub so the type check
    // passes when someone hands an instance to an API that expects
    // the full interface.
    return null;
  }

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other === (this as unknown as FileSystemHandle);
  }

  async queryPermission(): Promise<PermissionState> {
    return "granted";
  }

  async requestPermission(): Promise<PermissionState> {
    return "granted";
  }

  // ---- Async iteration: entries / keys / values + default ----
  //
  // TS's `FileSystemDirectoryHandle` async iterators are typed with
  // the `FileSystemFileHandle | FileSystemDirectoryHandle` discriminated
  // union rather than the base `FileSystemHandle`. The cast below is
  // safe because `Entry` is exactly that union in our mock.

  entries(): FileSystemDirectoryHandleAsyncIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  > {
    return this.#makeAsyncIterator(
      () => this.#entries.entries(),
      ([k, v]) => [k, v as unknown as FileSystemDirectoryHandle | FileSystemFileHandle],
    );
  }

  keys(): FileSystemDirectoryHandleAsyncIterator<string> {
    return this.#makeAsyncIterator<string>(
      () => this.#entries.keys(),
      (k) => k,
    );
  }

  values(): FileSystemDirectoryHandleAsyncIterator<
    FileSystemDirectoryHandle | FileSystemFileHandle
  > {
    return this.#makeAsyncIterator(
      () => this.#entries.values(),
      (v) => v as unknown as FileSystemDirectoryHandle | FileSystemFileHandle,
    );
  }

  [Symbol.asyncIterator](): FileSystemDirectoryHandleAsyncIterator<
    [string, FileSystemDirectoryHandle | FileSystemFileHandle]
  > {
    return this.entries();
  }

  #makeAsyncIterator<T>(
    source: () => IterableIterator<unknown>,
    map: (item: any) => T,
  ): FileSystemDirectoryHandleAsyncIterator<T> {
    const iter = source();
    // Bag shape matches the global FileSystemDirectoryHandleAsyncIterator
    // (including `[Symbol.asyncDispose]`, added for Explicit Resource
    // Management in newer lib.dom.d.ts versions). The `this` self-
    // reference in `[Symbol.asyncIterator]` would normally narrow to
    // the plain `AsyncIterableIterator<T>` the inline object literal
    // widens to; the `as FileSystemDirectoryHandleAsyncIterator<T>`
    // cast at the end pins the type back down so callers in
    // contract tests see the dispose-bearing shape the FSA spec
    // promises.
    const asyncIter = {
      async next() {
        const { value, done } = iter.next();
        if (done) return { value: undefined as unknown as T, done: true };
        return { value: map(value), done: false };
      },
      async return(value?: T) {
        return { value: value as T, done: true };
      },
      async [Symbol.asyncDispose]() {
        /* nothing to release */
      },
      [Symbol.asyncIterator]() {
        return asyncIter;
      },
    };
    return asyncIter as FileSystemDirectoryHandleAsyncIterator<T>;
  }
}

// Use the global `FileSystemDirectoryHandleAsyncIterator<T>` from
// `lib.dom.d.ts`. Older TS versions shadowed it with a local alias
// here to survive under `skipLibCheck: true`; the project's TS 6
// toolchain now has the global type with the
// `[Symbol.asyncDispose]` requirement (Explicit Resource
// Management, ES2026), so the shadow is gone and the mock matches
// the global shape directly.

/** Factory used by tests: fresh root directory per call. */
export function createMockRoot(name = "annot-test-root"): MockDirectoryHandle {
  return new MockDirectoryHandle(name);
}
