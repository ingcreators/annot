/** Dash pattern multipliers (relative to stroke-width), matching Office presets */
export const DASH_MULTIPLIERS: Record<string, number[]> = {
  dash: [4, 3],
  dot: [1, 3],
  dashDot: [4, 3, 1, 3],
  lgDash: [8, 3],
};

/** Compute SVG stroke-dasharray from a dash key and stroke width */
export function computeDasharray(key: string, strokeWidth: number): string {
  const mult = DASH_MULTIPLIERS[key];
  if (!mult) return "";
  return mult.map((m) => Math.max(1, Math.round(m * strokeWidth))).join(",");
}

/** Detect dash key from an SVG dasharray string and stroke width */
export function detectDashKey(dasharray: string, strokeWidth: number): string {
  if (!dasharray) return "";
  for (const [key, mult] of Object.entries(DASH_MULTIPLIERS)) {
    const expected = mult.map((m) => Math.max(1, Math.round(m * strokeWidth))).join(",");
    if (expected === dasharray) return key;
  }
  // Fallback heuristic
  const parts = dasharray.split(",").map(Number);
  if (parts.length === 4) return "dashDot";
  if (parts.length === 2 && parts[0] <= strokeWidth * 2) return "dot";
  if (parts.length === 2 && parts[0] > strokeWidth * 5) return "lgDash";
  return "dash";
}
