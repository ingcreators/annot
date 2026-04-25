/**
 * Document Picture-in-Picture API ambient declaration.
 *
 * Chrome 116+ exposes `window.documentPictureInPicture` for
 * detaching arbitrary HTML into a floating window. Annot uses it
 * for the capture-progress overlay so the user can keep clicking
 * on the page being captured without the overlay covering content.
 *
 * Not in TS lib.dom yet (still on the WICG track), so we declare
 * the slice we use.
 *
 * Phase 5 of `docs/plans/source-audit-cleanup.md`.
 */

interface DocumentPictureInPictureRequestOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
}

interface DocumentPictureInPicture {
  requestWindow(opts?: DocumentPictureInPictureRequestOptions): Promise<Window>;
  readonly window: Window | null;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
  }
}

export {};
