import type { PageDimensions } from "@ingcreators/annot-core/utils/types";

export function getPageDimensions(): PageDimensions {
  return {
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  };
}

export function scrollTo(x: number, y: number): Promise<void> {
  return new Promise((resolve) => {
    window.scrollTo(x, y);
    // Wait for scroll + repaint
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}
