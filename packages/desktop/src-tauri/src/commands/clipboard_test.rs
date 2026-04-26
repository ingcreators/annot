//! Smoke test for the GVML OPC ZIP packaging.
//!
//! Per-shape OOXML construction lives on the TS side now (see
//! `packages/render/src/drawingml/`); the Rust crate only
//! packages a pre-built `drawing_xml` string + a list of
//! mosaic media into the GVML clipboard ZIP. The test asserts:
//!
//! 1. The ZIP can be built without error.
//! 2. The expected entries are present (`[Content_Types].xml`,
//!    `_rels/.rels`, `clipboard/drawings/drawing1.xml`,
//!    `clipboard/drawings/_rels/drawing1.xml.rels`,
//!    `clipboard/theme/theme1.xml`).
//! 3. The drawing XML and mosaic media land at their declared
//!    paths with the exact bytes the caller passed in.
//! 4. The drawing rels file references rId entries for both
//!    the screenshot (when present) and each mosaic file in
//!    order.

use super::clipboard::{build_gvml_zip, MosaicMedia};
use std::io::Read;

fn read_zip_entry(zip_bytes: &[u8], path: &str) -> Option<Vec<u8>> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    let mut entry = archive.by_name(path).ok()?;
    let mut out = Vec::new();
    entry.read_to_end(&mut out).ok()?;
    Some(out)
}

fn list_zip_entries(zip_bytes: &[u8]) -> Vec<String> {
    let cursor = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor).expect("ZIP must parse");
    let mut out = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let entry = archive.by_index(i).expect("entry by index");
        out.push(entry.name().to_string());
    }
    out
}

const SAMPLE_DRAWING_XML: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><lc:lockedCanvas xmlns:lc="http://schemas.openxmlformats.org/drawingml/2006/lockedCanvas"><a:nvGrpSpPr><a:cNvPr id="0" name=""/><a:cNvGrpSpPr/></a:nvGrpSpPr><a:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="7620000" cy="5715000"/><a:chOff x="0" y="0"/><a:chExt cx="7620000" cy="5715000"/></a:xfrm></a:grpSpPr></lc:lockedCanvas></a:graphicData></a:graphic>"#;

#[test]
fn build_gvml_zip_includes_drawing_xml_and_theme() {
    let zip_bytes = build_gvml_zip(SAMPLE_DRAWING_XML, &[], None).expect("zip builds");
    let drawing = read_zip_entry(&zip_bytes, "clipboard/drawings/drawing1.xml")
        .expect("drawing1.xml present");
    assert_eq!(String::from_utf8_lossy(&drawing), SAMPLE_DRAWING_XML);

    let entries = list_zip_entries(&zip_bytes);
    for required in [
        "[Content_Types].xml",
        "_rels/.rels",
        "clipboard/drawings/drawing1.xml",
        "clipboard/drawings/_rels/drawing1.xml.rels",
        "clipboard/theme/theme1.xml",
    ] {
        assert!(entries.iter().any(|e| e == required), "missing: {required}");
    }
}

#[test]
fn build_gvml_zip_writes_mosaic_media_under_clipboard_media() {
    let media = vec![
        MosaicMedia { filename: "mosaic_0.png".into(), bytes: vec![0xDE, 0xAD] },
        MosaicMedia { filename: "mosaic_1.jpeg".into(), bytes: vec![0xCA, 0xFE] },
    ];
    let zip_bytes = build_gvml_zip(SAMPLE_DRAWING_XML, &media, None).expect("zip builds");
    let m0 = read_zip_entry(&zip_bytes, "clipboard/media/mosaic_0.png").expect("mosaic_0");
    let m1 = read_zip_entry(&zip_bytes, "clipboard/media/mosaic_1.jpeg").expect("mosaic_1");
    assert_eq!(m0, vec![0xDE, 0xAD]);
    assert_eq!(m1, vec![0xCA, 0xFE]);
}

#[test]
fn build_gvml_zip_writes_screenshot_at_image1_jpeg() {
    let img = vec![0xFF, 0xD8, 0xFF, 0xE0]; // JPEG magic bytes
    let zip_bytes =
        build_gvml_zip(SAMPLE_DRAWING_XML, &[], Some(&img)).expect("zip builds");
    let stored = read_zip_entry(&zip_bytes, "clipboard/media/image1.jpeg")
        .expect("image1.jpeg present");
    assert_eq!(stored, img);
}

#[test]
fn build_gvml_zip_drawing_rels_index_screenshot_and_mosaics() {
    // rId numbering: rId1=theme, rId2=screenshot (when present),
    // rId3+ = mosaic media in declaration order. The TS-side
    // builder relies on this order to write the matching `<a:blip
    // r:embed="rId{N}"/>` references in `drawing_xml`.
    let media = vec![
        MosaicMedia { filename: "mosaic_0.png".into(), bytes: vec![0x01] },
        MosaicMedia { filename: "mosaic_1.jpeg".into(), bytes: vec![0x02] },
    ];
    let img = vec![0xFF, 0xD8];
    let zip_bytes =
        build_gvml_zip(SAMPLE_DRAWING_XML, &media, Some(&img)).expect("zip builds");

    let rels = read_zip_entry(&zip_bytes, "clipboard/drawings/_rels/drawing1.xml.rels")
        .expect("rels present");
    let rels_str = String::from_utf8_lossy(&rels);
    assert!(rels_str.contains(r#"Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme""#));
    assert!(rels_str.contains(r#"Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.jpeg""#));
    assert!(rels_str.contains(r#"Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/mosaic_0.png""#));
    assert!(rels_str.contains(r#"Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/mosaic_1.jpeg""#));
}

#[test]
fn build_gvml_zip_omits_image_content_types_when_no_image_or_media() {
    let zip_bytes = build_gvml_zip(SAMPLE_DRAWING_XML, &[], None).expect("zip builds");
    let ct = read_zip_entry(&zip_bytes, "[Content_Types].xml").expect("ct present");
    let ct_str = String::from_utf8_lossy(&ct);
    assert!(!ct_str.contains(r#"Extension="jpeg""#));
    assert!(!ct_str.contains(r#"Extension="png""#));
}

#[test]
fn build_gvml_zip_includes_image_content_types_when_screenshot_present() {
    let zip_bytes =
        build_gvml_zip(SAMPLE_DRAWING_XML, &[], Some(&[0xFF])).expect("zip builds");
    let ct = read_zip_entry(&zip_bytes, "[Content_Types].xml").expect("ct present");
    let ct_str = String::from_utf8_lossy(&ct);
    assert!(ct_str.contains(r#"Extension="jpeg""#));
    assert!(ct_str.contains(r#"Extension="png""#));
}
