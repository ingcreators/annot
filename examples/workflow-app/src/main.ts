// Workflow-app entrypoint. Phase 1 just imports the shell —
// the element is mounted by markup in `index.html`.
import "./components/app-shell.js";

// Default to the login screen on first load if the URL has no
// hash yet. Subsequent navigations leave the hash alone.
if (!window.location.hash) {
  window.location.hash = "#/";
}
