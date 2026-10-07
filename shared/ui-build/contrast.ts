// The contrast check of P1.21 step 9: each pair in contrast-pairs.json, in every theme, against WCAG 2.x. A
// translucent background is composited over `over` (default `ground`) first, so a see-through surface is measured
// as it is seen. Relative luminance and contrast ratio as WCAG 2.2 defines them
// (https://www.w3.org/TR/WCAG22/#dfn-relative-luminance, #dfn-contrast-ratio; sRGB threshold 0.04045).
import { resolveColors, TokenError } from "./build-tokens.ts";

export type ContrastPair = { fg: string; bg: string; min: number; over?: string };
export type ContrastResult = ContrastPair & { theme: string; ratio: number; ok: boolean };
type Rgba = [number, number, number, number];

/** A hex or rgb()/rgba() literal as 0..255 channels and 0..1 alpha. Other forms are not measured: fail closed. */
function parse(color: string): Rgba {
  const hex = /^#([0-9a-f]+)$/i.exec(color)?.[1];
  if (hex !== undefined) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
    const n = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]*)\)$/i.exec(color)?.[1];
  const parts =
    fn
      ?.split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number) ?? [];
  if (parts.length < 3 || parts.length > 4 || parts.some(Number.isNaN))
    throw new TokenError("tokens.contrast_unsupported", `cannot measure ${color}`);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
}

/** `top` drawn over an opaque `below`. */
function composite(top: Rgba, below: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (below[i] ?? 0) * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast of `fg` on `bg`; a translucent `bg` is composited over `over`, and `fg` over the result. */
export function contrastRatio(fg: string, bg: string, over = "#000000"): number {
  const ground = composite(parse(bg), parse(over));
  const text = composite(parse(fg), ground);
  const [hi, lo] = [luminance(text), luminance(ground)].sort((a, b) => b - a);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Every pair in every theme; with `throwOnFail`, the first pair below its minimum stops the build. */
export function checkContrast(
  tokens: Record<string, unknown>,
  pairs: ContrastPair[],
  options: { throwOnFail?: boolean } = {},
): ContrastResult[] {
  const { themes, colors } = resolveColors(tokens);
  const color = (name: string, theme: number): string => {
    const value = colors.get(name)?.[theme];
    if (value === undefined) throw new TokenError("tokens.contrast_pair", `unknown token ${name}`);
    return value;
  };
  return pairs.flatMap((pair) =>
    themes.map((theme, i) => {
      const ratio = contrastRatio(color(pair.fg, i), color(pair.bg, i), color(pair.over ?? "ground", i));
      const result = { ...pair, theme, ratio, ok: ratio >= pair.min };
      if (!result.ok && options.throwOnFail)
        throw new TokenError("tokens.contrast", `${pair.fg}/${pair.bg}/${theme}/${ratio.toFixed(2)}`);
      return result;
    }),
  );
}
