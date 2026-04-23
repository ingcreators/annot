# Path-based Storage Refactor

> **Status:** Queued. Prerequisite for `GitHubStore` and Playwright /
> headless integration (numeric IDs don't map to git SHAs or to
> `locator()` references; paths do). Raising priority once element-
> snap integration lands.
>
> **Compatibility:** PWA / extension only. Brings the storage layer
> in line with `PRODUCT_DIRECTION.md` principles P4 (stable
> `StorageProvider`) and P5 (additive `PageMetadata`).
>
> **Risk:** Single-landing refactor (all phases must merge together
> because the core type change breaks every downstream package). IDB
> data is dropped on DB version bump — acceptable since the project
> is pre-GA.

## Context

現在のストレージ層は全ストレージ実装（LocalStore/IDB、FileSystemStore、GoogleDriveStore、Extension IDB）で数値ID（auto-increment）を使って画像・フォルダを識別しています。しかしFileSystemStoreとGoogleDriveStoreでは内部的にパス↔ID/Drive IDのマッピングを維持しており、数値IDは「ファサード」に過ぎません。また、Extension経由のFileSystem操作（`extensionFsStorage`）でも同様のマッピングが存在します。

ユーザーの要望は、**ファイルシステムの構造に合わせてフォルダパスとファイル名で管理する**こと。これによりファサード層が不要となり、URL・UI・ストレージが一貫してパスベースの識別子を使うため、実装がシンプルになり、ファイルシステムへのマッピングが自然になります。

**重要**: 現時点ではまだ開発中のため、既存のIDBデータは破棄してOKとします（DB version bumpで対応）。

## New Design

### Types (`packages/core/src/storage/types.ts`)
```typescript
export interface ImageRecord {
  path: string;              // Primary key: "Screenshots/Mobile/image-123.png" (root = "image.png")
  folderPath: string;        // Derived from path; stored for IDB indexing
  originalDataUrl: string;
  thumbnailDataUrl: string;
  annotationsSvg: string;
  width: number;
  height: number;
  sourceUrl: string;
  tags: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface FolderRecord {
  path: string;              // Primary key: "Screenshots/Mobile"
  parentPath: string;        // Derived; for IDB indexing
  name: string;              // Last segment: "Mobile"
  createdAt: string;
}

export interface StorageProvider {
  saveImage(data: Omit<ImageRecord, "path"> & { filename?: string }): Promise<string>;
  getImage(path: string): Promise<ImageRecord | undefined>;
  listImages(folderPath: string): Promise<ImageRecord[]>;
  updateImage(path: string, updates: ImageRecordUpdate): Promise<string>; // returns new path if moved
  deleteImage(path: string): Promise<void>;

  createFolder(parentPath: string, name: string): Promise<string>;
  listFolders(parentPath: string): Promise<FolderRecord[]>;
  getFolder(path: string): Promise<FolderRecord | undefined>;
  renameFolder(path: string, newName: string): Promise<string>;
  moveFolder(path: string, newParentPath: string): Promise<string>;
  deleteFolder(path: string): Promise<void>;
  getBreadcrumb(path: string): Promise<FolderRecord[]>;

  generateThumbnail(dataUrl: string, maxWidth?: number): Promise<string>;
  resync?(): Promise<void>;
}
```

### Conventions
- **Root path** = `""` (空文字列)。`null` や `/` は使わない。
- **パス区切り** = `/` (POSIX)。先頭/末尾の `/` なし。`.` / `..` は禁止。
- **名前検証**: `[<>:"/\|?*\x00-\x1f]` を含む名前は拒否。

### Filename uniqueness
- `saveImage({ filename })` でその名前がフォルダ内に既に存在する場合、自動的に `image (2).png`, `image (3).png` のようにサフィックスを付与。戻り値は実際に割り当てられたパス。
- `filename` 省略時は `image-<timestamp>.<ext>` を使用。
- `createFolder(parentPath, name)` で既存のフォルダと衝突する場合はエラーをスロー（ユーザーに意図を表示する）。
- `renameFolder` / `moveFolder` も衝突時エラー。

