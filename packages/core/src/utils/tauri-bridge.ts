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

export interface ToolPreset {
  // All fields are optional because the Rust side
  // (`packages/desktop/src-tauri/src/commands/settings.rs`) declares
  // every field with `#[serde(default = …)]` — missing keys round-trip
  // as the type's default value, not as a deserialization error. This
  // matches reality, lets per-tool `presetFields` arrays drive the
  // wire schema (Phase 2 of `docs/plans/toolbar-schema.md`), and lets
  // a Highlight or Redact preset persist without carrying the six
  // historical "always-write" universal fields it doesn't read.
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
  /** Stroke opacity / cap / join — added in Phase 2 of
   *  `docs/plans/toolbar-schema.md` so per-tool presetFields can
   *  persist them without a separate schema change. The Rust struct
   *  doesn't model these yet, so they're silently dropped on disk
   *  via Tauri today; localStorage / chrome.storage do persist them. */
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

export interface SvgshotMetadata {
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

export async function readXmp(filePath: string): Promise<SvgshotMetadata | null> {
  return invoke<SvgshotMetadata | null>("read_xmp", { filePath });
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
 * Unified annotation-shape payload sent to the desktop (Tauri) side
 * for Office clipboard export (`copy_as_office`).
 *
 * The shape taxonomy mirrors the editor's unified object model after
 * Phase 4 refactor:
 *
 *   type="rect"         Rectangle. Use `corner_radius>0` for rounded
 *                       variant. Use `redact_style="solid"` for an
 *                       opaque solid-bar redaction.
 *   type="ellipse"      Ellipse.
 *   type="line" | "arrow"
 *                       Line. Use `arrow_head_start / arrow_head_end`
 *                       to describe heads (the legacy `has_arrow`
 *                       stays equivalent to arrow_head_end=true).
 *   type="text"         Textbox. Use `text_variant` for plain / sticky
 *                       / callout. `tail_x`/`tail_y` set for callout.
 *   type="freehand"     Freehand path. Use `draw_style` for pen vs
 *                       highlighter. `stroke_opacity` carries the
 *                       semi-transparent highlighter alpha.
 *   type="mosaic_image" Mosaic-redaction PNG, embedded via data URL in
 *                       `image_data_url` (legacy: in `text`).
 *   type="blur_image"   Blur-redaction PNG, same shape as mosaic_image.
 *   type="marker"       Counter marker; `marker_shape` + `label`.
 *
 * All new fields are optional so existing Rust handlers keep working;
 * they can adopt the richer metadata incrementally.
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
  stroke_opacity?: number;
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

  // ---- Text variant ----
  text?: string;
  font_size?: number;
  font_family?: string;
  text_variant?: "plain" | "sticky" | "callout";
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
  /** Per-end arrow head shapes (SVG names). Desktop translates these
   *  into OOXML preset types on the way out (triangle→triangle,
   *  triangle-open→stealth, oval→oval, diamond→diamond, tbar→stealth
   *  w/ sm len, reverse→arrow reverse). */
  arrow_shape_start?: "none" | "arrow" | "triangle" | "stealth" | "diamond" | "oval";
  arrow_shape_end?: "none" | "arrow" | "triangle" | "stealth" | "diamond" | "oval";
  /** Per-dimension arrow widths (perpendicular to stem, OOXML `w`). */
  arrow_width_start?: "sm" | "md" | "lg";
  arrow_width_end?: "sm" | "md" | "lg";
  /** Per-dimension arrow lengths (along stem, OOXML `len`). */
  arrow_length_start?: "sm" | "md" | "lg";
  arrow_length_end?: "sm" | "md" | "lg";
  /** Legacy single-size field — written for back-compat when older
   *  Rust handlers still read `arrow_size_*`. Equal to the length
   *  value. */
  arrow_size_start?: "sm" | "md" | "lg";
  arrow_size_end?: "sm" | "md" | "lg";

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

export async function copyAsOffice(
  shapes: AnnotationShape[],
  canvasWidth: number,
  canvasHeight: number,
  screenshotData?: string,
  pngDataUrl?: string,
): Promise<void> {
  return invoke<void>("copy_as_office", {
    shapes,
    canvasWidth,
    canvasHeight,
    screenshotData,
    pngDataUrl,
  });
}

export { isTauri };
