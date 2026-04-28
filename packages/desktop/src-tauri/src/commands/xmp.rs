use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use tauri::command;

const XMP_NAMESPACE: &str = "annot";
const XMP_NS_URI: &str = "https://ingcreators.com/annot/ns/1.0/";
const XMP_APP1_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const PNG_XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp";
// Custom APP2 marker for storing original image data
const ANNOT_APP2_PREFIX: &[u8] = b"annot:OriginalImage\0";

#[derive(Debug, Serialize, Deserialize)]
pub struct SvgshotMetadata {
    pub original_image_b64: String,
    pub annotations_svg: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub tags: String,
}

/// Build compact XMP (annotations + dimensions + tags, no large image data)
fn build_xmp(annotations_svg: &str, width: u32, height: u32, tags: &str) -> String {
    let tags_line = if tags.is_empty() || tags == "{}" {
        String::new()
    } else {
        format!("\n      <{ns}:tags>{tags}</{ns}:tags>", ns = XMP_NAMESPACE, tags = tags)
    };
    format!(
        r#"<?xpacket begin="\u{{feff}}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      xmlns:{ns}="{ns_uri}">
      <{ns}:annotations><![CDATA[{svg}]]></{ns}:annotations>
      <{ns}:width>{w}</{ns}:width>
      <{ns}:height>{h}</{ns}:height>
      <{ns}:version>1.0</{ns}:version>{tags_line}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>"#,
        ns = XMP_NAMESPACE, ns_uri = XMP_NS_URI,
        svg = annotations_svg, w = width, h = height,
    )
}

fn parse_xmp(xmp: &str, original_b64: &str) -> Option<SvgshotMetadata> {
    let svg = extract_tag(xmp, "annotations")?;
    let svg = svg.trim_start_matches("<![CDATA[").trim_end_matches("]]>").to_string();
    let width = extract_tag(xmp, "width").and_then(|s| s.parse().ok()).unwrap_or(0);
    let height = extract_tag(xmp, "height").and_then(|s| s.parse().ok()).unwrap_or(0);
    let tags = extract_tag(xmp, "tags").unwrap_or_default();
    Some(SvgshotMetadata {
        original_image_b64: original_b64.to_string(),
        annotations_svg: svg,
        width,
        height,
        tags,
    })
}

fn extract_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{}:{}>", XMP_NAMESPACE, tag);
    let close = format!("</{}:{}>", XMP_NAMESPACE, tag);
    let start = xml.find(&open)? + open.len();
    let end = xml.find(&close)?;
    Some(xml[start..end].to_string())
}

fn png_to_jpeg_bytes(png_data: &[u8]) -> Result<Vec<u8>, String> {
    crate::jpeg_utils::image_to_progressive_jpeg(png_data)
}

/// Save image with XMP metadata (annotations in XMP, original image in APP2 segments)
#[command]
pub async fn save_with_xmp(
    rendered_image_b64: String,
    original_image_b64: String,
    annotations_svg: String,
    width: u32,
    height: u32,
    file_path: String,
    #[allow(unused)] tags: Option<String>,
) -> Result<(), String> {
    let tags_str = tags.unwrap_or_default();
    let xmp_xml = build_xmp(&annotations_svg, width, height, &tags_str);
    let img_bytes = STANDARD.decode(&rendered_image_b64).map_err(|e| e.to_string())?;
    let original_raw = STANDARD.decode(&original_image_b64).map_err(|e| e.to_string())?;
    // Ensure original image is Progressive JPEG
    let original_bytes = crate::jpeg_utils::image_to_progressive_jpeg(&original_raw)
        .unwrap_or(original_raw);

    if file_path.ends_with(".png") {
        write_png_with_metadata(&img_bytes, xmp_xml.as_bytes(), &original_bytes, &file_path)
    } else {
        let jpeg_bytes = if img_bytes.starts_with(b"\x89PNG") {
            png_to_jpeg_bytes(&img_bytes)?
        } else {
            img_bytes
        };
        write_jpeg_with_metadata(&jpeg_bytes, xmp_xml.as_bytes(), &original_bytes, &file_path)
    }
}

/// Read XMP metadata from image file
#[command]
pub async fn read_xmp(file_path: String) -> Result<Option<SvgshotMetadata>, String> {
    let data = std::fs::read(&file_path).map_err(|e| e.to_string())?;
    if file_path.ends_with(".png") {
        let xmp_str = read_png_xmp(&data);
        let original = read_png_original(&data);
        let original_b64 = original.map(|b| STANDARD.encode(&b)).unwrap_or_default();
        Ok(xmp_str.and_then(|s| parse_xmp(&s, &original_b64)))
    } else {
        let xmp_str = read_jpeg_xmp(&data);
        let original = read_jpeg_original(&data);
        let original_b64 = original.map(|b| STANDARD.encode(&b)).unwrap_or_default();
        Ok(xmp_str.and_then(|s| parse_xmp(&s, &original_b64)))
    }
}

// ======================
// JPEG: XMP in APP1, original image in multiple APP2 segments
// ======================