### Router URLs
**Query parameter方式**を採用: `/edit/browser?p=Screenshots/Mobile/image-123.png`
- 理由: パスセグメントに `/` を含むため、path param にすると `%2F` エンコードが必要で、一部のサーバ/ブラウザで問題が起きやすい。クエリパラメータなら `/` をそのまま使える。
- Extension: `?extId=xxx&p=<path>`

Route shape:
```typescript
export interface Route {
  type: "gallery" | "edit";
  store?: string;
  extId?: string;
  path?: string;
}
```
旧 `editFile` バリアントは削除（全ての画像がパスで識別可能になるため）。

### Path utilities (`packages/core/src/storage/path.ts` — NEW)
- `ROOT_PATH = ""` 定数
- `joinPath(parent, name)`, `getParentPath(path)`, `getFilename(path)`
- `splitPath(path)`, `ancestorPaths(path)`
- `validateName(name)` — 不正文字・予約名チェック
- `uniquifyFilename(desired, existsFn)` — サフィックス付与

### GoogleDriveStore の path↔Drive-ID マッピング
Drive は ID ネイティブ（フォルダに安定したIDがあり、リネーム/移動してもID保持、同名の兄弟を許容）なので、パスファーストのAPIを外に出すために内部でマッピングを維持:
- `pathToDriveFolderId: Map<string, string>` と `driveFolderIdToPath: Map<string, string>` を双方向維持（遅延populated、ルートから走査）
- ファイルも同様: `pathToDriveFileId: Map<string, string>`
- **同名兄弟**: 最初にリストされた方がそのパス名を取り、2番目は ` (2)` をサフィックス（仮想的、Drive側は変更しない）
- **フォルダリネーム/移動**: 子孫のキャッシュパスも全て書き換える
- **外部編集**（ユーザがDrive UIで移動）: `resync()` でマップを破棄して再構築
- Drive IDs はクラス外に漏らさない

## Phased Plan

> すべてのフェーズは**一度にランディング**する必要があります（Phase 1でコアの型を変えるとすべてのダウンストリームがビルド不能になるため）。ただし、レビュー・検証のために以下の順序で進めます。

### Phase 1: Core types + path utilities
- `packages/core/src/storage/path.ts` (NEW) — ユーティリティ関数
- `packages/core/src/storage/types.ts` — 新しい interface に全面置換
- `packages/core/src/index.ts` — `path.ts` をエクスポート

### Phase 2: IDB実装 (LocalStore + Extension idb-store)
- `packages/web-annotation/src/storage/local-store.ts`:
  - DB version `1 → 2`、`onupgradeneeded` で両ストアを drop して再作成
  - `images` store: `keyPath: "path"`、`folderPath` と `createdAt` にインデックス
  - `folders` store: `keyPath: "path"`、`parentPath` にインデックス
  - `saveImage` は `uniquifyFilename` でユニーク名生成
  - `deleteFolder` はプレフィックスマッチで再帰削除
- `packages/browser-extension/src/storage/idb-store.ts`:
  - DB version `3 → 4`、同様の drop & recreate

### Phase 3: Extension messaging
- `packages/browser-extension/src/background/service-worker.ts`:
  - `onMessageExternal` ハンドラのシグネチャを `{ action, path, ... }` に変更
  - Capture flow: 保存後のURLを `?p=<path>` 形式で生成
  - `fsRead/fsWrite/fsList/fsMkdir/fsRmdir/fsUpdate/fsDelete` は引き続き `{ folder, filename }` ベースなので変更不要

### Phase 4: Router
- `packages/web-annotation/src/router.ts`:
  - 新 `Route` shape（`editFile` 削除）
  - `parseRoute`: `?p=` から path を取り出し
  - `editUrl(store, path, extId?)`, `galleryUrl(folderPath?)` builders
  - 旧 `editFileUrl` 削除
- See `docs/url-schemes.md` for the target URL shape — this plan is
  the implementation that realizes those routes.

