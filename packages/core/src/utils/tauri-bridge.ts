const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error("Not running in Tauri");
  // Try global Tauri API first (withGlobalTauri: true), then dynamic import
  const internals = (window as any).__TAURI_INTERNALS__;
  if (internals?.invoke) {
    return internals.invoke(cmd, args) as Promise<T>;
  }
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

// --- Portable directory ---
//
// Phase 5 of `docs/plans/_done/desktop-storage-provider-migration.md`
// dropped the SQLite-backed gallery + the
// `saveScreenshot` / `loadScreenshot` / `listProjects` /
// `createProject` / `deleteProject` / `listImages` / `updateImage` /
// `deleteImage` exports that the bespoke gallery used.
// `getPortableDir` survived because the renderer still resolves
// `<portable_dir>/data/incoming/` for the extension-capture sweep
// and `<portable_dir>/data/annot.db` for the one-time legacy-data
// notice.

export async function getPortableDir(): Promise<string> {
  return invoke<string>("get_portable_dir");
}

// --- Tool Presets ---

/**
 * Documentation type for the on-disk tool-preset shape. The Rust
 * side (`packages/desktop/src-tauri/src/commands/settings.rs`)
 * persists each tool's preset as an opaque YAML mapping, so any
 * key the JS toolbar emits round-trips through Rust unchanged. The
 * canonical schema — which keys belong to which tool — lives in
 * `packages/core/src/editor/tool-registry.ts` (`presetFields`
 * arrays per tool) and `packages/core/src/editor/tool-preset-serde.ts`
 * (`FIELD_TO_SNAKE` table). The fields enumerated here are the
 * union of what every tool's `presetFields` resolves to today,
 * pinned for IDE autocomplete + cross-language schema discoverability.
 *
 * History: this interface used to declare a NARROWER schema mirroring
 * a Rust struct that named only six fields with `#[serde(default = …)]`
 * — but the Rust struct silently dropped all other fields on save,
 * orphaning every variant discriminator (shape_type / arrow_head /
 * shape_kind / draw_style / redact_style / marker_shape /
 * highlight_color), the per-end arrow shape / width / length, and
 * stroke opacity / cap / join. The Rust struct is now schema-
 * transparent (`HashMap<String, serde_yaml::Value>`) so all keys
 * round-trip; the TS interface has been re-aligned to enumerate the
 * full set toolbar.ts emits, matching reality.
 */
export interface ToolPreset {
  stroke_color?: string;
  fill_color?: string;
  stroke_width?: number;
  font_size?: number;
  stroke_dasharray?: string;
  fill_opacity?: number;
  /** Subtype for the unified Shape tool (rect / rounded / ellipse). */
  shape_type?: string;
  /** Head variant for the unified Line/Arrow tool (none / end / both). */
  arrow_head?: string;
  /** Shape kind for text-bearing shapes (plain / sticky / callout). */
  shape_kind?: string;
  /** Font family CSS value for the Text tool. */
  font_family?: string;
  /** Style for the unified Draw tool (pen / highlighter). */
  draw_style?: string;
  /** Style for the unified Redact tool (mosaic / solid / blur). */
  redact_style?: string;
  /** Default arrow shapes (per end) — matches OOXML preset types. */
  arrow_head_start?: string;
  arrow_head_end?: string;
  /** Default arrow width / length (per end) — sm / md / lg. */
  arrow_width_start?: string;
  arrow_width_end?: string;
  arrow_length_start?: string;
  arrow_length_end?: string;
  /** Selected highlighter color for the Highlight tool. */
  highlight_color?: string;
  /** Shape for the Counter (Marker) tool — circle / rect / rounded. */
  marker_shape?: string;
  /** Stroke opacity / cap / join. */
  stroke_opacity?: number;
  stroke_linecap?: string;
  stroke_linejoin?: string;
}

export interface ToolPresets {
  /** Preset map. Keys are element keys ("shape.rect", "arrow.end")
   *  for tools with variants, or bare tool IDs ("crop", "highlight")
   *  for tools without variants. Legacy files (pre–per-variant
   *  refactor) may have bare tool IDs like "shape" / "arrow" — the
   *  loader migrates these to the tool's default variant on read. */
  tools: Record<string, ToolPreset>;
  /** Last-used variant per tool. Used to pick which variant's preset
   *  to activate when the user re-selects the tool. Optional — falls
   *  back to TOOL_VARIANTS[toolId].fallback when absent. */
  last_variants?: Record<string, string>;
}

