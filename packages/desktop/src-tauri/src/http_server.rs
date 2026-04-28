use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use std::io::Read;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

const PORT: u16 = 19530;
const MAX_BODY_SIZE: usize = 50 * 1024 * 1024; // 50MB

#[derive(Deserialize)]
struct CaptureRequest {
    data: String,           // base64 data URL
    source_url: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
}

/// Start the local HTTP server in a background thread.
/// Chrome extension sends captures to http://localhost:19530/capture
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let addr = format!("127.0.0.1:{PORT}");
        let server = match tiny_http::Server::http(&addr) {
            Ok(s) => {
                println!("SVGShot HTTP server listening on {addr}");
                Arc::new(s)
            }
            Err(e) => {
                eprintln!("Failed to start HTTP server on {addr}: {e}");
                return;
            }
        };

        loop {
            let request = match server.recv() {
                Ok(r) => r,
                Err(_) => break,
            };

            let app = app.clone();
            std::thread::spawn(move || {
                handle_request(request, &app);
            });
        }
    });
}

fn handle_request(mut request: tiny_http::Request, app: &AppHandle) {
    let url = request.url().to_string();
    let method = request.method().to_string();

    // CORS preflight
    if method == "OPTIONS" {
        let response = tiny_http::Response::empty(200)
            .with_header(cors_header("Access-Control-Allow-Origin", "*"))
            .with_header(cors_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS"))
            .with_header(cors_header("Access-Control-Allow-Headers", "Content-Type"))
            .with_header(cors_header("Access-Control-Max-Age", "86400"));
        request.respond(response).ok();
        return;
    }

    match (method.as_str(), url.as_str()) {
        ("GET", "/ping") => {
            let body = r#"{"status":"ok","app":"annot"}"#;
            let response = tiny_http::Response::from_string(body)
                .with_header(cors_header("Access-Control-Allow-Origin", "*"))
                .with_header(cors_header("Content-Type", "application/json"));
            request.respond(response).ok();
        }

        ("POST", "/capture") => {
            // Read body
            let mut body = Vec::new();
            let content_len = request.body_length().unwrap_or(0);
            if content_len > MAX_BODY_SIZE {
                let resp = tiny_http::Response::from_string("Body too large")
                    .with_status_code(413)
                    .with_header(cors_header("Access-Control-Allow-Origin", "*"));
                request.respond(resp).ok();
                return;
            }
            if let Err(e) = request.as_reader().read_to_end(&mut body) {
                let resp = tiny_http::Response::from_string(format!("Read error: {e}"))
                    .with_status_code(400)
                    .with_header(cors_header("Access-Control-Allow-Origin", "*"));
                request.respond(resp).ok();
                return;
            }

            // Parse JSON
            let capture: CaptureRequest = match serde_json::from_slice(&body) {
                Ok(c) => c,
                Err(e) => {
                    let resp = tiny_http::Response::from_string(format!("JSON error: {e}"))
                        .with_status_code(400)
                        .with_header(cors_header("Access-Control-Allow-Origin", "*"));
                    request.respond(resp).ok();
                    return;
                }
            };

            // Save to incoming directory
            let result = save_incoming(&capture);

            // Notify the Tauri frontend via event
            app.emit("chrome-capture", serde_json::json!({
                "source_url": capture.source_url.unwrap_or_default(),
                "width": capture.width.unwrap_or(0),
                "height": capture.height.unwrap_or(0),
            })).ok();

            // Also bring window to front
            if let Some(win) = app.get_webview_window("main") {
                win.show().ok();
                win.unminimize().ok();
                win.set_focus().ok();
            }

            let resp_body = match result {
                Ok(path) => format!(r#"{{"success":true,"path":"{}"}}"#, path.replace('\\', "\\\\")),
                Err(e) => format!(r#"{{"success":false,"error":"{}"}}"#, e),
            };

            let response = tiny_http::Response::from_string(resp_body)
                .with_header(cors_header("Access-Control-Allow-Origin", "*"))
                .with_header(cors_header("Content-Type", "application/json"));
            request.respond(response).ok();
        }

        _ => {
            let response = tiny_http::Response::from_string("Not found")
                .with_status_code(404)
                .with_header(cors_header("Access-Control-Allow-Origin", "*"));
            request.respond(response).ok();
        }
    }
}

fn save_incoming(capture: &CaptureRequest) -> Result<String, String> {
    let incoming_dir = crate::portable_dir().join("data").join("incoming");
    std::fs::create_dir_all(&incoming_dir).map_err(|e| e.to_string())?;

    // Parse base64
    let b64 = capture.data.split(',').nth(1).unwrap_or(&capture.data);
    let bytes = STANDARD.decode(b64).map_err(|e| e.to_string())?;

    // Mirror the `defaultAnnotFilenameStem` shape used by the web /
    // extension stores (`annot-YYYYMMDD-HHMMSS-SSS`). Single source of
    // truth lives in `packages/core/src/utils/filename.ts`; the Rust
    // side stays in sync by string contract.
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S-%3f").to_string();
    let filename = format!("annot-{timestamp}.jpg");
    let path = incoming_dir.join(&filename);

    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

    // Write metadata
    let meta = serde_json::json!({
        "filename": filename,
        "path": path.to_string_lossy(),
        "source_url": capture.source_url.as_deref().unwrap_or(""),
        "width": capture.width.unwrap_or(0),
        "height": capture.height.unwrap_or(0),
    });
    let meta_path = incoming_dir.join(format!("{filename}.json"));
    std::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).ok();

    Ok(path.to_string_lossy().to_string())
}

fn cors_header(name: &str, value: &str) -> tiny_http::Header {
    tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap()
}
