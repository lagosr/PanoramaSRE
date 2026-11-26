use crate::db::SreDatabase;
use crate::otto_runtime::OttoRuntimeController;
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show PanoramaSRE", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
    let otto_kill_item = MenuItem::with_id(
        app,
        "toggle_otto_kill_switch",
        "Pause / Resume Otto (Kill-Switch)",
        true,
        None::<&str>,
    )?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit PanoramaSRE Completely", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&show_item, &hide_item, &otto_kill_item, &quit_item])?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/128x128@2x.png"))
        .ok()
        .or_else(|| app.default_window_icon().cloned())
        .or_else(|| {
            tauri::image::Image::from_app_icon_resource(32).ok()
        });

    let mut builder = TrayIconBuilder::new()
        .tooltip("PanoramaSRE - Windows Control Plane")
        .menu(&menu)
        .show_menu_on_left_click(false);

    if let Some(i) = icon {
        builder = builder.icon(i);
    }

    let _tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "toggle_otto_kill_switch" => {
                if let (Some(db_state), Some(runtime_state)) = (
                    app.try_state::<Arc<Mutex<SreDatabase>>>(),
                    app.try_state::<Arc<OttoRuntimeController>>(),
                ) {
                    if let Ok(guard) = db_state.lock() {
                        let currently_active = guard
                            .get_otto_state()
                            .map(|s| s.kill_switch_active)
                            .unwrap_or(false);
                        let next_active = !currently_active;
                        if next_active {
                            runtime_state.request_abort();
                        } else {
                            runtime_state.clear_abort();
                        }
                        if let Ok(next_state) = guard.set_otto_kill_switch(
                            next_active,
                            if next_active {
                                "System tray Global Emergency Kill-Switch engaged"
                            } else {
                                "System tray Global Emergency Kill-Switch released"
                            },
                        ) {
                            let pending = guard.count_pending_otto_approvals().unwrap_or(0);
                            runtime_state.sync_from_db_state(
                                Some(app),
                                next_state.kill_switch_active,
                                &next_state.circuit_breaker_state,
                                pending,
                                next_state.daily_t1_calls,
                                next_state.daily_t2_calls,
                                next_state.dropped_noise_24h_count,
                            );
                        }
                    }
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
