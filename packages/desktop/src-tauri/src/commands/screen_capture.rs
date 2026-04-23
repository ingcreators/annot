use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{command, AppHandle, Manager, State};

#[derive(Debug, Serialize)]
pub struct CaptureResult {
    pub data_url: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize, Clone)]
pub struct WindowInfo {
    pub hwnd: isize,
    pub title: String,
    pub class: String,
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Serialize, Clone)]
pub struct CaptureParams {
    pub mode: String,
    pub screenshot_data_url: String,
    pub screen_width: u32,
    pub screen_height: u32,
    pub windows: Vec<WindowInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RegionResult {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

/// Shared state for overlay communication
pub struct CaptureState {
    pub params: Mutex<Option<CaptureParams>>,
    pub result_tx: Mutex<Option<tokio::sync::oneshot::Sender<Option<RegionResult>>>>,
}

impl CaptureState {
    pub fn new() -> Self {
        Self {
            params: Mutex::new(None),
            result_tx: Mutex::new(None),
        }
    }
}

/// Capture the entire screen
#[command]
pub async fn capture_screen() -> Result<CaptureResult, String> {
    #[cfg(windows)]
    { win_capture_screen() }
    #[cfg(not(windows))]
    { Err("Only supported on Windows".into()) }
}

/// List visible windows
#[command]
pub async fn list_windows() -> Result<Vec<WindowInfo>, String> {
    #[cfg(windows)]
    { Ok(win_list_windows()) }
    #[cfg(not(windows))]
    { Err("Only supported on Windows".into()) }
}

/// Capture a specific window
#[command]
pub async fn capture_window(hwnd: isize) -> Result<CaptureResult, String> {
    #[cfg(windows)]
    { win_capture_window(hwnd) }
    #[cfg(not(windows))]
    { let _ = hwnd; Err("Only supported on Windows".into()) }
}

/// Capture a region
#[command]
pub async fn capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<CaptureResult, String> {
    #[cfg(windows)]
    { win_capture_region(x, y, width, height) }
    #[cfg(not(windows))]
    { let _ = (x,y,width,height); Err("Only supported on Windows".into()) }
}

#[derive(Debug, Serialize)]
pub struct OverlayResult {
    pub region: RegionResult,
    pub screenshot_data_url: String,
    pub screen_width: u32,
    pub screen_height: u32,
}

/// Start capture with overlay window (called from main window)
#[command]
pub async fn start_capture_overlay(
    app: AppHandle,
    state: State<'_, CaptureState>,
    mode: String,
) -> Result<Option<OverlayResult>, String> {
    #[cfg(windows)]
    {
        use tauri::WebviewWindowBuilder;

        // 0. Close any existing overlay window from previous capture
        if let Some(existing) = app.get_webview_window("capture-overlay") {
            existing.destroy().ok();
            std::thread::sleep(std::time::Duration::from_millis(200));
        }

        // 1. Minimize main window
        if let Some(main) = app.get_webview_window("main") {
            main.minimize().ok();
        }
        std::thread::sleep(std::time::Duration::from_millis(400));

        // 2. Capture screen
        let screen = win_capture_screen()?;
        let windows = if mode == "window" { win_list_windows() } else { vec![] };

        // 3. Set up params and result channel
        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            *state.params.lock().unwrap() = Some(CaptureParams {
                mode: mode.clone(),
                screenshot_data_url: screen.data_url,
                screen_width: screen.width,
                screen_height: screen.height,
                windows,
            });
            *state.result_tx.lock().unwrap() = Some(tx);
        }

        // 5. Get screen size
        let (sw, sh) = unsafe {
            use windows::Win32::UI::WindowsAndMessaging::*;
            (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))
        };

        // 6. Create fullscreen overlay window
        // Use a non-transparent window with the screenshot as background
        // (WebView2 transparent mode is unreliable on Windows)
        let overlay_url = tauri::WebviewUrl::App("capture-overlay.html".into());
        let _overlay = WebviewWindowBuilder::new(&app, "capture-overlay", overlay_url)
            .title("")
            .inner_size(sw as f64, sh as f64)
            .position(0.0, 0.0)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .focused(true)
            .maximized(true)
            .build()
            .map_err(|e| e.to_string())?;

        // 7. Wait for result from overlay
        let region = rx.await.map_err(|_| "Capture cancelled".to_string())?;

        // 8. Restore main window
        if let Some(main) = app.get_webview_window("main") {
            main.unminimize().ok();
            main.show().ok();
            main.set_focus().ok();
        }

        // 9. Return region + the original screenshot (taken before overlay was shown)
        let screenshot_data_url = state.params.lock().unwrap()
            .as_ref()
            .map(|p| p.screenshot_data_url.clone())
            .unwrap_or_default();
        let (sw, sh) = state.params.lock().unwrap()
            .as_ref()
            .map(|p| (p.screen_width, p.screen_height))
            .unwrap_or((0, 0));

        Ok(region.map(|r| OverlayResult {
            region: r,
            screenshot_data_url,
            screen_width: sw,
            screen_height: sh,
        }))
    }

    #[cfg(not(windows))]
    {
        let _ = (app, state, mode);
        Err("Only supported on Windows".into())
    }
}

/// Called by overlay window to get its params
#[command]
pub async fn get_capture_params(state: State<'_, CaptureState>) -> Result<CaptureParams, String> {
    state.params.lock().unwrap().clone().ok_or("No params".into())
}

