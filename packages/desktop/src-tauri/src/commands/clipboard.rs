use serde::Deserialize;
use tauri::command;
use std::io::Write;

#[derive(Debug, Default, Deserialize)]
pub struct AnnotationShape {
    #[serde(rename = "type")]
    pub shape_type: String,
    pub x: Option<f64>, pub y: Option<f64>,
    pub width: Option<f64>, pub height: Option<f64>,
    pub stroke: Option<String>, pub stroke_width: Option<f64>, pub fill: Option<String>,
    pub x1: Option<f64>, pub y1: Option<f64>, pub x2: Option<f64>, pub y2: Option<f64>,
    pub has_arrow: Option<bool>,
    pub cx: Option<f64>, pub cy: Option<f64>, pub rx: Option<f64>, pub ry: Option<f64>,
    pub text: Option<String>, pub font_size: Option<f64>, pub label: Option<String>,
    pub fill_opacity: Option<f64>,
    pub stroke_dasharray: Option<String>,
    /// Rotation in degrees (CW positive), pivot = bbox center.
    /// Translated into OOXML's 60,000ths-of-a-degree on the way out.
    pub rotation_deg: Option<f64>,
    /// Mirror flags. For lines/connectors, applied to <a:xfrm> only when
    /// no endpoint-derived flip is already present (otherwise they
    /// cancel out and produce a no-op).
    pub flip_h: Option<bool>,
    pub flip_v: Option<bool>,

    // ---- Line polish ----
    /// SVG arrow-shape names per end — matching OOXML's six preset
    /// types exactly: none / arrow / triangle / stealth / diamond / oval.
    pub arrow_shape_start: Option<String>,
    pub arrow_shape_end: Option<String>,
    /// Per-dimension widths (perpendicular to stem, OOXML `w`).
    pub arrow_width_start: Option<String>,
    pub arrow_width_end: Option<String>,
    /// Per-dimension lengths (along stem, OOXML `len`).
    pub arrow_length_start: Option<String>,
    pub arrow_length_end: Option<String>,

    /// Stroke opacity (0..1). Emitted as `<a:alpha val="..."/>` inside
    /// the stroke's solidFill.
    pub stroke_opacity_value: Option<f64>,

    /// `butt` | `round` | `square` — maps to OOXML `cap="flat|rnd|sq"`.
    pub stroke_linecap: Option<String>,
    /// `miter` | `round` | `bevel` — maps to <a:miter/><a:round/><a:bevel/>.
    pub stroke_linejoin: Option<String>,

    // ---- Gradient paint ----
    pub stroke_gradient: Option<GradientSpec>,
    pub fill_gradient: Option<GradientSpec>,

    // ---- Marker (counter) ----
    /// Counter background shape. `circle` | `rect` | `rounded`. The
    /// canonical discriminator since
    /// [office-paste-abi-modernisation phase 1]; older callers that
    /// only set `stroke` to `"rect"` still dispatch correctly via the
    /// fallback in `gvml_marker`.
    pub marker_shape: Option<String>,

    // ---- Mosaic / blur redact image ----
    /// Self-contained PNG / JPEG data URL for mosaic / blur
    /// redactions. The canonical carrier since
    /// [office-paste-abi-modernisation phase 2]; older callers that
    /// stash the data URL in `text` still parse via the fallback in
    /// `build_drawing_xml`.
    pub image_data_url: Option<String>,

    // ---- Textbox sticky / callout bg ----
    /// Sticky / callout background color (`rgba(...)` or `#rrggbb`).
    /// The canonical carrier since
    /// [office-paste-abi-modernisation phase 3]; older callers that
    /// stash the color in `stroke` still render via the fallback in
    /// `gvml_text`.
    pub text_bg_color: Option<String>,

    // ---- Textbox variant ----
    /// `plain` | `sticky` | `callout`. Distinguishes the three
    /// `type === "text"` shapes; only `callout` cares about tail
    /// coordinates today.
    pub text_variant: Option<String>,
    /// Callout tail-tip coordinates, in the same (canvas) space as
    /// `x` / `y`. Both populated together; either being absent
    /// degrades the shape to a plain rounded textbox.
    pub tail_x: Option<f64>,
    pub tail_y: Option<f64>,

