use serde::{Deserialize, Serialize};
use serde_yaml::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};

/// On-disk shape of the tool-presets YAML file.
///
/// The Rust side is intentionally **schema-transparent** for the
/// inner preset values: the JS toolbar
/// (`packages/web/src/editor/toolbar.ts`) is the source of truth for
/// which fields each tool persists, driven by per-tool `presetFields`
/// arrays in `packages/core/src/editor/tool-registry.ts`. Anything
/// the JS side emits round-trips through this Rust struct unchanged.
///
/// History: this used to be `HashMap<String, ToolPreset>` where
/// `ToolPreset` named six specific fields (stroke_color, fill_color,
/// stroke_width, font_size, stroke_dasharray, fill_opacity) with
/// `#[serde(default = …)]` defaults. That silently DROPPED every
/// other field on save — including the variant discriminators
/// (shape_type / arrow_head / text_variant / draw_style /
/// redact_style / marker_shape / highlight_color), the per-end arrow
/// shape / width / length, and the stroke opacity / cap / join. The
/// `last_variants` field was also missing on the wrapper, so the
/// user's last-used variant tracking was lost on every Tauri
/// session. Replacing the typed inner struct with `serde_yaml::Value`
/// closes both gaps while keeping the YAML output identical for the
/// six historical fields.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolPresets {
    /// Preset map. Keys are element keys ("shape.rect", "arrow.end")
    /// for tools with variants, or bare tool IDs ("crop") for tools
    /// without variants. Each value is a free-form YAML mapping; the
    /// Rust side never inspects the inner shape.
    #[serde(default)]
    pub tools: HashMap<String, Value>,
    /// Last-used variant per tool. Keyed by tool id, value is the
    /// variant string. Skipped on serialize when empty so the YAML
    /// output stays clean for fresh installs.
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub last_variants: HashMap<String, String>,
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
