use crate::db::{SreDatabase, SystemLogEntry};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsoleSessionRecord {
    pub id: String,
    pub title: String,
    pub lines: Vec<String>,
    pub is_running: bool,
    pub exit_code: Option<i32>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

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

#[tauri::command]
pub async fn save_console_session(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    id: String,
    title: String,
    lines: Vec<String>,
    is_running: bool,
    exit_code: Option<i32>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.save_console_session(&id, &title, &lines, is_running, exit_code).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_saved_console_sessions(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<Vec<ConsoleSessionRecord>, String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    let raw = guard.get_saved_console_sessions().map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|(id, title, lines, is_running, exit_code, created_at, updated_at)| ConsoleSessionRecord {
            id,
            title,
            lines,
            is_running,
            exit_code,
            created_at,
            updated_at,
        })
        .collect())
}

#[tauri::command]
pub async fn delete_console_session(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
    id: String,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_console_session(&id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_all_console_sessions(
    db: State<'_, Arc<Mutex<SreDatabase>>>,
) -> Result<(), String> {
    let guard = db.lock().map_err(|e| e.to_string())?;
    guard.delete_all_console_sessions().map_err(|e| e.to_string())
}
