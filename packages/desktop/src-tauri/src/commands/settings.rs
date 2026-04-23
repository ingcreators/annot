use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolPreset {
    #[serde(default = "default_stroke_color")]
    pub stroke_color: String,
    #[serde(default = "default_fill_color")]
    pub fill_color: String,
    #[serde(default = "default_stroke_width")]
    pub stroke_width: f64,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default)]
    pub stroke_dasharray: String,
    #[serde(default = "default_fill_opacity")]
    pub fill_opacity: f64,
}

fn default_stroke_color() -> String { "#ff0000".into() }
fn default_fill_color() -> String { "none".into() }
fn default_fill_opacity() -> f64 { 1.0 }
fn default_stroke_width() -> f64 { 3.0 }
fn default_font_size() -> f64 { 24.0 }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolPresets {
    #[serde(default)]
    pub tools: HashMap<String, ToolPreset>,
}

/// Get the portable base directory (same directory as the exe)
fn portable_dir() -> PathBuf {
    std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

/// Get the path to the default presets YAML (shipped with the app)
fn default_presets_path(_app: &AppHandle) -> PathBuf {
    let dir = portable_dir();
    // Check EXE directory first, then resources/ subdirectory (Tauri bundle)
    let direct = dir.join("tool-presets.yml");
    if direct.exists() { return direct; }
    dir.join("resources").join("tool-presets.yml")
}

/// Get the path to the user's presets YAML (portable: next to exe)
fn user_presets_path(_app: &AppHandle) -> PathBuf {
    portable_dir().join("user-presets.yml")
}

/// Get the portable data directory (for images etc.)
#[command]
pub async fn get_portable_dir() -> Result<String, String> {
    let dir = portable_dir().join("data");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Load tool presets: user file takes priority, falls back to default
#[command]
pub async fn load_tool_presets(app: AppHandle) -> Result<ToolPresets, String> {
    let user_path = user_presets_path(&app);
    let default_path = default_presets_path(&app);

    // Try user file first
    if user_path.exists() {
        let content = std::fs::read_to_string(&user_path).map_err(|e| e.to_string())?;
        let presets: ToolPresets = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(presets);
    }

    // Fall back to default
    if default_path.exists() {
        let content = std::fs::read_to_string(&default_path).map_err(|e| e.to_string())?;
        let presets: ToolPresets = serde_yaml::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(presets);
    }

    // No file found, return empty (will use hardcoded defaults)
    Ok(ToolPresets::default())
}

/// Save tool presets to user file
#[command]
pub async fn save_tool_presets(app: AppHandle, presets: ToolPresets) -> Result<(), String> {
    let path = user_presets_path(&app);
    let content = serde_yaml::to_string(&presets).map_err(|e| e.to_string())?;
    std::fs::write(&path, &content).map_err(|e| e.to_string())?;
    Ok(())
}
