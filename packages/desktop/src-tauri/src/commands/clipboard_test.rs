//! Golden-snapshot regression net for the GVML drawing XML produced
//! by `copy_as_office`. Exercises every emitter
//! (`rect` / `ellipse` / `arrow` / `marker` / `text` / `freehand` /
//! `mosaic_image`) so any future change to the drawing output is
//! either intentional (and called out in the PR) or caught here.

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
        marker_shape: Some("rect".into()),
        ..Default::default()
    }
}

fn marker_rounded_shape() -> AnnotationShape {
    // `marker_shape: "rounded"` emits `roundRect` with adj=30000 so
    // the OOXML preset visibly matches the SVG-side
    // `cornerRadius = r * 0.6` rendering.
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
        text_bg_color: Some("rgba(255,255,200,0.92)".into()),
        ..Default::default()
    }
}

fn redact_solid_shape() -> AnnotationShape {
    // Solid-fill redaction bar — `gvml_rect` emits
    // `<a:ln><a:noFill/></a:ln>` regardless of any populated
    // `stroke_*` fields, matching PowerPoint's "rectangle (no
    // outline)" preset.
    AnnotationShape {
        shape_type: "rect".into(),
        x: Some(50.0),
        y: Some(500.0),
        width: Some(120.0),
        height: Some(30.0),
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
    // its bottom-right. `gvml_text` switches `prstGeom` from
    // `roundRect` to `wedgeRoundRectCallout` when `text_variant`
    // and `tail_x` / `tail_y` are populated.
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

fn freehand_shape() -> AnnotationShape {
    AnnotationShape {
        shape_type: "freehand".into(),
        stroke: Some("#ff00ff".into()),
        stroke_width: Some(2.0),
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
        image_data_url: Some(TEST_PNG_DATA_URL.into()),
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
    assert_eq!(media_files.len(), 1);
    assert!(media_files[0].0.starts_with("mosaic_"));

    insta::assert_snapshot!("drawing_xml_all_emitters", xml);
}

#[test]
fn drawing_xml_redact_solid_emits_no_outline() {
    // A `type: "rect"` + `redact_style: "solid"` rect must emit
    // `<a:ln><a:noFill/></a:ln>` instead of the user-supplied stroke
    // paint, matching PowerPoint's "rectangle (no outline)" preset.
    // Plain rects keep their outline.
    let (xml, _) = build_drawing_xml(&[redact_solid_shape()], 800.0, 600.0, false);
    insta::assert_snapshot!("drawing_xml_redact_solid_no_outline", xml);
}

#[test]
fn drawing_xml_callout_emits_wedge_round_rect_callout() {
    // For a 150x50 bbox at (100,400) and tail at (300,470), the
    // signed adj1/adj2 percentages are dx = +125 (≈+83333),
    // dy = +45 (≈+90000).
    let (xml, _) = build_drawing_xml(&[callout_shape()], 800.0, 600.0, false);
    insta::assert_snapshot!("drawing_xml_callout_with_tail", xml);
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
    // stays untouched.
    let shapes = vec![rect_shape()];
    let (xml, media_files) = build_drawing_xml(&shapes, 1024.0, 768.0, true);

    assert!(media_files.is_empty());
    insta::assert_snapshot!("drawing_xml_with_screenshot", xml);
}