/// Called by overlay window to send result and close itself
#[command]
pub async fn capture_overlay_result(
    app: AppHandle,
    state: State<'_, CaptureState>,
    result: Option<RegionResult>,
) -> Result<(), String> {
    // Close overlay window first
    if let Some(overlay) = app.get_webview_window("capture-overlay") {
        overlay.destroy().ok();
    }
    // Send result back
    if let Some(tx) = state.result_tx.lock().unwrap().take() {
        tx.send(result).ok();
    }
    Ok(())
}

// ---- Windows implementation ----

#[cfg(windows)]
fn win_capture_screen() -> Result<CaptureResult, String> {
    use windows::Win32::UI::WindowsAndMessaging::*;
    unsafe {
        let w = GetSystemMetrics(SM_CXSCREEN);
        let h = GetSystemMetrics(SM_CYSCREEN);
        win_capture_region(0, 0, w, h)
    }
}

#[cfg(windows)]
fn win_capture_region(x: i32, y: i32, width: i32, height: i32) -> Result<CaptureResult, String> {
    use windows::Win32::Graphics::Gdi::*;
    if width <= 0 || height <= 0 { return Err("Invalid region".into()); }
    unsafe {
        let hdc_screen = GetDC(None);
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm = CreateCompatibleBitmap(hdc_screen, width, height);
        let old = SelectObject(hdc_mem, hbm);
        BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, x, y, SRCCOPY)
            .map_err(|e| format!("BitBlt: {e}"))?;
        SelectObject(hdc_mem, old);
        let jpeg = bitmap_to_jpeg(hbm, width, height)?;
        DeleteObject(hbm);
        DeleteDC(hdc_mem).ok();
        ReleaseDC(None, hdc_screen);
        let b64 = STANDARD.encode(&jpeg);
        Ok(CaptureResult {
            data_url: format!("data:image/jpeg;base64,{}", b64),
            width: width as u32, height: height as u32,
        })
    }
}

#[cfg(windows)]
fn win_capture_window(hwnd: isize) -> Result<CaptureResult, String> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::*;
    unsafe {
        let hwnd = HWND(hwnd as *mut _);
        let mut rect = RECT::default();
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS,
            &mut rect as *mut _ as *mut _, std::mem::size_of::<RECT>() as u32);
        if rect.right - rect.left <= 0 {
            windows::Win32::UI::WindowsAndMessaging::GetWindowRect(hwnd, &mut rect).ok();
        }
        win_capture_region(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top)
    }
}

#[cfg(windows)]
fn win_list_windows() -> Vec<WindowInfo> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM, RECT};
    use windows::Win32::UI::WindowsAndMessaging::*;
    let mut list: Vec<WindowInfo> = Vec::new();
    unsafe {
        unsafe extern "system" fn cb(hwnd: HWND, lp: LPARAM) -> BOOL {
            let list = &mut *(lp.0 as *mut Vec<WindowInfo>);
            if !IsWindowVisible(hwnd).as_bool() { return BOOL(1); }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len == 0 { return BOOL(1); }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title.is_empty() || title == "Program Manager" { return BOOL(1); }
            let mut cbuf = [0u16; 256];
            let clen = GetClassNameW(hwnd, &mut cbuf);
            let class = String::from_utf16_lossy(&cbuf[..clen as usize]);
            let mut r = RECT::default();
            // Use DWM extended frame bounds to exclude window shadow
            let hr = windows::Win32::Graphics::Dwm::DwmGetWindowAttribute(
                hwnd,
                windows::Win32::Graphics::Dwm::DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut _ as *mut _,
                std::mem::size_of::<RECT>() as u32,
            );
            if hr.is_err() {
                GetWindowRect(hwnd, &mut r).ok();
            }
            let w = r.right - r.left; let h = r.bottom - r.top;
            if w < 50 || h < 50 { return BOOL(1); }
            list.push(WindowInfo { hwnd: hwnd.0 as isize, title, class, x: r.left, y: r.top, width: w, height: h });
            BOOL(1)
        }
        EnumWindows(Some(cb), LPARAM(&mut list as *mut _ as isize)).ok();
    }
    list
}

#[cfg(windows)]
unsafe fn bitmap_to_jpeg(hbm: windows::Win32::Graphics::Gdi::HBITMAP, w: i32, h: i32) -> Result<Vec<u8>, String> {
    use windows::Win32::Graphics::Gdi::*;
    let hdc = CreateCompatibleDC(None);
    let old = SelectObject(hdc, hbm);
    let mut bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    GetDIBits(hdc, hbm, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bmi, DIB_RGB_COLORS);
    SelectObject(hdc, old);
    DeleteDC(hdc).ok();
    // BGRA → RGB (drop alpha, JPEG doesn't support alpha)
    let mut rgb = Vec::with_capacity((w * h * 3) as usize);
    for c in px.chunks_exact(4) {
        rgb.push(c[2]); // R (was B in BGRA)
        rgb.push(c[1]); // G
        rgb.push(c[0]); // B (was R in BGRA)
    }
    let buf = std::io::Cursor::new(
        crate::jpeg_utils::encode_progressive_jpeg(&rgb, w as u32, h as u32)?
    );
    Ok(buf.into_inner())
}