### Phase 5: Bridge + FS Store + Drive Store
- `packages/web-annotation/src/storage/bridge.ts`:
  - `fsFileMap`, `fsFolderMap`, `fsEncodeId`, `fsDecodeId` 系を**全削除**
  - `extensionStorage` メソッドは `path` をそのまま転送
  - `extensionFsStorage`: path を `getParentPath/getFilename` で分解して `fsXxx` メッセージを送る
- `packages/web-annotation/src/storage/fs-store.ts`:
  - 内部マップ（`#folderIdMap` 等）を全削除
  - インデックスを `{ images: Record<path, ...> }` に変更（`nextId` は不要）
  - `listFolders(parentPath)` はファイルシステムを直接ウォーク
  - `renameFolder`/`moveFolder` は copy+delete で実装（FS Access API に rename なし）
- `packages/web-annotation/src/storage/google-drive-store.ts`:
  - 公開APIは全てパス。内部で `pathToDriveFolderId` 等のマップを維持
  - `#resolvePath(path)` プライベートメソッドで親から走査してキャッシュ

### Phase 6: UI (App, FileManager, Sidebar, GalleryPage)
- `packages/web-annotation/src/gallery/gallery-page.ts`: `#currentFolderId: number | null` → `#currentFolderPath: string`
- `packages/web-annotation/src/gallery/file-manager.ts`: 同様にpath化
- `packages/web-annotation/src/gallery/sidebar.ts`: `Set<number>` → `Set<string>`、`#activeFolderId` → `#activeFolderPath`
- `packages/web-annotation/src/app.ts`: `#currentImageId: number | null` → `#currentImagePath: string | null`

### Phase 7: Verification
- `pnpm -r typecheck` で全パッケージpass
- `pnpm -r build` で全パッケージbuild成功
- 手動テストマトリクス（各ストレージモード: Local IDB / Extension IDB / FileSystem直接 / FS via Extension / Google Drive）:
  - 画像キャプチャ → ギャラリー表示
  - フォルダ作成 → サブフォルダ作成 → ネスト確認
  - 画像を別フォルダに移動 → パスが更新される
  - フォルダリネーム → 子孫のパスも追従
  - フォルダ削除 → 子孫が再帰削除
  - 編集画面 → リロード → アノテーションが保持される
  - URLブックマーク → `?p=...` で画像が開ける
  - 同名ファイルの重複保存 → ` (2)` サフィックス確認

## Migration Notes
- **IDB**: 両データベース（web-annotation / browser-extension）のversion bumpで旧データ破棄。
- **`.ingcreators.json`** (FileSystem mode): 形状が変わる（`nextId`削除、パスキー化）。既存ファイルは無視して再スキャンで復元。
- **Google Drive**: Drive側のデータは無変更。アプリ内のマップだけ再構築。
- **旧URLのブックマーク**: `/edit/:store/:id` 形式は404になり、galleryに戻る。受容可能。

## Critical Files
- `packages/core/src/storage/types.ts` — interface定義
- `packages/core/src/storage/path.ts` — NEW utilities
- `packages/web-annotation/src/storage/local-store.ts`
- `packages/web-annotation/src/storage/fs-store.ts`
- `packages/web-annotation/src/storage/google-drive-store.ts`
- `packages/web-annotation/src/storage/bridge.ts`
- `packages/browser-extension/src/storage/idb-store.ts`
- `packages/browser-extension/src/background/service-worker.ts`
- `packages/web-annotation/src/router.ts`
- `packages/web-annotation/src/gallery/gallery-page.ts`
- `packages/web-annotation/src/gallery/file-manager.ts`
- `packages/web-annotation/src/gallery/sidebar.ts`
- `packages/web-annotation/src/app.ts`

## Relationship to future GitHubStore

Once this lands, a `GitHubStore` becomes a straightforward
implementation of the same `StorageProvider` interface:
- `path` maps to a file path inside a repository.
- `folderPath` maps to a directory.
- `listFolders` / `listImages` → `git ls-tree`.
- `saveImage` → commit a new file.
- `updateImage` (with new path) → git rename + commit.
- `deleteFolder` → recursive remove + commit.
- `resync()` → refetch refs / reconcile with remote.

No numeric-ID shim layer, no ID↔path map — it just uses paths, same
as the filesystem and Drive stores will after the refactor.
