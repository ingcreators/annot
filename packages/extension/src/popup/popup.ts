import type { PopupMessage } from "../shared/messages.js";

/** Send a fire-and-forget message, then close popup. */
function sendAndClose(msg: PopupMessage): void {
  chrome.runtime.sendMessage(msg);
  setTimeout(() => window.close(), 100);
}

/** Send a message expecting a response. */
function sendWithResponse<T = any>(msg: PopupMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

document.getElementById("btn-visible")!.addEventListener("click", () => {
  sendAndClose({ type: "capture-visible" });
});

document.getElementById("btn-area")!.addEventListener("click", () => {
  sendAndClose({ type: "capture-area" });
});

document.getElementById("btn-full")!.addEventListener("click", () => {
  sendAndClose({ type: "capture-full" });
});

document.getElementById("btn-pages")!.addEventListener("click", () => {
  sendAndClose({ type: "capture-pages" as any });
});

document.getElementById("btn-gallery")!.addEventListener("click", () => {
  sendAndClose({ type: "open-gallery" as any });
});
document.getElementById("btn-gallery-active")!.addEventListener("click", () => {
  sendAndClose({ type: "open-gallery" as any });
});
document.getElementById("btn-gallery-hotkey-active")!.addEventListener("click", () => {
  sendAndClose({ type: "open-gallery" as any });
});

document.getElementById("btn-click-capture")!.addEventListener("click", () => {
  sendAndClose({ type: "click-capture-start" });
});

document.getElementById("btn-stop-click")!.addEventListener("click", () => {
  sendAndClose({ type: "click-capture-stop" });
});

document.getElementById("btn-hotkey-capture")!.addEventListener("click", () => {
  sendAndClose({ type: "hotkey-capture-start" });
});

document.getElementById("btn-stop-hotkey")!.addEventListener("click", () => {
  sendAndClose({ type: "hotkey-capture-stop" });
});

document.getElementById("btn-options")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
  setTimeout(() => window.close(), 100);
});

// ---- Initial state sync ----
(async () => {
  const status = await sendWithResponse<{
    active: boolean;
    count: number;
    hotkeyActive: boolean;
    hotkeyCount: number;
  }>({ type: "click-capture-status" });

  const idle = document.getElementById("idle-state")!;
  const clickActive = document.getElementById("active-state")!;
  const hotkeyActive = document.getElementById("hotkey-active-state")!;

  if (status?.active) {
    idle.style.display = "none";
    clickActive.style.display = "";
    hotkeyActive.style.display = "none";
    const n = document.getElementById("rec-count-num");
    if (n) n.textContent = String(status.count || 0);
  } else if (status?.hotkeyActive) {
    idle.style.display = "none";
    clickActive.style.display = "none";
    hotkeyActive.style.display = "";
    const n = document.getElementById("hotkey-count-num");
    if (n) n.textContent = String(status.hotkeyCount || 0);
  } else {
    idle.style.display = "";
    clickActive.style.display = "none";
    hotkeyActive.style.display = "none";
  }
})();
