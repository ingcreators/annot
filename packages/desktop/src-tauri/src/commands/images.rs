use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: i64,
    pub project_id: Option<i64>,
    pub filename: String,
    pub path: String,
    pub svg_path: Option<String>,
    pub width: i64,
    pub height: i64,
    pub thumbnail_path: Option<String>,
    pub tags: String,
    pub source_url: String,
    pub notes: String,
    pub created_at: String,
}

#[command]
pub async fn list_images(
    db: State<'_, Database>,
    project_id: Option<i64>,
    search: Option<String>,
) -> Result<Vec<ImageInfo>, String> {
    let conn = db.conn.lock().unwrap();

    let (query, params): (String, Vec<Box<dyn rusqlite::types::ToSql>>) = match (project_id, search)
    {
        (Some(pid), Some(ref q)) if !q.is_empty() => (
            "SELECT id, project_id, filename, path, svg_path, width, height, thumbnail_path, tags, source_url, notes, created_at
             FROM images WHERE project_id = ?1 AND (filename LIKE ?2 OR tags LIKE ?2 OR notes LIKE ?2)
             ORDER BY created_at DESC".to_string(),
            vec![Box::new(pid) as Box<dyn rusqlite::types::ToSql>, Box::new(format!("%{}%", q))],
        ),
        (Some(pid), _) => (
            "SELECT id, project_id, filename, path, svg_path, width, height, thumbnail_path, tags, source_url, notes, created_at
             FROM images WHERE project_id = ?1 ORDER BY created_at DESC".to_string(),
            vec![Box::new(pid) as Box<dyn rusqlite::types::ToSql>],
        ),
        (None, Some(ref q)) if !q.is_empty() => (
            "SELECT id, project_id, filename, path, svg_path, width, height, thumbnail_path, tags, source_url, notes, created_at
             FROM images WHERE filename LIKE ?1 OR tags LIKE ?1 OR notes LIKE ?1
             ORDER BY created_at DESC".to_string(),
            vec![Box::new(format!("%{}%", q)) as Box<dyn rusqlite::types::ToSql>],
        ),
        _ => (
            "SELECT id, project_id, filename, path, svg_path, width, height, thumbnail_path, tags, source_url, notes, created_at
             FROM images ORDER BY created_at DESC".to_string(),
            vec![],
        ),
    };

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(ImageInfo {
                id: row.get(0)?,
                project_id: row.get(1)?,
                filename: row.get(2)?,
                path: row.get(3)?,
                svg_path: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                thumbnail_path: row.get(7)?,
                tags: row.get(8)?,
                source_url: row.get(9)?,
                notes: row.get(10)?,
                created_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut images = Vec::new();
    for row in rows {
        images.push(row.map_err(|e| e.to_string())?);
    }
    Ok(images)
}

#[command]
pub async fn update_image(
    db: State<'_, Database>,
    id: i64,
    tags: Option<String>,
    notes: Option<String>,
    svg_path: Option<String>,
    project_id: Option<i64>,
) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();
    let mut updates = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut idx = 1;

    if let Some(t) = tags {
        updates.push(format!("tags = ?{}", idx));
        params.push(Box::new(t));
        idx += 1;
    }
    if let Some(n) = notes {
        updates.push(format!("notes = ?{}", idx));
        params.push(Box::new(n));
        idx += 1;
    }
    if let Some(s) = svg_path {
        updates.push(format!("svg_path = ?{}", idx));
        params.push(Box::new(s));
        idx += 1;
    }
    if let Some(p) = project_id {
        updates.push(format!("project_id = ?{}", idx));
        params.push(Box::new(p));
        idx += 1;
    }

    if updates.is_empty() {
        return Ok(());
    }

    updates.push(format!("updated_at = datetime('now')"));
    let query = format!(
        "UPDATE images SET {} WHERE id = ?{}",
        updates.join(", "),
        idx
    );
    params.push(Box::new(id));

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    conn.execute(&query, param_refs.as_slice())
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn delete_image(db: State<'_, Database>, id: i64) -> Result<(), String> {
    let conn = db.conn.lock().unwrap();

    // Get paths to delete files
    let mut stmt = conn
        .prepare("SELECT path, thumbnail_path, svg_path FROM images WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let paths: Vec<Option<String>> = stmt
        .query_row([id], |row| {
            Ok(vec![row.get(0)?, row.get(1)?, row.get(2)?])
        })
        .map_err(|e| e.to_string())?;

    // Delete files
    for path in paths.into_iter().flatten() {
        std::fs::remove_file(&path).ok();
    }

    conn.execute("DELETE FROM images WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
