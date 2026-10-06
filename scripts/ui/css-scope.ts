// The one CSS Modules class-name function (P1.23c; ADR 0015 "Carried into P1.23"; architecture record
// 2026-10-06-p116-retention-usage-and-p124-icon-source.md, amendment 20:20Z). The client build, the SSR build and
// Vitest all pass it as `css.modules.generateScopedName` (vite 8.3.1 `CSSModulesOptions`, dist/node/index.d.ts), so
// a class the server renders is the selector in the client's CSS. It hashes the repo-relative POSIX path, never an
// absolute one, so the name is the same on every machine. Only the root vitest.config.ts and apps/<app>/vite.config.ts
// import it.
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";

export const REPO_ROOT = join(import.meta.dirname, "..", "..");

/** `<class>_<first 8 hex of sha256("<repo-relative path>:<class>")>`; `filename` is the absolute module path. */
export function scopedName(name: string, filename: string): string {
  const file = filename.split("?")[0] as string;
  if (!isAbsolute(file)) throw new Error(`css-scope: expected an absolute module path, got ${file}`);
  const path = relative(REPO_ROOT, file);
  if (path.startsWith("..") || isAbsolute(path)) throw new Error(`css-scope: ${file} is outside the repository`);
  const posix = path.split(sep).join("/");
  return `${name}_${createHash("sha256").update(`${posix}:${name}`).digest("hex").slice(0, 8)}`;
}
