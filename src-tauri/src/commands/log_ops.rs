use crate::db::{SreDatabase, SystemLogEntry};
use std::sync::{Arc, Mutex};
use tauri::State;

#[tauri::command]
pub async fn get_system_logs(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    limit: Option<usize>,
    category: Option<String>,
) -> Result<Vec<SystemLogEntry>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.get_logs(limit.unwrap_or(200), category.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_system_logs(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.clear_logs().map_err(|e| e.to_string())
}
