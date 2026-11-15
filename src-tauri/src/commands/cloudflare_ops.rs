use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudflareDeploymentDto {
    pub id: String,
    pub short_id: String,
    pub environment: String,
    pub status: String,
    pub url: String,
    pub created_on: String,
    pub branch: String,
    pub commit_hash: String,
    pub commit_message: String,
    pub is_active: bool,
}

fn validate_cf_project_name(project_name: &str) -> Result<String, String> {
    let clean = project_name.trim().to_string();
    if clean.is_empty()
        || !clean
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Err(format!(
            "Invalid Cloudflare Pages project name '{}'",
            project_name
        ));
    }
    Ok(clean)
}

fn extract_json_payload(raw: &str) -> Option<&str> {
    let trimmed = raw.trim();
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return Some(trimmed);
    }
    if let Some(idx) = trimmed.find('[') {
        return Some(&trimmed[idx..]);
    }
    if let Some(idx) = trimmed.find('{') {
        return Some(&trimmed[idx..]);
    }
    None
}

fn pick_str(obj: &serde_json::Map<String, Value>, keys: &[&str]) -> String {
    for k in keys {
        if let Some(val) = obj.get(*k) {
            if let Some(s) = val.as_str() {
                let t = s.trim();
                if !t.is_empty() && t != "-" {
                    return t.to_string();
                }
            }
        }
    }
    String::new()
}

