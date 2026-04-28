/**
 * Excel-style color palette with theme colors, standard colors, and custom picker.
 */
import { setTooltip } from "./tooltip.js";

// Theme colors (top 2 rows: base + tints/shades)
const THEME_COLORS = [
  "#FFFFFF",
  "#000000",
  "#E7E6E6",
  "#44546A",
  "#4472C4",
  "#ED7D31",
  "#A5A5A5",
  "#FFC000",
  "#5B9BD5",
  "#70AD47",
];

// Standard colors
const STANDARD_COLORS = [
  "#C00000",
  "#FF0000",
  "#FFC000",
  "#FFFF00",
  "#92D050",
  "#00B050",
  "#00B0F0",
  "#0070C0",
  "#002060",
  "#7030A0",
];

// Extended tints/shades for theme colors (5 rows)
const TINT_MATRIX = [
  [
    "#F2F2F2",
    "#808080",
    "#D0CECE",
    "#D6DCE4",
    "#D9E2F3",
    "#FCE4D6",
    "#EDEDED",
    "#FFF2CC",
    "#DDEBF7",
    "#E2EFDA",
  ],
  [
    "#D9D9D9",
    "#595959",
    "#AEAAAA",
    "#ADB9CA",
    "#B4C6E7",
    "#F8CBAD",
    "#DBDBDB",
    "#FFE599",
    "#BDD7EE",
    "#C6EFCE",
  ],
  [
    "#BFBFBF",
    "#404040",
    "#757171",
    "#8497B0",
    "#8FAADC",
    "#F4B084",
    "#C0C0C0",
    "#FFD966",
    "#9DC3E6",
    "#A9D18E",
  ],
  [
    "#A6A6A6",
    "#262626",
    "#3A3838",
    "#323F4F",
    "#2F5597",
    "#C55A11",
    "#7B7B7B",
    "#BF8F00",
    "#2E75B6",
    "#548235",
  ],
  [
    "#808080",
    "#0D0D0D",
    "#171616",
    "#222A35",
    "#1F3864",
    "#833C0B",
    "#525252",
    "#806000",
    "#1F4E79",
    "#375623",
  ],
];

export interface ColorPaletteOptions {
  currentColor: string;
  onChange: (color: string) => void;
}

export function createColorPalette(opts: ColorPaletteOptions): HTMLDivElement {
  const panel = document.createElement("div");
  panel.className = "color-palette";

  // Theme colors label
  const themeLabel = document.createElement("div");
  themeLabel.className = "color-palette-label";
  themeLabel.textContent = "Theme Colors";
  panel.appendChild(themeLabel);

  // Theme color row
  const themeRow = createColorRow(THEME_COLORS, opts);
  panel.appendChild(themeRow);

  // Tint rows
  for (const row of TINT_MATRIX) {
    panel.appendChild(createColorRow(row, opts));
  }

  // Standard colors label
  const stdLabel = document.createElement("div");
  stdLabel.className = "color-palette-label";
  stdLabel.style.marginTop = "6px";
  stdLabel.textContent = "Standard Colors";
  panel.appendChild(stdLabel);

  const stdRow = createColorRow(STANDARD_COLORS, opts);
  panel.appendChild(stdRow);

  // Custom color picker
  const customRow = document.createElement("div");
  customRow.className = "color-palette-custom";

  const customBtn = document.createElement("button");
  customBtn.className = "color-palette-custom-btn";
  customBtn.textContent = "More Colors...";

  const customInput = document.createElement("input");
  customInput.type = "color";
  customInput.className = "color-palette-hidden-input";
  customInput.value = opts.currentColor.startsWith("#") ? opts.currentColor : "#ff0000";
  customInput.addEventListener("input", () => {
    opts.onChange(customInput.value);
    // Highlight nothing in grid (custom color)
    panel.querySelectorAll(".color-swatch.active").forEach((s) => s.classList.remove("active"));
  });

  customBtn.addEventListener("click", () => customInput.click());

  customRow.appendChild(customBtn);
  customRow.appendChild(customInput);
  panel.appendChild(customRow);

  return panel;
}

function createColorRow(colors: string[], opts: ColorPaletteOptions): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "color-palette-row";

  for (const color of colors) {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    if (color.toUpperCase() === opts.currentColor.toUpperCase()) {
      swatch.classList.add("active");
    }
    swatch.style.backgroundColor = color;

    // White swatch needs a visible border
    if (color.toUpperCase() === "#FFFFFF") {
      swatch.style.borderColor = "var(--annot-border-color)";
    }

    setTooltip(swatch, color);
    swatch.addEventListener("click", () => {
      // Remove active from all swatches in the palette
      const palette = swatch.closest(".color-palette");
      palette
        ?.querySelectorAll(".color-swatch.active")
        .forEach((s) => s.classList.remove("active"));
      swatch.classList.add("active");
      opts.onChange(color);
    });
    row.appendChild(swatch);
  }

  return row;
}
