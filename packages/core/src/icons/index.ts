/**
 * `@ingcreators/annot-core/icons` — Tier-A icon types + value-level
 * helpers + the narrow `BuiltinIconId` union from the Tier-B
 * registry.
 *
 * Plugin authors and host code that need autocomplete on builtin
 * ids import from here. The barrel intentionally pulls in the
 * registry so consumers get a SINGLE narrow `BuiltinIconId` —
 * earlier phases used a broad `string` alias for the type while
 * the registry was being scaffolded; with Phase 2 in, the broad
 * alias from `./types` is shadowed by the narrow one from the
 * registry below.
 */

// Pure types + value-level constructors / guards. The broad
// `BuiltinIconId` alias from this module is intentionally NOT
// re-exported — it's superseded by the narrow union from the
// registry export immediately below.
export {
  builtinIcon,
  type IconSpec,
  isBuiltinIcon,
  isSvgIcon,
  isUrlIcon,
  svgIcon,
  urlIcon,
} from "./types.js";

// Registry-backed narrow union + all-ids list + resolver.
// Adding a new id means editing
// `packages/core/src/editor/icons/registry.ts`; autocomplete +
// compile errors flow to every consumer here automatically.
export {
  BUILTIN_ICON_IDS,
  BUILTIN_ICONS,
  type BuiltinIconId,
  resolveBuiltinIcon,
} from "../editor/icons/registry.js";
