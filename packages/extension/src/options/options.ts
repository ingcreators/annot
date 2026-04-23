import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "../shared/settings.js";

let current: Settings = DEFAULT_SETTINGS;
let savedTimer: number | undefined;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function init(): Promise<void> {
  current = await loadSettings();
  apply(current);
  wireEvents();
}

function apply(s: Settings): void {
  // Overlays
  (el<HTMLSelectElement>("overlay-mode")).value = s.overlays.mode;
  (el<HTMLInputElement>("keep-first-segment")).checked = s.overlays.keepFirstSegment;
  (el<HTMLTextAreaElement>("preserved-selectors")).value = s.overlays.preservedSelectors;

  // Scrollbars
  (el<HTMLInputElement>("scrollbars-hide")).checked = s.scrollbars.hide;

  // Timing
  setRange("scroll-settle", s.timing.scrollSettleMs, "ms");
  setRange("click-settle", s.timing.clickSettleMs, "ms");
  setRange("hotkey-settle", s.timing.hotkeySettleMs, "ms");
  setRange("inter-seg", s.timing.interSegmentMs, "ms");

  // Format
  (el<HTMLSelectElement>("image-format")).value = s.quality.format;
  (el<HTMLSelectElement>("smart-fallback")).value = s.quality.smartFallback;
  setRange("smart-threshold", s.quality.smartColorThreshold, "");

  // Quality
  setRange("jpeg-q", s.quality.jpegPercent, "%");
  setRange("thumb-q", s.quality.thumbnailPercent, "%");
  (el<HTMLSelectElement>("thumb-w")).value = String(s.quality.thumbnailMaxWidth);

  // Visibility: smart-fallback only matters when format === "smart"
  updateSmartFieldsVisibility(s.quality.format);

  // Emulation
  (el<HTMLInputElement>("emulation-enabled")).checked = s.emulation.enabled;
  (el<HTMLSelectElement>("emulation-preset")).value = s.emulation.preset;
  (el<HTMLInputElement>("custom-width")).value = String(s.emulation.customWidth);
  (el<HTMLInputElement>("custom-height")).value = String(s.emulation.customHeight);
  updateEmulationVisibility(s.emulation.enabled, s.emulation.preset);
}

function updateEmulationVisibility(enabled: boolean, preset: string): void {
  (el<HTMLElement>("emulation-options")).style.display = enabled ? "" : "none";
  (el<HTMLElement>("custom-emulation-fields")).style.display =
    enabled && preset === "custom" ? "" : "none";
}

function updateSmartFieldsVisibility(format: string): void {
  const fallbackField = document.getElementById("smart-fallback-field")!;
  const thresholdField = document.getElementById("smart-threshold")?.closest(".field") as HTMLElement | null;
  const show = format === "smart";
  fallbackField.style.display = show ? "" : "none";
  if (thresholdField) thresholdField.style.display = show ? "" : "none";
}

function setRange(id: string, value: number, suffix: string): void {
  const input = el<HTMLInputElement>(id);
  const out = el<HTMLOutputElement>(`${id}-val`);
  input.value = String(value);
  out.textContent = `${value} ${suffix}`.replace(" %", "%");
}

function readCurrent(): Settings {
  return {
    overlays: {
      mode: el<HTMLSelectElement>("overlay-mode").value as Settings["overlays"]["mode"],
      keepFirstSegment: el<HTMLInputElement>("keep-first-segment").checked,
      preservedSelectors: el<HTMLTextAreaElement>("preserved-selectors").value,
    },
    scrollbars: {
      hide: el<HTMLInputElement>("scrollbars-hide").checked,
    },
    timing: {
      scrollSettleMs: Number(el<HTMLInputElement>("scroll-settle").value),
      clickSettleMs: Number(el<HTMLInputElement>("click-settle").value),
      hotkeySettleMs: Number(el<HTMLInputElement>("hotkey-settle").value),
      interSegmentMs: Number(el<HTMLInputElement>("inter-seg").value),
    },
    quality: {
      format: el<HTMLSelectElement>("image-format").value as Settings["quality"]["format"],
      smartFallback: el<HTMLSelectElement>("smart-fallback").value as Settings["quality"]["smartFallback"],
      smartColorThreshold: Number(el<HTMLInputElement>("smart-threshold").value),
      jpegPercent: Number(el<HTMLInputElement>("jpeg-q").value),
      thumbnailPercent: Number(el<HTMLInputElement>("thumb-q").value),
      thumbnailMaxWidth: Number(el<HTMLSelectElement>("thumb-w").value),
    },
    emulation: {
      enabled: el<HTMLInputElement>("emulation-enabled").checked,
      preset: el<HTMLSelectElement>("emulation-preset").value as Settings["emulation"]["preset"],
      customWidth: Number(el<HTMLInputElement>("custom-width").value) || 1920,
      customHeight: Number(el<HTMLInputElement>("custom-height").value) || 1080,
    },
  };
}

