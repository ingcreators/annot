/**
 * SVG path-data utilities.
 *
 * Pure (Tier A) — string in, string out, no DOM. Used by the move-
 * bakes-coordinates work to translate the absolute coordinates inside
 * a `<path>` element's `d` attribute when the path is moved.
 *
 * Reference: https://www.w3.org/TR/SVG11/paths.html#PathData
 */

/** Per-command parameter slot types. `x` / `y` are world-space
 *  coordinates affected by translation; `n` slots (radii, rotation
 *  angle, flags) are not.
 *
 *  M / L / T / S / Q / C are listed by their per-repetition parameter
 *  shape — the param array can contain N repetitions of the same shape
 *  (e.g. `L 10 20 30 40` = two L repeats of [x,y]). The chunking loop
 *  in `translatePathD` re-applies the slot list per repeat.
 */
type Slot = "x" | "y" | "n";

const COMMAND_PARAMS: Record<string, Slot[]> = {
  M: ["x", "y"],
  L: ["x", "y"],
  H: ["x"],
  V: ["y"],
  C: ["x", "y", "x", "y", "x", "y"],
  S: ["x", "y", "x", "y"],
  Q: ["x", "y", "x", "y"],
  T: ["x", "y"],
  // Arc: rx ry x-axis-rotation large-arc-flag sweep-flag x y
  A: ["n", "n", "n", "n", "n", "x", "y"],
  Z: [],
};

interface PathToken {
  cmd: string;
  params: number[];
}

/** Tokenize an SVG path-data string into command+numbers chunks.
 *
 *  Numbers are parsed eagerly between commands; whitespace, commas
 *  and a leading `-` / `+` (when not following an `e`/`E`) all act as
 *  separators. Exponent notation is preserved (e.g. `1e-5` is one
 *  number).
 *
 *  No semantic validation here — invalid input round-trips through
 *  `serializeTokens` as the same garbage. Callers operating on
 *  Annot-emitted paths are expected to feed valid input.
 */
function tokenize(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  // Match either a single command letter or a number with optional
  // sign + decimal + exponent. The number regex matches the SVG
  // path-number grammar.
  const re = /([A-DF-Za-df-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
  let current: PathToken | null = null;
  let match: RegExpExecArray | null = re.exec(d);
  while (match !== null) {
    const cmdChar = match[1];
    const numStr = match[2];
    if (cmdChar !== undefined) {
      // E/e is excluded from the command class above so it doesn't
      // accidentally split exponent notation.
      current = { cmd: cmdChar, params: [] };
      tokens.push(current);
    } else if (numStr !== undefined) {
      if (!current) {
        // Number before any command — malformed but tolerate by
        // emitting a leading implicit `M`. Pure paranoia; Annot
        // never emits this shape.
        current = { cmd: "M", params: [] };
        tokens.push(current);
      }
      current.params.push(Number.parseFloat(numStr));
    }
    match = re.exec(d);
  }
  return tokens;
}

/** Format a number for SVG output. Strips trailing zeros and the
 *  `.0` for whole numbers; caps precision at 6 fractional digits to
 *  match `transform-utils.ts`'s `fmt` for cross-file consistency. */
function fmt(n: number): string {
  if (Math.abs(n) < 1e-9) return "0";
  return Number(n.toFixed(6)).toString();
}

/** Serialize tokens back to a path-data string. Numbers are space-
 *  separated; commands sit immediately before their first number with
 *  no space (e.g. `M10 20` not `M 10 20`). A negative number after a
 *  digit doesn't need a separator since its `-` acts as one, but we
 *  emit a space anyway for readability — Annot's paths are not size-
 *  critical. */
function serializeTokens(tokens: PathToken[]): string {
  const out: string[] = [];
  for (const tok of tokens) {
    if (tok.params.length === 0) {
      out.push(tok.cmd);
    } else {
      out.push(tok.cmd + tok.params.map(fmt).join(" "));
    }
  }
  return out.join(" ");
}

/**
 * Translate every absolute coordinate in a path-data string by
 * (dx, dy). Relative coordinates (lowercase commands) are unchanged
 * — by definition they're deltas from the previous point, so a
 * global translation has no effect on them.
 *
 * Special case: per the SVG path-data grammar, a leading `m`
 * (lowercase moveto as the first command) is treated as an ABSOLUTE
 * moveto by the renderer, even though subsequent pairs in the same
 * `m` token are still relative `l` continuations. This function
 * honours that: it shifts the first x,y of a leading `m` and
 * leaves the rest of the same token untouched.
 *
 * Idempotence: `translatePathD(translatePathD(d, dx, dy), -dx, -dy)`
 * round-trips to a path that's geometrically equivalent to the
 * input (modulo numeric precision in the formatted output).
 *
 * @param d   original `d` attribute value
 * @param dx  world-space delta to add to every absolute X coord
 * @param dy  world-space delta to add to every absolute Y coord
 * @returns   shifted `d` string suitable for `setAttribute("d", ...)`
 */
export function translatePathD(d: string, dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return d;
  const tokens = tokenize(d);
  let isFirstCommand = true;
  for (const tok of tokens) {
    const upper = tok.cmd.toUpperCase();
    const sig = COMMAND_PARAMS[upper];
    if (!sig || sig.length === 0) {
      isFirstCommand = false;
      continue;
    }
    const isAbsolute = tok.cmd === upper;
    // Leading `m` is absolute for its FIRST x,y pair; subsequent
    // implicit `l` pairs remain relative.
    const firstMQuirk = isFirstCommand && tok.cmd === "m";
    for (let i = 0; i < tok.params.length; i += sig.length) {
      for (let j = 0; j < sig.length; j++) {
        const idx = i + j;
        if (idx >= tok.params.length) break;
        const slot = sig[j];
        if (slot === "n") continue;
        let shift = false;
        if (isAbsolute) shift = true;
        else if (firstMQuirk && i === 0) shift = true;
        if (!shift) continue;
        const cur = tok.params[idx];
        if (cur === undefined) continue;
        tok.params[idx] = cur + (slot === "x" ? dx : dy);
      }
    }
    isFirstCommand = false;
  }
  return serializeTokens(tokens);
}
