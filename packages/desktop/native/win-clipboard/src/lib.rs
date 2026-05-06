//! Atomic multi-format Win32 clipboard write — N-API addon.
//!
//! Background — see
//! [`docs/plans/_done/desktop-electron-migration.md`](../../../../../docs/plans/_done/desktop-electron-migration.md):
//!
//! Phase 4 of the Tauri-to-Electron migration shipped Annot's
//! Office-paste flow over Electron's built-in
//! `clipboard.writeBuffer(format, buffer)`, knowing that the
//! built-in API runs an
//! `OpenClipboard + EmptyClipboard + SetClipboardData +
//! CloseClipboard` cycle per call. Each call therefore replaces
//! the previous one — back-to-back calls cannot accumulate
//! formats. To set GVML + CF_DIB together (so PowerPoint paste
//! gets native shapes AND Paint / browsers / Sheets get a
//! bitmap fallback) we drive Win32 ourselves: one
//! `OpenClipboard` + one `EmptyClipboard` + N
//! `SetClipboardData` + `CloseClipboard`. That's exactly what
//! the deleted `packages/desktop/src-tauri/src/commands/clipboard.rs`
//! did; this crate re-introduces the equivalent via napi-rs so
//! the Electron main process can call it directly.
//!
//! Surface: a single exported function `writeMultiFormat` taking
//! `Array<{ format: string | number, data: Buffer }>`.
//!
//! - `format: string` ⇒ registered via
//!   `RegisterClipboardFormatW` (custom format, e.g.
//!   `Art::GVML ClipFormat`). The Win32 cache makes repeated
//!   registrations cheap.
//! - `format: number` ⇒ used directly as the Win32 format id
//!   (standard formats like `CF_DIB = 8`).
//!
//! Each entry's bytes are copied into a fresh
//! `GlobalAlloc(GMEM_MOVEABLE)` block, transferred to the
//! clipboard via `SetClipboardData(format, hMem)`, and the
//! ownership of the `hMem` is given to the system clipboard
//! (the addon must NOT free it after the call succeeds — Win32
//! frees it on the next `EmptyClipboard`).
//!
//! Errors short-circuit but `CloseClipboard` is ALWAYS called
//! to release the Win32 clipboard lock. A panicked / aborted
//! call would leave the clipboard locked until the process
//! exits — but the addon never panics: every fallible Win32
//! call funnels through `?` into a `napi::Error`.

use napi::bindgen_prelude::*;
use napi::Either;
use napi_derive::napi;
use windows::core::PCWSTR;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

/// One entry passed to `writeMultiFormat`. The renderer's payload
/// shape is `{ format: string | number, data: Buffer }` —
/// napi-rs's `Either<String, u32>` decodes either at the
/// deserialise boundary so we don't have to inspect the JS
/// argument tag manually.
#[napi(object)]
pub struct ClipboardFormatWrite {
    pub format: Either<String, u32>,
    pub data: Buffer,
}

/// Atomically write every entry in `formats` to the system
/// clipboard. See the file-level comment for the
/// `OpenClipboard + EmptyClipboard + N×SetClipboardData +
/// CloseClipboard` contract.
#[napi(js_name = "writeMultiFormat")]
pub fn write_multi_format(formats: Vec<ClipboardFormatWrite>) -> Result<()> {
    if formats.is_empty() {
        return Err(Error::from_reason("writeMultiFormat: formats array is empty"));
    }

    unsafe {
        OpenClipboard(None).map_err(|e| Error::from_reason(format!("OpenClipboard: {e}")))?;

        // RAII would be nice but `Result<()>` + the explicit
        // `CloseClipboard` at the end is simpler and matches the
        // Tauri impl's flow. Use a closure so the early-return
        // shape stays clean while we still always close.
        let result: Result<()> = (|| {
            EmptyClipboard()
                .map_err(|e| Error::from_reason(format!("EmptyClipboard: {e}")))?;

            for entry in formats.iter() {
                let format_id = match &entry.format {
                    Either::A(name) => {
                        // RegisterClipboardFormatW expects a wide
                        // null-terminated string. Win32 caches
                        // the registration per-session, so calls
                        // for the same name are cheap.
                        let wide: Vec<u16> = name.encode_utf16().chain(std::iter::once(0)).collect();
                        let id = RegisterClipboardFormatW(PCWSTR(wide.as_ptr()));
                        if id == 0 {
                            return Err(Error::from_reason(format!(
                                "RegisterClipboardFormatW failed for {name:?}"
                            )));
                        }
                        id
                    }
                    Either::B(id) => *id,
                };

                let bytes: &[u8] = entry.data.as_ref();
                let hmem = GlobalAlloc(GMEM_MOVEABLE, bytes.len())
                    .map_err(|e| Error::from_reason(format!("GlobalAlloc: {e}")))?;
                let ptr = GlobalLock(hmem);
                if ptr.is_null() {
                    return Err(Error::from_reason("GlobalLock returned null"));
                }
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
                // GlobalUnlock returns FALSE for "lock count
                // reached zero" which is the success case for our
                // single-locker pattern; ignore the BOOL.
                let _ = GlobalUnlock(hmem);

                // SetClipboardData transfers ownership of `hmem`
                // to the system clipboard on success. On
                // failure we'd leak the alloc — but the
                // subsequent EmptyClipboard / CloseClipboard
                // cycle releases it, and we surface the error
                // to JS rather than swallowing it.
                SetClipboardData(format_id, Some(HANDLE(hmem.0 as *mut _)))
                    .map_err(|e| Error::from_reason(format!("SetClipboardData: {e}")))?;
            }

            Ok(())
        })();

        // CloseClipboard always runs, even on error — leaving
        // the clipboard locked would freeze paste in every other
        // app on the system until our process exits.
        let _ = CloseClipboard();
        result
    }
}
