/**
 * Shared brand mark SVG used across editor headers (image editor's
 * `<annot-editor-header>` and document editor's
 * `<annot-doc-header>`). 30×30 viewport matches the
 * file-manager `.brand` so the logo stays at the same x/y position
 * when the user navigates between gallery and any editor surface.
 * 30px fills ~62% of the 48px header — the sweet spot used by
 * Figma / Slack / Notion in equivalent-height chrome.
 *
 * Keeping the markup in one place means a future brand refresh
 * touches a single file instead of N header components.
 */
export const BRAND_MARK_SVG = `
  <svg width="30" height="30" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="24" cy="7" r="3.5" fill="#7c9cff"/>
    <path d="M24 13 L13 38" stroke="#7ef0c5" stroke-width="4" stroke-linecap="round"/>
    <path d="M24 13 L35 38" stroke="#b391ff" stroke-width="4" stroke-linecap="round"/>
    <path d="M19 24 H29" stroke="#7c9cff" stroke-width="3.5" stroke-linecap="round"/>
  </svg>
`;
