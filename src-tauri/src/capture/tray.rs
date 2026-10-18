//! Menu-bar / system-tray icon. Glue only: the menu items and what they do
//! are defined (and tested) in `lifecycle`.

use super::lifecycle::{request_quit, show_main, show_quick_capture, tray_action, TrayAction, TRAY_ITEMS};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

pub fn build<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let items = TRAY_ITEMS
        .iter()
        .map(|(id, label)| MenuItem::with_id(app, *id, *label, true, None::<&str>))
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn tauri::menu::IsMenuItem<R>> = items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<R>).collect();
    let menu = Menu::with_items(app, &refs)?;
    let icon = Image::from_bytes(include_bytes!("../../icons/tray.png"))?;
    TrayIconBuilder::with_id("markdaun")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("MarkDaun")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_action(event.id.as_ref()) {
            Some(TrayAction::OpenMain) => show_main(app),
            Some(TrayAction::QuickCapture) => show_quick_capture(app),
            Some(TrayAction::Quit) => request_quit(app),
            None => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