fn write_jpeg_with_metadata(jpeg_data: &[u8], xmp: &[u8], original: &[u8], path: &str) -> Result<(), String> {
    if jpeg_data.len() < 2 || jpeg_data[0] != 0xFF || jpeg_data[1] != 0xD8 {
        return Err("Not a valid JPEG".into());
    }

    // Build XMP APP1
    let mut xmp_payload = XMP_APP1_PREFIX.to_vec();
    xmp_payload.extend_from_slice(xmp);
    let xmp_seg = build_jpeg_segment(0xE1, &xmp_payload);

    // Build original image APP2 segments (split into ~60KB chunks)
    let app2_segments = build_app2_segments(original);

    // Clean JPEG: remove old XMP APP1 and Annot APP2
    let cleaned = remove_jpeg_metadata(jpeg_data);

    let mut output = Vec::with_capacity(cleaned.len() + xmp_seg.len() + app2_segments.len());
    output.extend_from_slice(&cleaned[..2]); // SOI
    output.extend_from_slice(&xmp_seg);
    output.extend_from_slice(&app2_segments);
    output.extend_from_slice(&cleaned[2..]);

    std::fs::write(path, &output).map_err(|e| e.to_string())
}

fn build_jpeg_segment(marker: u8, payload: &[u8]) -> Vec<u8> {
    let seg_len = (payload.len() + 2) as u16;
    let mut seg = vec![0xFF, marker];
    seg.extend_from_slice(&seg_len.to_be_bytes());
    seg.extend_from_slice(payload);
    seg
}

fn build_app2_segments(data: &[u8]) -> Vec<u8> {
    // Each APP2 segment: FF E2 [len] "annot:OriginalImage\0" [seq:2] [total:2] [chunk]
    // Max payload per segment: 65533 - prefix(22) - seq(2) - total(2) = 65507
    let prefix_len = ANNOT_APP2_PREFIX.len();
    let max_chunk = 65533 - prefix_len - 4; // 4 bytes for seq + total
    let total_chunks = (data.len() + max_chunk - 1) / max_chunk;
    let mut result = Vec::new();

    for i in 0..total_chunks {
        let start = i * max_chunk;
        let end = (start + max_chunk).min(data.len());
        let chunk = &data[start..end];

        let mut payload = ANNOT_APP2_PREFIX.to_vec();
        payload.extend_from_slice(&(i as u16).to_be_bytes());
        payload.extend_from_slice(&(total_chunks as u16).to_be_bytes());
        payload.extend_from_slice(chunk);

        result.extend_from_slice(&build_jpeg_segment(0xE2, &payload));
    }
    result
}

fn remove_jpeg_metadata(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    result.extend_from_slice(&data[..2]);
    let mut pos = 2;
    while pos + 4 <= data.len() {
        if data[pos] != 0xFF { break; }
        let marker = data[pos + 1];
        if marker == 0xD9 || marker == 0xDA {
            result.extend_from_slice(&data[pos..]);
            return result;
        }
        let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        let seg_end = pos + 2 + seg_len;
        if seg_end > data.len() { break; }

        let is_xmp = marker == 0xE1 && data[pos + 4..].starts_with(XMP_APP1_PREFIX);
        let is_annot = marker == 0xE2 && data[pos + 4..].starts_with(ANNOT_APP2_PREFIX);

        if !is_xmp && !is_annot {
            result.extend_from_slice(&data[pos..seg_end]);
        }
        pos = seg_end;
    }
    if pos < data.len() { result.extend_from_slice(&data[pos..]); }
    result
}

fn read_jpeg_xmp(data: &[u8]) -> Option<String> {
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 { return None; }
    let mut pos = 2;
    while pos + 4 <= data.len() {
        if data[pos] != 0xFF { break; }
        let marker = data[pos + 1];
        if marker == 0xD9 || marker == 0xDA { break; }
        let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        let seg_end = pos + 2 + seg_len;
        if seg_end > data.len() { break; }

        if marker == 0xE1 && data[pos + 4..].starts_with(XMP_APP1_PREFIX) {
            let xmp_start = pos + 4 + XMP_APP1_PREFIX.len();
            return String::from_utf8(data[xmp_start..seg_end].to_vec()).ok();
        }
        pos = seg_end;
    }
    None
}

fn read_jpeg_original(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 { return None; }

    let prefix_len = ANNOT_APP2_PREFIX.len();
    let mut chunks: Vec<(u16, Vec<u8>)> = Vec::new();

    let mut pos = 2;
    while pos + 4 <= data.len() {
        if data[pos] != 0xFF { break; }
        let marker = data[pos + 1];
        if marker == 0xD9 || marker == 0xDA { break; }
        let seg_len = u16::from_be_bytes([data[pos + 2], data[pos + 3]]) as usize;
        let seg_end = pos + 2 + seg_len;
        if seg_end > data.len() { break; }

        if marker == 0xE2 && data[pos + 4..].starts_with(ANNOT_APP2_PREFIX) {
            let header_end = pos + 4 + prefix_len;
            if header_end + 4 <= seg_end {
                let seq = u16::from_be_bytes([data[header_end], data[header_end + 1]]);
                let chunk_data = data[header_end + 4..seg_end].to_vec();
                chunks.push((seq, chunk_data));
            }
        }
        pos = seg_end;
    }

    if chunks.is_empty() { return None; }
    chunks.sort_by_key(|(seq, _)| *seq);

    let mut result = Vec::new();
    for (_, chunk) in chunks {
        result.extend_from_slice(&chunk);
    }
    Some(result)
}

