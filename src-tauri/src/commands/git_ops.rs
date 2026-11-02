use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingCommit {
    pub sha: String,
    pub subject: String,
    pub author: String,
    pub committed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFileItem {
    pub status: String, // "M", "A", "D", "??"
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitReleaseCandidate {
    pub tag: String,
    pub commit_short: String,
    pub committed_at: String,
    pub subject: String,
    pub is_deployed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppCompositionReport {
    pub app_id: String,
    pub state: String, // "IN_SYNC" | "LOCAL_WIP" | "AHEAD" | "DIRTY_PROD" | "DIVERGED" | "LEGACY_UNSTAMPED" | "PROD_UNREACHABLE"
    pub local_head_sha: String,
    pub local_head_short: String,
    pub local_branch: String,
    pub local_dirty: bool,
    pub dirty_files: Vec<ChangedFileItem>,
    pub prod_sha: Option<String>,
    pub prod_release_id: Option<String>,
    pub prod_dirty: bool,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub undeployed_commits: Vec<PendingCommit>,
    pub changed_files_since_prod: Vec<ChangedFileItem>,
    pub blast_radius_badges: Vec<String>, // "DB_MIGRATION", "AUTH_SECURITY", "ENV_CONTRACT", "DEPENDENCY_DELTA", "DOCKER_INFRA", "APP_LOGIC_UI"
    pub new_env_keys: Vec<String>,
    pub recent_candidates: Vec<GitReleaseCandidate>,
}

fn run_git(repo_dir: &Path, args: &[&str]) -> Result<String, String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let mut cmd = Command::new("git");
    cmd.current_dir(repo_dir).args(args);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let out = cmd.output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

pub fn classify_blast_radius(paths: &[String], has_new_env_keys: bool) -> Vec<String> {
    let mut badges = BTreeSet::new();
    if has_new_env_keys {
        badges.insert("ENV_CONTRACT".to_string());
    }
    for p in paths {
        let norm = p.replace('\\', "/");
        if norm.contains("migrations/") || norm.ends_with(".sql") {
            badges.insert("DB_MIGRATION".to_string());
        } else if norm.contains("lib/auth")
            || norm.contains("route-guards")
            || norm.ends_with("middleware.ts")
            || norm.contains("api/auth/")
        {
            badges.insert("AUTH_SECURITY".to_string());
        } else if norm == "package.json" || norm == "package-lock.json" {
            badges.insert("DEPENDENCY_DELTA".to_string());
        } else if norm == "Dockerfile"
            || norm == "docker-compose.yml"
            || norm.starts_with("next.config")
            || norm == "deploy-docker.ps1"
        {
            badges.insert("DOCKER_INFRA".to_string());
        } else if norm.starts_with(".env") {
            badges.insert("ENV_CONTRACT".to_string());
        } else if norm.starts_with("src/") {
            badges.insert("APP_LOGIC_UI".to_string());
        }
    }
    badges.into_iter().collect()
}

pub fn extract_env_keys(content: &str) -> BTreeSet<String> {
    content
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#') && l.contains('='))
        .filter_map(|l| l.split('=').next().map(|k| k.trim().to_string()))
        .collect()
}

#[tauri::command]
pub async fn compute_app_composition(
    app_id: String,
    repo_path: String,
    prod_sha: Option<String>,
    prod_release_id: Option<String>,
    prod_dirty: bool,
) -> Result<AppCompositionReport, String> {
    let repo = Path::new(&repo_path);
    let head_sha = run_git(repo, &["rev-parse", "HEAD"])?;
    let head_short = head_sha.chars().take(7).collect::<String>();
    let branch = run_git(repo, &["rev-parse", "--abbrev-ref", "HEAD"]).unwrap_or_else(|_| "HEAD".into());

    let porcelain = run_git(repo, &["status", "--porcelain"]).unwrap_or_default();
    let dirty_files: Vec<ChangedFileItem> = porcelain
        .lines()
        .filter(|l| !l.trim().is_empty() && !l.contains("release-manifest.json"))
        .map(|l| ChangedFileItem {
            status: l.chars().take(2).collect::<String>().trim().to_string(),
            path: l.chars().skip(3).collect::<String>().trim().to_string(),
        })
        .collect();
    let local_dirty = !dirty_files.is_empty();

    // Gather recent git commits and release tags to form candidate rollback and release history
    let mut recent_candidates: Vec<GitReleaseCandidate> = Vec::new();

    // 1. Tags
    if let Ok(tag_out) = run_git(repo, &["tag", "-l", "--format=%(refname:short)|%(creatordate:iso-strict)|%(objectname:short)", "--sort=-creatordate"]) {
        for line in tag_out.lines().filter(|l| !l.is_empty()) {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() >= 3 && !parts[0].is_empty() {
                let tag_name = parts[0].to_string();
                let commit_short = parts[2].to_string();
                let is_deployed = tag_name == "deployed/prod" || prod_sha.as_deref().map(|p| p.starts_with(&commit_short) || commit_short == &p[..p.len().min(7)]).unwrap_or(false);
                recent_candidates.push(GitReleaseCandidate {
                    tag: tag_name,
                    commit_short,
                    committed_at: parts[1].to_string(),
                    subject: format!("Release tag {}", parts[0]),
                    is_deployed,
                });
            }
        }
    }

    // 2. Recent commits (top 8)
    if let Ok(log_out) = run_git(repo, &["log", "-n", "8", "--pretty=format:%h\t%cI\t%s"]) {
        for line in log_out.lines().filter(|l| !l.is_empty()) {
            let cols: Vec<&str> = line.splitn(3, '\t').collect();
            if cols.len() == 3 {
                let c_sha = cols[0].to_string();
                let is_deployed = prod_sha.as_deref().map(|p| p.starts_with(&c_sha) || c_sha == &p[..p.len().min(7)]).unwrap_or(false);
                if !recent_candidates.iter().any(|c| c.commit_short == c_sha && c.tag != c_sha) {
                    recent_candidates.push(GitReleaseCandidate {
                        tag: c_sha.clone(),
                        commit_short: c_sha,
                        committed_at: cols[1].to_string(),
                        subject: cols[2].to_string(),
                        is_deployed,
                    });
                }
            }
        }
    }

    let Some(ref p_sha) = prod_sha else {
        let all_touched: Vec<String> = dirty_files.iter().map(|f| f.path.clone()).collect();
        let blast_radius_badges = classify_blast_radius(&all_touched, false);
        let state = if prod_release_id.is_some() {
            "LEGACY_UNSTAMPED".into()
        } else {
            "PROD_UNREACHABLE".into()
        };
        return Ok(AppCompositionReport {
            app_id,
            state,
            local_head_sha: head_sha,
            local_head_short: head_short,
            local_branch: branch,
            local_dirty,
            dirty_files,
            prod_sha: None,
            prod_release_id,
            prod_dirty,
            ahead_count: 0,
            behind_count: 0,
            undeployed_commits: vec![],
            changed_files_since_prod: vec![],
            blast_radius_badges,
            new_env_keys: vec![],
            recent_candidates,
        });
    };

    if p_sha == "unknown" || p_sha.is_empty() {
        let all_touched: Vec<String> = dirty_files.iter().map(|f| f.path.clone()).collect();
        let blast_radius_badges = classify_blast_radius(&all_touched, false);
        return Ok(AppCompositionReport {
            app_id,
            state: "LEGACY_UNSTAMPED".into(),
            local_head_sha: head_sha,
            local_head_short: head_short,
            local_branch: branch,
            local_dirty,
            dirty_files,
            prod_sha: prod_sha.clone(),
            prod_release_id,
            prod_dirty,
            ahead_count: 0,
            behind_count: 0,
            undeployed_commits: vec![],
            changed_files_since_prod: vec![],
            blast_radius_badges,
            new_env_keys: vec![],
            recent_candidates,
        });
    }

    // Verify prod_sha exists in local git history
    if run_git(repo, &["cat-file", "-t", p_sha]).is_err() {
        return Ok(AppCompositionReport {
            app_id,
            state: "DIVERGED".into(),
            local_head_sha: head_sha,
            local_head_short: head_short,
            local_branch: branch,
            local_dirty,
            dirty_files,
            prod_sha: prod_sha.clone(),
            prod_release_id,
            prod_dirty,
            ahead_count: 0,
            behind_count: 1,
            undeployed_commits: vec![],
            changed_files_since_prod: vec![],
            blast_radius_badges: vec![],
            new_env_keys: vec![],
            recent_candidates,
        });
    }

    let counts_raw = run_git(repo, &["rev-list", "--left-right", "--count", &format!("{}...HEAD", p_sha)])?;
    let mut parts = counts_raw.split_whitespace();
    let behind_count: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead_count: u32 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);

    let mut undeployed_commits = Vec::new();
    let mut changed_files_since_prod = Vec::new();
    if ahead_count > 0 {
        if let Ok(log_out) = run_git(repo, &["log", &format!("{}..HEAD", p_sha), "-n", "50", "--pretty=format:%h\t%s\t%an\t%cI"]) {
            for line in log_out.lines().filter(|l| !l.is_empty()) {
                let cols: Vec<&str> = line.splitn(4, '\t').collect();
                if cols.len() == 4 {
                    undeployed_commits.push(PendingCommit {
                        sha: cols[0].into(),
                        subject: cols[1].into(),
                        author: cols[2].into(),
                        committed_at: cols[3].into(),
                    });
                }
            }
        }
        if let Ok(diff_out) = run_git(repo, &["diff", "--name-status", p_sha, "HEAD"]) {
            for line in diff_out.lines().filter(|l| !l.is_empty()) {
                let cols: Vec<&str> = line.splitn(2, '\t').collect();
                if cols.len() == 2 {
                    changed_files_since_prod.push(ChangedFileItem {
                        status: cols[0].trim().into(),
                        path: cols[1].trim().into(),
                    });
                }
            }
        }
    }

    // Env contract diff (.env.example + .env.production)
    let mut new_env_keys = Vec::new();
    for env_file in [".env.example", ".env.production"] {
        let local_env_path = repo.join(env_file);
        if local_env_path.exists() {
            let local_content = std::fs::read_to_string(&local_env_path).unwrap_or_default();
            let local_keys = extract_env_keys(&local_content);
            let old_content = run_git(repo, &["show", &format!("{}:{}", p_sha, env_file)]).unwrap_or_default();
            let old_keys = extract_env_keys(&old_content);
            for k in local_keys.difference(&old_keys) {
                if !new_env_keys.contains(k) {
                    new_env_keys.push(k.clone());
                }
            }
        }
    }

    let mut all_touched_paths: Vec<String> = changed_files_since_prod.iter().map(|f| f.path.clone()).collect();
    for df in &dirty_files {
        all_touched_paths.push(df.path.clone());
    }
    let blast_radius_badges = classify_blast_radius(&all_touched_paths, !new_env_keys.is_empty());

    let state = if prod_dirty {
        "DIRTY_PROD"
    } else if behind_count > 0 {
        "DIVERGED"
    } else if ahead_count > 0 {
        "AHEAD"
    } else if local_dirty {
        "LOCAL_WIP"
    } else {
        "IN_SYNC"
    }
    .to_string();

    Ok(AppCompositionReport {
        app_id,
        state,
        local_head_sha: head_sha,
        local_head_short: head_short,
        local_branch: branch,
        local_dirty,
        dirty_files,
        prod_sha: prod_sha.clone(),
        prod_release_id,
        prod_dirty,
        ahead_count,
        behind_count,
        undeployed_commits,
        changed_files_since_prod,
        blast_radius_badges,
        new_env_keys,
        recent_candidates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_blast_radius() {
        let files = vec![
            "src/lib/migrations/0004_test.sql".to_string(),
            "package.json".to_string(),
            "src/components/App.tsx".to_string(),
            "Dockerfile".to_string(),
        ];
        let badges = classify_blast_radius(&files, true);
        assert!(badges.contains(&"DB_MIGRATION".to_string()));
        assert!(badges.contains(&"DEPENDENCY_DELTA".to_string()));
        assert!(badges.contains(&"APP_LOGIC_UI".to_string()));
        assert!(badges.contains(&"DOCKER_INFRA".to_string()));
        assert!(badges.contains(&"ENV_CONTRACT".to_string()));
    }

    #[test]
    fn test_extract_env_keys() {
        let env_content = r#"
# Comment
PORT=3000
DATABASE_URL="file:local.db"
EMPTY_VAL=
# ANOTHER_COMMENT=foo
"#;
        let keys = extract_env_keys(env_content);
        assert_eq!(keys.len(), 3);
        assert!(keys.contains("PORT"));
        assert!(keys.contains("DATABASE_URL"));
        assert!(keys.contains("EMPTY_VAL"));
    }
}
