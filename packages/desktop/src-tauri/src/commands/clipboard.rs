//! Office-clipboard packaging.
//!
//! Since
//! [`office-paste-shared-drawing-builder` phase 2](../../../../../docs/plans/office-paste-shared-drawing-builder.md)
//! the per-shape OOXML construction lives in TS
//! (`@ingcreators/annot-render/drawingml`) and the Tauri side is
//! reduced to: receive a pre-built drawing XML string + a list
//! of mosaic image media (filename + bytes) + the optional
//! background screenshot, ZIP it into the GVML OPC package, and
//! push it to the Win32 clipboard.

use serde::Deserialize;
use std::io::Write;
use tauri::command;

/// One mosaic / blur image embedded into the GVML clipboard
/// package. The TS side parses the data URL and passes the raw
/// bytes; the filename is `mosaic_<index>.<ext>` (matching the
/// `<a:blip r:embed="rId{N}"/>` references already inside the
/// drawing XML the TS builder produced).
#[derive(Debug, Deserialize)]
pub struct MosaicMedia {
    pub filename: String,
    pub bytes: Vec<u8>,
}

/// Copy annotations as native Office shapes via GVML clipboard
/// format (OPC ZIP). The drawing XML + mosaic media list are
/// pre-built on the TS side; this command's job is just to ZIP
/// them up alongside the screenshot + theme + content_types and
/// push the result to the Win32 clipboard. Also sets `CF_DIB` as
/// a fallback for non-Office clipboard consumers (Paint, browsers,
/// Google Sheets).
#[command]
pub async fn copy_as_office(
    drawing_xml: String,
    mosaic_media: Vec<MosaicMedia>,
    screenshot_data: Option<String>,
    png_data_url: Option<String>,
) -> Result<(), String> {
    // Convert image to JPEG if it's PNG (smaller size for GVML).
    let image_bytes = screenshot_data.as_deref().and_then(|data| {
        let raw = parse_data_url_bytes(data)?;
        if data.contains("image/png") {
            png_to_jpeg(&raw).ok()
        } else {
            Some(raw)
        }
    });

    // Parse PNG for clipboard fallback (CF_DIB / regular bitmap).
    let png_bytes = png_data_url.as_deref().and_then(parse_data_url_bytes);
    let gvml_zip = build_gvml_zip(&drawing_xml, &mosaic_media, image_bytes.as_deref())?;

    #[cfg(windows)]
    {
        set_clipboard_all(&gvml_zip, png_bytes.as_deref())?;
    }
    #[cfg(not(windows))]
    {
        let _ = png_bytes;
        let _ = gvml_zip;
        return Err("Office clipboard only supported on Windows".into());
    }

    Ok(())
}

fn png_to_jpeg(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    crate::jpeg_utils::image_to_progressive_jpeg(png_bytes)
}

fn parse_data_url_bytes(data_url: &str) -> Option<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let pos = data_url.find(',')?;
    STANDARD.decode(&data_url[pos + 1..]).ok()
}

/// Pack the pre-built drawing XML + mosaic media + optional
/// background screenshot into the GVML OPC ZIP that the Office
/// clipboard expects (the format Word / PowerPoint / Excel
/// recognise as native shape paste).
pub(crate) fn build_gvml_zip(
    drawing_xml: &str,
    mosaic_media: &[MosaicMedia],
    image_bytes: Option<&[u8]>,
) -> Result<Vec<u8>, String> {
    let has_image = image_bytes.is_some();
    let has_any_image = has_image || !mosaic_media.is_empty();

    let img_ct = if has_any_image {
        r#"<Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/>"#
    } else {
        ""
    };

    let content_types = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>{img_ct}<Override PartName="/clipboard/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/clipboard/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>"#
    );

    let root_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="clipboard/drawings/drawing1.xml"/></Relationships>"#;

    // Build drawing rels dynamically: rId1=theme, rId2=screenshot
    // (when present), rId3+ = mosaic images. The TS builder
    // assumes the same rId numbering for the `<a:blip>`
    // references inside `drawing_xml`.
    let mut rels_entries = vec![
        r#"<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>"#.to_string(),
    ];
    if has_image {
        rels_entries.push(
            r#"<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg"/>"#.to_string(),
        );
    }
    let mosaic_rid_start = if has_image { 3u32 } else { 2u32 };
    for (i, m) in mosaic_media.iter().enumerate() {
        let rid = mosaic_rid_start + i as u32;
        rels_entries.push(format!(
            r#"<Relationship Id="rId{rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/{}"/>"#,
            m.filename
        ));
    }
    let drawing_rels = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{}</Relationships>"#,
        rels_entries.join("")
    );

    let buf = std::io::Cursor::new(Vec::new());
    let mut zip = zip::ZipWriter::new(buf);
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (name, content) in [
        ("[Content_Types].xml", content_types.as_str()),
        ("_rels/.rels", root_rels),
        ("clipboard/drawings/drawing1.xml", drawing_xml),
        ("clipboard/drawings/_rels/drawing1.xml.rels", drawing_rels.as_str()),
        ("clipboard/theme/theme1.xml", CLIPBOARD_THEME),
    ] {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
    }

    if let Some(img) = image_bytes {
        zip.start_file("clipboard/media/image1.jpeg", opts).map_err(|e| e.to_string())?;
        zip.write_all(img).map_err(|e| e.to_string())?;
    }

    for m in mosaic_media {
        zip.start_file(format!("clipboard/media/{}", m.filename), opts)
            .map_err(|e| e.to_string())?;
        zip.write_all(&m.bytes).map_err(|e| e.to_string())?;
    }

    let result = zip.finish().map_err(|e| e.to_string())?;
    Ok(result.into_inner())
}

#[cfg(windows)]
fn set_clipboard_all(gvml_data: &[u8], png_data: Option<&[u8]>) -> Result<(), String> {
    use windows::Win32::System::DataExchange::*;

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

        // Set CF_DIB (standard bitmap — Paint, browsers, Google Sheets etc.)
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

    // DIB rows are bottom-up and padded to 4-byte boundaries.
    let row_stride = ((w * 3 + 3) / 4) * 4;
    let pixel_size = (row_stride * h) as usize;

    // BITMAPINFOHEADER (40 bytes).
    let mut dib = Vec::with_capacity(40 + pixel_size);

    dib.extend_from_slice(&40u32.to_le_bytes());
    dib.extend_from_slice(&w.to_le_bytes());
    dib.extend_from_slice(&h.to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes());
    dib.extend_from_slice(&24u16.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());
    dib.extend_from_slice(&(pixel_size as u32).to_le_bytes());
    dib.extend_from_slice(&0i32.to_le_bytes());
    dib.extend_from_slice(&0i32.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());
    dib.extend_from_slice(&0u32.to_le_bytes());

    // Pixel data (bottom-up, BGR, row-padded).
    let raw = rgb.as_raw();
    for y in (0..h).rev() {
        let row_start = (y * w * 3) as usize;
        for x in 0..w as usize {
            let i = row_start + x * 3;
            dib.push(raw[i + 2]); // B
            dib.push(raw[i + 1]); // G
            dib.push(raw[i]);     // R
        }
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

const CLIPBOARD_THEME: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:clipboardTheme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:clipboardTheme>"#;
