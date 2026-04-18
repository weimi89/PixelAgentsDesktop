// Native menu bar（目前僅在 macOS 安裝）。
//
// Windows / Linux 多採「內嵌 tab bar 即 UI」設計，Tauri 在這兩個平台若
// 不設定 menu 會不顯示原生選單列，符合我們像素風系統匣常駐程式的視覺
// 預期。macOS 則依 HIG 必須提供應用選單才能顯示應用名稱。

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{
        AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
    };
    use tauri::Manager;

    let handle = app.handle();
    let about_meta = AboutMetadata {
        name: Some("Pixel Agents Desktop".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        copyright: Some("© 2026".to_string()),
        ..Default::default()
    };

    // App 選單（macOS 第一項，必為應用名稱）
    let app_menu = SubmenuBuilder::new(handle, "Pixel Agents Desktop")
        .item(&PredefinedMenuItem::about(handle, None, Some(about_meta))?)
        .separator()
        .item(&PredefinedMenuItem::services(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(handle, None)?)
        .item(&PredefinedMenuItem::hide_others(handle, None)?)
        .item(&PredefinedMenuItem::show_all(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(handle, None)?)
        .build()?;

    // File 選單
    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&PredefinedMenuItem::close_window(handle, Some("Close Window"))?)
        .build()?;

    // Edit — 預設項（剪下/複製/貼上/全選/復原/重做）
    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .item(&PredefinedMenuItem::undo(handle, None)?)
        .item(&PredefinedMenuItem::redo(handle, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(handle, None)?)
        .item(&PredefinedMenuItem::copy(handle, None)?)
        .item(&PredefinedMenuItem::paste(handle, None)?)
        .item(&PredefinedMenuItem::select_all(handle, None)?)
        .build()?;

    // View — 重新載入、全螢幕
    let reload = MenuItemBuilder::with_id("view.reload", "Reload")
        .accelerator("Cmd+R")
        .build(app)?;
    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&reload)
        .item(&PredefinedMenuItem::fullscreen(handle, None)?)
        .build()?;

    // Window
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .item(&PredefinedMenuItem::minimize(handle, None)?)
        .item(&PredefinedMenuItem::maximize(handle, None)?)
        .build()?;

    let menu = MenuBuilder::new(handle)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    app.set_menu(menu)?;

    // 監聽自訂 id 的事件
    handle.on_menu_event(move |app, event| {
        if event.id().as_ref() == "view.reload" {
            // 重新載入主視窗的 WebView
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.eval("window.location.reload()");
            }
        }
    });

    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::App) -> tauri::Result<()> {
    // 非 macOS 平台保留 Tauri 預設（不裝 menu bar）
    Ok(())
}
