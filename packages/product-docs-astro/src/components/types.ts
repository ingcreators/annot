// Shared types for the Astro components.
//
// Phase 2 PR 3 of `docs/plans/living-product-docs.md`. Each
// `.astro` component re-declares its own `Props` interface
// inline (Astro requires that), but the structural types like
// `Match` / `TransitionEntry` / `ScreenListEntry` / `GraphEdge`
// live here so:
//
//   - The integration's `astro:config:setup` walker (Phase 4)
//     can produce typed entries to pass into `<ScreenList>` /
//     `<TransitionGraph>` props.
//   - The vitest snapshot tests in `components.test.ts` import
//     them to drive the renderers.
//   - Downstream JSX/Vue adapters reuse the same shapes.

import type { MatchKey } from "@ingcreators/annot-product-docs";

export type Match = MatchKey;

export type OverlayIntent =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "neutral"
  | "required"
  | "action";

export interface TransitionEntry {
  trigger: string;
  on?: string;
  to?: string;
  body?: string;
}

export interface ScreenListEntry {
  id: string;
  title?: string;
  href?: string;
  order?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export type GraphDirection = "TB" | "LR" | "BT" | "RL";
