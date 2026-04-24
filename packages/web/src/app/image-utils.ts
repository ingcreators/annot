/**
 * Small image-loading helpers shared across app shell collaborators.
 *
 * Extracted as part of the Phase 1 decomposition (SavePipeline + CaptureHost)
 * so both `CaptureHost` and the remaining `AnnotApp` methods can call them
 * without a back-reference to the orchestrator.
 */

/** Decode a data URL into an `HTMLImageElement`. Resolves once the pixels
 *  are available (naturalWidth/naturalHeight become meaningful); rejects
 *  on decode failure. */
export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Read a `File`/`Blob` as a data URL. Wraps `FileReader.readAsDataURL`. */
export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}
