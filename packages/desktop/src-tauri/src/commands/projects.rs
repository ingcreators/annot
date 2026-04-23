use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Serialize, Deserialize)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub image_count: i64,
}

#[command]
pub async fn list_projects(db: State<'_, Database>) -> Result<Vec<Project>, String> {
    let conn = db.conn.lock().unwrap();
    let mut stmt = conn
        .prepare(
            "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM images WHERE project_id = p.id) as image_count
             FROM projects p ORDER BY p.updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(Project {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                image_count: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

#[command]
pub async fn create_project(
    db: State<'_, Database>,
    name: String,
    description: Option<String>,
) -> Result<Project, String> {
    let conn = db.conn.lock().unwrap();
    let desc = description.unwrap_or_default();
    conn.execute(
        "INSERT INTO projects (name, description) VALUES (?1, ?2)",
        rusqlite::params![&name, &desc],
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();
    Ok(Project {
        id,
        name,
        description: desc,
        created_at: String::new(),
        updated_at: String::new(),
        image_count: 0,
    })
}

#[command]
pub async fn delete_project(db: State<'_, Database>, id: i64) -> Result<(), String> {
    if id == 1 {
        return Err("Cannot delete the default project".to_string());
    }
    let conn = db.conn.lock().unwrap();
    // Move images to default project
    conn.execute(
        "UPDATE images SET project_id = 1 WHERE project_id = ?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM projects WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
