/**
 * Minimal ambient declarations for the Google Identity Services
 * (`window.google.accounts.oauth2.*`) and Google Picker
 * (`window.gapi.load`, `window.google.picker.*`) globals loaded
 * via `<script>` tag at runtime.
 *
 * Why hand-rolled instead of `@types/google.accounts` /
 * `@types/google.picker`: Annot uses a tiny slice of each API
 * (initTokenClient + revoke from GIS, PickerBuilder + DocsView
 * from Picker). Pulling in 10 KB of typings for 6 method names
 * is over-eager dependency growth; the surface is small and
 * stable enough to declare locally.
 *
 * Phase 5 of `docs/plans/source-audit-cleanup.md`.
 */

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  /** Other GIS fields (`scope`, `token_type`, `expires_in`) exist
   *  too but Annot doesn't read them; left out so the surface
   *  stays narrow. */
}

interface GoogleTokenClient {
  requestAccessToken(): void;
}

interface GoogleTokenClientInit {
  client_id: string;
  scope: string;
  prompt?: "" | "select_account" | "consent" | "none";
  callback: (response: GoogleTokenResponse) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient(init: GoogleTokenClientInit): GoogleTokenClient;
  /** `revoke(token, done?)` per GIS docs; `done` is optional and
   *  Annot doesn't pass it, so its type is loose here. */
  revoke(accessToken: string | null, done?: () => void): void;
}

interface GooglePickerView {
  setSelectFolderEnabled(enabled: boolean): GooglePickerView;
  setMimeTypes(mimeTypes: string): GooglePickerView;
}

interface GooglePickerDocsViewCtor {
  new (viewId: string): GooglePickerView;
}

interface GooglePicker {
  setVisible(visible: boolean): void;
}

interface GooglePickerBuilder {
  setTitle(title: string): GooglePickerBuilder;
  addView(view: GooglePickerView): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  setCallback(cb: (data: GooglePickerCallbackData) => void): GooglePickerBuilder;
  build(): GooglePicker;
}

interface GooglePickerBuilderCtor {
  new (): GooglePickerBuilder;
}

interface GooglePickerCallbackData {
  action: "picked" | "cancel" | "loaded";
  docs?: Array<{ id: string; name: string }>;
}

interface GooglePickerNamespace {
  DocsView: GooglePickerDocsViewCtor;
  PickerBuilder: GooglePickerBuilderCtor;
  ViewId: { FOLDERS: string; [key: string]: string };
}

interface GoogleAccountsNamespace {
  oauth2: GoogleAccountsOAuth2;
}

interface GoogleNamespace {
  accounts: GoogleAccountsNamespace;
  picker: GooglePickerNamespace;
}

interface GapiNamespace {
  load(name: string, callback: () => void): void;
}

declare global {
  interface Window {
    google?: GoogleNamespace;
    gapi?: GapiNamespace;
  }
}

export {};
