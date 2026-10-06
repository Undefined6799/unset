// Framework glue size (P1.20; re-measured by P1.23 and P1.38 with the same rule):
//   - every non-blank, non-comment line of a .ts or .tsx file under <dir> counts, test files excluded;
//   - a config file passed with --config counts every line inside a function (a plugin, a hook, a callback);
//   - its remaining, declarative lines (option literals) are free up to 80; each line beyond 80 counts.
// Usage: node scripts/budgets/count-glue-lines.ts <dir> [--config <file>]...   prints one integer.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "vite";
import { countLines } from "./check.ts";

export const FREE_DECLARATIVE_LINES = 80;

const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$/;
const FUNCTION = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

type Node = { type?: string; start?: number; end?: number; [key: string]: unknown };

/** Source files under dir, recursively, tests excluded. */
function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFilesUnder(path);
    return SOURCE.test(entry.name) && !TEST.test(entry.name) ? [path] : [];
  });
}

/** [start, end) offsets of the outermost functions; nested functions are inside them already. */
function functionSpans(node: unknown, spans: [number, number][] = []): [number, number][] {
  if (Array.isArray(node)) {
    for (const child of node) functionSpans(child, spans);
  } else if (node !== null && typeof node === "object") {
    const n = node as Node;
    if (n.type !== undefined && FUNCTION.has(n.type) && n.start !== undefined && n.end !== undefined) {
      spans.push([n.start, n.end]);
      return spans;
    }
    for (const [key, child] of Object.entries(n)) if (key !== "parent") functionSpans(child, spans);
  }
  return spans;
}

/** A config file's code lines, split into lines inside a function and the remaining declarative lines. */
export function configLineSplit(file: string, source: string): { functionLines: number; declarativeLines: number } {
  const lang = file.endsWith(".tsx") ? "tsx" : "ts";
  const { program, errors } = parseSync(file, source, { lang });
  if (errors.length > 0) throw new Error(`cannot parse ${file}: ${errors[0]?.message}`);
  const lines = source.split("\n");
  const lineOf = (offset: number) => source.slice(0, offset).split("\n").length - 1;
  const inFunction = new Set<number>();
  for (const [start, end] of functionSpans(program)) {
    for (let line = lineOf(start); line <= lineOf(Math.max(start, end - 1)); line++) inFunction.add(line);
  }
  const functionLines = countLines(
    [...inFunction]
      .sort((a, b) => a - b)
      .map((i) => lines[i])
      .join("\n"),
  );
  return { functionLines, declarativeLines: countLines(source) - functionLines };
}

/** Glue lines of one config file: function lines, plus declarative lines beyond the free allowance. */
export function configGlueLines(file: string, source: string): number {
  const { functionLines, declarativeLines } = configLineSplit(file, source);
  return functionLines + Math.max(0, declarativeLines - FREE_DECLARATIVE_LINES);
}

export function countGlueLines(dir: string, configs: readonly string[] = []): number {
  const code = sourceFilesUnder(dir).reduce((sum, file) => sum + countLines(readFileSync(file, "utf8")), 0);
  return configs.reduce((sum, file) => sum + configGlueLines(file, readFileSync(file, "utf8")), code);
}

function main(args: readonly string[]): void {
  const [dir, ...rest] = args;
  const configs: string[] = [];
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] !== "--config" || rest[i + 1] === undefined) throw new Error("usage: <dir> [--config <file>]...");
    configs.push(rest[i + 1] as string);
  }
  if (dir === undefined) throw new Error("usage: <dir> [--config <file>]...");
  process.stdout.write(`${countGlueLines(dir, configs)}\n`);
}

if (import.meta.main) main(process.argv.slice(2));