// --- XMP (re-editable image save/load) ---

export interface AnnotMetadata {
  original_image_b64: string;
  annotations_svg: string;
  width: number;
  height: number;
}

export async function saveWithXmp(
  renderedImageB64: string,
  originalImageB64: string,
  annotationsSvg: string,
  width: number,
  height: number,
  filePath: string,
): Promise<void> {
  return invoke<void>("save_with_xmp", {
    renderedImageB64,
    originalImageB64,
    annotationsSvg,
    width,
    height,
    filePath,
  });
}

export async function readXmp(filePath: string): Promise<AnnotMetadata | null> {
  return invoke<AnnotMetadata | null>("read_xmp", { filePath });
}

export async function loadToolPresets(): Promise<ToolPresets> {
  return invoke<ToolPresets>("load_tool_presets");
}

export async function saveToolPresets(presets: ToolPresets): Promise<void> {
  return invoke<void>("save_tool_presets", { presets });
}

// --- Screen capture ---

export interface CaptureResult {
  data_url: string;
  width: number;
  height: number;
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  class: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function captureScreen(): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_screen");
}

export async function listWindows(): Promise<WindowInfo[]> {
  return invoke<WindowInfo[]>("list_windows");
}

export async function captureWindow(hwnd: number): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_window", { hwnd });
}

export async function captureRegion(
  x: number,
  y: number,
  width: number,
  height: number,
): Promise<CaptureResult> {
  return invoke<CaptureResult>("capture_region", { x, y, width, height });
}

// --- Clipboard ---

/**
 * Unified annotation-shape payload — the input to the shared OOXML
 * DrawingML builder in `@ingcreators/annot-render`. Used by both
 * the PPTX export path
 * (`packages/editor/src/pptx-export.ts`, `ns: "p"`) and the
 * Office-clipboard path
 * (`packages/web/src/editor/toolbar.ts:#copyForOffice`, `ns: "a"`).
 *
 * The Rust crate (`packages/desktop/src-tauri/src/commands/clipboard.rs`)
 * no longer mirrors this struct field-for-field — since
 * [`office-paste-shared-drawing-builder` phase 3](../../../../docs/plans/_done/office-paste-shared-drawing-builder.md)
 * the per-shape OOXML is built TS-side and passed to Rust as a
 * pre-assembled drawing XML string. The shape taxonomy below is
 * what `svgElementToAnnotationShape` produces:
 *
 *   type="rect"         Rectangle. Use `corner_radius>0` for rounded
 *                       variant. Use `redact_style="solid"` for an
 *                       opaque solid-bar redaction (no outline).
 *   type="ellipse"      Ellipse.
 *   type="line" | "arrow"
 *                       Line. Use `arrow_shape_start / arrow_shape_end`
 *                       to describe heads (`"none"` or undefined for
 *                       no head; `"triangle"` / `"arrow"` / `"stealth"`
 *                       / `"diamond"` / `"oval"` for the OOXML preset
 *                       head shapes).
 *   type="text"         Text-bearing shape. `shape_kind` is the
 *                       discriminator — auto-bg variants (`plain`
 *                       / `sticky` / `callout`) plus the text-on-
 *                       shape kinds (`rect` / `rounded` /
 *                       `ellipse`, see `isTextOnShape`).
 *                       `runs[]` holds the per-run
 *                       text content + per-character formatting
 *                       (bold / italic / underline / mixed font /
 *                       size / color); for a uniformly-styled
 *                       textbox `runs` collapses to one entry per
 *                       line with no formatting flags.
 *                       `text_bg_color` carries the bg fill;
 *                       `tail_x` / `tail_y` set for callout (the
 *                       OOXML emit then uses `wedgeRoundRectCallout`).
 *   type="freehand"     Freehand path. The SVG path d-string rides
 *                       on `path_d`. Use `draw_style` for pen vs
 *                       highlighter; `stroke_opacity_value` carries
 *                       the semi-transparent highlighter alpha.
 *   type="mosaic_image" Mosaic-redaction PNG, embedded via data URL
 *                       in `image_data_url`.
 *   type="blur_image"   Blur-redaction PNG, same shape as mosaic_image.
 *   type="marker"       Counter marker; `marker_shape` + `label`.
 */
