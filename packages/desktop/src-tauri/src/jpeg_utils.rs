use std::io::Cursor;

/// Encode RGB image data as Progressive JPEG Q90
pub fn encode_progressive_jpeg(rgb_data: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let mut buf = Cursor::new(Vec::new());
    let mut encoder = jpeg_encoder::Encoder::new(&mut buf, 90);
    encoder.set_progressive(true);
    encoder
        .encode(rgb_data, width as u16, height as u16, jpeg_encoder::ColorType::Rgb)
        .map_err(|e| format!("JPEG encode: {e}"))?;
    Ok(buf.into_inner())
}

/// Convert any image (PNG/JPEG/etc) to Progressive JPEG Q90
pub fn image_to_progressive_jpeg(data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(data).map_err(|e| e.to_string())?;
    let rgb = img.to_rgb8();
    encode_progressive_jpeg(rgb.as_raw(), rgb.width(), rgb.height())
}
