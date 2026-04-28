/**
 * Theme toggle button — single source of truth for light/dark mode switching.
 *
 * Previously two separate implementations existed (one in Toolbar, one in the
 * gallery header) with slightly different behavior: the toolbar copy didn't
 * read the current theme on init, so it always rendered the "dark_mode" icon
 * even when the user had already switched to light mode. This factory
 * dedupes them into a single correct implementation.
 *
 * Call sites pass their own className so the button can match the surrounding
 * toolbar (editor: "toolbar-btn", gallery: "header-info-btn").
 *
 * The choice persists across reloads via `persistThemeChoice()`. Boot-time
 * restoration happens in `applyPersistedTheme()` (called from the host's
 * entry point); see `theme-overrides.ts` for both helpers.
 */
import { persistThemeChoice } from "./theme-overrides.js";
import { setTooltip } from "./tooltip.js";

export function createThemeToggle(
  className = "toolbar-btn material-symbols-outlined",
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  setTooltip(btn, "Toggle light / dark theme");

  const refreshIcon = () => {
    const isLight = document.documentElement.classList.contains("light");
    btn.textContent = isLight ? "light_mode" : "dark_mode";
    btn.setAttribute("aria-pressed", String(isLight));
  };
  refreshIcon();

  btn.addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    persistThemeChoice();
    refreshIcon();
  });

  return btn;
}
