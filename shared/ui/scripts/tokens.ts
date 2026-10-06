// The token build run (P1.21): checks the sheet copy against source.json, checks contrast, and writes
// shared/ui/src/tokens.css; `--check` instead fails when the committed file differs. tokens.css sits in src/ because
// the Biome override that allows hex colours names that path (biome.json, P0.05).
//
// shared/ui imports no Node built-in (dependency-cruiser, shared-ui row), so file access and hashing arrive as `io`;
// the binding to node:fs lives with the tooling that runs it (tokens.test.ts, and scripts/ui/tokens.ts).
import { buildTokens, type FontMetrics, TokenError } from "./build-tokens.ts";
import { type ContrastPair, checkContrast } from "./contrast.ts";

/** Paths are relative to shared/ui. */
export type TokensIo = {
  readText(path: string): string;
  sha256(path: string): string;
  writeText(path: string, text: string): void;
};

const OUTPUT = "src/tokens.css";

function readJson(io: TokensIo, path: string, code: string): Record<string, unknown> {
  try {
    return JSON.parse(io.readText(path));
  } catch (error) {
    throw new TokenError(code, `${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Step 2: the sheet copy and fonts are byte for byte what source.json recorded from the sheet. */
function checkSource(io: TokensIo): void {
  const source = readJson(io, "sheet/source.json", "tokens.parse") as { files?: { path: string; sha256: string }[] };
  if (!Array.isArray(source.files) || source.files.length === 0)
    throw new TokenError("tokens.parse", "sheet/source.json lists no files");
  for (const { path, sha256: expected } of source.files) {
    const actual = io.sha256(path);
    if (actual !== expected)
      throw new TokenError("tokens.source_mismatch", `${path} is ${actual}, source.json says ${expected}`);
  }
}

/** Step 9's table, printed so the numbers can be reviewed; then the first failing pair stops the build. */
function contrastTable(tokens: Record<string, unknown>, pairs: ContrastPair[]): string[] {
  const rows = checkContrast(tokens, pairs).map(
    (r) => `| ${r.fg} | ${r.bg} | ${r.over ?? "ground"} | ${r.theme} | ${r.ratio.toFixed(2)} | ${r.min} |`,
  );
  checkContrast(tokens, pairs, { throwOnFail: true });
  return ["| fg | bg | over | theme | ratio | min |", "| --- | --- | --- | --- | --- | --- |", ...rows];
}

/** 0 when tokens.css is (or now is) current; 1 with the error code on any failure. */
export function runTokens(args: string[], io: TokensIo, print: (line: string) => void): number {
  try {
    const tokens = readJson(io, "sheet/tokens.json", "tokens.parse");
    checkSource(io);
    const metrics = readJson(io, "tokens/font-metrics.json", "tokens.font_metrics") as FontMetrics;
    const pairs = (readJson(io, "tokens/contrast-pairs.json", "tokens.parse") as { pairs: ContrastPair[] }).pairs;
    for (const line of contrastTable(tokens, pairs)) print(line);
    const { css } = buildTokens(tokens, metrics);
    if (!args.includes("--check")) io.writeText(OUTPUT, css);
    else if (io.readText(OUTPUT) !== css)
      throw new TokenError("tokens.stale", `${OUTPUT} differs; run node scripts/ui/tokens.ts`);
    return 0;
  } catch (error) {
    print(error instanceof TokenError ? error.message : `tokens.error: ${String(error)}`);
    return 1;
  }
}
