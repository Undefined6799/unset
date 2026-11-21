// The chat page as the door loads it at start (ADR 0088 decision 1): index.html and the flat assets/ folder Vite
// writes, each file typed by its extension. A file of a kind the page never ships stops the door from starting, so
// nothing unexpected is ever served from the page's origin.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadChatPage } from "./page.ts";

function built(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "chat-page-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  return dir;
}

describe("loadChatPage", () => {
  test("door.page_load: the document and every built file, keyed by the path it is served at", () => {
    const page = loadChatPage(
      built({ "index.html": "<!doctype html>", "assets/a-1.js": "x", "assets/a-1.css": "y", "assets/f.woff2": "z" }),
    );
    expect(page.html).toBe("<!doctype html>");
    expect([...page.files.keys()].sort()).toEqual(["/assets/a-1.css", "/assets/a-1.js", "/assets/f.woff2"]);
    expect(page.files.get("/assets/a-1.css")?.type).toBe("text/css; charset=utf-8");
    expect(page.files.get("/assets/f.woff2")?.type).toBe("font/woff2");
    expect(new TextDecoder().decode(page.files.get("/assets/a-1.js")?.body)).toBe("x");
  });

  test("door.page_load_refuses: no document, or a file of another kind, stops the start", () => {
    expect(() => loadChatPage(built({ "assets/a.js": "x" }))).toThrow();
    expect(() => loadChatPage(built({ "index.html": "", "assets/a.map": "x" }))).toThrow(/a\.map/);
  });
});
