// Every CSS Module is linked as a stylesheet, never injected: style-src allows /assets/ only.
// Prod: one client entry (styles.ts) imports all modules, so the build emits their CSS once.
// Dev: each module is linked with ?direct, which Vite serves as plain CSS (dev-only path).
import { cssUrls } from "./manifest.ts";

const modules = Object.keys(import.meta.glob("/src/**/*.module.css"));

export function stylesheetHrefs(): string[] {
  if (import.meta.env.PROD) return cssUrls("src/glue/styles.ts");
  return modules.map((path) => `${path}?direct`);
}
