//! Golden-snapshot regression net for the GVML drawing XML produced
//! by `copy_as_office`. Exercises every emitter
//! (`rect` / `rounded-rect` / `ellipse` / `arrow` / `marker` / `text` /
//! `freehand` / `mosaic_image`) and pins the current XML byte-for-byte
//! so subsequent ABI-modernisation phases (see
//! `docs/plans/office-paste-abi-modernisation.md`) can land
//! field-rename refactors without silently dropping output.

use super::clipboard::{build_drawing_xml, AnnotationShape};

fn rect_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "rect".into(),
        x: Some(10.0),
        y: Some(20.0),
        width: Some(100.0),
        height: Some(80.0),
        stroke: Some("#ff0000".into()),
        stroke_width: Some(3.0),
        fill: Some("#ffeeaa".into()),
        fill_opacity: Some(0.5),
        ..Default::default()
    }
}

fn rounded_rect_shape() -> AnnotationShape {
    // Phase 6 of the office-paste ABI plan made `corner_radius`
    // the canonical roundedness signal; the legacy
    // `type: "rounded-rect"` arm is still honored as a fallback
    // (phase 8 drops it).
    AnnotationShape {
        shape_type: "rect".into(),
        x: Some(120.0),
        y: Some(20.0),
        width: Some(100.0),
        height: Some(80.0),
        stroke: Some("#0000ff".into()),
        stroke_width: Some(2.0),
        fill: Some("none".into()),
        corner_radius: Some(8.0),
        ..Default::default()
    }
}

fn rounded_rect_shape_legacy_type() -> AnnotationShape {
    // Mirror of `rounded_rect_shape()` but using only the legacy
    // `type: "rounded-rect"` dispatch — proves the legacy arm
    // produces byte-equivalent XML to the canonical form.
    AnnotationShape {
        shape_type: "rounded-rect".into(),
        x: Some(120.0),
        y: Some(20.0),
        width: Some(100.0),
        height: Some(80.0),
        stroke: Some("#0000ff".into()),
        stroke_width: Some(2.0),
        fill: Some("none".into()),
        ..Default::default()
    }
}

fn ellipse_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "ellipse".into(),
        cx: Some(300.0),
        cy: Some(60.0),
        rx: Some(50.0),
        ry: Some(40.0),
        stroke: Some("#00ff00".into()),
        stroke_width: Some(3.0),
        fill: Some("none".into()),
        ..Default::default()
    }
}

fn arrow_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "arrow".into(),
        x1: Some(10.0),
        y1: Some(150.0),
        x2: Some(210.0),
        y2: Some(250.0),
        stroke: Some("#ff0000".into()),
        stroke_width: Some(3.0),
        has_arrow: Some(true),
        arrow_shape_end: Some("triangle".into()),
        arrow_width_end: Some("med".into()),
        arrow_length_end: Some("med".into()),
        ..Default::default()
    }
}

fn marker_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "marker".into(),
        cx: Some(400.0),
        cy: Some(300.0),
        font_size: Some(13.0),
        fill: Some("#ff0000".into()),
        label: Some("1".into()),
        // Phase 1 of the office-paste ABI plan made `marker_shape`
        // the canonical discriminator; the legacy `stroke == "rect"`
        // carrier is still honored as a fallback (phase 8 drops it).
        marker_shape: Some("rect".into()),
        ..Default::default()
    }
}

fn marker_shape_legacy_carrier() -> AnnotationShape {
    // Mirror of `marker_shape()` but using only the legacy carrier
    // (`stroke == "rect"`) — lets us prove the fallback in
    // `gvml_marker` produces byte-equivalent XML to the canonical
    // form. Phase 8 will delete the fallback and this fixture.
    AnnotationShape {
        shape_type: "marker".into(),
        cx: Some(400.0),
        cy: Some(300.0),
        font_size: Some(13.0),
        fill: Some("#ff0000".into()),
        label: Some("1".into()),
        stroke: Some("rect".into()),
        ..Default::default()
    }
}

fn marker_rounded_shape() -> AnnotationShape {
    // New variant unlocked by phase 1 — `marker_shape: "rounded"`
    // emits `roundRect` with a higher `adj` value so the counter
    // looks visibly rounded in PowerPoint, matching the
    // SVG-side `cornerRadius = r * 0.6` rendering.
    AnnotationShape {
        shape_type: "marker".into(),
        cx: Some(500.0),
        cy: Some(300.0),
        font_size: Some(13.0),
        fill: Some("#0000ff".into()),
        label: Some("2".into()),
        marker_shape: Some("rounded".into()),
        ..Default::default()
    }
}

