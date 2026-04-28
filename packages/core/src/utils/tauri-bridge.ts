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

// --- Screenshots ---

export interface SaveResult {
  id: number;
  path: string;
  thumbnail_path: string;
}

export async function getPortableDir(): Promise<string> {
  return invoke<string>("get_portable_dir");
}

export async function saveScreenshot(
  data: string,
  projectId?: number,
  sourceUrl?: string,
): Promise<SaveResult> {
  const baseDir = await getPortableDir();
  return invoke<SaveResult>("save_screenshot", {
    data,
    projectId: projectId ?? 1,
    sourceUrl: sourceUrl ?? "",
    baseDir: `${baseDir}/images`,
  });
}

export async function loadScreenshot(path: string): Promise<string> {
  return invoke<string>("load_screenshot", { path });
}

// --- Projects ---

export interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  image_count: number;
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export async function createProject(name: string, description?: string): Promise<Project> {
  return invoke<Project>("create_project", { name, description });
}

export async function deleteProject(id: number): Promise<void> {
  return invoke<void>("delete_project", { id });
}

// --- Images ---

export interface ImageInfo {
  id: number;
  project_id: number | null;
  filename: string;
  path: string;
  svg_path: string | null;
  width: number;
  height: number;
  thumbnail_path: string | null;
  tags: string;
  source_url: string;
  notes: string;
  created_at: string;
}

export async function listImages(projectId?: number, search?: string): Promise<ImageInfo[]> {
  return invoke<ImageInfo[]>("list_images", { projectId, search });
}

export async function updateImage(
  id: number,
  updates: {
    tags?: string;
    notes?: string;
    svgPath?: string;
    projectId?: number;
  },
): Promise<void> {
  return invoke<void>("update_image", { id, ...updates });
}

export async function deleteImage(id: number): Promise<void> {
  return invoke<void>("delete_image", { id });
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
 * text_variant / draw_style / redact_style / marker_shape /
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
  /** Variant for the unified Text tool (plain / sticky / callout). */
  text_variant?: string;
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
 *                       Line. Use `arrow_head_start / arrow_head_end`
 *                       to describe heads (the legacy `has_arrow`
 *                       stays equivalent to arrow_head_end=true).
 *   type="text"         Textbox. Use `text_variant` for plain / sticky
 *                       / callout. `text_bg_color` carries the bg
 *                       fill; `tail_x`/`tail_y` set for callout (the
 *                       Rust side then emits `wedgeRoundRectCallout`).
 *   type="freehand"     Freehand path. Use `draw_style` for pen vs
 *                       highlighter. `stroke_opacity_value` carries
 *                       the semi-transparent highlighter alpha.
 *   type="mosaic_image" Mosaic-redaction PNG, embedded via data URL
 *                       in `image_data_url`.
 *   type="blur_image"   Blur-redaction PNG, same shape as mosaic_image.
 *   type="marker"       Counter marker; `marker_shape` + `label`.
 */
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
  /** Legacy: true iff there is any arrow head (maps to arrow_head_end). */
  has_arrow?: boolean;
  arrow_head_start?: boolean;
  arrow_head_end?: boolean;
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
  text?: string;
  font_size?: number;
  font_family?: string;
  text_variant?: "plain" | "sticky" | "callout";
  /** Sticky / callout background color, in CSS `rgba(...)` or `#rrggbb`
   *  form. Populated for `text_variant === "sticky" | "callout"`;
   *  omitted for plain text. */
  text_bg_color?: string;
  /** Callout tail-tip coordinates (canvas space). */
  tail_x?: number;
  tail_y?: number;

  // ---- Freehand / Path variant ----
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
