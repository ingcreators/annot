/// <reference types="vite/client" />

// Phase 2 of `docs/plans/desktop-storage-provider-migration.md`:
// the desktop now imports the unified gallery from
// `@ingcreators/annot-web`, which transitively pulls in modules
// that read `import.meta.env.VITE_*`. The Vite-side `defineConfig`
// already strips / inlines those at build time; this declaration
// gives the desktop's `tsc --noEmit` pass the same type shape the
// PWA's `env.d.ts` provides so the typechecker doesn't trip on
// the cross-package reference.
//
// The desktop itself does NOT use any of these env vars — they're
// only here for the imported PWA modules' consumers. If the
// desktop ever introduces its own `VITE_*`-driven config, append
// the new keys to `ImportMetaEnv` below.
interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_GOOGLE_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