fn text_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "text".into(),
        x: Some(10.0),
        y: Some(400.0),
        width: Some(200.0),
        height: Some(50.0),
        font_size: Some(24.0),
        fill: Some("#000000".into()),
        text: Some("Hello".into()),
        // Phase 3 of the office-paste ABI plan made `text_bg_color`
        // the canonical carrier; the legacy `stroke`-as-bg-color
        // path is still honored as a fallback (phase 8 drops it).
        text_bg_color: Some("rgba(255,255,200,0.92)".into()),
        ..Default::default()
    }
}

fn redact_solid_shape() -> AnnotationShape {
    // Solid-fill redaction bar. Phase 5 makes Rust read
    // `redact_style` and emit `<a:ln><a:noFill/></a:ln>` regardless
    // of any `stroke_*` fields the preset carries — matching
    // PowerPoint's "rectangle (no outline)" preset.
    AnnotationShape {
        shape_type: "rect".into(),
        x: Some(50.0),
        y: Some(500.0),
        width: Some(120.0),
        height: Some(30.0),
        // Stroke fields populated to prove they get suppressed when
        // `redact_style: "solid"` is set.
        stroke: Some("#ff0000".into()),
        stroke_width: Some(3.0),
        fill: Some("#000000".into()),
        fill_opacity: Some(1.0),
        redact_style: Some("solid".into()),
        ..Default::default()
    }
}

fn callout_shape() -> AnnotationShape {
    // Callout textbox with tail at (300, 470) — outside the bbox to
    // its bottom-right. Phase 4 makes Rust read `tail_x` / `tail_y`
    // and `text_variant`, switching `prstGeom` from `roundRect` to
    // `wedgeRoundRectCallout`.
    AnnotationShape {
        shape_type: "text".into(),
        x: Some(100.0),
        y: Some(400.0),
        width: Some(150.0),
        height: Some(50.0),
        font_size: Some(20.0),
        fill: Some("#000000".into()),
        text: Some("Callout!".into()),
        text_bg_color: Some("rgba(255,255,200,0.92)".into()),
        text_variant: Some("callout".into()),
        tail_x: Some(300.0),
        tail_y: Some(470.0),
        ..Default::default()
    }
}

fn text_shape_legacy_carrier() -> AnnotationShape {
    // Mirror of `text_shape()` but using only the legacy
    // `stroke`-as-bg-color carrier — proves the fallback in
    // `gvml_text` produces byte-equivalent XML to the canonical form.
    AnnotationShape {
        shape_type: "text".into(),
        x: Some(10.0),
        y: Some(400.0),
        width: Some(200.0),
        height: Some(50.0),
        font_size: Some(24.0),
        fill: Some("#000000".into()),
        text: Some("Hello".into()),
        stroke: Some("rgba(255,255,200,0.92)".into()),
        ..Default::default()
    }
}

fn freehand_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "freehand".into(),
        stroke: Some("#ff00ff".into()),
        stroke_width: Some(2.0),
        // `text` carries the SVG path d-string today; deliberately
        // kept as the legacy carrier until a later cleanup pass.
        text: Some("M 0 0 L 10 10 L 20 5".into()),
        ..Default::default()
    }
}

/// 1x1 transparent PNG data URL. Bytes are irrelevant for the XML
/// snapshot — only `parse_data_url_bytes` success matters.
const TEST_PNG_DATA_URL: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

fn mosaic_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "mosaic_image".into(),
        x: Some(500.0),
        y: Some(400.0),
        width: Some(100.0),
        height: Some(80.0),
        // Phase 2 of the office-paste ABI plan made `image_data_url`
        // the canonical carrier; the legacy `text`-as-data-URL path
        // is still honored as a fallback (phase 8 drops it).
        image_data_url: Some(TEST_PNG_DATA_URL.into()),
        ..Default::default()
    }
}

fn mosaic_shape_legacy_carrier() -> AnnotationShape {
    // Mirror of `mosaic_shape()` but using only the legacy carrier
    // (`text` field) — proves the fallback in `build_drawing_xml`
    // produces byte-equivalent XML to the canonical form.
    AnnotationShape {
        shape_type: "mosaic_image".into(),
        x: Some(500.0),
        y: Some(400.0),
        width: Some(100.0),
        height: Some(80.0),
        text: Some(TEST_PNG_DATA_URL.into()),
        ..Default::default()
    }
}

#[test]
fn drawing_xml_pins_every_emitter() {
    let shapes = vec![
        rect_shape(),
        rounded_rect_shape(),
        ellipse_shape(),
        arrow_shape(),
        marker_shape(),
        text_shape(),
        freehand_shape(),
        mosaic_shape(),
    ];
    let (xml, media_files) = build_drawing_xml(&shapes, 800.0, 600.0, false);

    // The mosaic emitter is the only one that pushes a media file.
    // ABI phase 2 will rename the carrier (`text` → `image_data_url`)
    // but the count + filename pattern should remain stable.
    assert_eq!(media_files.len(), 1);
    assert!(media_files[0].0.starts_with("mosaic_"));

    insta::assert_snapshot!("drawing_xml_all_emitters", xml);
}

