//! wasm-bindgen wrapper around the upstream `imagequant` crate.
//!
//! Exposes a single entry point with the same shape as the existing
//! `@panda-ai/imagequant` binding consumed at
//! `packages/core/src/encode/index.ts`:
//!
//!   `quantize_image(rgba, width, height, max_colors) -> { palette, indices }`
//!
//! - `rgba`: tightly packed RGBA8 bytes (length must be `width * height * 4`).
//! - `palette`: flattened RGBA8 palette bytes (`palette.length == colorCount * 4`).
//! - `indices`: one byte per pixel, indexing into the palette.
//!
//! No DOM access. No allocation knobs other than libimagequant's defaults
//! (Median Cut + Voronoi refinement, alpha-aware, 256-colour cap by
//! default — same algorithm as `pngquant`).

use imagequant::{Attributes, RGBA};
use js_sys::{Object, Reflect, Uint8Array};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn quantize_image(
    rgba: &[u8],
    width: u32,
    height: u32,
    max_colors: u32,
) -> Result<JsValue, JsValue> {
    let w = width as usize;
    let h = height as usize;
    let expected = w
        .checked_mul(h)
        .and_then(|p| p.checked_mul(4))
        .ok_or_else(|| JsValue::from_str("imagequant: width * height * 4 overflowed usize"))?;
    if rgba.len() != expected {
        return Err(JsValue::from_str(&format!(
            "imagequant: rgba length {} does not match width*height*4 = {}",
            rgba.len(),
            expected,
        )));
    }

    let mut liq = Attributes::new();
    liq.set_max_colors(max_colors).map_err(to_js_err)?;

    // libimagequant's `new_image` borrows the pixel slice for the lifetime
    // of the resulting `Image`. Re-pack the byte slice into `Vec<RGBA>`
    // so the typed view outlives the call (one extra heap allocation, on
    // par with the existing `@panda-ai/imagequant` binding).
    let pixels: Vec<RGBA> = rgba
        .chunks_exact(4)
        .map(|c| RGBA::new(c[0], c[1], c[2], c[3]))
        .collect();

    let mut img = liq
        .new_image(pixels.as_slice(), w, h, 0.0)
        .map_err(to_js_err)?;

    let mut result = liq.quantize(&mut img).map_err(to_js_err)?;
    let (palette, indices) = result.remapped(&mut img).map_err(to_js_err)?;

    let mut palette_bytes: Vec<u8> = Vec::with_capacity(palette.len() * 4);
    for c in &palette {
        palette_bytes.extend_from_slice(&[c.r, c.g, c.b, c.a]);
    }

    let palette_arr = Uint8Array::new_with_length(palette_bytes.len() as u32);
    palette_arr.copy_from(&palette_bytes);

    let indices_arr = Uint8Array::new_with_length(indices.len() as u32);
    indices_arr.copy_from(&indices);

    let obj = Object::new();
    Reflect::set(&obj, &JsValue::from_str("palette"), &palette_arr.into())?;
    Reflect::set(&obj, &JsValue::from_str("indices"), &indices_arr.into())?;
    Ok(obj.into())
}

fn to_js_err(e: imagequant::Error) -> JsValue {
    JsValue::from_str(&format!("imagequant: {}", e))
}