    // ---- Redact discriminator ----
    /// Redaction style: `solid` | `mosaic` | `blur`. `gvml_rect`
    /// branches on this to drop the outline for solid bars (matches
    /// PowerPoint's "rectangle (no outline)" preset). Mosaic / blur
    /// already route through their own emitter via the `type`
    /// discriminator, so this field only matters when paired with
    /// `type === "rect"`.
    pub redact_style: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct GradientSpec {
    pub angle: f64,
    pub stops: Vec<GradientStop>,
}

#[derive(Debug, Deserialize)]
pub struct GradientStop {
    pub color: String,
    pub offset: f64,
    pub opacity: Option<f64>,
}

/// Build the OOXML `<a:headEnd>` or `<a:tailEnd>` element for one end
/// of a line/arrow. The SVG shape set mirrors OOXML's six preset
/// types one-to-one. Width and length are passed through independently
/// (OOXML's native model: `w="sm|med|lg" len="sm|med|lg"`).
fn end_xml(
    which: &str,
    shape: Option<&str>,
    width: Option<&str>,
    length: Option<&str>,
) -> String {
    let shape = match shape { Some(s) if s != "none" => s, _ => return String::new() };
    let ooxml_type = match shape {
        "arrow" => "arrow",
        "triangle" => "triangle",
        "stealth" => "stealth",
        "diamond" => "diamond",
        "oval" => "oval",
        _ => "triangle",
    };
    let map = |s: Option<&str>| match s {
        Some("sm") => "sm",
        Some("lg") => "lg",
        _ => "med",
    };
    format!(r#"<a:{which} type="{ooxml_type}" w="{}" len="{}"/>"#, map(width), map(length))
}

/// Map SVG stroke-linecap values to the OOXML `cap=""` attribute.
fn cap_attr(cap: Option<&str>) -> String {
    match cap {
        Some("butt") => " cap=\"flat\"".into(),
        Some("square") => " cap=\"sq\"".into(),
        Some("round") => " cap=\"rnd\"".into(),
        _ => String::new(),
    }
}

/// Map SVG stroke-linejoin to OOXML child element.
fn join_xml(join: Option<&str>) -> String {
    match join {
        Some("round") => "<a:round/>".into(),
        Some("bevel") => "<a:bevel/>".into(),
        Some("miter") => r#"<a:miter lim="800000"/>"#.into(),
        _ => String::new(),
    }
}

/// Build <a:solidFill> or <a:gradFill> for a stroke paint, honoring
/// stroke_opacity and stroke_gradient.
fn stroke_paint_xml(s: &AnnotationShape, stroke_hex: &str) -> String {
    if let Some(g) = &s.stroke_gradient {
        return grad_fill_xml(g);
    }
    let opacity = s.stroke_opacity_value.unwrap_or(1.0);
    if opacity < 0.999 {
        let alpha = (opacity * 100_000.0).round() as i64;
        format!(r#"<a:solidFill><a:srgbClr val="{stroke_hex}"><a:alpha val="{alpha}"/></a:srgbClr></a:solidFill>"#)
    } else {
        format!(r#"<a:solidFill><a:srgbClr val="{stroke_hex}"/></a:solidFill>"#)
    }
}

fn grad_fill_xml(g: &GradientSpec) -> String {
    let rot_norm = ((g.angle % 360.0) + 360.0) % 360.0;
    let ang = (rot_norm * 60_000.0).round() as i64;
    let gs: String = g.stops.iter().map(|s| {
        let pos = (s.offset.clamp(0.0, 1.0) * 100_000.0).round() as i64;
        let alpha = s.opacity
            .filter(|&o| o < 0.999)
            .map(|o| format!(r#"<a:alpha val="{}"/>"#, (o * 100_000.0).round() as i64))
            .unwrap_or_default();
        format!(r#"<a:gs pos="{pos}"><a:srgbClr val="{}">{alpha}</a:srgbClr></a:gs>"#, chex(&s.color))
    }).collect();
    format!(r#"<a:gradFill flip="none" rotWithShape="1"><a:gsLst>{gs}</a:gsLst><a:lin ang="{ang}" scaled="1"/></a:gradFill>"#)
}

/// Build the rot/flipH/flipV attribute string for an `<a:xfrm>` open
/// tag. Pass `exclude_flip = true` for line/connector shapes whose own
/// endpoint-direction logic already populates flipH/flipV — combining
/// would double-mirror.
fn xfrm_attrs(s: &AnnotationShape, exclude_flip: bool) -> String {
    let mut out = String::new();
    if let Some(deg) = s.rotation_deg {
        if deg != 0.0 {
            let normalized = ((deg % 360.0) + 360.0) % 360.0;
            let rot = (normalized * 60_000.0).round() as i64;
            out.push_str(&format!(r#" rot="{rot}""#));
        }
    }
    if !exclude_flip {
        if s.flip_h.unwrap_or(false) { out.push_str(r#" flipH="1""#); }
        if s.flip_v.unwrap_or(false) { out.push_str(r#" flipV="1""#); }
    }
    out
}

/// Copy annotations as native Office shapes via GVML clipboard format (OPC ZIP)
/// Also sets PNG as fallback for non-Office apps
#[command]
pub async fn copy_as_office(
    shapes: Vec<AnnotationShape>,
    canvas_width: f64,
    canvas_height: f64,
    screenshot_data: Option<String>,
    png_data_url: Option<String>,
) -> Result<(), String> {
    // Convert image to JPEG if it's PNG (smaller size for GVML)
    let image_bytes = screenshot_data.as_deref().and_then(|data| {
        let raw = parse_data_url_bytes(data)?;
        if data.contains("image/png") {
            png_to_jpeg(&raw).ok()
        } else {
            Some(raw)
        }
    });

    // Parse PNG for clipboard fallback
    let png_bytes = png_data_url.as_deref().and_then(parse_data_url_bytes);
    let gvml_zip = build_gvml_zip(&shapes, canvas_width, canvas_height, image_bytes.as_deref())?;

    #[cfg(windows)]
    {
        set_clipboard_all(&gvml_zip, png_bytes.as_deref())?;
    }
    #[cfg(not(windows))]
    {
        return Err("Office clipboard only supported on Windows".into());
    }

    Ok(())
}

const PX_EMU: f64 = 9525.0;
const PT_EMU: f64 = 12700.0;
fn px(v: f64) -> i64 { (v * PX_EMU).round() as i64 }
/// Convert pt to EMU for line width
fn pt(v: f64) -> i64 { (v * PT_EMU).round() as i64 }
fn chex(c: &str) -> String { c.trim_start_matches('#').to_uppercase().chars().take(6).collect() }
fn exml(s: &str) -> String { s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;") }

fn png_to_jpeg(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    crate::jpeg_utils::image_to_progressive_jpeg(png_bytes)
}

fn parse_data_url_bytes(data_url: &str) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pos = data_url.find(',')?;
    STANDARD.decode(&data_url[pos + 1..]).ok()
}

/// Build the GVML drawing XML string and the mosaic media files list.
///
/// The XML half is reachable from a Rust unit test (see
/// `clipboard_test.rs`); the wrapper `build_gvml_zip` keeps the
/// existing public entry point and packs this output into the OPC
/// ZIP. Extracted as the regression net for the Office-paste ABI
/// modernisation plan — see
/// `docs/plans/office-paste-abi-modernisation.md`.
pub(crate) fn build_drawing_xml(
    shapes: &[AnnotationShape],
    w: f64,
    h: f64,
    has_image: bool,
) -> (String, Vec<(String, Vec<u8>)>) {
    let cx = px(w);
    let cy = px(h);

    // Track extra media files (mosaic patches). rId starts at 3 (rId1=theme, rId2=screenshot)
    let mut media_files: Vec<(String, Vec<u8>)> = Vec::new(); // (filename, bytes)
    let mut next_rid = if has_image { 3u32 } else { 2u32 };

    let mut shape_xml = String::new();
    let mut id = 2u32;

    // Screenshot image as first element (background)
    if has_image {
        shape_xml.push_str(&format!(
            r#"<a:pic><a:nvPicPr><a:cNvPr id="1000" name="Screenshot"/><a:cNvPicPr><a:picLocks noChangeAspect="1"/></a:cNvPicPr></a:nvPicPr><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></a:spPr></a:pic>"#
        ));
    }

    for shape in shapes {
        let xml = match shape.shape_type.as_str() {
            "rect" => { let s = gvml_rect(shape, id, false); id += 1; s }
            "rounded-rect" => { let s = gvml_rect(shape, id, true); id += 1; s }
            "ellipse" => { let s = gvml_ellipse(shape, id); id += 1; s }
            "line" | "arrow" => { let s = gvml_line(shape, id); id += 1; s }
            "marker" => { let s = gvml_marker(shape, id); id += 1; s }
            "text" => { let s = gvml_text(shape, id); id += 1; s }
            "freehand" => { let s = gvml_freehand(shape, id); id += 1; s }
            "mosaic_image" => {
                let rid = next_rid;
                next_rid += 1;
                // Prefer the canonical `image_data_url`; fall back to
                // `text` for payloads built before
                // office-paste-abi-modernisation phase 2. Phase 8
                // removes the fallback.
                let data_url = shape
                    .image_data_url
                    .as_deref()
                    .or(shape.text.as_deref())
                    .unwrap_or("");
                if let Some(bytes) = parse_data_url_bytes(data_url) {
                    let ext = if data_url.contains("image/png") { "png" } else { "jpeg" };
                    let fname = format!("mosaic_{}.{}", media_files.len(), ext);
                    media_files.push((fname, bytes));
                    let s = gvml_mosaic_pic(shape, id, rid); id += 1; s
                } else { String::new() }
            }
            _ => String::new(),
        };
        shape_xml.push_str(&xml);
    }

    let drawing = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/><a:chOff x="0" y="0"/><a:chExt cx="{cx}" cy="{cy}"/></a:xfrm></a:grpSpPr>{shape_xml}</lc:lockedCanvas></a:graphicData></a:graphic>"#);

    (drawing, media_files)
}

fn build_gvml_zip(shapes: &[AnnotationShape], w: f64, h: f64, image_bytes: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let has_image = image_bytes.is_some();

    let (drawing, media_files) = build_drawing_xml(shapes, w, h, has_image);

    let has_any_image = has_image || !media_files.is_empty();
    let img_ct = if has_any_image {
        r#"<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>"#
    } else { "" };

    let content_types = format!(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{img_ct}<Override PartName="/clipboard/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/clipboard/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>"#);

    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="clipboard/drawings/drawing1.xml"/></Relationships>"#;

    // Build drawing rels dynamically: rId1=theme, rId2=screenshot, rId3+=mosaic images
    let mut rels_entries = vec![
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>"#.to_string(),
    ];
    if has_image {
        rels_entries.push(r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/>"#.to_string());
    }
    let mosaic_rid_start = if has_image { 3u32 } else { 2u32 };
    for (i, (fname, _)) in media_files.iter().enumerate() {
        let rid = mosaic_rid_start + i as u32;
        rels_entries.push(format!(
            r#"<Relationship Id="rId{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{fname}"/>"#
        ));
    }
    let drawing_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{}</Relationships>"#,
        rels_entries.join("")
    );

    // Build ZIP
    let buf = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (name, content) in [
        ("[Content_Types].xml", content_types.as_str()),
        ("_rels/.rels", root_rels),
        ("clipboard/drawings/drawing1.xml", drawing.as_str()),
        ("clipboard/drawings/_rels/drawing1.xml.rels", drawing_rels.as_str()),
        ("clipboard/theme/theme1.xml", CLIPBOARD_THEME),
    ] {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }

    // Add screenshot image
    if let Some(img) = image_bytes {
        zip.start_file("clipboard/media/image1.jpeg", opts).map_err(|e| e.to_string())?;
        zip.write_all(img).map_err(|e| e.to_string())?;
    }

    // Add mosaic image files
    for (fname, bytes) in &media_files {
        zip.start_file(format!("clipboard/media/{fname}"), opts).map_err(|e| e.to_string())?;
        zip.write_all(bytes).map_err(|e| e.to_string())?;
    }

    let result = zip.finish().map_err(|e| e.to_string())?;
    Ok(result.into_inner())
}

#[cfg(windows)]
fn set_clipboard_all(gvml_data: &[u8], png_data: Option<&[u8]>) -> Result<(), String> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::System::Memory::*;

    unsafe {
        // Register custom formats
        let gvml_name: Vec<u16> = "Art::GVML ClipFormat\0".encode_utf16().collect();
        let gvml_fmt = RegisterClipboardFormatW(windows::core::PCWSTR(gvml_name.as_ptr()));
        if gvml_fmt == 0 {
            return Err("RegisterClipboardFormatW failed".into());
        }

        OpenClipboard(None).map_err(|e| format!("OpenClipboard: {e}"))?;
        EmptyClipboard().map_err(|e| format!("EmptyClipboard: {e}"))?;

        // Set GVML (Office drawing objects)
        set_clipboard_data(gvml_fmt, gvml_data)?;

        // Set CF_DIB (standard bitmap - Paint, browsers, Google Sheets etc.)
        if let Some(png) = png_data {
            if let Ok(dib) = png_to_dib(png) {
                set_clipboard_data(8, &dib).ok(); // CF_DIB = 8
            }
        }

        CloseClipboard().ok();
        Ok(())
    }
}

#[cfg(windows)]
fn png_to_dib(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(png_data).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    let w = rgb.width() as i32;
    let h = rgb.height() as i32;

    // DIB rows are bottom-up and padded to 4-byte boundaries
    let row_stride = ((w * 3 + 3) / 4) * 4;
    let pixel_size = (row_stride * h) as usize;

    // BITMAPINFOHEADER (40 bytes)
    let mut dib = Vec::with_capacity(40 + pixel_size);

    // biSize
    dib.extend_from_slice(&40u32.to_le_bytes());
    // biWidth
    dib.extend_from_slice(&w.to_le_bytes());
    // biHeight (positive = bottom-up)
    dib.extend_from_slice(&h.to_le_bytes());
    // biPlanes
    dib.extend_from_slice(&1u16.to_le_bytes());
    // biBitCount
    dib.extend_from_slice(&24u16.to_le_bytes());
    // biCompression (BI_RGB = 0)
    dib.extend_from_slice(&0u32.to_le_bytes());
    // biSizeImage
    dib.extend_from_slice(&(pixel_size as u32).to_le_bytes());
    // biXPelsPerMeter, biYPelsPerMeter
    dib.extend_from_slice(&0i32.to_le_bytes());
    dib.extend_from_slice(&0i32.to_le_bytes());
    // biClrUsed, biClrImportant
    dib.extend_from_slice(&0u32.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());

    // Pixel data (bottom-up, BGR, row-padded)
    let raw = rgb.as_raw();
    for y in (0..h).rev() {
        let row_start = (y * w * 3) as usize;
        for x in 0..w as usize {
            let i = row_start + x * 3;
            dib.push(raw[i + 2]); // B
            dib.push(raw[i + 1]); // G
            dib.push(raw[i]);     // R
        }
        // Pad row to 4-byte boundary
        let padding = (row_stride - w * 3) as usize;
        for _ in 0..padding {
            dib.push(0);
        }
    }

    Ok(dib)
}

#[cfg(windows)]
unsafe fn set_clipboard_data(format: u32, data: &[u8]) -> Result<(), String> {
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::DataExchange::*;
    use windows::Win32::System::Memory::*;

    let hmem = GlobalAlloc(GMEM_MOVEABLE, data.len())
        .map_err(|e| format!("GlobalAlloc: {e}"))?;
    let ptr = GlobalLock(hmem);
    if ptr.is_null() {
        return Err("GlobalLock failed".into());
    }
    std::ptr::copy_nonoverlapping(data.as_ptr(), ptr as *mut u8, data.len());
    GlobalUnlock(hmem).ok();

    SetClipboardData(format, HANDLE(hmem.0 as *mut _))
        .map_err(|e| format!("SetClipboardData: {e}"))?;
    Ok(())
}

// --- Shape builders (a: namespace for GVML) ---

/// Convert SVG stroke-dasharray to DrawingML preset dash
fn dash_to_drawingml(dasharray: &str) -> String {
    // dasharray can be a key name or computed SVG values
    match dasharray.trim() {
        "" => String::new(),
        "dash" => r#"<a:prstDash val="dash"/>"#.to_string(),
        "dot" => r#"<a:prstDash val="dot"/>"#.to_string(),
        "dashDot" => r#"<a:prstDash val="dashDot"/>"#.to_string(),
        "lgDash" => r#"<a:prstDash val="lgDash"/>"#.to_string(),
        // Computed SVG values: detect by pattern
        v => {
            let parts: Vec<&str> = v.split(',').collect();
            if parts.len() == 4 { r#"<a:prstDash val="dashDot"/>"#.to_string() }
            else if parts.len() == 2 {
                let d: f64 = parts[0].trim().parse().unwrap_or(0.0);
                let g: f64 = parts[1].trim().parse().unwrap_or(0.0);
                if d <= g { r#"<a:prstDash val="dot"/>"#.to_string() }
                else if d > g * 4.0 { r#"<a:prstDash val="lgDash"/>"#.to_string() }
                else { r#"<a:prstDash val="dash"/>"#.to_string() }
            }
            else { r#"<a:prstDash val="dash"/>"#.to_string() }
        }
    }
}

/// Build DrawingML fill element with optional opacity
fn build_fill_xml(fill: &str, opacity: f64) -> String {
    if fill == "none" {
        "<a:noFill/>".to_string()
    } else {
        let hex = chex(fill);
        if opacity < 0.999 {
            let alpha = (opacity * 100000.0).round() as i64;
            format!(r#"<a:solidFill><a:srgbClr val="{hex}"><a:alpha val="{alpha}"/></a:srgbClr></a:solidFill>"#)
        } else {
            format!(r#"<a:solidFill><a:srgbClr val="{hex}"/></a:solidFill>"#)
        }
    }
}

fn gvml_rect(s: &AnnotationShape, id: u32, rounded: bool) -> String {
    let x = px(s.x.unwrap_or(0.0)); let y = px(s.y.unwrap_or(0.0));
    let w = px(s.width.unwrap_or(0.0)); let h = px(s.height.unwrap_or(0.0));
    let stroke = chex(s.stroke.as_deref().unwrap_or("#ff0000"));
    let sw = pt(s.stroke_width.unwrap_or(3.0));
    let fill = s.fill.as_deref().unwrap_or("none");
    let opacity = s.fill_opacity.unwrap_or(1.0);
    let f = build_fill_xml(fill, opacity);
    let geom = if rounded {
        r#"<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>"#
    } else {
        r#"<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>"#
    };
    let dash = dash_to_drawingml(s.stroke_dasharray.as_deref().unwrap_or(""));
    let xf = xfrm_attrs(s, false);
    let cap = cap_attr(s.stroke_linecap.as_deref());
    let join = join_xml(s.stroke_linejoin.as_deref());
    // If the shape has a fill gradient, override the solid/noFill fill.
    let f_final = if let Some(fg) = &s.fill_gradient { grad_fill_xml(fg) } else { f };
    // Solid redactions are visually a filled rectangle with NO
    // outline — matching PowerPoint's "rectangle (no outline)"
    // preset. Suppress `<a:ln>` regardless of the inbound
    // `stroke_*` fields so the bar reads cleanly.
    let line = if s.redact_style.as_deref() == Some("solid") {
        r#"<a:ln><a:noFill/></a:ln>"#.to_string()
    } else {
        let paint = stroke_paint_xml(s, &stroke);
        format!(r#"<a:ln w="{sw}"{cap}>{paint}{join}{dash}</a:ln>"#)
    };
    format!(r#"<a:sp><a:nvSpPr><a:cNvPr id="{id}" name="R{id}"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm{xf}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm>{geom}{f_final}{line}</a:spPr></a:sp>"#)
}

fn gvml_ellipse(s: &AnnotationShape, id: u32) -> String {
    let cx = s.cx.unwrap_or(0.0); let cy = s.cy.unwrap_or(0.0);
    let rx = s.rx.unwrap_or(0.0); let ry = s.ry.unwrap_or(0.0);
    let stroke = chex(s.stroke.as_deref().unwrap_or("#ff0000"));
    let sw = pt(s.stroke_width.unwrap_or(3.0));
    let fill = s.fill.as_deref().unwrap_or("none");
    let opacity = s.fill_opacity.unwrap_or(1.0);
    let f = build_fill_xml(fill, opacity);
    let dash = dash_to_drawingml(s.stroke_dasharray.as_deref().unwrap_or(""));
    let xf = xfrm_attrs(s, false);
    let paint = stroke_paint_xml(s, &stroke);
    let cap = cap_attr(s.stroke_linecap.as_deref());
    let join = join_xml(s.stroke_linejoin.as_deref());
    let f_final = if let Some(fg) = &s.fill_gradient { grad_fill_xml(fg) } else { f };
    format!(r#"<a:sp><a:nvSpPr><a:cNvPr id="{id}" name="E{id}"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm{xf}><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>{f_final}<a:ln w="{sw}"{cap}>{paint}{join}{dash}</a:ln></a:spPr></a:sp>"#, px(cx-rx), px(cy-ry), px(rx*2.0), px(ry*2.0))
}

fn gvml_line(s: &AnnotationShape, id: u32) -> String {
    let x1 = s.x1.unwrap_or(0.0); let y1 = s.y1.unwrap_or(0.0);
    let x2 = s.x2.unwrap_or(0.0); let y2 = s.y2.unwrap_or(0.0);
    let stroke = chex(s.stroke.as_deref().unwrap_or("#ff0000"));
    let sw = pt(s.stroke_width.unwrap_or(3.0));
    let left = x1.min(x2); let top = y1.min(y2);
    let w = (x2-x1).abs().max(1.0); let h = (y2-y1).abs().max(1.0);
    let fh = if x2 < x1 { r#" flipH="1""# } else { "" };
    let fv = if y2 < y1 { r#" flipV="1""# } else { "" };

    // Per-end arrows with independent width / length.
    let start_w = s.arrow_width_start.as_deref();
    let start_l = s.arrow_length_start.as_deref();
    let end_w = s.arrow_width_end.as_deref();
    let end_l = s.arrow_length_end.as_deref();
    let head = end_xml("headEnd", s.arrow_shape_start.as_deref(), start_w, start_l);
    let tail = if s.arrow_shape_end.is_some() {
        end_xml("tailEnd", s.arrow_shape_end.as_deref(), end_w, end_l)
    } else if s.has_arrow.unwrap_or(false) {
        r#"<a:tailEnd type="triangle" w="med" len="med"/>"#.into()
    } else { String::new() };

    let dash = dash_to_drawingml(s.stroke_dasharray.as_deref().unwrap_or(""));
    let paint = stroke_paint_xml(s, &stroke);
    let cap = cap_attr(s.stroke_linecap.as_deref());
    let join = join_xml(s.stroke_linejoin.as_deref());
    // Lines already use flipH/flipV to express endpoint direction —
    // exclude the user-applied mirror to avoid double-flipping. Rotation
    // is still safe to layer on top.
    let xf = xfrm_attrs(s, true);
    format!(r#"<a:cxnSp><a:nvCxnSpPr><a:cNvPr id="{id}" name="L{id}"/><a:cNvCxnSpPr/></a:nvCxnSpPr><a:spPr><a:xfrm{fh}{fv}{xf}><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom><a:ln w="{sw}"{cap}>{paint}{join}{dash}{head}{tail}</a:ln></a:spPr></a:cxnSp>"#, px(left), px(top), px(w), px(h))
}

fn gvml_text(s: &AnnotationShape, id: u32) -> String {
    let x = px(s.x.unwrap_or(0.0)); let y = px(s.y.unwrap_or(0.0));
    let fs = s.font_size.unwrap_or(24.0);
    let fill = chex(s.fill.as_deref().unwrap_or("#ff0000"));
    let text = s.text.as_deref().unwrap_or("");
    let pt = (fs * 75.0_f64).round() as i64;
    let bw = s.width.map(|w| px(w)).unwrap_or_else(|| px((text.len() as f64 * fs * 0.6).max(200.0)));
    let bh = s.height.map(|h| px(h)).unwrap_or_else(|| px(fs * 1.5 * text.lines().count().max(1) as f64));

    // Prefer the canonical `text_bg_color`; fall back to the legacy
    // `stroke`-as-bg-color carrier for payloads built before
    // office-paste-abi-modernisation phase 3. Phase 8 removes the
    // fallback.
    let bg_carrier = s.text_bg_color.as_deref().or(s.stroke.as_deref());
    let bg_fill = match bg_carrier {
        Some(bg) if !bg.is_empty() => {
            let (r, g, b, a) = parse_rgba(bg);
            if a > 0 {
                let hex = format!("{:02X}{:02X}{:02X}", r, g, b);
                let alpha_pct = ((a as f64 / 255.0) * 100000.0).round() as i64;
                format!(r#"<a:solidFill><a:srgbClr val="{hex}"><a:alpha val="{alpha_pct}"/></a:srgbClr></a:solidFill>"#)
            } else {
                "<a:noFill/>".to_string()
            }
        }
        _ => "<a:noFill/>".to_string(),
    };

    let p: String = text.lines().map(|l| format!(
        r#"<a:p><a:r><a:rPr lang="ja-JP" sz="{pt}" dirty="0"><a:solidFill><a:srgbClr val="{fill}"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p>"#,
        exml(l)
    )).collect();
    let xf = xfrm_attrs(s, false);

    // Callouts with a populated tail tip switch from `roundRect` to
    // `wedgeRoundRectCallout`. adj1/adj2 express the tail tip as a
    // signed percentage offset from the bbox center, in 1/100,000ths
    // of width / height; values can exceed ±50% when the tail tip
    // lands outside the bbox (the typical case for callouts).
    // adj3 keeps the same corner-rounding constant as the
    // non-callout `roundRect` form (val 5000) so plain / sticky /
    // callout share the visual corner radius.
    let geom = match (
        s.text_variant.as_deref(),
        s.tail_x,
        s.tail_y,
        s.x,
        s.y,
        s.width,
        s.height,
    ) {
        (Some("callout"), Some(tx), Some(ty), Some(bx), Some(by), Some(bw), Some(bh))
            if bw > 0.0 && bh > 0.0 =>
        {
            let dx = tx - (bx + bw / 2.0);
            let dy = ty - (by + bh / 2.0);
            let adj1 = (dx / bw * 100_000.0).round() as i64;
            let adj2 = (dy / bh * 100_000.0).round() as i64;
            format!(
                r#"<a:prstGeom prst="wedgeRoundRectCallout"><a:avLst><a:gd name="adj1" fmla="val {adj1}"/><a:gd name="adj2" fmla="val {adj2}"/><a:gd name="adj3" fmla="val 5000"/></a:avLst></a:prstGeom>"#
            )
        }
        _ => r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 5000"/></a:avLst></a:prstGeom>"#.to_string(),
    };

    format!(r#"<a:sp><a:nvSpPr><a:cNvPr id="{id}" name="T{id}"/><a:cNvSpPr txBox="1"/></a:nvSpPr><a:spPr><a:xfrm{xf}><a:off x="{x}" y="{y}"/><a:ext cx="{bw}" cy="{bh}"/></a:xfrm>{geom}{bg_fill}<a:ln w="9525"><a:solidFill><a:srgbClr val="BFBFBF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr wrap="square" rtlCol="0" lIns="91440" tIns="45720" rIns="91440" bIns="45720"/><a:lstStyle/>{p}</a:txBody><a:useSpRect/></a:txSp></a:sp>"#)
}

/// Parse "rgba(r,g,b,a)" or "#rrggbb" to (r,g,b,a) where a is 0-255
fn parse_rgba(s: &str) -> (u8, u8, u8, u8) {
    if let Some(inner) = s.strip_prefix("rgba(").and_then(|s| s.strip_suffix(')')) {
        let parts: Vec<&str> = inner.split(',').map(|p| p.trim()).collect();
        if parts.len() == 4 {
            let r = parts[0].parse::<u8>().unwrap_or(255);
            let g = parts[1].parse::<u8>().unwrap_or(255);
            let b = parts[2].parse::<u8>().unwrap_or(200);
            let a = (parts[3].parse::<f64>().unwrap_or(0.92) * 255.0).round() as u8;
            return (r, g, b, a);
        }
    }
    if let Some(hex) = s.strip_prefix('#') {
        if hex.len() >= 6 {
            let r = u8::from_str_radix(&hex[0..2], 16).unwrap_or(255);
            let g = u8::from_str_radix(&hex[2..4], 16).unwrap_or(255);
            let b = u8::from_str_radix(&hex[4..6], 16).unwrap_or(200);
            return (r, g, b, 255);
        }
    }
    (255, 255, 200, 235) // default yellow sticky
}

fn gvml_marker(s: &AnnotationShape, id: u32) -> String {
    let cx = s.cx.unwrap_or(0.0); let cy = s.cy.unwrap_or(0.0);
    let fs = s.font_size.unwrap_or(13.0);
    let r = fs * 0.8;
    let fill = chex(s.fill.as_deref().unwrap_or("#ff0000"));
    let label = s.label.as_deref().unwrap_or("");
    let pt = (fs * 75.0_f64).round() as i64;
    // Prefer the canonical `marker_shape` field; fall back to the
    // legacy `stroke == "rect"` carrier so payloads built before
    // office-paste-abi-modernisation phase 1 still dispatch.
    // Phase 8 removes the fallback once no live caller relies on it.
    let shape = s
        .marker_shape
        .as_deref()
        .or_else(|| match s.stroke.as_deref() {
            Some("rect") => Some("rect"),
            _ => None,
        });
    let geom = match shape {
        Some("rect") => {
            r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>"#
        }
        Some("rounded") => {
            r#"<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>"#
        }
        _ => r#"<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>"#,
    };
    // bodyPr: zero insets so text fits in small shapes, shrink text to fit
    format!(r#"<a:sp><a:nvSpPr><a:cNvPr id="{id}" name="M{id}"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm>{geom}<a:solidFill><a:srgbClr val="{fill}"/></a:solidFill><a:ln w="14288"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></a:spPr><a:txSp><a:txBody><a:bodyPr anchor="ctr" lIns="0" tIns="0" rIns="0" bIns="0" wrap="none"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="{pt}" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p></a:txBody><a:useSpRect/></a:txSp></a:sp>"#, px(cx-r), px(cy-r), px(r*2.0), px(r*2.0), exml(label))
}

fn gvml_mosaic_pic(s: &AnnotationShape, id: u32, rid: u32) -> String {
    let x = px(s.x.unwrap_or(0.0));
    let y = px(s.y.unwrap_or(0.0));
    let w = px(s.width.unwrap_or(0.0));
    let h = px(s.height.unwrap_or(0.0));
    let xf = xfrm_attrs(s, false);
    format!(r#"<a:pic><a:nvPicPr><a:cNvPr id="{id}" name="Mosaic{id}"/><a:cNvPicPr><a:picLocks noChangeAspect="1"/></a:cNvPicPr></a:nvPicPr><a:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId{rid}"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:spPr><a:xfrm{xf}><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></a:spPr></a:pic>"#)
}

fn gvml_freehand(s: &AnnotationShape, id: u32) -> String {
    let d = s.text.as_deref().unwrap_or(""); // SVG path data stored in text field
    let stroke = chex(s.stroke.as_deref().unwrap_or("#ff0000"));
    let sw = pt(s.stroke_width.unwrap_or(3.0));

    // Parse M/L points from SVG path
    let points = parse_svg_path(d);
    if points.len() < 2 { return String::new(); }

    let mut min_x = f64::MAX; let mut min_y = f64::MAX;
    let mut max_x = f64::MIN; let mut max_y = f64::MIN;
    for p in &points {
        min_x = min_x.min(p.0); min_y = min_y.min(p.1);
        max_x = max_x.max(p.0); max_y = max_y.max(p.1);
    }
    let bw = (max_x - min_x).max(1.0);
    let bh = (max_y - min_y).max(1.0);

    // DrawingML path points (relative to shape origin, in EMU)
    let path_cmds: String = points.iter().enumerate().map(|(i, (x, y))| {
        let ex = px(*x - min_x);
        let ey = px(*y - min_y);
        if i == 0 {
            format!(r#"<a:moveTo><a:pt x="{ex}" y="{ey}"/></a:moveTo>"#)
        } else {
            format!(r#"<a:lnTo><a:pt x="{ex}" y="{ey}"/></a:lnTo>"#)
        }
    }).collect();

    let pw = px(bw); let ph = px(bh);

    let dash = dash_to_drawingml(s.stroke_dasharray.as_deref().unwrap_or(""));
    let xf = xfrm_attrs(s, false);
    format!(r#"<a:sp><a:nvSpPr><a:cNvPr id="{id}" name="F{id}"/><a:cNvSpPr/></a:nvSpPr><a:spPr><a:xfrm{xf}><a:off x="{}" y="{}"/><a:ext cx="{pw}" cy="{ph}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="{pw}" b="{ph}"/><a:pathLst><a:path w="{pw}" h="{ph}">{path_cmds}</a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="{sw}" cap="rnd"><a:solidFill><a:srgbClr val="{stroke}"/></a:solidFill>{dash}<a:round/></a:ln></a:spPr></a:sp>"#, px(min_x), px(min_y))
}

fn parse_svg_path(d: &str) -> Vec<(f64, f64)> {
    let mut points = Vec::new();
    let re_pattern = regex_lite::Regex::new(r"[ML]\s*([\d.\-]+)[,\s]+([\d.\-]+)").unwrap();
    for cap in re_pattern.captures_iter(d) {
        if let (Ok(x), Ok(y)) = (cap[1].parse::<f64>(), cap[2].parse::<f64>()) {
            points.push((x, y));
        }
    }
    points
}

const CLIPBOARD_THEME: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:clipboardTheme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:clipboardTheme>"#;