#[test]
fn drawing_xml_marker_legacy_stroke_carrier_matches_canonical() {
    // Output-equivalence check for phase 1's fallback: the legacy
    // `stroke == "rect"` form must produce the same XML body as
    // `marker_shape: "rect"`. Once phase 8 drops the fallback, this
    // test (and the helper) goes away.
    let canonical = build_drawing_xml(&[marker_shape()], 800.0, 600.0, false).0;
    let legacy = build_drawing_xml(&[marker_shape_legacy_carrier()], 800.0, 600.0, false).0;
    assert_eq!(canonical, legacy);
}

#[test]
fn drawing_xml_rounded_rect_legacy_type_matches_canonical() {
    // Phase 6 fallback equivalence: a payload that uses the legacy
    // `type: "rounded-rect"` (without `corner_radius`) must produce
    // the same XML body as the canonical `type: "rect"` +
    // `corner_radius` form. Phase 8 removes this test + helper.
    let canonical = build_drawing_xml(&[rounded_rect_shape()], 800.0, 600.0, false).0;
    let legacy = build_drawing_xml(&[rounded_rect_shape_legacy_type()], 800.0, 600.0, false).0;
    assert_eq!(canonical, legacy);
}

#[test]
fn drawing_xml_redact_solid_emits_no_outline() {
    // Phase 5: a `type: "rect"` + `redact_style: "solid"` rect must
    // emit `<a:ln><a:noFill/></a:ln>` instead of the user-supplied
    // stroke paint, matching PowerPoint's "rectangle (no outline)"
    // preset. Plain rects keep their outline.
    let (xml, _) = build_drawing_xml(&[redact_solid_shape()], 800.0, 600.0, false);
    insta::assert_snapshot!("drawing_xml_redact_solid_no_outline", xml);
}

#[test]
fn drawing_xml_callout_emits_wedge_round_rect_callout() {
    // Phase 4: a callout with a populated tail tip switches from
    // the plain `roundRect` form to `wedgeRoundRectCallout`. The
    // signed adj1/adj2 percentages encode the tail offset from the
    // bbox center; for a 150x50 bbox at (100,400) and tail at
    // (300,470), the offsets are dx = +125 (≈+83333), dy = +45
    // (≈+90000).
    let (xml, _) = build_drawing_xml(&[callout_shape()], 800.0, 600.0, false);
    insta::assert_snapshot!("drawing_xml_callout_with_tail", xml);
}

#[test]
fn drawing_xml_text_legacy_stroke_bg_carrier_matches_canonical() {
    // Phase 3 fallback equivalence: a payload that stashes the
    // sticky bg color in `stroke` (pre-phase-3 form) must produce
    // the same XML body as the canonical `text_bg_color` form.
    // Phase 8 drops both this test and the helper.
    let canonical = build_drawing_xml(&[text_shape()], 800.0, 600.0, false).0;
    let legacy = build_drawing_xml(&[text_shape_legacy_carrier()], 800.0, 600.0, false).0;
    assert_eq!(canonical, legacy);
}

#[test]
fn drawing_xml_mosaic_legacy_text_carrier_matches_canonical() {
    // Phase 2 fallback equivalence: a payload that stashes the data
    // URL in `text` (pre-phase-2 form) must produce the same XML
    // body as the canonical `image_data_url` form. Phase 8 drops
    // both this test and the helper.
    let canonical = build_drawing_xml(&[mosaic_shape()], 800.0, 600.0, false).0;
    let legacy = build_drawing_xml(&[mosaic_shape_legacy_carrier()], 800.0, 600.0, false).0;
    assert_eq!(canonical, legacy);
}

#[test]
fn drawing_xml_marker_rounded_emits_high_adj_round_rect() {
    let (xml, _) = build_drawing_xml(&[marker_rounded_shape()], 800.0, 600.0, false);
    insta::assert_snapshot!("drawing_xml_marker_rounded", xml);
}

#[test]
fn drawing_xml_with_background_screenshot() {
    // `has_image: true` prepends an <a:pic> for the rId2-bound
    // screenshot. Pin its XML separately so the wrapping envelope
    // stays untouched across phases.
    let shapes = vec![rect_shape()];
    let (xml, media_files) = build_drawing_xml(&shapes, 1024.0, 768.0, true);

    assert!(media_files.is_empty());
    insta::assert_snapshot!("drawing_xml_with_screenshot", xml);
}