/** A single styled text run inside a text-bearing shape.
 *
 * On disk each run corresponds to one `<tspan>` child of the
 * shape's `<text>` element. Transitions in any of the formatting
 * fields split the source text into separate runs; runs adjacent
 * within the same paragraph share an `<a:p>` on the OOXML side,
 * while `line_break_after === true` ends the paragraph and starts
 * a new `<a:p>` for the following run.
 *
 * Per-run formatting is OPTIONAL — when omitted, the run inherits
 * the shape-level defaults (`font_size` / `font_family` / `fill`
 * on the parent `AnnotationShape`). A uniformly-styled textbox
 * therefore collapses to one run per line with only `text` +
 * `line_break_after` populated.
 */
export interface TextRun {
  /** Plain text content of this run. Newlines are NOT permitted —
   *  use `line_break_after` to end a paragraph. */
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Per-run font size override (px). Omit to inherit the shape-
   *  level `font_size`. */
  font_size?: number;
  /** Per-run font family override. */
  font_family?: string;
  /** Per-run text color (`#rrggbb`). Omit to inherit the shape-
   *  level `fill`. */
  color?: string;
  /** When true, ends the current paragraph after this run. The
   *  next run starts in a fresh `<a:p>` on the OOXML side. */
  line_break_after?: boolean;
}

export interface AnnotationShape {
  type: string;
  // ---- Geometry ----
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;

  // ---- Stroke / fill ----
  stroke?: string;
  stroke_width?: number;
  stroke_dasharray?: string;
  fill?: string;
  fill_opacity?: number;

  // ---- Rectangle variant ----
  /** Corner radius. 0 (or omitted) = sharp; >0 = rounded rectangle. */
  corner_radius?: number;

  // ---- Line variant ----
  /** Quadratic-Bezier control-point coordinates for a curved
   *  arrow, in the same canvas space as `x1/y1/x2/y2`. Both
   *  populated together; either being absent renders the arrow
   *  as a straight `<a:prstGeom prst="line">` connector. When
   *  populated the shared builder swaps to `<a:custGeom>` with a
   *  `<a:moveTo>` + `<a:quadBezTo>` path so the curve survives
   *  the paste. */
  arrow_curve_cx?: number;
  arrow_curve_cy?: number;

  // ---- Text variant ----
  /** One entry per `<tspan>` in the source SVG. Style transitions
   *  split runs; uniformly-styled text collapses to one entry per
   *  line with no formatting flags. The OOXML emit walks this
   *  array, opening a new `<a:p>` after each run with
   *  `line_break_after === true`, otherwise emitting the run as
   *  one `<a:r>` inside the current paragraph. */
  runs?: TextRun[];
  font_size?: number;
  font_family?: string;
  /** Discriminator for text-bearing shapes. Phase 1 supports the
   *  three text-variant values; Phase 3 adds `rect` / `rounded` /
   *  `ellipse` for text-on-shape. */
  shape_kind?: "plain" | "sticky" | "callout" | "rect" | "rounded" | "ellipse";
  /** Sticky / callout background color, in CSS `rgba(...)` or `#rrggbb`
   *  form. Populated for `shape_kind === "sticky" | "callout"`;
   *  omitted for plain text. */
  text_bg_color?: string;
  /** Horizontal alignment of the run block within the shape. Mirrors
   *  the wrapper's `data-text-anchor` attribute and flows through to
   *  OOXML as `<a:pPr algn="…">` per paragraph. Omitted = no
   *  per-paragraph alignment override (PowerPoint inherits from the
   *  paragraph default, i.e. left). */
  text_anchor?: "start" | "middle" | "end";
  /** Vertical alignment of the run block within the shape. Mirrors
   *  the wrapper's `data-text-vanchor` attribute and flows through
   *  to OOXML as `<a:bodyPr anchor="…">`. Omitted = top. */
  text_vertical_anchor?: "top" | "middle" | "bottom";
  /** Callout tail-tip coordinates (canvas space). */
  tail_x?: number;
  tail_y?: number;

  // ---- Freehand / Path variant ----
  /** SVG path d-string for freehand strokes. */
  path_d?: string;
  draw_style?: "pen" | "highlighter";

