/**
 * `@ingcreators/annot-core/icons` — Tier A icon types + value-level
 * helpers for plugin authors and host code that doesn't want the
 * registry's data graph as a value-level dependency.
 *
 * Phase 1 of `docs/plans/svg-icons-and-plugin-icon-spec.md`. The
 * narrow `BuiltinIconId` literal union and `BUILTIN_ICON_IDS`
 * runtime list are added on top of this barrel by Phase 2 (the
 * registry); existing imports from `@ingcreators/annot-core/icons`
 * keep working unchanged across the upgrade.
 */

export {
  type BuiltinIconId,
  builtinIcon,
  type IconSpec,
  isBuiltinIcon,
  isSvgIcon,
  isUrlIcon,
  svgIcon,
  urlIcon,
} from "./types.js";