// ======================
// PNG: XMP in iTXt, original image in custom chunk "svGo"
// ======================

fn write_png_with_metadata(png_data: &[u8], xmp: &[u8], original: &[u8], path: &str) -> Result<(), String> {
    if png_data.len() < 8 || &png_data[..4] != b"\x89PNG" {
        return Err("Not a valid PNG".into());
    }

    let itxt_chunk = build_png_itxt_chunk(xmp);
    let orig_chunk = build_png_chunk(b"svGo", original); // custom ancillary chunk

    let cleaned = remove_png_metadata(png_data)?;

    let insert_pos = cleaned.len() - 12; // before IEND
    let mut output = Vec::with_capacity(cleaned.len() + itxt_chunk.len() + orig_chunk.len());
    output.extend_from_slice(&cleaned[..insert_pos]);
    output.extend_from_slice(&itxt_chunk);
    output.extend_from_slice(&orig_chunk);
    output.extend_from_slice(&cleaned[insert_pos..]);

    std::fs::write(path, &output).map_err(|e| e.to_string())
}

fn read_png_xmp(data: &[u8]) -> Option<String> {
    if data.len() < 8 || &data[..4] != b"\x89PNG" { return None; }
    let mut pos = 8;
    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
        let chunk_type = &data[pos+4..pos+8];
        let chunk_data_start = pos + 8;
        let chunk_end = chunk_data_start + chunk_len + 4;
        if chunk_end > data.len() { break; }

        if chunk_type == b"iTXt" {
            let chunk_data = &data[chunk_data_start..chunk_data_start + chunk_len];
            if chunk_data.starts_with(PNG_XMP_KEYWORD) {
                let after_kw = &chunk_data[PNG_XMP_KEYWORD.len()..];
                let mut nulls = 0;
                let mut xmp_start = 0;
                for (i, &b) in after_kw.iter().enumerate() {
                    if b == 0 { nulls += 1; }
                    if nulls >= 4 { xmp_start = i + 1; break; }
                }
                return String::from_utf8(after_kw[xmp_start..].to_vec()).ok();
            }
        }
        pos = chunk_end;
    }
    None
}

fn read_png_original(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 8 || &data[..4] != b"\x89PNG" { return None; }
    let mut pos = 8;
    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
        let chunk_type = &data[pos+4..pos+8];
        let chunk_data_start = pos + 8;
        let chunk_end = chunk_data_start + chunk_len + 4;
        if chunk_end > data.len() { break; }

        if chunk_type == b"svGo" {
            return Some(data[chunk_data_start..chunk_data_start + chunk_len].to_vec());
        }
        pos = chunk_end;
    }
    None
}

fn remove_png_metadata(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut result = Vec::with_capacity(data.len());
    result.extend_from_slice(&data[..8]);
    let mut pos = 8;
    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]) as usize;
        let chunk_type = &data[pos+4..pos+8];
        let chunk_data_start = pos + 8;
        let chunk_end = chunk_data_start + chunk_len + 4;
        if chunk_end > data.len() { break; }

        let is_xmp = chunk_type == b"iTXt" && data[chunk_data_start..].starts_with(PNG_XMP_KEYWORD);
        let is_orig = chunk_type == b"svGo";

        if !is_xmp && !is_orig {
            result.extend_from_slice(&data[pos..chunk_end]);
        }
        pos = chunk_end;
    }
    Ok(result)
}

// ======================
// PNG chunk helpers
// ======================

fn build_png_itxt_chunk(xmp: &[u8]) -> Vec<u8> {
    let mut itxt_data = Vec::new();
    itxt_data.extend_from_slice(PNG_XMP_KEYWORD);
    itxt_data.push(0); // null
    itxt_data.push(0); // compression flag
    itxt_data.push(0); // compression method
    itxt_data.push(0); // language
    itxt_data.push(0); // translated keyword
    itxt_data.extend_from_slice(xmp);
    build_png_chunk(b"iTXt", &itxt_data)
}

fn build_png_chunk(chunk_type: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut chunk = Vec::with_capacity(12 + data.len());
    chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
    chunk.extend_from_slice(chunk_type);
    chunk.extend_from_slice(data);
    let crc = crc32(&chunk[4..]);
    chunk.extend_from_slice(&crc.to_be_bytes());
    chunk
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFFFFFF;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 { crc = (crc >> 1) ^ 0xEDB88320; }
            else { crc >>= 1; }
        }
    }
    !crc
}