/// Parses JSON array (or object envelope) produced by `npx wrangler pages deployment list --json`.
pub fn parse_wrangler_deployments_json(raw: &str) -> Result<Vec<CloudflareDeploymentDto>, String> {
    let json_slice = extract_json_payload(raw)
        .ok_or_else(|| "Wrangler deployment list output did not contain JSON".to_string())?;
    let parsed: Value = serde_json::from_str(json_slice)
        .map_err(|e| format!("Failed to parse Wrangler deployment JSON: {}", e))?;

    let items = if let Some(arr) = parsed.as_array() {
        arr.clone()
    } else if let Some(arr) = parsed.get("deployments").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = parsed.get("result").and_then(|v| v.as_array()) {
        arr.clone()
    } else {
        return Err("Unexpected JSON structure from Wrangler deployment list".to_string());
    };

    let mut out = Vec::with_capacity(items.len());
    let mut marked_active_prod = false;

    for item in items {
        let Some(obj) = item.as_object() else {
            continue;
        };

        let id = pick_str(obj, &["id", "Id", "ID", "deployment_id"]);
        if id.is_empty() {
            continue;
        }
        let short_id = id.chars().take(8).collect::<String>();
        let environment = {
            let env = pick_str(obj, &["environment", "Environment"]);
            if env.is_empty() {
                "production".to_string()
            } else {
                env.to_ascii_lowercase()
            }
        };
        let raw_status = pick_str(obj, &["status", "Status"]);
        let is_failed = matches!(
            raw_status.to_ascii_lowercase().as_str(),
            "failure" | "failed" | "canceled" | "cancelled"
        );
        let url = pick_str(obj, &["url", "URL", "Url", "Deployment"]);
        let mut created_on = pick_str(
            obj,
            &["created_on", "Created on", "CreatedOn", "Created"],
        );
        if created_on.is_empty() && !is_failed && !raw_status.is_empty() {
            created_on = raw_status.clone();
        }

        let trigger_meta = obj
            .get("deployment_trigger")
            .and_then(|t| t.get("metadata"))
            .and_then(|m| m.as_object());

        let mut branch = pick_str(obj, &["branch", "Branch"]);
        if branch.is_empty() {
            if let Some(meta) = trigger_meta {
                branch = pick_str(meta, &["branch", "Branch"]);
            }
        }
        if branch.is_empty() {
            branch = "main".to_string();
        }

        let mut commit_hash = pick_str(obj, &["commit_hash", "CommitHash", "Commit"]);
        if commit_hash.is_empty() {
            if let Some(meta) = trigger_meta {
                commit_hash = pick_str(meta, &["commit_hash", "commitHash"]);
            }
        }
        if commit_hash.is_empty() {
            let source_str = pick_str(obj, &["Source", "source"]);
            if let Some(first_tok) = source_str.split_whitespace().next() {
                if (7..=40).contains(&first_tok.len())
                    && first_tok.chars().all(|c| c.is_ascii_hexdigit())
                {
                    commit_hash = first_tok.to_string();
                }
            }
        }

        let mut commit_message = pick_str(obj, &["commit_message", "CommitMessage", "Source"]);
        if commit_message.is_empty() {
            if let Some(meta) = trigger_meta {
                commit_message = pick_str(meta, &["commit_message", "commitMessage"]);
            }
        }

        let explicit_active = obj
            .get("is_active")
            .and_then(|v| v.as_bool())
            .or_else(|| obj.get("is_current_production").and_then(|v| v.as_bool()));

        let is_active = if is_failed {
            false
        } else {
            match explicit_active {
                Some(flag) => flag,
                None => {
                    if environment == "production" && !marked_active_prod {
                        marked_active_prod = true;
                        true
                    } else {
                        false
                    }
                }
            }
        };

        out.push(CloudflareDeploymentDto {
            id,
            short_id,
            environment,
            status: raw_status,
            url,
            created_on,
            branch,
            commit_hash,
            commit_message,
            is_active,
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn list_cloudflare_deployments(
    workspace_path: String,
    project_name: String,
) -> Result<Vec<CloudflareDeploymentDto>, String> {
    let project = validate_cf_project_name(&project_name)?;
    let ws = workspace_path.trim().to_string();
    if ws.is_empty() || !Path::new(&ws).exists() {
        return Err(format!("Workspace path does not exist: {}", workspace_path));
    }

    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        let output = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            Command::new("cmd.exe")
                .args([
                    "/C",
                    "npx",
                    "wrangler",
                    "pages",
                    "deployment",
                    "list",
                    &format!("--project-name={}", project),
                    "--json",
                ])
                .current_dir(&ws)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
        };

        #[cfg(not(windows))]
        let output = Command::new("npx")
            .args([
                "wrangler",
                "pages",
                "deployment",
                "list",
                &format!("--project-name={}", project),
                "--json",
            ])
            .current_dir(&ws)
            .output();

        let output = output.map_err(|e| format!("Failed to invoke wrangler: {}", e))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            let err_msg = if !stderr.trim().is_empty() {
                stderr.trim().to_string()
            } else {
                stdout.trim().to_string()
            };
            return Err(format!(
                "wrangler pages deployment list failed ({}): {}",
                output.status, err_msg
            ));
        }

        parse_wrangler_deployments_json(&stdout)
    })
    .await
    .map_err(|e| format!("Deployment list task join error: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wrangler_v4_and_api_deployment_json_shapes() {
        let sample = r#"
        [
          {
            "Id": "8f12c4e2-1234-4a5b-9999-abcdef123456",
            "Environment": "Production",
            "Branch": "main",
            "Source": "729d8b5 Initial deploy",
            "Deployment": "https://8f12c4e2.parakith-site.pages.dev",
            "Created on": "2026-11-14T22:00:00Z"
          },
          {
            "id": "11112222-3333-4444-5555-666677778888",
            "environment": "preview",
            "url": "https://11112222.parakith-site.pages.dev",
            "created_on": "2026-11-14T20:00:00Z",
            "deployment_trigger": {
              "metadata": {
                "branch": "feat/health",
                "commit_hash": "abcdef1234567",
                "commit_message": "Add stealth probe"
              }
            }
          }
        ]
        "#;

        let parsed = parse_wrangler_deployments_json(sample).expect("parse deployments");
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].short_id, "8f12c4e2");
        assert_eq!(parsed[0].environment, "production");
        assert!(parsed[0].is_active);
        assert_eq!(parsed[1].environment, "preview");
        assert_eq!(parsed[1].branch, "feat/health");
        assert_eq!(parsed[1].commit_hash, "abcdef1234567");
        assert!(!parsed[1].is_active);
    }

    #[test]
    fn validates_cloudflare_project_slug() {
        assert_eq!(validate_cf_project_name("parakith-site").unwrap(), "parakith-site");
        assert!(validate_cf_project_name("parakith; calc").is_err());
        assert!(validate_cf_project_name("").is_err());
    }

    #[test]
    fn handles_wrangler_4_162_failure_status_and_relative_age() {
        let sample = r#"
        [
          {
            "Id": "099a859f-4a84-47bb-a057-9285308c995e",
            "Environment": "Production",
            "Branch": "main",
            "Source": "5aaa1c3",
            "Deployment": "https://099a859f.parakith-site.pages.dev",
            "Status": "Failure",
            "Build": "https://dash.cloudflare.com/x"
          },
          {
            "Id": "2a0b05fb-8515-4b46-8ceb-65eb0370b896",
            "Environment": "Production",
            "Branch": "main",
            "Source": "810d12e",
            "Deployment": "https://2a0b05fb.parakith-site.pages.dev",
            "Status": "7 hours ago",
            "Build": "https://dash.cloudflare.com/y"
          }
        ]
        "#;

        let parsed = parse_wrangler_deployments_json(sample).expect("parse wrangler 4.162 json");
        assert_eq!(parsed.len(), 2);

        assert_eq!(parsed[0].short_id, "099a859f");
        assert_eq!(parsed[0].status, "Failure");
        assert_eq!(parsed[0].commit_hash, "5aaa1c3");
        assert_eq!(parsed[0].created_on, "");
        assert!(!parsed[0].is_active, "failed deployment must never be marked LIVE");

        assert_eq!(parsed[1].short_id, "2a0b05fb");
        assert_eq!(parsed[1].status, "7 hours ago");
        assert_eq!(parsed[1].commit_hash, "810d12e");
        assert_eq!(parsed[1].created_on, "7 hours ago");
        assert!(parsed[1].is_active, "first non-failed production deployment should be LIVE");
    }
}
