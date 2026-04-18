// System tray integration.
//
// Provides tray icon with context menu, minimize-to-tray behavior,
// and dynamic status updates (connection state + agent count).

use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

/// Menu item IDs for dynamic updates.
const MENU_SHOW_HIDE: &str = "show_hide";
const MENU_STATUS: &str = "status";
const MENU_AGENTS: &str = "agents";
const MENU_QUIT: &str = "quit";

/// Tray icon ID.
const TRAY_ID: &str = "main-tray";

/// Set up the system tray with icon and context menu.
pub fn setup_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let icon =
        tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;

    // Build menu items
    let show_hide = MenuItemBuilder::with_id(MENU_SHOW_HIDE, "顯示/隱藏")
        .build(app)?;

    let status_item = MenuItemBuilder::with_id(MENU_STATUS, "狀態: 未連線")
        .enabled(false)
        .build(app)?;

    let agents_item = MenuItemBuilder::with_id(MENU_AGENTS, "代理: 0")
        .enabled(false)
        .build(app)?;

    let quit_item = MenuItemBuilder::with_id(MENU_QUIT, "結束")
        .build(app)?;

    // Build context menu
    let menu = MenuBuilder::new(app)
        .item(&show_hide)
        .separator()
        .item(&status_item)
        .item(&agents_item)
        .separator()
        .item(&quit_item)
        .build()?;

    // Store menu item references for dynamic updates
    app.manage(TrayMenuItems {
        status: status_item,
        agents: agents_item,
    });

    // Build tray icon
    let _tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Pixel Agents Desktop")
        .on_menu_event(move |app_handle, event| {
            match event.id().as_ref() {
                id if id == MENU_SHOW_HIDE => toggle_window_visibility(app_handle),
                id if id == MENU_QUIT => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window_visibility(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Toggle the main window visibility.
fn toggle_window_visibility<R: Runtime>(app_handle: &AppHandle<R>) {
    if let Some(window) = app_handle.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Holds references to dynamically updated tray menu items.
pub struct TrayMenuItems {
    status: tauri::menu::MenuItem<tauri::Wry>,
    agents: tauri::menu::MenuItem<tauri::Wry>,
}

/// Update tray menu items to reflect current connection status and agent count.
pub fn update_tray_status(app: &AppHandle, connected: bool, agent_count: u32) {
    if let Some(items) = app.try_state::<TrayMenuItems>() {
        let status_text = if connected {
            "狀態: 已連線"
        } else {
            "狀態: 未連線"
        };
        let _ = items.status.set_text(status_text);
        let _ = items.agents.set_text(format!("代理: {agent_count}"));
    }
}
