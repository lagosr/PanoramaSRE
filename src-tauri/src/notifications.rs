use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone)]
struct AlertHistory {
    last_fired: Instant,
    last_state: String,
}

pub struct NotificationEngine {
    history: Mutex<HashMap<String, AlertHistory>>,
    cooldown: Duration,
}

impl NotificationEngine {
    pub fn new() -> Self {
        NotificationEngine {
            history: Mutex::new(HashMap::new()),
            cooldown: Duration::from_secs(15 * 60), // 15-minute cooldown per entity
        }
    }

    /// Edge-triggered alert: fires ONLY when state transitions or cooldown expires
    pub fn should_fire_alert(&self, entity_id: &str, current_state: &str) -> bool {
        let mut history = self.history.lock().unwrap();
        let now = Instant::now();

        if let Some(entry) = history.get_mut(entity_id) {
            let state_changed = entry.last_state != current_state;
            let cooldown_expired = now.duration_since(entry.last_fired) >= self.cooldown;

            if state_changed || cooldown_expired {
                entry.last_fired = now;
                entry.last_state = current_state.to_string();
                true
            } else {
                false
            }
        } else {
            // First time seeing this entity
            history.insert(
                entity_id.to_string(),
                AlertHistory {
                    last_fired: now,
                    last_state: current_state.to_string(),
                },
            );
            true
        }
    }
}
