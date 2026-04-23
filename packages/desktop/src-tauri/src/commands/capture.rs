use crate::db::Database;
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{command, State};
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveResult {
    pub id: i64,
    pub path: String,
    pub thumbnail_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IncomingCapture {
    pub filename: String,
    pub path: String,
    pub source_url: String,
    pub width: u32,
    pub height: u32,
}

/// Save a screenshot (base64 data URL) to disk and register in DB
#[command]
pub async fn save_screenshot(
    db: State<'_, Database>,
    data: String,
    project_id: Option<i64>,
    source_url: Option<String>,
    base_dir: String,
) -> Result<SaveResult, String> {
    let project = project_id.unwrap_or(1);
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let uid = &Uuid::new_v4().to_string()[..8];

    // Parse data URL
    let (mime, base64_data) = parse_data_url(&data).map_err(|e| e.to_string())?;
    let bytes = STANDARD.decode(base64_data).map_err(|e| e.to_string())?;

    // Convert PNG to JPEG for consistent storage
    let (bytes, ext) = if mime.contains("png") {
        match png_to_jpeg(&bytes) {
            Ok(jpeg) => (jpeg, "jpg"),
            Err(_) => (bytes, "png"),
        }
    } else {
        (bytes, "jpg")
    };
    let filename = format!("anno_{}_{}.{}", timestamp, uid, ext);

    // Save to project directory
    let dir = PathBuf::from(&base_dir).join(format!("project_{}", project));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&filename);
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    // Get dimensions
    let (width, height) = get_image_dimensions(&bytes).unwrap_or((0, 0));

    // Generate thumbnail
    let thumb_filename = format!("thumb_{}", &filename);
    let thumb_path = dir.join(&thumb_filename);
    generate_thumbnail(&bytes, &thumb_path).ok();

    // Insert into DB
    let conn = db.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO images (project_id, filename, path, width, height, thumbnail_path, source_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            project,
            &filename,
            path.to_string_lossy().to_string(),
            width,
            height,
            thumb_path.to_string_lossy().to_string(),
            source_url.unwrap_or_default(),
        ],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    Ok(SaveResult {
        id,
        path: path.to_string_lossy().to_string(),
        thumbnail_path: thumb_path.to_string_lossy().to_string(),
    })
}

/// Load a screenshot as base64 data URL
#[command]
pub async fn load_screenshot(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let base64 = STANDARD.encode(&bytes);
    let mime = if path.ends_with(".png") {
        "image/png"
    } else {
        "image/jpeg"
    };
    Ok(format!("data:{};base64,{}", mime, base64))
}

/// Check the incoming folder for captures from Chrome extension via Native Messaging
#[command]
pub async fn check_incoming(
    db: State<'_, Database>,
    base_dir: String,
) -> Result<Vec<SaveResult>, String> {
    let incoming_dir = get_incoming_dir();
    if !incoming_dir.exists() {
        return Ok(vec![]);
    }

    let mut results = Vec::new();

    // Look for .json metadata files
    let entries: Vec<_> = std::fs::read_dir(&incoming_dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map_or(false, |ext| ext == "json"))
        .collect();

    for entry in entries {
        let meta_path = entry.path();
        let meta_content = match std::fs::read_to_string(&meta_path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let meta: serde_json::Value = match serde_json::from_str(&meta_content) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let img_path_str = meta["path"].as_str().unwrap_or("");
        let img_path = PathBuf::from(img_path_str);
        if !img_path.exists() {
            // Clean up orphan meta
            std::fs::remove_file(&meta_path).ok();
            continue;
        }

        let source_url = meta["source_url"].as_str().unwrap_or("").to_string();
        let bytes = match std::fs::read(&img_path) {
            Ok(b) => b,
            Err(_) => continue,
        };

        let (width, height) = get_image_dimensions(&bytes).unwrap_or((0, 0));
        let filename = img_path.file_name().unwrap_or_default().to_string_lossy().to_string();

        // Move to project directory
        let project_dir = PathBuf::from(&base_dir).join("project_1");
        std::fs::create_dir_all(&project_dir).ok();
        let dest = project_dir.join(&filename);
        std::fs::rename(&img_path, &dest).or_else(|_| {
            // rename may fail across drives, fallback to copy+delete
            std::fs::copy(&img_path, &dest).map(|_| ()).and_then(|_| std::fs::remove_file(&img_path))
        }).ok();

        // Generate thumbnail
        let thumb_filename = format!("thumb_{}", &filename);
        let thumb_path = project_dir.join(&thumb_filename);
        generate_thumbnail(&bytes, &thumb_path).ok();

        // Insert into DB
        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "INSERT INTO images (project_id, filename, path, width, height, thumbnail_path, source_url)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &filename,
                    dest.to_string_lossy().to_string(),
                    width,
                    height,
                    thumb_path.to_string_lossy().to_string(),
                    &source_url,
                ],
            ).ok();

            let id = conn.last_insert_rowid();
            results.push(SaveResult {
                id,
                path: dest.to_string_lossy().to_string(),
                thumbnail_path: thumb_path.to_string_lossy().to_string(),
            });
        }

        // Clean up meta file
        std::fs::remove_file(&meta_path).ok();
    }

    Ok(results)
}

fn get_incoming_dir() -> PathBuf {
    crate::portable_dir().join("data").join("incoming")
}

fn parse_data_url(data: &str) -> Result<(&str, &str), &'static str> {
    if let Some(comma) = data.find(',') {
        let header = &data[..comma];
        let mime = header
            .strip_prefix("data:")
            .and_then(|s| s.strip_suffix(";base64"))
            .unwrap_or("image/jpeg");
        Ok((mime, &data[comma + 1..]))
    } else {
        Ok(("image/jpeg", data))
    }
}

fn get_image_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    let reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let dims = reader.into_dimensions().ok()?;
    Some(dims)
}

fn png_to_jpeg(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    crate::jpeg_utils::image_to_progressive_jpeg(png_bytes)
}

fn generate_thumbnail(bytes: &[u8], out_path: &std::path::Path) -> Result<(), String> {
    let img = image::load_from_memory(bytes).map_err(|e| e.to_string())?;
    let w = img.width();
    let h = img.height();

    // Resize to 320px width, then crop top portion for thumbnail
    let thumb_w = 320u32;
    let thumb_h = 180u32;
    let resized = img.resize(thumb_w, thumb_w * h / w.max(1), image::imageops::FilterType::Lanczos3);

    // Crop to 320x180 from top (shows the top of the page)
    let crop_h = resized.height().min(thumb_h);
    let cropped = resized.crop_imm(0, 0, thumb_w.min(resized.width()), crop_h);

    cropped.save(out_path).map_err(|e| e.to_string())?;
    Ok(())
}
