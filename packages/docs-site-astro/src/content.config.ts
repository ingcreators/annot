import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

// Starlight content-collection wiring. Starlight 0.39 ships the
// docsLoader + docsSchema helpers so this file is the
// single-source-of-truth registration for the `docs` collection
// against Astro 6's content layer (the old `src/content/config.ts`
// + glob-based collection is removed in Astro 6).
//
// Phase 1 of `docs/plans/annot-work-astro-unification.md` — the
// only content the loader sees right now is the placeholder
// home page; Phase 2-3 fill out the rest of the routes.
export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema(),
  }),
};