function wireEvents(): void {
  // Range inputs — update label and debounce-save
  for (const [id, unit] of [
    ["scroll-settle", "ms"],
    ["click-settle", "ms"],
    ["hotkey-settle", "ms"],
    ["inter-seg", "ms"],
    ["smart-threshold", ""],
    ["jpeg-q", "%"],
    ["thumb-q", "%"],
  ] as const) {
    el<HTMLInputElement>(id).addEventListener("input", () => {
      const v = Number(el<HTMLInputElement>(id).value);
      (el<HTMLOutputElement>(`${id}-val`)).textContent = `${v} ${unit}`.replace(" %", "%");
      scheduleSave();
    });
  }

  // Selects / checkbox / textarea — save on change
  const liveTargets = [
    "overlay-mode", "keep-first-segment", "thumb-w",
    "scrollbars-hide", "preserved-selectors",
    "image-format", "smart-fallback",
    "emulation-enabled", "emulation-preset",
    "custom-width", "custom-height",
  ];
  for (const id of liveTargets) {
    const node = el(id);
    node.addEventListener("change", scheduleSave);
    if (node instanceof HTMLTextAreaElement) node.addEventListener("input", scheduleSave);
    if (node instanceof HTMLInputElement && node.type === "number") {
      node.addEventListener("input", scheduleSave);
    }
  }

  // Format select also toggles visibility of smart-only fields
  el<HTMLSelectElement>("image-format").addEventListener("change", () => {
    updateSmartFieldsVisibility(el<HTMLSelectElement>("image-format").value);
  });

  // Emulation is a plain setting — no permissions needed (we physically
  // resize the browser window, which only needs the existing `tabs` perm).
  el<HTMLInputElement>("emulation-enabled").addEventListener("change", () => {
    updateEmulationVisibility(
      el<HTMLInputElement>("emulation-enabled").checked,
      el<HTMLSelectElement>("emulation-preset").value,
    );
  });
  el<HTMLSelectElement>("emulation-preset").addEventListener("change", () => {
    updateEmulationVisibility(
      el<HTMLInputElement>("emulation-enabled").checked,
      el<HTMLSelectElement>("emulation-preset").value,
    );
  });

  // Reset button
  el<HTMLButtonElement>("btn-reset").addEventListener("click", async () => {
    current = { ...DEFAULT_SETTINGS,
      overlays: { ...DEFAULT_SETTINGS.overlays },
      scrollbars: { ...DEFAULT_SETTINGS.scrollbars },
      timing: { ...DEFAULT_SETTINGS.timing },
      quality: { ...DEFAULT_SETTINGS.quality },
      emulation: { ...DEFAULT_SETTINGS.emulation },
    };
    apply(current);
    await saveSettings(current);
    flashSaved("Reset to defaults");
  });
}

function scheduleSave(): void {
  window.clearTimeout(savedTimer);
  savedTimer = window.setTimeout(async () => {
    current = readCurrent();
    await saveSettings(current);
    flashSaved("Saved");
  }, 250);
}

function flashSaved(text: string): void {
  const note = el<HTMLElement>("saved-note");
  note.textContent = text;
  note.classList.add("visible");
  window.setTimeout(() => note.classList.remove("visible"), 1400);
}

void init();
