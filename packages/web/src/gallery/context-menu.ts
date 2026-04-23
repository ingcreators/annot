/**
 * Floating context menu used by the gallery (3-dot button and right-click).
 */

export interface MenuItem {
  /** Material Symbols icon name. */
  icon: string;
  label: string;
  action: () => void | Promise<void>;
  /** If true, styled as a destructive (red) action. */
  danger?: boolean;
}

interface OpenOptions {
  /** Viewport X (clientX). */
  x: number;
  /** Viewport Y (clientY). */
  y: number;
  items: MenuItem[];
}

let activeMenu: HTMLElement | null = null;

function closeActive(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

/** Show a floating menu at (x, y). Closes any previously-open menu. */
export function openContextMenu(opts: OpenOptions): void {
  closeActive();

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.setAttribute("role", "menu");

  for (const item of opts.items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "menuitem");
    btn.className = "context-menu-item" + (item.danger ? " context-menu-item-danger" : "");
    btn.innerHTML = `<span class="material-symbols-outlined context-menu-icon" aria-hidden="true">${item.icon}</span><span>${item.label}</span>`;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeActive();
      try { await item.action(); } catch (err) { console.error("[context-menu]", err); }
    });
    menu.appendChild(btn);
  }

  // Position off-screen first to measure, then reposition inside viewport.
  menu.style.left = "-9999px";
  menu.style.top = "-9999px";
  document.body.appendChild(menu);
  const { width, height } = menu.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(opts.x, vw - width - 8);
  const top = Math.min(opts.y, vh - height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  activeMenu = menu;

  // Focus first item for keyboard access
  (menu.firstElementChild as HTMLElement | null)?.focus();

  // Close on outside click / Esc / scroll
  const onDocClick = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) closeActive();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeActive();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = Array.from(menu.querySelectorAll<HTMLElement>(".context-menu-item"));
      const idx = items.findIndex((el) => el === document.activeElement);
      const nextIdx = e.key === "ArrowDown"
        ? (idx + 1) % items.length
        : (idx - 1 + items.length) % items.length;
      items[nextIdx]?.focus();
    }
  };
  const onScroll = () => closeActive();
  const cleanup = () => {
    document.removeEventListener("mousedown", onDocClick);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("scroll", onScroll, true);
  };
  // Defer attach so the originating click doesn't immediately close
  requestAnimationFrame(() => {
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
  });

  // Make sure cleanup happens when the menu is removed
  const observer = new MutationObserver(() => {
    if (!document.body.contains(menu)) {
      observer.disconnect();
      cleanup();
    }
  });
  observer.observe(document.body, { childList: true });
}

/** Close any open context menu — useful on navigation or storage switch. */
export function closeContextMenu(): void {
  closeActive();
}