  // ---- Redact variants ----
  /** Discriminator for redactions. A type="rect" + redact_style="solid"
   *  means an opaque color bar; type="mosaic_image" / "blur_image"
   *  carry baked-in PNGs. */
  redact_style?: "solid" | "mosaic" | "blur";
  /** PNG data URL for mosaic / blur redactions (self-contained). */
  image_data_url?: string;

  // ---- Marker (counter) ----
  label?: string;
  /** Counter background shape. `rounded` is a newer variant — older
   *  Rust-side consumers that only know `circle`/`rect` will treat
   *  unknown values as circle (graceful degradation). */
  marker_shape?: "circle" | "rect" | "rounded";

  // ---- Transform (rotation / flip) ----
  /** Rotation in degrees, CW positive, around the shape's bbox center.
   *  Omitted (or 0) means no rotation. */
  rotation_deg?: number;
  /** Mirrored along the horizontal axis (left/right swap). */
  flip_h?: boolean;
  /** Mirrored along the vertical axis (top/bottom swap). */
  flip_v?: boolean;

  // ---- Line polish (PowerPoint-equivalent arrow + cap/join + opacity) ----
  /** Per-end arrow head shapes — matching OOXML's six preset types
   *  one-to-one. */
  arrow_shape_start?: "none" | "arrow" | "triangle" | "stealth" | "diamond" | "oval";
  arrow_shape_end?: "none" | "arrow" | "triangle" | "stealth" | "diamond" | "oval";
  /** Per-dimension arrow widths (perpendicular to stem, OOXML `w`). */
  arrow_width_start?: "sm" | "md" | "lg";
  arrow_width_end?: "sm" | "md" | "lg";
  /** Per-dimension arrow lengths (along stem, OOXML `len`). */
  arrow_length_start?: "sm" | "md" | "lg";
  arrow_length_end?: "sm" | "md" | "lg";

  /** Stroke opacity (0..1). Emitted as `<a:alpha val="..."/>` inside
   *  the stroke's solidFill. */
  stroke_opacity_value?: number;

  /** SVG stroke-linecap. Translates to OOXML `<a:ln cap="rnd|sq|flat"/>`. */
  stroke_linecap?: "butt" | "round" | "square";
  /** SVG stroke-linejoin. Translates to `<a:miter/>|<a:round/>|<a:bevel/>`. */
  stroke_linejoin?: "miter" | "round" | "bevel";

  // ---- Gradient paint (linear only, 2+ stops) ----
  /** Serialized stroke gradient (JSON). Consumer translates into
   *  OOXML `<a:gradFill>` inside `<a:ln>`. */
  stroke_gradient?: {
    angle: number;
    stops: Array<{ color: string; offset: number; opacity?: number }>;
  };
  /** Serialized fill gradient. */
  fill_gradient?: {
    angle: number;
    stops: Array<{ color: string; offset: number; opacity?: number }>;
  };
}

/** One mosaic / blur image embedded into the GVML clipboard
 *  package. The caller (TS-side `buildDrawingXml` consumer)
 *  passes pre-decoded bytes; the Rust packager writes them at
 *  `clipboard/media/{filename}` and binds them via the
 *  matching rId in the drawing rels. */
export interface MosaicMediaPayload {
  filename: string;
  /** Raw image bytes (PNG / JPEG). Tauri JSON-serializes this
   *  as an array of numbers — fine for the typical mosaic
   *  payload size (a few KB per patch). */
  bytes: Uint8Array;
}

/**
 * Office-clipboard copy. Since
 * [`office-paste-shared-drawing-builder` phase 3](../../../../../docs/plans/office-paste-shared-drawing-builder.md)
 * the per-shape OOXML is built on the TS side via
 * `@ingcreators/annot-render`'s `buildDrawingXml`; this IPC
 * boundary just hands the assembled drawing XML + media list
 * to Rust for ZIP packaging + Win32 clipboard write.
 */
export async function copyAsOffice(
  drawingXml: string,
  mosaicMedia: MosaicMediaPayload[],
  screenshotData?: string,
  pngDataUrl?: string,
): Promise<void> {
  return invoke<void>("copy_as_office", {
    drawingXml,
    mosaicMedia: mosaicMedia.map((m) => ({
      filename: m.filename,
      bytes: Array.from(m.bytes),
    })),
    screenshotData,
    pngDataUrl,
  });
}

export { isTauri };
